-- repair-020-position-site-company.sql
-- ENV_ONLY operator repair for databases that fail migration 020's preflight.
--
-- 020 refuses to install when a position.company_id does not match the
-- company that owns position.site_id. This script never merges companies,
-- never deletes rows, and never rewrites company_id. It only retargets
-- site_id onto a site already owned by the same company, preferring the
-- same city as the currently (wrong) site.
--
-- Apply with db/scripts/repair-020-position-site-company.sh (or
-- make db-repair-020). Then retry make db-migrate. Do not put this SQL
-- in db/migrations/: 020 must stay fail-closed, and a later numbered
-- file cannot run before 020.

DO $$
DECLARE
  mismatch_count bigint;
  stranded_count bigint;
BEGIN
  SELECT count(*)
    INTO mismatch_count
  FROM public.positions AS p
  JOIN public.company_sites AS s ON s.id = p.site_id
  WHERE p.company_id IS DISTINCT FROM s.company_id;

  RAISE NOTICE '020 repair preflight: cross-company position/site rows: %', mismatch_count;

  IF mismatch_count = 0 THEN
    RAISE NOTICE '020 repair: nothing to do';
    RETURN;
  END IF;

  SELECT count(*)
    INTO stranded_count
  FROM public.positions AS p
  JOIN public.company_sites AS s ON s.id = p.site_id
  WHERE p.company_id IS DISTINCT FROM s.company_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.company_sites AS own
      WHERE own.company_id = p.company_id
    );

  IF stranded_count > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        '020 repair refused: %s mismatched position(s) have no site on their own company',
        stranded_count
      ),
      DETAIL = 'company_id is left unchanged; a position cannot be retargeted without a same-company site.',
      HINT = 'Inspect those companies before retrying. Do not invent a replacement employer.';
  END IF;
END
$$;

WITH mismatched AS (
  SELECT p.id AS position_id,
         p.company_id,
         s.city AS wrong_city
  FROM public.positions AS p
  JOIN public.company_sites AS s ON s.id = p.site_id
  WHERE p.company_id IS DISTINCT FROM s.company_id
),
ranked AS (
  SELECT m.position_id,
         cs.id AS new_site_id,
         ROW_NUMBER() OVER (
           PARTITION BY m.position_id
           ORDER BY
             CASE WHEN cs.city IS NOT DISTINCT FROM m.wrong_city THEN 0 ELSE 1 END,
             cs.id
         ) AS rn
  FROM mismatched AS m
  JOIN public.company_sites AS cs ON cs.company_id = m.company_id
)
UPDATE public.positions AS p
SET site_id = r.new_site_id,
    updated_at = now()
FROM ranked AS r
WHERE p.id = r.position_id
  AND r.rn = 1
  AND p.site_id IS DISTINCT FROM r.new_site_id;

DO $$
DECLARE
  leftover bigint;
BEGIN
  SELECT count(*)
    INTO leftover
  FROM public.positions AS p
  JOIN public.company_sites AS s ON s.id = p.site_id
  WHERE p.company_id IS DISTINCT FROM s.company_id;

  IF leftover > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        '020 repair refused to finish: %s cross-company position/site row(s) remain',
        leftover
      ),
      DETAIL = 'No company rows were merged. Remaining mismatches must be resolved in a separately approved operation.',
      HINT = 'SELECT p.id, p.company_id, s.company_id AS site_company_id FROM public.positions p JOIN public.company_sites s ON s.id = p.site_id WHERE p.company_id IS DISTINCT FROM s.company_id ORDER BY p.id;';
  END IF;

  RAISE NOTICE '020 repair: remaining cross-company position/site rows: 0';
END
$$;
