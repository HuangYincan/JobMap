-- Application watch pipeline: free-form status ids + last-activity sort.
-- User-defined stages live in users.preferences.applicationPipeline (JSON).
-- Legacy viewed → applied. Env-only apply.

DO $$
DECLARE
  cname text;
BEGIN
  FOR cname IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'applications'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE applications DROP CONSTRAINT IF EXISTS %I', cname);
  END LOOP;
END $$;

ALTER TABLE applications
  ADD CONSTRAINT applications_status_check
  CHECK (char_length(status) BETWEEN 1 AND 32);

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE applications
SET status = 'applied'
WHERE status = 'viewed';

UPDATE applications
SET updated_at = created_at
WHERE updated_at IS NULL;

ALTER TABLE applications
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS applications_user_updated_idx
  ON applications (user_id, updated_at DESC);
