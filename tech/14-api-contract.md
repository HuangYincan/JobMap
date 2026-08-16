# Public / account API contract（2026-08-16）

MapShell does **not** use these routes for the live Domain list. The browser talks to AMap. The routes exist for persistence, suggest, and later PostGIS.

All public GETs below send `Cache-Control: public, max-age=30, stale-while-revalidate=60` and share a 30s process cache. **Account routes are never cached.**

## Public

| Method | Path | Notes |
|---|---|---|
| GET | `/api/modes` | Active modes. `?all=1` includes reserved college/overseas. |
| GET | `/api/filter-options?mode=` | Filters + sort options from `MODES`. Unknown mode → 400. |
| GET | `/api/pois?mode=&q=&filters=&sort=&bounds=&page=&pageSize=` | `loadServerCatalog` → optional bbox clip (`inBounds`) → `runPOIPipeline`. Work prefers imported SQL rows, else `INTERNSHIP_SEED`. Domain = `DOMAIN_SEED`. College/overseas = empty. |
| GET | `/api/pois/:id?mode=` | `loadServerCatalogById`. Missing → 404. |
| POST | `/api/search` | JSON `{ mode, q, filters, sort, bounds, page, pageSize }`. Invalid JSON → 400. `bounds` clips results to the box, then distances from the box center. Returns `aggregations.industries`. Same catalog. |
| GET | `/api/suggest?q=&mode=` | Same catalog. Work: company / job / tag. Domain: seed names. Job rows include `poiId` (company catalog id) so the client can open the office. Tag rows come from `suggestSearchTags` (`TAG_FILTERS`: scale / industry / jobTaxonomy), not a hardcoded industry list. Empty `q` → `trendingForMode` as `hotSearches`. `recentSearches` always `[]` (use `/api/me/search-history`). MapShell work autocomplete calls this (200ms debounce) and falls back to `suggestSearchTags` + `suggestRecruitment` if the request fails. |

`pageSize` is clamped to 50. `filters` is JSON. `bounds` is `minLng,minLat,maxLng,maxLat` and **filters** the list (it is not only a sort origin).

## Account (`/api/me/*`, `/api/auth/*`)

Cookie session. Guests get 401, never a fabricated list.

- Search history, saved places, applications, notifications: per `user_id`.
- Demo OTP is stubbed (`000000`). Keep `POST /api/auth/otp/send` for Aliyun later.
- OAuth: GitHub / Google / X / WeChat stubs via `POST /api/auth/oauth`.
- Do not introduce NextAuth / Clerk until an ADR. Demo identities already cover the Profile flow.

## Errors

JSON `{ code, message }`. Typical codes: `BAD_REQUEST`, `INVALID_MODE`, `NOT_FOUND`, `UNAUTHORIZED`.
