-- Keep one durable row per user/memory fact; concurrent saves must be idempotent.

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, content
           ORDER BY created_at DESC, id DESC
         ) AS duplicate_rank
  FROM user_memories
)
DELETE FROM user_memories
WHERE id IN (
  SELECT id FROM ranked WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS user_memories_user_content_uidx
  ON user_memories (user_id, content);
