-- Username + password credentials (auth-password).
--
-- 方案选择:username / password_hash 直接挂在 users 上(与 phone / email 一致,
-- 都是 profile 字段),auth_identities 保留 password:<username> 行
-- (provider='password'),这样 getSessionUser 的
-- LEFT JOIN LATERAL ... auth_identities 取 provider 的逻辑无需改动。
-- 用户名唯一键走 lower(username) 部分唯一索引(大小写不敏感,空值不约束)。

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS password_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_uidx
  ON users (lower(username)) WHERE username IS NOT NULL AND username <> '';

-- 扩展 provider CHECK 支持 'password'(沿用 007 的 drop/re-add 幂等模式)。
ALTER TABLE auth_identities DROP CONSTRAINT IF EXISTS auth_identities_provider_check;
ALTER TABLE auth_identities
  ADD CONSTRAINT auth_identities_provider_check
  CHECK (provider IN ('phone', 'email', 'github', 'google', 'x', 'wechat', 'password'));
