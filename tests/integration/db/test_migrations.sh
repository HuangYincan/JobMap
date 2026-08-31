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
DECLARE required text[] := ARRAY['users','maps','map_memberships','plugin_manifests','plugin_schema_versions','sources','source_records','import_runs','entities','items','map_entity_overlays','map_annotations','map_favorites','audit_events','user_memories','companies','company_sites','positions'];
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(required) r(name) WHERE to_regclass('public.' || name) IS NULL) THEN RAISE EXCEPTION 'required table missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='postgis') OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_trgm') THEN RAISE EXCEPTION 'required extension missing'; END IF;
END $$;
SQL
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X <<'SQL'
DO $$
DECLARE
  composite_fk text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'company_sites'
      AND indexname = 'company_sites_id_company_id_uidx'
  ) THEN
    RAISE EXCEPTION 'company_sites composite referenced key is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.conrelid = 'public.positions'::regclass
      AND c.conname = 'positions_site_company_fkey'
      AND c.contype = 'f'
      AND c.confrelid = 'public.company_sites'::regclass
      AND c.confdeltype = 'r'
      AND pg_get_constraintdef(c.oid) LIKE
        'FOREIGN KEY (site_id, company_id) REFERENCES company_sites(id, company_id)%'
  ) THEN
    RAISE EXCEPTION 'positions ownership-matching composite foreign key is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.conrelid = 'public.positions'::regclass
      AND c.conname = 'positions_company_id_fkey'
      AND c.contype = 'f'
      AND c.confdeltype = 'c'
  ) THEN
    RAISE EXCEPTION 'positions.company_id CASCADE foreign key changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.conrelid = 'public.positions'::regclass
      AND c.conname = 'positions_site_id_fkey'
      AND c.contype = 'f'
      AND c.confdeltype = 'r'
  ) THEN
    RAISE EXCEPTION 'positions.site_id RESTRICT foreign key changed';
  END IF;
END $$;
SQL

# Probe the live constraints with rows that are rolled back.  The two
# independent legacy keys both accept the referenced company and site; only the
# new composite key must reject their cross-company pairing.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X <<'SQL'
BEGIN;
DO $$
DECLARE
  suffix text := txid_current()::text;
  company_a bigint;
  company_b bigint;
  site_a bigint;
  site_b bigint;
  rejected boolean := false;
BEGIN
  INSERT INTO companies (slug, name)
  VALUES ('__migration_fk_probe_a_' || suffix, 'migration FK probe A')
  RETURNING id INTO company_a;
  INSERT INTO companies (slug, name)
  VALUES ('__migration_fk_probe_b_' || suffix, 'migration FK probe B')
  RETURNING id INTO company_b;
  INSERT INTO company_sites (company_id, name)
  VALUES (company_a, 'migration FK probe site A')
  RETURNING id INTO site_a;
  INSERT INTO company_sites (company_id, name)
  VALUES (company_b, 'migration FK probe site B')
  RETURNING id INTO site_b;

  INSERT INTO positions (company_id, site_id, external_id, title, family)
  VALUES (company_a, site_a, '__migration_fk_probe_valid_' || suffix, 'valid probe', 'social');

  BEGIN
    INSERT INTO positions (company_id, site_id, external_id, title, family)
    VALUES (company_a, site_b, '__migration_fk_probe_invalid_' || suffix, 'invalid probe', 'social');
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;

  IF NOT rejected THEN
    RAISE EXCEPTION 'composite company/site foreign key accepted a cross-company position';
  END IF;
END $$;
ROLLBACK;
SQL

printf '%s\n' 'Database integration tests passed.'
