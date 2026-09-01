#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

readonly ROOT=/opt/domain-map
readonly INCOMING_ROOT="$ROOT/incoming"
readonly RELEASE_ROOT="$ROOT/releases"
readonly CURRENT="$ROOT/current"
readonly PREVIOUS="$ROOT/previous"
readonly COMPOSE_ENV=/etc/domain-map/compose.env
readonly REGISTRY_ENV=/etc/domain-map/registry.env
readonly BACKUP_SCRIPT=/usr/local/sbin/domain-map-backup.sh
readonly PROJECT=domain-map-prod
readonly APP_RE='^ghcr\.io/huangyincan/jobmap-app@sha256:[0-9a-f]{64}$'
readonly MIGRATE_RE='^ghcr\.io/huangyincan/jobmap-migrate@sha256:[0-9a-f]{64}$'

log() { printf '%s\n' "$*"; }
die() { printf 'domain-map deploy: %s\n' "$*" >&2; exit 1; }

usage() {
  cat >&2 <<'EOF'
usage:
  domain-map-deploy apply <release-sha> <app-image-digest> <migrate-image-digest>
  domain-map-deploy rollback [release-id]
  domain-map-deploy status
EOF
  exit 2
}

require_root() {
  [[ "$EUID" -eq 0 ]] || die 'must run as root'
}

validate_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] || die 'release SHA must be a 40-character lowercase hexadecimal commit'
}

validate_release_id() {
  if [[ "$1" =~ ^[0-9a-f]{40}$ ]]; then
    return
  fi
  [[ "$1" =~ ^[0-9a-f]{40}--[0-9a-f]{64}--[0-9a-f]{64}$ ]] \
    || die 'release id must be a commit SHA or a commit plus both image digests'
}

release_sha_for_id() {
  local release_id=$1
  validate_release_id "$release_id"
  printf '%s\n' "${release_id%%--*}"
}

release_id_for() {
  local sha=$1 app_image=$2 migrate_image=$3
  printf '%s--%s--%s\n' "$sha" "${app_image##*@sha256:}" "${migrate_image##*@sha256:}"
}

validate_image() {
  [[ "$1" =~ $APP_RE ]] || die 'app image must be the pinned approved GHCR digest'
  [[ "$2" =~ $MIGRATE_RE ]] || die 'migration image must be the pinned approved GHCR digest'
}

assert_root_file() {
  local path=$1
  [[ -f "$path" && ! -L "$path" ]] || die "required file is missing or a symlink: $path"
  [[ "$(stat -c '%u' "$path")" == 0 ]] || die "required file is not root-owned: $path"
  [[ "$(stat -c '%a' "$path")" == 600 ]] || die "required file must have mode 0600: $path"
}

assert_root_dir() {
  local path=$1
  [[ -d "$path" && ! -L "$path" ]] || die "required directory is missing or a symlink: $path"
  [[ "$(stat -c '%u' "$path")" == 0 ]] || die "required directory is not root-owned: $path"
}

ensure_host_config() {
  assert_root_file /etc/domain-map/db.env
  assert_root_file /etc/domain-map/app.env
  assert_root_dir /etc/domain-map
  assert_root_dir "$ROOT"
  if [[ -L "$CURRENT" ]]; then
    assert_root_file "$COMPOSE_ENV"
  fi
  if [[ -e "$RELEASE_ROOT" ]]; then
    assert_root_dir "$RELEASE_ROOT"
  else
    install -d -o root -g root -m 755 "$RELEASE_ROOT"
  fi
  if [[ -e "$INCOMING_ROOT" ]]; then
    [[ -d "$INCOMING_ROOT" && ! -L "$INCOMING_ROOT" ]] || die 'incoming release root is not a directory'
  else
    mkdir -p "$INCOMING_ROOT"
  fi
  chown root:root "$RELEASE_ROOT"
  chmod 755 "$RELEASE_ROOT"
}

