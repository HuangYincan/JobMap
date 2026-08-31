#!/usr/bin/env bash
set -Eeuo pipefail

COMPOSE_FILE=/opt/domain-map/current/deploy/compose.prod.yml
COMPOSE_ENV=/etc/domain-map/compose.env
DB_ENV=/etc/domain-map/db.env
BACKUP_DIR=/srv/domain-map/backups

[[ -r "$COMPOSE_ENV" && -r "$DB_ENV" ]]
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Prevent a timer run from racing a manually requested pre-release dump.
exec 9>/run/lock/domain-map-backup.lock
flock -n 9 || exit 0

set -a
. "$DB_ENV"
set +a

stamp=$(date -u +%Y%m%dT%H%M%SZ)
final="$BACKUP_DIR/domain-map-$stamp.dump"
tmp="$final.tmp"
trap 'rm -f "$tmp"' EXIT

# pg_dump runs inside the private DB container; DATABASE_URL is intentionally
# not used on the host because the Compose service name is not host-resolvable.
docker compose \
  --project-name domain-map-prod \
  --env-file "$COMPOSE_ENV" \
  --file "$COMPOSE_FILE" \
  exec -T db pg_dump --format=custom --no-owner --no-acl \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" > "$tmp"

[[ -s "$tmp" ]]
chmod 600 "$tmp"
mv "$tmp" "$final"
sha256sum "$final" > "$final.sha256"
chmod 600 "$final.sha256"

# Keep the initial seven-day retention policy aligned with the existing VPS
# convention. Files are never removed outside this dedicated directory.
find "$BACKUP_DIR" -type f -name 'domain-map-*.dump' -mtime +7 -delete
find "$BACKUP_DIR" -type f -name 'domain-map-*.dump.sha256' -mtime +7 -delete
printf 'backup created: %s\n' "$(basename "$final")"
