# 数据库查询笔记（2026-08-16）

Live PostGIS apply is verified (`001`–`010`, 51 companies / 51 sites). This page records **indexes already in migrations**, **real `account-store` SQL**, and a 2026-08-16 gist `EXPLAIN`. Without `DATABASE_URL` those statements do not run and callers use memory / seed.

**不要**在没有库的情况下把「查询优化」标成已用 `EXPLAIN ANALYZE` 验证。空间 clip 和账户列表已在本机 51 家 / 1 个用户上跑过 `EXPLAIN`；新查询仍要自己量。

## 谁在查库

| 路径 | 何时打 Postgres | 不打 |
|---|---|---|
| MapShell 列表 / 搜索 / 筛选 | 从不。浏览器高德 + `runPOIPipeline` | 公开读走 `loadServerCatalog`（有导入行读库，否则 seed + official-career JSON）+ 30s 进程缓存 |
| `loadWorkCatalogFromDb(clip?)` | 有 `DATABASE_URL` | 无池 / 查询失败 → `null`（调用方回落 seed）；空表无 clip → seed；带 clip 的空结果保持 `[]` |
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

## 招聘表（公开读已能 SELECT + 空间 clip）

`006_recruitment_sites.sql` 给导入和以后的 PostGIS 读路径预留：

- `company_sites_geom_gist` — `geometry(Point,4326)` 生成列
- `positions_status_family_idx (status, family)` — 开岗 + intern/campus/social
- `positions_title_trgm` / `entities_name_trgm` / `items_title_trgm` — `pg_trgm` GIN
- `positions_company_id_idx` / `positions_site_id_idx` / `company_sites_company_id_idx`

`loadWorkCatalogFromDb(clip?)` 在有 `DATABASE_URL` 时读开岗。`/api/pois` 和 `/api/search` 把 `bounds` / `filters.distance` / `filters.district` 编成 `SpatialClip`（`lib/spatial-query.ts`）再下推：站点先 `s.geom && ST_MakeEnvelope(...)`（gist），有距离再 `ST_DWithin(s.geom::geography, point, meters)`。行政区是超集：地址 `ILIKE` 区名/简称，或点落在粗框。命中站点后再 `companies.id = ANY(...)` / `positions.site_id = ANY(...)`，不要把整表公司和岗位拉进 Node。无库或导入失败仍走 seed，内存 `inBounds` + `poiMatchesDistrict` 二次裁（地址优先于粗框）。`/api/suggest` 和 job-alert 不传 clip，仍是全量目录。单站点 POI id = `companies.slug`（对齐 WORK_SEED）；多站点 = `slug:site.id`。

```sql
SELECT s.id, s.company_id, s.name, s.address, s.lng, s.lat, s.career_url, s.logo_url
FROM company_sites s
WHERE s.geom IS NOT NULL
  AND s.geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
  AND ST_DWithin(
    s.geom::geography,
    ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography,
    $7
  );
```

`status + family` 走 btree；视野用 `&&` 再 `ST_DWithin`，不要先 `ST_Distance` 排序全表。行政区 SQL 是地址 `ILIKE` + 粗框超集；精确规则仍在 `poiMatchesDistrict`。换成多边形后再加 `gist` 到 district 边界表，不要在 `company_sites.address` 上指望 btree。

## 刻意不做

- **Domain 列表不进库。** 累计池在浏览器 `sessionStorage`；不要把高德结果写进 `entities`。工作模式公开读已可走导入行。
- **不为 JSON 偏好建 GIN。** `users.preferences` 按 `id` 整行读写。
- **不在应用里拼未绑定 SQL。** 全部 `$1` 参数。
- **不引入 ORM。** 等 ADR。
- **邮件/短信不改 `notifications.status`。** 本阶段只 `queued`。

## Live EXPLAIN（2026-08-16，51 行 `company_sites` + 1 个账户）

西湖西溪小框 `ST_MakeEnvelope(120.01, 30.26, 120.04, 30.29, 4326)`：