registry_login() {
  [[ -e "$REGISTRY_ENV" ]] || return 0
  assert_root_file "$REGISTRY_ENV"
  local ghcr_username ghcr_token
  # This file is installed out of band and is root-only. Its values never go
  # through command-line arguments or deployment logs.
  set -a
  # shellcheck disable=SC1091
  . "$REGISTRY_ENV"
  set +a
  ghcr_username=${GHCR_USERNAME:-}
  ghcr_token=${GHCR_TOKEN:-}
  [[ -n "$ghcr_username" && -n "$ghcr_token" ]] || die 'registry credentials are incomplete'
  printf '%s' "$ghcr_token" | docker login ghcr.io --username "$ghcr_username" --password-stdin >/dev/null
  unset ghcr_username ghcr_token GHCR_USERNAME GHCR_TOKEN
}

compose() {
  docker compose --project-name "$PROJECT" --env-file "$1" --file "$2" "${@:3}"
}

validate_compose() {
  local compose_env=$1 compose_file=$2 services
  # The incoming file is copied by a non-root deploy account. Reject Docker
  # escape hatches before root's Compose client parses or runs it.
  if grep -Eq '(^|[[:space:]])(build|privileged|network_mode|pid|devices|cap_add|security_opt):|docker\.sock|/var/run/docker|/proc/|/sys/' "$compose_file"; then
    die 'release Compose contains a forbidden host/Docker escape hatch'
  fi
  grep -qF '    image: ${DOMAIN_MAP_APP_IMAGE' "$compose_file" || die 'release Compose app image contract is missing'
  grep -qF '    image: ${DOMAIN_MAP_MIGRATE_IMAGE' "$compose_file" || die 'release Compose migration image contract is missing'
  services=$(compose "$compose_env" "$compose_file" --profile ops config --services | sort | paste -sd ' ' -)
  [[ "$services" == 'app db migrate' ]] || die "release Compose service set is invalid: $services"
}

validate_legacy_compose() {
  local compose_env=$1 compose_file=$2 services
  if grep -Eq '(^|[[:space:]])(privileged|network_mode|pid|devices|cap_add|security_opt):|docker\.sock|/var/run/docker|/proc/|/sys/' "$compose_file"; then
    die 'legacy Compose contains a forbidden host/Docker escape hatch'
  fi
  services=$(compose "$compose_env" "$compose_file" --profile ops config --services | sort | paste -sd ' ' -)
  [[ "$services" == 'app db migrate' ]] || die "legacy Compose service set is invalid: $services"
}

