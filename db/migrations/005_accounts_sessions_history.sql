-- Account identities, sessions, preferences, and per-user search history.
-- users already exists (001). This adds profile fields and satellite tables.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{"language":"zh","defaultMode":"work"}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_preferences_object'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_preferences_object CHECK (jsonb_typeof(preferences) = 'object');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_phone_uidx ON users (phone) WHERE phone IS NOT NULL AND phone <> '';
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uidx ON users (lower(email)) WHERE email IS NOT NULL AND email <> '';

CREATE TABLE IF NOT EXISTS auth_identities (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (provider IN ('phone', 'email', 'github')),
  CHECK (subject <> ''),
  UNIQUE (provider, subject)
);
CREATE INDEX IF NOT EXISTS auth_identities_user_id_idx ON auth_identities(user_id);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (token_hash <> '')
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON auth_sessions(expires_at);

-- Demo OTP challenges. Production send goes through Aliyun SMS (PNvs).
CREATE TABLE IF NOT EXISTS auth_otp_challenges (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL,
  target text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (provider IN ('phone', 'email')),
  CHECK (target <> '' AND code_hash <> '')
);
CREATE INDEX IF NOT EXISTS auth_otp_challenges_lookup_idx ON auth_otp_challenges(provider, target, expires_at DESC);

CREATE TABLE IF NOT EXISTS search_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query text NOT NULL,
  mode text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (query <> ''),
  CHECK (mode IN ('domain', 'work', 'internship', 'college', 'overseas'))
);
CREATE INDEX IF NOT EXISTS search_history_user_created_idx ON search_history(user_id, created_at DESC);