- 只有 `geom && envelope`：planner 走 **Seq Scan**（表太小，gist 启动成本更高）。实际 3 行 / 48 行被 Filter 丢掉。
- `&&` + `ST_DWithin(geom::geography, point, 3000)`：走 **Bitmap Index Scan on `company_sites_geom_gist`**，再 Heap Recheck + `st_dwithin` Filter。实际仍是 3 行。

gist 已接上。行数涨到几百以后，单独的 bbox 也应切到 Index Scan；现在不要为 51 行强行 `SET enable_seqscan = off`。

账户列表（user_id = 1，history 3 行 / saved 0 / apps 0 / notes 0）：

- `search_history` / `saved_places` / `applications`：`Bitmap Index Scan` on `*_user_created_idx`，Index Cond = `user_id`。行太少时 `ORDER BY created_at DESC` 会再套一层 Sort，不是 Seq Scan。
- `notifications`：`Index Scan using notifications_user_created_idx`。
- `auth_sessions` by `token_hash`：`Index Scan using auth_sessions_token_hash_key`，`expires_at > now()` 是 Filter。

## Docker 通了以后的验收

1. `make db-migrate` 对空库跑完 `001`–`010`。**Done.**
2. 对上面每条 `account-store` SELECT 跑 `EXPLAIN (ANALYZE, BUFFERS)`：Index Scan / Index Only Scan，不要 Seq Scan。**Done for history / saved / applications / notifications / sessions.**
3. 招聘 `bbox` 查询确认走 `company_sites_geom_gist`。**Done for `&&` + `ST_DWithin`.** 单独 `&&` 在 51 行时仍 Seq Scan。
4. `getSessionUser` already `DELETE`s expired sessions (and the missed token) on a cache miss; `consumeOtp` deletes expired challenges for that target. A periodic sweeper can still use `auth_sessions_expires_at_idx` later.

在那之前，优化面是：保持 `Pool max=5`、账号路由不进 `public-cache`、公开读 30s TTL。

## 全国规模扩展（2026-08-17，计划见 tech/18）

工作模式全国化（北上广深、成都、武汉）的 DB 落地（`011_national_scope`，已实现 2026-08-17）：

- `companies.tier smallint NOT NULL DEFAULT 3`（1名企/2大厂/3中厂/其他）：LOD 按缩放级别过滤。索引 `companies_tier_idx`。
- `company_sites.province text` / `city_code text`（行政区划码）：城市分片加载；`company_sites_city_code_idx` + `company_sites_city_company_idx (city_code, company_id)`（join 公司的复合索引）。
  - ⚠️ 计划草案里的复合 `(city_code, tier)` 无法建在单表上（tier 在 `companies`），改为上面的 join 复合索引 + `companies_tier_idx` 联合覆盖城市过滤 + 层级过滤。
- `company_sites.geom_geog geography(Point,4326)` STORED（由 lng/lat 生成）+ `company_sites_geog_gist`：用户位置半径用 `ST_DWithin(geom_geog, point_geog, radius_m)`，避免 4326 度数误差。
- 视野裁剪仍 `geom && ST_MakeEnvelope` + `ST_DWithin`（已有）。
- `positions_open_site_idx (site_id) WHERE status='open'`：部分索引，alive 过滤只扫在招行。
- A1 只在招：DB 读路径恒开 `status='open' AND (deadline IS NULL OR deadline >= CURRENT_DATE)`；离线 catalog 在 `loadOfflineWorkCatalog` 里按 `isAlivePosition` 内存过滤；筛选器 `alive` 同规则。
- 读路径透传（`/api/pois` + `/api/search` 的 `filters`）：`maxTier`（SQL 下推 `companies.tier <= n`，内存 `applyFilters` 兜底）、`city`（SQL：`city_code` 精确 OR `city` ILIKE；内存：site 城市/地址文本包含）、`alive`。
- 导入映射（`recruitment-import.ts`）：`companies.tier` 缺省 3；site `city` 从 drop `site.city` 或地址解析（`siteCityOf`：目标城市名 / 杭州区名前缀），`province`/`city_code` 原样落库。
- 百万级预留：按 `province`/`city_code` 分区或聚合展示（缩到全国时按 tier 聚合计数）。
