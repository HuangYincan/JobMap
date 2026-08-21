# Public / account API contract（2026-08-16）

Domain live list: **in-Hangzhou browse goes through `/api/pois/domain-local`** (local `hz_pois` table, bbox + zoom tier clip, 2026-08-17); outside Hangzhou the browser calls the AMap API directly (no POI import). Work list reads the same catalog through these routes. The routes also serve persistence, suggest, and PostGIS reads.

All public GETs below send `Cache-Control: public, max-age=30, stale-while-revalidate=60` and share a 30s process cache. **Account routes are never cached.**

## Public

| Method | Path | Notes |
|---|---|---|
| GET | `/api/modes` | Active modes. `?all=1` includes reserved college/overseas. |
| GET | `/api/filter-options?mode=` | Filters + sort options from `MODES`. Unknown mode → 400. |
| GET | `/api/pois?mode=&q=&filters=&sort=&bounds=&page=&pageSize=` | `loadServerCatalog` → optional bbox / distance / district / **city** / **maxTier** / **alive** clip → `runPOIPipeline`. Work prefers imported SQL rows, else offline drops. **Only authentic positions are returned** (`radar-*` / `portal-*`; seed example jobs are scaffolding and filtered out, 2026-08-17). Ungeocoded radar sites are excluded. National scope (2026-08-17): `filters.maxTier` is the LOD zoom cap — value range **0..21** (0=always visible, 21=never-show hidden marker; the frontend `maxTierForZoom` only emits 0..20, so tier 21 is filtered out by `tier <= maxTier`; SQL `companies.tier <= n`, tech/19), `filters.city` matches `city_code` exactly or `city` by ILIKE (`'北京'` hits `'北京市'`), `filters.alive` keeps only open positions with a future/no deadline (DB path always applies this rule). Domain = `DOMAIN_SEED` (server-side seed; live Domain browse uses `/api/pois/domain-local` → `hz_pois`). College/overseas = empty. |
| GET | `/api/pois/:id?mode=` | `loadServerCatalogById`. Missing → 404. |
| POST | `/api/search` | JSON `{ mode, q, filters, sort, bounds, page, pageSize }`. Invalid JSON → 400. `bounds` clips results to the box, then distances from the box center. Returns `aggregations.industries`. Same catalog; `filters.maxTier` / `city` / `alive` passthrough identical to `/api/pois` (maxTier 语义:当前 zoom 取整,tech/19)。 |
| GET | `/api/suggest?q=&mode=` | Same catalog. Work: company / job / tag. Domain: **hz_pois name prefix match** (local DB, `adname` as subtitle; no DB / table missing / 0 hits → empty list, client falls back to AMap AutoComplete once). Job rows include `poiId` (company catalog id) so the client can open the office. Tag rows come from `suggestSearchTags` (`TAG_FILTERS`: scale / industry / jobTaxonomy / roleFamily / district / onlyOpen / housing / shuttle / education), not a hardcoded industry list. Company / job / place aliases (`alibaba` → 阿里巴巴, `FE` → 前端, `westlake` → 西湖) share `matchKeyword`. Empty `q` → `trendingForMode` as `hotSearches` (search box does not render them; Recent L2 does). `recentSearches` always `[]` (signed-in: `/api/me/search-history`; guests: `dm.guest-search-history.v1`). MapShell work autocomplete calls this (200ms debounce) and falls back to `suggestSearchTags` + `suggestRecruitment` if the request fails. |

`pageSize` is clamped to 50. `filters` is JSON. `bounds` is `minLng,minLat,maxLng,maxLat` and **filters** the list (it is not only a sort origin).

## Account (`/api/me/*`, `/api/auth/*`)

Cookie session. Guests get 401, never a fabricated list.

- Search history and saved places are persistable catalog rows only (`lib/persistable.ts`). `POST /api/me/saved` with a domain snapshot → 400 `NOT_PERSISTABLE`. Guest Recent is browser-only.
- Demo OTP is stubbed (`000000`). Keep `POST /api/auth/otp/send` for Aliyun later.
- OAuth UI / demo map: GitHub / Google / WeChat via `POST /api/auth/oauth`. Do not add X. Existing `'x'` account rows stay valid.
- Password accounts (2026-08-19): `POST /api/auth/password/register` `{ username, password, confirmPassword? }` → 201-less 200 `{ ok: true, user }` + session cookie; 400 `INVALID_USERNAME` / `PASSWORD_TOO_SHORT` / `PASSWORD_MISMATCH`, 409 `USERNAME_TAKEN`. `POST /api/auth/password/login` `{ username, password }` → `{ ok: true, user }` + cookie; 401 `INVALID_CREDENTIALS` (same message for unknown user vs wrong password). Username: 2-32 letters/digits/underscore/Chinese, unique case-insensitively (`users.username` + `lower()` partial unique index, migration 014). Hash: `scrypt` via `node:crypto` (`lib/password.ts`, format `scrypt$N$r$p$salt$hash`), never returned by `/api/auth/me`. Registration also writes an `auth_identities` row `(password, <username-lower>)`.
- Avatar upload (2026-08-21): `POST /api/me/avatar` (multipart, field `file`) → `{ user }`; bytes go to `users.avatar_data` (bytea, migration 017), `avatar_url` becomes the versioned serve path `/api/me/avatar?v=<ts>` (new upload = new URL → `Cache-Control: private, max-age=31536000, immutable`). Server validates with zero deps: magic bytes (JPEG/PNG) + dimension header parse + 512KB / 4096px caps (`lib/avatar-image.ts`); 400 `AVATAR_TOO_LARGE` / `INVALID_AVATAR`, missing field → 400 `BAD_REQUEST`. `GET /api/me/avatar` serves the bytes (404 `NOT_FOUND` when none; OAuth external avatars keep their original `avatar_url`). Clearing: `PATCH /api/auth/me` with `avatarUrl: ""` clears both columns. `avatar_data` never appears in any user JSON.
- Account vs username (2026-08-21): **账户 (account)** = the login credential — email / phone / the registration username — is immutable and shown in the Profile identity card (`accountLabel` fallback: provider name for pure-OAuth users). **用户名 (username)** = `displayName`, changeable via `PATCH /api/auth/me`. Profile labels: 求职偏好 rows are 求职状态 / 求职类型 (families: intern/campus/social) / 意向行业 / 意向岗位 (strengths: algorithm/frontend/backend/product/design/data).
- Do not introduce NextAuth / Clerk until an ADR. Demo identities already cover the Profile flow.

## Errors

JSON `{ code, message }`. Typical codes: `BAD_REQUEST`, `INVALID_MODE`, `NOT_FOUND`, `UNAUTHORIZED`, `NOT_PERSISTABLE`.
