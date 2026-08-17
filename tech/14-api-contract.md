# Public / account API contract（2026-08-16）

MapShell does **not** use these routes for the live Domain list. The browser talks to AMap. The routes exist for persistence, suggest, and later PostGIS.

All public GETs below send `Cache-Control: public, max-age=30, stale-while-revalidate=60` and share a 30s process cache. **Account routes are never cached.**

## Public

| Method | Path | Notes |
|---|---|---|
| GET | `/api/modes` | Active modes. `?all=1` includes reserved college/overseas. |
| GET | `/api/filter-options?mode=` | Filters + sort options from `MODES`. Unknown mode → 400. |
| GET | `/api/pois?mode=&q=&filters=&sort=&bounds=&page=&pageSize=` | `loadServerCatalog` → optional bbox / distance / district / **city** / **maxTier** / **alive** clip → `runPOIPipeline`. Work prefers imported SQL rows, else offline drops. **Only authentic positions are returned** (`radar-*` / `portal-*`; seed example jobs are scaffolding and filtered out, 2026-08-17). Ungeocoded radar sites are excluded. National scope (2026-08-17): `filters.maxTier` is the LOD zoom cap (0..20, company visible when tier<=zoom; SQL `companies.tier <= n`), `filters.city` matches `city_code` exactly or `city` by ILIKE (`'北京'` hits `'北京市'`), `filters.alive` keeps only open positions with a future/no deadline (DB path always applies this rule). Domain = `DOMAIN_SEED`. College/overseas = empty. |
| GET | `/api/pois/:id?mode=` | `loadServerCatalogById`. Missing → 404. |
| POST | `/api/search` | JSON `{ mode, q, filters, sort, bounds, page, pageSize }`. Invalid JSON → 400. `bounds` clips results to the box, then distances from the box center. Returns `aggregations.industries`. Same catalog; `filters.maxTier` / `city` / `alive` passthrough identical to `/api/pois` (maxTier 语义:当前 zoom 取整,tech/19)。 |
| GET | `/api/suggest?q=&mode=` | Same catalog. Work: company / job / tag. Domain: seed names. Job rows include `poiId` (company catalog id) so the client can open the office. Tag rows come from `suggestSearchTags` (`TAG_FILTERS`: scale / industry / jobTaxonomy / roleFamily / district / onlyOpen / housing / shuttle / education), not a hardcoded industry list. Company / job / place aliases (`alibaba` → 阿里巴巴, `FE` → 前端, `westlake` → 西湖) share `matchKeyword`. Empty `q` → `trendingForMode` as `hotSearches` (search box does not render them; Recent L2 does). `recentSearches` always `[]` (signed-in: `/api/me/search-history`; guests: `dm.guest-search-history.v1`). MapShell work autocomplete calls this (200ms debounce) and falls back to `suggestSearchTags` + `suggestRecruitment` if the request fails. |

`pageSize` is clamped to 50. `filters` is JSON. `bounds` is `minLng,minLat,maxLng,maxLat` and **filters** the list (it is not only a sort origin).

## Account (`/api/me/*`, `/api/auth/*`)

Cookie session. Guests get 401, never a fabricated list.

- Search history and saved places are persistable catalog rows only (`lib/persistable.ts`). `POST /api/me/saved` with a domain snapshot → 400 `NOT_PERSISTABLE`. Guest Recent is browser-only.
- Demo OTP is stubbed (`000000`). Keep `POST /api/auth/otp/send` for Aliyun later.
- OAuth UI / demo map: GitHub / Google / WeChat via `POST /api/auth/oauth`. Do not add X. Existing `'x'` account rows stay valid.
- Do not introduce NextAuth / Clerk until an ADR. Demo identities already cover the Profile flow.

## Errors

JSON `{ code, message }`. Typical codes: `BAD_REQUEST`, `INVALID_MODE`, `NOT_FOUND`, `UNAUTHORIZED`, `NOT_PERSISTABLE`.
