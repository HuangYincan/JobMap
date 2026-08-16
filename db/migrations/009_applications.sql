-- Application tracking. One row per user + position. Guests do not write here.

CREATE TABLE IF NOT EXISTS applications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position_id text NOT NULL,
  company_poi_id text NOT NULL,
  title text NOT NULL,
  company_name text NOT NULL,
  apply_url text,
  status text NOT NULL DEFAULT 'applied',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (position_id <> '' AND company_poi_id <> '' AND title <> '' AND company_name <> ''),
  CHECK (status IN ('applied', 'viewed', 'withdrawn')),
  UNIQUE (user_id, position_id)
);
CREATE INDEX IF NOT EXISTS applications_user_created_idx ON applications(user_id, created_at DESC);