current_target() {
  if [[ -L "$CURRENT" ]]; then
    local target
    target=$(readlink -f "$CURRENT")
    [[ "$target" == "$RELEASE_ROOT"/* && -d "$target" ]] || die 'current symlink points outside the release root'
    printf '%s\n' "$target"
  elif [[ -e "$CURRENT" ]]; then
    die 'current exists but is not a symlink'
  fi
}

previous_target() {
  if [[ -L "$PREVIOUS" ]]; then
    local target
    target=$(readlink -f "$PREVIOUS")
    [[ "$target" == "$RELEASE_ROOT"/* && -d "$target" ]] || die 'previous symlink points outside the release root'
    printf '%s\n' "$target"
  elif [[ -e "$PREVIOUS" ]]; then
    die 'previous exists but is not a symlink'
  fi
}

resolve_release_selector() {
  local selector=$1 candidate
  if [[ "$selector" =~ ^[0-9a-f]{40}$ ]]; then
    local -a matches=()
    candidate="$RELEASE_ROOT/$selector"
    if [[ -e "$candidate" ]]; then
      matches+=("$candidate")
    fi
    while IFS= read -r candidate; do
      matches+=("$candidate")
    done < <(find "$RELEASE_ROOT" -mindepth 1 -maxdepth 1 -type d -name "${selector}--*" -print | sort)
    if [[ "${#matches[@]}" -eq 1 ]]; then
      printf '%s\n' "${matches[0]}"
      return
    fi
    if [[ "${#matches[@]}" -gt 1 ]]; then
      die 'release SHA is ambiguous; use the full release id'
    fi
    die "release does not exist: $selector"
  fi
  validate_release_id "$selector"
  printf '%s/%s\n' "$RELEASE_ROOT" "$selector"
}

assert_legacy_release() {
  local release=$1
  [[ "$release" == "$RELEASE_ROOT"/* ]] || die 'legacy release path is outside the release root'
  [[ -d "$release" && ! -L "$release" ]] || die "legacy release does not exist: $release"
  [[ -f "$release/deploy/compose.prod.yml" && ! -L "$release/deploy/compose.prod.yml" ]] || die 'legacy release compose file is missing'
  [[ -f "$release/compose.env" && ! -L "$release/compose.env" ]] || die 'legacy release Compose environment is missing'
  [[ "$(stat -c '%u' "$release/compose.env")" == 0 ]] || die 'legacy Compose environment is not root-owned'
  [[ "$(stat -c '%a' "$release/compose.env")" == 600 ]] || die 'legacy Compose environment must have mode 0600'
}

assert_release() {
  local release=$1
  [[ "$release" == "$RELEASE_ROOT"/* ]] || die 'release path is outside the release root'
  [[ -d "$release" && ! -L "$release" ]] || die "release does not exist: $release"
  [[ -f "$release/deploy/compose.prod.yml" && ! -L "$release/deploy/compose.prod.yml" ]] || die 'release compose file is missing'
  [[ -f "$release/deploy/domain-map-backup.sh" && ! -L "$release/deploy/domain-map-backup.sh" ]] || die 'release backup script is missing'
  [[ -f "$release/release.env" && ! -L "$release/release.env" ]] || die 'release metadata is missing'
  [[ "$(stat -c '%u' "$release/deploy/compose.prod.yml")" == 0 ]] || die 'release compose file is not root-owned'
  [[ "$(stat -c '%u' "$release/deploy/domain-map-backup.sh")" == 0 ]] || die 'release backup script is not root-owned'
  [[ "$(stat -c '%a' "$release/deploy/domain-map-backup.sh")" == 755 ]] || die 'release backup script must have mode 0755'
  [[ "$(stat -c '%u' "$release/release.env")" == 0 ]] || die 'release metadata is not root-owned'
  validate_release_id "$(basename "$release")"
  local release_sha
  release_sha=$(release_sha_for_id "$(basename "$release")")
  grep -Fxq "DOMAIN_MAP_RELEASE_SHA=$release_sha" "$release/release.env" || die 'release SHA metadata differs from its directory'
  local release_app release_migrate
  release_app=$(awk -F= '$1 == "DOMAIN_MAP_APP_IMAGE" { print $2 }' "$release/release.env")
  release_migrate=$(awk -F= '$1 == "DOMAIN_MAP_MIGRATE_IMAGE" { print $2 }' "$release/release.env")
  validate_image "$release_app" "$release_migrate"
  local release_id id_app_digest id_migrate_digest app_digest migrate_digest
  release_id=$(basename "$release")
  if [[ "$release_id" =~ ^[0-9a-f]{40}--([0-9a-f]{64})--([0-9a-f]{64})$ ]]; then
    id_app_digest=${BASH_REMATCH[1]}
    id_migrate_digest=${BASH_REMATCH[2]}
    app_digest=${release_app##*@sha256:}
    migrate_digest=${release_migrate##*@sha256:}
    [[ "$id_app_digest" == "$app_digest" && "$id_migrate_digest" == "$migrate_digest" ]] \
      || die 'release id digests differ from release metadata'
  fi
  if [[ -n "$(find "$release" -type l -print -quit)" ]]; then
    die 'release contains a symlink'
  fi
}

write_release() {
  local sha=$1 app_image=$2 migrate_image=$3 incoming=$4 release=$5
  [[ -d "$incoming" && ! -L "$incoming" ]] || die "incoming release is missing: $incoming"
  [[ -f "$incoming/deploy/compose.prod.yml" && ! -L "$incoming/deploy/compose.prod.yml" ]] || die 'incoming compose file is missing'
  [[ -f "$incoming/deploy/domain-map-backup.sh" && ! -L "$incoming/deploy/domain-map-backup.sh" ]] || die 'incoming backup script is missing'
  if [[ -n "$(find "$incoming" -type l -print -quit)" ]]; then
    die 'incoming release contains a symlink'
  fi

  if [[ -e "$release" ]]; then
    assert_release "$release"
    grep -Fxq "DOMAIN_MAP_RELEASE_SHA=$sha" "$release/release.env" || die 'existing release SHA metadata differs'
    grep -Fxq "DOMAIN_MAP_APP_IMAGE=$app_image" "$release/release.env" || die 'existing app digest differs'
    grep -Fxq "DOMAIN_MAP_MIGRATE_IMAGE=$migrate_image" "$release/release.env" || die 'existing migration digest differs'
    return
  fi

  local staging="$RELEASE_ROOT/.${sha}.tmp.$$"
  rm -rf -- "$staging"
  install -d -o root -g root -m 755 "$staging/deploy"
  install -o root -g root -m 644 "$incoming/deploy/compose.prod.yml" "$staging/deploy/compose.prod.yml"
  install -o root -g root -m 755 "$incoming/deploy/domain-map-backup.sh" "$staging/deploy/domain-map-backup.sh"
  {
    printf 'DOMAIN_MAP_RELEASE_SHA=%s\n' "$sha"
    printf 'DOMAIN_MAP_APP_IMAGE=%s\n' "$app_image"
    printf 'DOMAIN_MAP_MIGRATE_IMAGE=%s\n' "$migrate_image"
  } > "$staging/release.env"
  chown root:root "$staging/release.env"
  chmod 600 "$staging/release.env"
  mv --no-target-directory "$staging" "$release"
  assert_release "$release"
}

atomic_link() {
  local link=$1 target=$2 tmp
  tmp="${link}.tmp.$$"
  rm -f -- "$tmp"
  ln -s -- "$target" "$tmp"
  mv -Tf -- "$tmp" "$link"
}

restore_previous_link() {
  local target=${1:-}
  if [[ -n "$target" ]]; then
    atomic_link "$PREVIOUS" "$target"
  else
    rm -f -- "$PREVIOUS"
  fi
}

set_compose_env() {
  local release=$1 tmp
  tmp="${COMPOSE_ENV}.tmp.$$"
  install -o root -g root -m 600 "$release/release.env" "$tmp"
  mv -f -- "$tmp" "$COMPOSE_ENV"
}

set_compose_env_file() {
  local source=$1 tmp
  tmp="${COMPOSE_ENV}.tmp.$$"
  install -o root -g root -m 600 "$source" "$tmp"
  mv -f -- "$tmp" "$COMPOSE_ENV"
}

compose_file_for() { printf '%s/deploy/compose.prod.yml\n' "$1"; }
compose_env_for() { printf '%s/release.env\n' "$1"; }

release_path_for() {
  local sha=$1 app_image=$2 migrate_image=$3 canonical canonical_app canonical_migrate
  canonical="$RELEASE_ROOT/$sha"
  if [[ -e "$canonical" ]]; then
    [[ -d "$canonical" && ! -L "$canonical" ]] || die 'canonical release path is invalid'
    if [[ -f "$canonical/release.env" ]]; then
      assert_release "$canonical"
      canonical_app=$(awk -F= '$1 == "DOMAIN_MAP_APP_IMAGE" { print $2 }' "$canonical/release.env")
      canonical_migrate=$(awk -F= '$1 == "DOMAIN_MAP_MIGRATE_IMAGE" { print $2 }' "$canonical/release.env")
      if [[ "$canonical_app" == "$app_image" && "$canonical_migrate" == "$migrate_image" ]]; then
        printf '%s\n' "$canonical"
        return
      fi
    else
      assert_legacy_release "$canonical"
    fi
  fi
  printf '%s/%s\n' "$RELEASE_ROOT" "$(release_id_for "$sha" "$app_image" "$migrate_image")"
}

wait_for_db() {
  local compose_file=$1 compose_env=$2 container state
  container=$(compose "$compose_env" "$compose_file" ps -q db)
  [[ -n "$container" ]] || die 'database container did not start'
  for _ in {1..30}; do
    state=$(docker inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null || true)
    [[ "$state" == healthy ]] && return
    [[ "$state" == unhealthy ]] && die 'database healthcheck failed'
    sleep 2
  done
  die 'timed out waiting for database health'
}

wait_for_app() {
  local path=$1
  for _ in {1..30}; do
    if curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:3002${path}" >/dev/null 2>&1; then
      return
    fi
    sleep 2
  done
  die "application probe failed: $path"
}

run_backup() {
  if [[ -x "$BACKUP_SCRIPT" ]]; then
    DOMAIN_MAP_BACKUP_REQUIRED=1 "$BACKUP_SCRIPT"
    return
  fi
  local current_release
  current_release=$(current_target || true)
  [[ -n "$current_release" && -x "$current_release/deploy/domain-map-backup.sh" ]] \
    || die 'backup script is not installed'
  DOMAIN_MAP_BACKUP_REQUIRED=1 "$current_release/deploy/domain-map-backup.sh"
}

restore_app() {
  local old_target=${1:-}
  if [[ -n "$old_target" ]]; then
    local old_file old_env old_image
    old_file=$(compose_file_for "$old_target")
    if [[ -f "$old_target/release.env" ]]; then
      assert_release "$old_target"
      old_env=$(compose_env_for "$old_target")
    else
      assert_legacy_release "$old_target"
      old_env="$old_target/compose.env"
      validate_legacy_compose "$old_env" "$old_file"
    fi
    atomic_link "$CURRENT" "$old_target"
    set_compose_env_file "$old_env"
    old_image=$(awk -F= '$1 == "DOMAIN_MAP_APP_IMAGE" { print $2 }' "$old_env")
    if [[ "$old_image" =~ $APP_RE ]]; then
      docker pull "$old_image" >/dev/null
    else
      local old_tag
      old_tag=$(awk -F= '$1 == "DOMAIN_MAP_RELEASE_TAG" { print $2 }' "$old_env")
      [[ "$old_tag" =~ ^[A-Za-z0-9._-]+$ ]] || die 'legacy release has an invalid image tag'
      docker image inspect "domain-map-app:$old_tag" >/dev/null || die 'legacy app image is unavailable locally'
    fi
    compose "$old_env" "$old_file" up -d --no-build app >/dev/null
    wait_for_app /api/health/ready
    wait_for_app /api/modes
    wait_for_app '/api/pois?mode=work&page=1&pageSize=1'
  else
    rm -f -- "$CURRENT" "$COMPOSE_ENV"
  fi
}

apply_release() {
  local sha=$1 app_image=$2 migrate_image=$3
  validate_sha "$sha"
  validate_image "$app_image" "$migrate_image"
  ensure_host_config

  local incoming="$INCOMING_ROOT/$sha"
  local release
  release=$(release_path_for "$sha" "$app_image" "$migrate_image")
  write_release "$sha" "$app_image" "$migrate_image" "$incoming" "$release"
  local compose_file compose_env
  compose_file=$(compose_file_for "$release")
  compose_env=$(compose_env_for "$release")
  validate_compose "$compose_env" "$compose_file"

  registry_login
  docker pull "$app_image" >/dev/null
  docker pull "$migrate_image" >/dev/null

  compose "$compose_env" "$compose_file" up -d db >/dev/null
  wait_for_db "$compose_file" "$compose_env"

  local old_target old_previous
  old_target=$(current_target || true)
  old_previous=$(previous_target || true)
  if [[ -n "$old_target" && ! -f "$old_target/release.env" ]]; then
    [[ "$old_target" == "$RELEASE_ROOT"/* && -d "$old_target" && ! -L "$old_target" ]] \
      || die 'legacy current release path is invalid'
    [[ -f "$old_target/deploy/compose.prod.yml" && ! -L "$old_target/deploy/compose.prod.yml" ]] \
      || die 'legacy current Compose file is missing'
    install -o root -g root -m 600 "$COMPOSE_ENV" "$old_target/compose.env"
    assert_legacy_release "$old_target"
  fi
  run_backup

  # The migration image runs both apply.sh and preflight.sh. It is intentionally
  # executed before changing current, so a failed migration leaves the old app
  # selected and never deletes the database volume.
  compose "$compose_env" "$compose_file" --profile ops run --rm migrate >/dev/null

  if [[ -n "$old_target" && "$old_target" != "$release" ]]; then
    atomic_link "$PREVIOUS" "$old_target"
  fi
  atomic_link "$CURRENT" "$release"
  set_compose_env "$release"

  local switched=1
  trap 'rc=$?; if [[ "$switched" == 1 && "$rc" -ne 0 ]]; then printf "%s\n" "domain-map deploy: app health failed; restoring previous app (database schema is not rolled back)" >&2; restore_app "$old_target" || true; restore_previous_link "$old_previous" || true; fi; exit "$rc"' EXIT
  compose "$compose_env" "$compose_file" up -d --no-build app >/dev/null
  wait_for_app /api/health/ready
  wait_for_app /api/modes
  wait_for_app '/api/pois?mode=work&page=1&pageSize=1'
  switched=0
  trap - EXIT
  rm -rf -- "$incoming"
  log "deployment applied: $sha"
  log 'database migrations are forward-only; application rollback remains available'
}

rollback_release() {
  ensure_host_config
  local target managed=1
  if [[ $# -eq 1 ]]; then
    target=$(resolve_release_selector "$1")
  else
    target=$(previous_target || true)
  fi
  [[ -n "$target" ]] || die 'no previous release is available'
  if [[ -f "$target/release.env" ]]; then
    assert_release "$target"
  else
    managed=0
    assert_legacy_release "$target"
  fi

  local old_target old_previous
  old_target=$(current_target || true)
  old_previous=$(previous_target || true)
  [[ "$target" != "$old_target" ]] || die 'requested rollback is already current'
  local compose_file compose_env
  compose_file=$(compose_file_for "$target")
  if [[ "$managed" == 1 ]]; then
    compose_env=$(compose_env_for "$target")
    validate_compose "$compose_env" "$compose_file"
  else
    compose_env="$target/compose.env"
    validate_legacy_compose "$compose_env" "$compose_file"
  fi
  registry_login
  local app_image
  app_image=$(awk -F= '$1 == "DOMAIN_MAP_APP_IMAGE" { print $2 }' "$compose_env")
  if [[ "$app_image" =~ $APP_RE ]]; then
    docker pull "$app_image" >/dev/null
  else
    local old_tag
    old_tag=$(awk -F= '$1 == "DOMAIN_MAP_RELEASE_TAG" { print $2 }' "$compose_env")
    [[ "$old_tag" =~ ^[A-Za-z0-9._-]+$ ]] || die 'legacy release has an invalid image tag'
    docker image inspect "domain-map-app:$old_tag" >/dev/null || die 'legacy app image is unavailable locally'
  fi

  [[ -n "$old_target" ]] && atomic_link "$PREVIOUS" "$old_target"
  atomic_link "$CURRENT" "$target"
  if [[ "$managed" == 1 ]]; then
    set_compose_env "$target"
  else
    set_compose_env_file "$compose_env"
  fi
  local switched=1
  trap 'rc=$?; if [[ "$switched" == 1 && "$rc" -ne 0 ]]; then printf "%s\n" "domain-map deploy: rollback health failed; restoring prior app" >&2; restore_app "$old_target" || true; restore_previous_link "$old_previous" || true; fi; exit "$rc"' EXIT
  compose "$compose_env" "$compose_file" up -d --no-build app >/dev/null
  wait_for_app /api/health/ready
  wait_for_app /api/modes
  wait_for_app '/api/pois?mode=work&page=1&pageSize=1'
  switched=0
  trap - EXIT
  log "application rolled back to: $(basename "$target")"
  log 'database schema was not rolled back'
}

status() {
  require_root
  local current previous
  current=$(current_target || true)
  previous=$(previous_target || true)
  printf 'current: %s\n' "${current:-none}"
  printf 'previous: %s\n' "${previous:-none}"
  if [[ -n "$current" && -r "$COMPOSE_ENV" ]]; then
    local file
    file=$(compose_file_for "$current")
    compose "$COMPOSE_ENV" "$file" ps
  fi
}

main() {
  require_root
  [[ $# -ge 1 ]] || usage
  exec 9>/run/lock/domain-map-deploy.lock
  flock -n 9 || die 'another deployment is already running'
  case "$1" in
    apply) [[ $# -eq 4 ]] || usage; apply_release "$2" "$3" "$4" ;;
    rollback)
      if [[ $# -eq 1 ]]; then
        rollback_release
      elif [[ $# -eq 2 ]]; then
        rollback_release "$2"
      else
        usage
      fi
      ;;
    status) [[ $# -eq 1 ]] || usage; status ;;
    *) usage ;;
  esac
}

main "$@"
