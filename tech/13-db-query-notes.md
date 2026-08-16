# 数据库查询笔记（2026-08-16）

Live PostGIS / Docker 仍不可用。本页记录**已经写进迁移的索引**和 **`account-store` 真实 SQL**，避免下次有库时再扫一遍。没有 `DATABASE_URL` 时这些语句不跑，走内存回落。

**不要**在没有库的情况下把「查询优化」标成已用 `EXPLAIN ANALYZE` 验证。下面的索引是契约，不是实测计划。

## 谁在查库

| 路径 | 何时打 Postgres | 不打 |
|---|---|---|
| MapShell 列表 / 搜索 / 筛选 | 从不。浏览器高德 + `runPOIPipeline` | 公开读走 `loadServerCatalog`（有导入行读库，否则 seed + official-career JSON）+ 30s 进程缓存 |
| `loadWorkCatalogFromDb` | 有 `DATABASE_URL` 且 `companies` 有行 | 无池 / 查询失败 → `null`（调用方回落 seed）；空表 → `[]` |
| `/api/me/*`、登录、Recent、Saved、投递、提醒 | 有 `DATABASE_URL` 时走 `account-store` | 没有库 → 内存 Map |

连接：`lib/db.ts` 单例 `Pool({ max: 5 })`。不要打印连接串。

## 已有索引（对着真实查询）

账户行都按「当前用户 + 新→旧 + LIMIT」读。迁移已经给了匹配的 btree：

| 查询（`account-store.ts`） | 索引 |
|---|---|
| `auth_sessions` by `token_hash` | `UNIQUE(token_hash)` |
| `auth_sessions` 过期清理预备 | `auth_sessions_expires_at_idx` |
| `auth_identities` by `(provider, subject)` | `UNIQUE(provider, subject)` |
| `auth_otp_challenges` 最新未消费码 | `auth_otp_challenges_lookup_idx (provider, target, expires_at DESC)` |
| `search_history` `WHERE user_id ORDER BY created_at DESC LIMIT n` | `search_history_user_created_idx (user_id, created_at DESC)` |
| `saved_places` 同上 | `saved_places_user_created_idx` + `UNIQUE(user_id, poi_id)` |
| `applications` 同上 | `applications_user_created_idx` + `UNIQUE(user_id, position_id)` |
| `notifications` 同上 | `notifications_user_created_idx` + `UNIQUE(user_id, kind, position_id)` |
| 手机 / 邮箱登录查用户 | 部分唯一 `users_phone_uidx`、`users_email_uidx (lower(email))` |

`addHistory` 先 `SELECT … ORDER BY created_at DESC LIMIT 1` 再决定 bump 还是 INSERT。复合索引前缀 `user_id` 覆盖这条。不要再给 `search_history(query)` 加 btree——Recent 不做全文。

`ON CONFLICT` 写 Saved / 投递 / 提醒，靠表上的 UNIQUE，不要另开去重查询。

## 招聘表（公开读已能 SELECT；视野查询仍等 PostGIS）

`006_recruitment_sites.sql` 给导入和以后的 PostGIS 读路径预留：

- `company_sites_geom_gist` — `geometry(Point,4326)` 生成列
- `positions_status_family_idx (status, family)` — 开岗 + intern/campus/social
- `positions_title_trgm` / `entities_name_trgm` / `items_title_trgm` — `pg_trgm` GIN
- `positions_company_id_idx` / `positions_site_id_idx` / `company_sites_company_id_idx`

`loadWorkCatalogFromDb` 现在读全量开岗；`/api/pois` 和 `/api/search` 在内存里用 `inBounds` 裁 `bounds`。单站点 POI id = `companies.slug`（对齐 WORK_SEED）；多站点 = `slug:site.id`。PostGIS 视野查询落地后应是：

```sql
SELECT c.*, s.*, p.*
FROM positions p
JOIN company_sites s ON s.id = p.site_id
JOIN companies c ON c.id = p.company_id
WHERE p.status = 'open'
  AND ($family::text IS NULL OR p.family = $family)
  AND ($bbox::geometry IS NULL OR s.geom && $bbox);
```

`status + family` 走 btree；视野用 `&&` 再 `ST_DWithin`，不要先 `ST_Distance` 排序全表。行政区插件今天匹配地址文本（`DISTRICT_PLUGIN`）；换成多边形后再加 `gist` 到 district 边界表，不要在 `company_sites.address` 上指望 btree。

## 刻意不做

- **Domain 列表不进库。** 累计池在浏览器 `sessionStorage`；不要把高德结果写进 `entities`。工作模式公开读已可走导入行。
- **不为 JSON 偏好建 GIN。** `users.preferences` 按 `id` 整行读写。
- **不在应用里拼未绑定 SQL。** 全部 `$1` 参数。
- **不引入 ORM。** 等 ADR。
- **邮件/短信不改 `notifications.status`。** 本阶段只 `queued`。

## Docker 通了以后的验收

1. `make db-migrate` 对空库跑完 `001`–`010`。
2. 对上面每条 `account-store` SELECT 跑 `EXPLAIN (ANALYZE, BUFFERS)`：Index Scan / Index Only Scan，不要 Seq Scan。
3. 招聘 `bbox` 查询确认走 `company_sites_geom_gist`。
4. `getSessionUser` already `DELETE`s expired sessions (and the missed token) on a cache miss; `consumeOtp` deletes expired challenges for that target. A periodic sweeper can still use `auth_sessions_expires_at_idx` later.

在那之前，优化面是：保持 `Pool max=5`、账号路由不进 `public-cache`、公开读 30s TTL。
