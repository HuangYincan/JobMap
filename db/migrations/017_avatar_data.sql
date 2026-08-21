-- Uploaded avatar bytes (image/jpeg or image/png, client-side cropped to 256px).
--
-- 头像「真实存储」:裁剪结果经 POST /api/me/avatar 上传,二进制存本列;
-- users.avatar_url 同时写入服务端提供的路径(/api/me/avatar?v=<时间戳>)。
-- OAuth 外部头像(如 GitHub)只写 avatar_url 不写本列。清空头像(avatar_url='')
-- 时两列一起清(updateUser 的 CASE 分支)。
--
-- bytea 行在 PostgreSQL 里自动 TOAST,256px JPEG ~15-60KB 无压力。

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_data bytea;
