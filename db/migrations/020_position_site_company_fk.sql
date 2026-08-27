-- 020_position_site_company_fk.sql
-- Couple a position's company and site without changing the existing delete actions.
--
-- 006_recruitment_sites.sql gave positions two independent foreign keys:
--   company_id -> companies(id) ON DELETE CASCADE
--   site_id    -> company_sites(id) ON DELETE RESTRICT
-- Those keys still allow a position owned by company A to point at company B's
-- site.  The preflight below deliberately refuses to install the new invariant
-- when that legacy state exists.  It never repairs or deletes business rows.

DO $$
DECLARE
  mismatch_count bigint;
BEGIN
  SELECT count(*)
    INTO mismatch_count
  FROM public.positions AS p
  JOIN public.company_sites AS s ON s.id = p.site_id
  WHERE p.company_id IS DISTINCT FROM s.company_id;

  RAISE NOTICE
    '020 preflight: positions with a company/site ownership mismatch: %',
    mismatch_count;

  IF mismatch_count > 0 THEN
    RAISE WARNING
      '020 preflight blocked: % cross-company position/site mismatch(es) found; no business data was changed',
      mismatch_count;
    RAISE EXCEPTION USING
      MESSAGE = format(
        '020_position_site_company_fk refused to install: % cross-company position/site mismatch(es)',
        mismatch_count
      ),
      DETAIL = 'The existing independent foreign keys permit this legacy state. The unique key and composite foreign key were not installed.',
      HINT = 'Read-only diagnostic SQL: SELECT p.id AS position_id, p.company_id AS position_company_id, p.site_id, s.company_id AS site_company_id FROM public.positions AS p JOIN public.company_sites AS s ON s.id = p.site_id WHERE p.company_id IS DISTINCT FROM s.company_id ORDER BY p.id; Resolve the data issue in a separately approved operation, then retry this migration.';
  END IF;
END
$$;

-- PostgreSQL foreign keys need a matching non-partial unique key.  Keep the
-- referenced columns in company_sites' natural (id, company_id) order; the
-- child columns below are intentionally reversed to match it.
CREATE UNIQUE INDEX IF NOT EXISTS company_sites_id_company_id_uidx
  ON public.company_sites (id, company_id);

-- Keep positions.company_id -> companies(id) ON DELETE CASCADE and
-- positions.site_id -> company_sites(id) ON DELETE RESTRICT from migration 006.
-- This additional pair preserves the site-side RESTRICT behavior while making
-- the company/site pair impossible to cross-wire.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.positions'::regclass
      AND conname = 'positions_site_company_fkey'
  ) THEN
    ALTER TABLE public.positions
      ADD CONSTRAINT positions_site_company_fkey
      FOREIGN KEY (site_id, company_id)
      REFERENCES public.company_sites (id, company_id)
      ON DELETE RESTRICT;
  END IF;
END
$$;
