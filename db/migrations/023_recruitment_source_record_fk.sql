-- 023_recruitment_source_record_fk.sql
-- Point recruitment sites and positions at the source_records row that
-- produced them. entities/items already have this composite FK from 003;
-- 006 only stored sources.id.
--
-- Operational boundary (ENV_ONLY): this migration does not backfill
-- record_version or retrieved_at and never rewrites business rows.
-- Existing sites/positions keep source_record_id NULL until a later import
-- apply or a separately approved backfill. Apply is operator-only.

DO $$
BEGIN
  IF to_regclass('public.source_records') IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = '023_recruitment_source_record_fk refused to install: source_records is missing',
      DETAIL = 'Recruitment provenance FKs require migration 002.',
      HINT = 'Apply db/migrations/002_plugins_and_provenance.sql first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.conrelid = 'public.source_records'::regclass
      AND c.contype IN ('u', 'p')
      AND pg_get_constraintdef(c.oid) LIKE '%(id, source_id)%'
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = '023_recruitment_source_record_fk refused to install: source_records(id, source_id) unique key is missing',
      DETAIL = 'PostgreSQL composite foreign keys need a matching unique key on the parent.',
      HINT = 'Confirm 002 created UNIQUE(id, source_id) on source_records.';
  END IF;
END
$$;

ALTER TABLE public.company_sites
  ADD COLUMN IF NOT EXISTS source_record_id bigint;

ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS source_record_id bigint;

DO $$
DECLARE
  site_orphans bigint;
  position_orphans bigint;
BEGIN
  SELECT count(*)
    INTO site_orphans
  FROM public.company_sites AS s
  WHERE s.source_record_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.source_records AS r
      WHERE r.id = s.source_record_id
        AND r.source_id IS NOT DISTINCT FROM s.source_id
    );

  SELECT count(*)
    INTO position_orphans
  FROM public.positions AS p
  WHERE p.source_record_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.source_records AS r
      WHERE r.id = p.source_record_id
        AND r.source_id IS NOT DISTINCT FROM p.source_id
    );

  RAISE NOTICE
    '023 preflight: company_sites with an orphan source_record_id: %; positions with an orphan source_record_id: %',
    site_orphans,
    position_orphans;

  IF site_orphans > 0 OR position_orphans > 0 THEN
    RAISE WARNING
      '023 preflight blocked: % site and % position orphan source_record_id value(s); no business data was changed',
      site_orphans,
      position_orphans;
    RAISE EXCEPTION USING
      MESSAGE = format(
        '023_recruitment_source_record_fk refused to install: % site and % position orphan source_record_id value(s)',
        site_orphans,
        position_orphans
      ),
      DETAIL = 'A non-null source_record_id must reference source_records(id, source_id). Historical NULL values are allowed and were not counted.',
      HINT = 'Read-only diagnostic SQL: SELECT ''company_sites'' AS rel, s.id, s.source_id, s.source_record_id FROM public.company_sites s WHERE s.source_record_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.source_records r WHERE r.id = s.source_record_id AND r.source_id IS NOT DISTINCT FROM s.source_id) UNION ALL SELECT ''positions'', p.id, p.source_id, p.source_record_id FROM public.positions p WHERE p.source_record_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.source_records r WHERE r.id = p.source_record_id AND r.source_id IS NOT DISTINCT FROM p.source_id) ORDER BY 1, 2; Resolve in a separately approved ENV_ONLY operation, then retry this migration.';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.company_sites'::regclass
      AND conname = 'company_sites_source_record_requires_source'
  ) THEN
    ALTER TABLE public.company_sites
      ADD CONSTRAINT company_sites_source_record_requires_source
      CHECK (source_record_id IS NULL OR source_id IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.positions'::regclass
      AND conname = 'positions_source_record_requires_source'
  ) THEN
    ALTER TABLE public.positions
      ADD CONSTRAINT positions_source_record_requires_source
      CHECK (source_record_id IS NULL OR source_id IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.company_sites'::regclass
      AND conname = 'company_sites_source_record_fkey'
  ) THEN
    ALTER TABLE public.company_sites
      ADD CONSTRAINT company_sites_source_record_fkey
      FOREIGN KEY (source_record_id, source_id)
      REFERENCES public.source_records (id, source_id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.positions'::regclass
      AND conname = 'positions_source_record_fkey'
  ) THEN
    ALTER TABLE public.positions
      ADD CONSTRAINT positions_source_record_fkey
      FOREIGN KEY (source_record_id, source_id)
      REFERENCES public.source_records (id, source_id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS company_sites_source_record_id_idx
  ON public.company_sites (source_record_id)
  WHERE source_record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS positions_source_record_id_idx
  ON public.positions (source_record_id)
  WHERE source_record_id IS NOT NULL;
