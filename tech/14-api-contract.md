# Public / account API contract（2026-08-16）

Domain live list: **in-Hangzhou browse goes through `/api/pois/domain-local`** (local `hz_pois` table, bbox + zoom tier clip, 2026-08-17); outside Hangzhou the browser calls the AMap API directly (no POI import). Work list reads the same catalog through these routes. The routes also serve persistence, suggest, and PostGIS reads.

All public GETs below send `Cache-Control: public, max-age=30, stale-while-revalidate=60` and share a 30s process cache. **Account routes are never cached.**

## Public

| Method | Path | Notes |
|---|---|---|
| GET | `/api/modes` | Active modes. `?all=1` includes reserved college/overseas. |
| GET | `/api/filter-options?mode=` | Filters + sort options from `MODES`. Unknown mode → 400. |
| GET | `/api/pois?mode=&q=&filters=&sort=&bounds=&page=&pageSize=` | `loadServerCatalog` → optional bbox / distance / district / **city** / **maxTier** / **alive** clip → `runPOIPipeline`. **严格 DB-only（2026-08-26）**：work 读 Postgres（`companies` / `company_sites` / `positions`），无 DB / 失败 → 空数组，不再回退 seed 离线目录（seed 示例数据已归档 `tech/backup/seed-data`）。**Only authentic positions are returned** (`radar-*` / `portal-*`; seed example jobs are scaffolding and filtered out, 2026-08-17). Ungeocoded radar sites are excluded. National scope (2026-08-17): `filters.maxTier` is the LOD zoom cap — value range **0..21** (0=always visible, 21=never-show hidden marker; the frontend `maxTierForZoom` only emits 0..20, so tier 21 is filtered out by `tier <= maxTier`; SQL `companies.tier <= n`, tech/19), `filters.city` matches `city_code` exactly or `city` by ILIKE (`'北京'` hits `'北京市'`), `filters.alive` keeps only open positions with a future/no deadline (DB path always applies this rule). Domain = 空（live Domain browse uses `/api/pois/domain-local` → `hz_pois` + AMap 兜底）。College/overseas = empty. |
| GET | `/api/pois/domain-local?bounds=west,south,east,north&zoom=&q=&categories=&limit=&offset=` | `bounds` 必填，四个有限数值且必须完全落在杭州导入范围 `118.3,29.1,120.8,30.7` 内；缺失/非法 → 400 `INVALID_BOUNDS`，越界 → 400 `BOUNDS_OUT_OF_RANGE`。`hz_pois` 按 bbox + zoom tier clip，数据库故障 → 502，前端回退 AMap。 |
| GET | `/api/pois/:id?mode=` | `loadServerCatalogById`；work 详情按 slug/站点 id 定向读取公司、站点和在招岗位。Missing → 404. |
| POST | `/api/search` | JSON `{ mode, q, filters, sort, bounds, page, pageSize }`. Invalid JSON → 400. `page` 必须是 1..10000 的有限正整数，`pageSize` 必须是 1..100 的有限正整数；缺失/null 使用默认值，其他非法值 → 400，与 GET `/api/pois` 一致。`bounds` clips results to the box, then distances from the box center. Returns `aggregations.industries`. Same catalog; `filters.maxTier` / `city` / `alive` passthrough identical to `/api/pois` (maxTier 语义:当前 zoom 取整,tech/19)。 |
| GET | `/api/suggest?q=&mode=` | Same catalog. Work: company / job / tag；公司/岗位匹配由受限 SQL 查询完成（每类最多 10 行，不物化全 catalog）。Domain: **hz_pois name prefix match** (local DB, `adname` as subtitle; no DB / table missing / 0 hits → empty list, client falls back to AMap AutoComplete once). Job rows include `poiId` (company catalog id) so the client can open the office. Tag rows come from `suggestSearchTags` (`TAG_FILTERS`: scale / industry / jobTaxonomy / roleFamily / district / onlyOpen / housing / shuttle / education), not a hardcoded industry list. Company / job / place aliases (`alibaba` → 阿里巴巴, `FE` → 前端, `westlake` → 西湖) share `matchKeyword`. Empty `q` → `trendingForMode` as `hotSearches` (search box does not render them; Recent L2 does). `recentSearches` always `[]` (signed-in: `/api/me/search-history`; guests: `dm.guest-search-history.v1`). MapShell work autocomplete calls this (200ms debounce) and falls back to `suggestSearchTags` + `suggestRecruitment` if the request fails). |

`pageSize` is clamped to 50. `filters` is JSON. `bounds` is `minLng,minLat,maxLng,maxLat` and **filters** the list (it is not only a sort origin).

## Navigation (`/api/navigation/routes/*`)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/navigation/routes/plan` | Bounded JSON `RouteRequest` → validated `RoutePlan`. Production has no live provider, so the normal result is an explicit `estimate` without geometry/`routeId`. |
| GET | `/api/navigation/routes/:routeId` | Returns only the unexpired public provider artifact for the same navigation session; public shape excludes the internal session fingerprint. |

Both responses are `Cache-Control: no-store`. The separate host-only HttpOnly/SameSite=Lax navigation cookie
uses `Path=/api`, allowing the upcoming `/api/agent/chat` integration and route handlers to share one session
without sending the token to page/static requests. The process-local artifact store is bounded by entry count and
aggregate geometry points; it does not persist provider raw responses.

## Account (`/api/me/*`, `/api/auth/*`)

Cookie session. Guests get 401, never a fabricated list.

