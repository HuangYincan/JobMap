#!/usr/bin/env bash
set -Eeuo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
command -v psql >/dev/null 2>&1 || { echo "psql is required" >&2; exit 127; }
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X)
"${PSQL[@]}" -c "SELECT postgis_version();" >/dev/null
actual=$((shasum -a 256 "$ROOT"/migrations/[0-9][0-9][0-9]_*.sql || true) | sort)
"${PSQL[@]}" -At -F ' ' -c "SELECT version, checksum FROM schema_migrations ORDER BY version" | while read -r version checksum; do
  expected=$(printf '%s\n' "$actual" | awk -v v="$version" '$2 ~ ("/" v "\\.sql$") {print $1}')
  if [ -z "$expected" ]; then printf 'ERROR missing migration file: %s\n' "$version" >&2; exit 1; fi
  if [ "$expected" != "$checksum" ]; then printf 'ERROR checksum drift: %s\n' "$version" >&2; exit 1; fi
done
printf '%s\n' 'Database preflight passed.'
