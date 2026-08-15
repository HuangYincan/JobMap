#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../../" && pwd)
if [ -z "${DATABASE_URL:-}" ]; then
  printf '%s\n' 'SKIP: DATABASE_URL is not set; database integration tests require a reachable PostGIS database.'
  exit 0
fi
if ! command -v psql >/dev/null 2>&1; then
  printf '%s\n' 'SKIP: psql is unavailable; database integration tests were not run.'
  exit 0
fi
if ! psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X -c 'SELECT postgis_version()' >/dev/null 2>&1; then
  printf '%s\n' 'BLOCKED: DATABASE_URL is set but the PostGIS database is unreachable or missing PostGIS.' >&2
  exit 2
fi
DATABASE_URL="$DATABASE_URL" "$ROOT/db/scripts/apply.sh"
DATABASE_URL="$DATABASE_URL" "$ROOT/db/scripts/apply.sh"
DATABASE_URL="$DATABASE_URL" "$ROOT/db/scripts/preflight.sh"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X <<'SQL'
DO $$
DECLARE required text[] := ARRAY['users','maps','map_memberships','plugin_manifests','plugin_schema_versions','sources','source_records','import_runs','entities','items','map_entity_overlays','map_annotations','map_favorites','audit_events'];
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(required) r(name) WHERE to_regclass('public.' || name) IS NULL) THEN RAISE EXCEPTION 'required table missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='postgis') OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_trgm') THEN RAISE EXCEPTION 'required extension missing'; END IF;
END $$;
SQL
printf '%s\n' 'Database integration tests passed.'
