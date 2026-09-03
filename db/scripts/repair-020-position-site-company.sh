#!/usr/bin/env bash
set -Eeuo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
command -v psql >/dev/null 2>&1 || { echo "psql is required" >&2; exit 127; }
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -1 -f "$ROOT/scripts/repair-020-position-site-company.sql"
printf '%s\n' '020 position/site repair applied'
