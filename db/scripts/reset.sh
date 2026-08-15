#!/usr/bin/env bash
set -Eeuo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X <<'SQL'
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;
SQL