- Search history and saved places are persistable catalog rows only (`lib/persistable.ts`). `POST /api/me/saved` with a domain snapshot → 400 `NOT_PERSISTABLE`. Guest Recent is browser-only.
- OTP send (email 2026-08-21 / phone 2026-08-22): email goes out for real via Resend (`POST /api/auth/otp/send` → `{ ok, provider, expiresAt, messageId }`; needs `RESEND_API_KEY`, error mapping & retry policy see tech/25). Phone goes out for real via the Aliyun SMS verification service (`{ ok, provider, expiresAt, requestId }`; needs `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET` / `ALIYUN_SMS_SIGN_NAME` / `ALIYUN_SMS_TEMPLATE_CODE`; error mapping & retry policy see tech/26-aliyun-sms.md).
- OAuth (2026-08-22): real authorization code flow for GitHub / Google / WeChat — `GET /api/auth/oauth/providers` (probe `configured`), `GET /api/auth/oauth/start?provider=<id>&next=<path>` (302 to the provider, signed `oauth_state` cookie), `GET /api/auth/oauth/callback/<provider>?code=&state=` (state check → code exchange → userinfo → `upsertIdentity` → session cookie → 302 back to `next`); failure → 302 `?auth_error=oauth_state_invalid|oauth_provider_error`. Demo login is non-production-only; a configured provider returns `403 DEMO_LOGIN_DISABLED`, while production returns `403 DEMO_LOGIN_DISABLED_IN_PRODUCTION` instead of minting a session. Endpoint detail / error mapping / ⚠️ manual config checklist: tech/27. Do not add X. Existing `'x'` account rows stay valid.
- Password accounts (2026-08-19): `POST /api/auth/password/register` `{ username, password, confirmPassword? }` → 201-less 200 `{ ok: true, user }` + session cookie; 400 `INVALID_USERNAME` / `PASSWORD_TOO_SHORT` / `PASSWORD_MISMATCH`, 409 `USERNAME_TAKEN`, 429 `RATE_LIMITED` after 5 validated attempts (including duplicate-username probes) per proxy-aware bucket per hour. `POST /api/auth/password/login` `{ username, password }` → `{ ok: true, user }` + cookie; 401 `INVALID_CREDENTIALS` (same message for unknown user vs wrong password). Username: 2-32 letters/digits/underscore/Chinese, unique case-insensitively (`users.username` + `lower()` partial unique index, migration 014). Hash: `scrypt` via `node:crypto` (`lib/password.ts`, format `scrypt$N$r$p$salt$hash`), never returned by `/api/auth/me`. Registration also writes an `auth_identities` row `(password, <username-lower>)`.
- Password management (2026-08-22, tech/28): `POST /api/auth/me/password` `{ oldPassword?, otp?: { provider: 'email'|'phone', target, code }, newPassword }` → 200 `{ ok, user }`; 400 `PASSWORD_TOO_SHORT` / 401 `WRONG_PASSWORD` | `INVALID_CODE` | `NOT_BOUND` | `UNAUTHORIZED`. `POST /api/auth/me/phone` `{ phone, code }` → 409 `PHONE_TAKEN` / 401 `INVALID_CODE`; `POST /api/auth/me/email` `{ email, code }` → 409 `EMAIL_TAKEN` / 401 `INVALID_CODE`. Bind/swap = update `users.phone|email` + `auth_identities` upsert/delete, never fully unbind. `password/login` username now accepts **email or username**; user JSON gains `hasPassword` (hash non-empty, never returned).
- Avatar upload (2026-08-21): `POST /api/me/avatar` (multipart, field `file`) → `{ user }`; bytes go to `users.avatar_data` (bytea, migration 017), `avatar_url` becomes the versioned serve path `/api/me/avatar?v=<ts>` (new upload = new URL → `Cache-Control: private, max-age=31536000, immutable`). Server validates with zero deps: magic bytes (JPEG/PNG) + dimension header parse + 512KB / 4096px caps (`lib/avatar-image.ts`); 400 `AVATAR_TOO_LARGE` / `INVALID_AVATAR`, missing field → 400 `BAD_REQUEST`; authenticated uploads are bounded to 5 per user per hour (`429 AVATAR_RATE_LIMITED`) before multipart parsing. `GET /api/me/avatar` serves the bytes (404 `NOT_FOUND` when none; OAuth external avatars keep their original `avatar_url`). Clearing: `PATCH /api/auth/me` with `avatarUrl: ""` clears both columns. `avatar_data` never appears in any user JSON.
- Account vs username (2026-08-21): **账户 (account)** = the login credential — email / phone / the registration username — is immutable and shown in the Profile identity card (`accountLabel` fallback: provider name for pure-OAuth users). **用户名 (username)** = `displayName`, changeable via `PATCH /api/auth/me`. Profile labels: 求职偏好 rows are 求职状态 / 求职类型 (families: intern/campus/social) / 意向行业 / 意向岗位 (strengths: algorithm/frontend/backend/product/design/data). PATCH input caps (2026-08-23, quality-scan #18): `displayName` ≤ 50 chars (`DISPLAY_NAME_TOO_LONG` / `INVALID_DISPLAY_NAME`), `avatarUrl` ≤ 2048 chars and http(s) only (`INVALID_AVATAR_URL`); `avatarUrl: ""` still clears the avatar; all 400 pre-store.
- Do not introduce NextAuth / Clerk until an ADR. Demo identities already cover the Profile flow.

## Errors

JSON `{ code, message }`. Navigation errors use the same top-level shape and add stable `retryable`; they are not
wrapped in an `error` property. Typical codes: `BAD_REQUEST`, `INVALID_MODE`, `INVALID_REQUEST`, `NOT_FOUND`,
`UNAUTHORIZED`, `FORBIDDEN`, `EXPIRED`, `RATE_LIMITED`, `TIMEOUT`, `NOT_PERSISTABLE`.
