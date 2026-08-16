-- Saved places / companies. One row per user + POI. Guests do not write here.

CREATE TABLE IF NOT EXISTS saved_places (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  poi_id text NOT NULL,
  name text NOT NULL,
  mode text NOT NULL,
  kind text NOT NULL,
  address text,
  lng double precision,
  lat double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (poi_id <> '' AND name <> ''),
  CHECK (mode IN ('domain', 'work', 'internship', 'college', 'overseas')),
  CHECK (kind IN ('domain', 'recruitment')),
  CHECK ((lng IS NULL) = (lat IS NULL)),
  UNIQUE (user_id, poi_id)
);
CREATE INDEX IF NOT EXISTS saved_places_user_created_idx ON saved_places(user_id, created_at DESC);
