#!/usr/bin/env bash
set -Eeuo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
command -v psql >/dev/null 2>&1 || { echo "psql is required" >&2; exit 127; }
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X)

# The runner owns the ledger. Migrations never recreate it.
"${PSQL[@]}" -c "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, filename text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());"

for file in "$ROOT"/migrations/[0-9][0-9][0-9]_*.sql; do
  version=$(basename "$file" .sql)
  filename=$(basename "$file")
  checksum=$(shasum -a 256 "$file" | cut -d' ' -f1)
  # One transaction per migration. The applied-check runs AFTER the
  # transaction-scoped advisory lock, so concurrent runners serialize: the
  # loser observes the winner's ledger row and skips instead of re-running.
  "${PSQL[@]}" -1 -v migration_file="$file" -v migration_version="$version" -v migration_filename="$filename" -v migration_checksum="$checksum" <<'SQL'
SELECT pg_advisory_xact_lock(hashtextextended('domain-map:migrations', 0));
SELECT CASE WHEN EXISTS (SELECT 1 FROM schema_migrations WHERE version = :'migration_version') THEN 't' ELSE 'f' END AS already_applied \gset
\if :already_applied
  SELECT checksum FROM schema_migrations WHERE version = :'migration_version' \gset existing_checksum
  \if :existing_checksum = :migration_checksum
    -- Already applied and unchanged; nothing to do.
  \else
    DO $drift$ BEGIN RAISE EXCEPTION 'checksum drift for migration %', :'migration_version'; END $drift$;
  \endif
\else
  \i :migration_file
  INSERT INTO schema_migrations(version, filename, checksum)
  VALUES (:'migration_version', :'migration_filename', :'migration_checksum');
\endif
SQL
done

printf '%s\n' 'migrations applied'
