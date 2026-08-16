-- In-account notification inbox. Email / SMS stay queued until a real sender exists.

CREATE TABLE IF NOT EXISTS notifications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'job',
  position_id text,
  company_poi_id text,
  title text NOT NULL,
  company_name text,
  apply_url text,
  channels text[] NOT NULL DEFAULT ARRAY['inbox']::text[],
  status text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind IN ('job', 'school')),
  CHECK (status IN ('queued', 'read', 'sent', 'failed')),
  CHECK (title <> ''),
  UNIQUE (user_id, kind, position_id)
);
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications(user_id, created_at DESC);
