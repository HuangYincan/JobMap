-- User personalized memory (tech/30-agent-memory.md).
-- One row per saved fact. Guests do not write here; user_id is always the session user.

CREATE TABLE user_memories (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_memories_user_created_idx ON user_memories (user_id, created_at DESC);
