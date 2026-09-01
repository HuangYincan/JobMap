-- 022_hz_pois_photos_shape.sql
-- Enforce the JSON shape used by public hz_pois list/suggest ordering.
--
-- Operational boundary (ENV_ONLY): inspect historical rows and decide any
-- cleanup/backfill before applying migrations. This migration never rewrites
-- existing business data; it refuses to install the constraint while dirty
-- rows remain so an operator cannot mistake a partial apply for a repair.

DO $$
DECLARE
  invalid_count bigint;
BEGIN
  SELECT count(*)
    INTO invalid_count
  FROM public.hz_pois
  WHERE photos IS NULL
     OR jsonb_typeof(photos) <> 'array';

  RAISE NOTICE
    '022 preflight: hz_pois rows with non-array photos: %',
    invalid_count;

  IF invalid_count > 0 THEN
    RAISE WARNING
      '022 preflight blocked: % hz_pois row(s) have non-array photos; no business data was changed',
      invalid_count;
    RAISE EXCEPTION USING
      MESSAGE = format(
        '022_hz_pois_photos_shape refused to install: % hz_pois row(s) have non-array photos',
        invalid_count
      ),
      DETAIL = 'The existing data must be diagnosed and normalized in a separately approved ENV_ONLY operation before this migration is retried.',
      HINT = 'Read-only diagnostic SQL: SELECT poi_id, jsonb_typeof(photos) AS photos_type, photos FROM public.hz_pois WHERE photos IS NULL OR jsonb_typeof(photos) <> ''array'' ORDER BY poi_id; Decide the approved backfill separately, then retry this migration.';
  END IF;
END
$$;

ALTER TABLE public.hz_pois
  ADD CONSTRAINT hz_pois_photos_array_check
  CHECK (jsonb_typeof(photos) = 'array');
