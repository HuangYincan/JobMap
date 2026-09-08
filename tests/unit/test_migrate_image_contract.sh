#!/usr/bin/env bash
# Contract for the production migration image: checksum with image-native
# sha256sum, never apt-get on the Debian 11 PostGIS base.
set -Eeuo pipefail
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
dockerfile="$ROOT/deploy/migrate.Dockerfile"
apply="$ROOT/db/scripts/apply.sh"
preflight="$ROOT/db/scripts/preflight.sh"

if grep -nE '(^|[[:space:]])apt-get([[:space:]]|$)' "$dockerfile"; then
  printf '%s\n' 'migrate.Dockerfile must not apt-get; Debian bullseye-security InRelease expiry breaks production builds' >&2
  exit 1
fi
grep -q 'sha256sum' "$dockerfile" || {
  printf '%s\n' 'migrate.Dockerfile must require sha256sum' >&2
  exit 1
}
grep -q 'sha256sum' "$apply" || {
  printf '%s\n' 'apply.sh must prefer sha256sum so the migrate image does not need perl/shasum' >&2
  exit 1
}
grep -q 'sha256sum' "$preflight" || {
  printf '%s\n' 'preflight.sh must prefer sha256sum' >&2
  exit 1
}

file=$(printf '%s\n' "$ROOT"/db/migrations/[0-9][0-9][0-9]_*.sql | head -n 1)
[[ -n "$file" && -f "$file" ]] || {
  printf '%s\n' 'no migration file found' >&2
  exit 1
}
if command -v sha256sum >/dev/null 2>&1 && command -v shasum >/dev/null 2>&1; then
  gnu=$(sha256sum "$file" | cut -d' ' -f1)
  perl=$(shasum -a 256 "$file" | cut -d' ' -f1)
  if [[ "$gnu" != "$perl" ]]; then
    printf '%s\n' "sha256sum and shasum disagree on $file" >&2
    exit 1
  fi
fi

printf '%s\n' 'migrate image contract check passed.'
