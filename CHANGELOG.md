# Changelog

Dates are UTC+8. This file tracks shipped work on `feature/phase-2-multi-mode` and later. It is not a substitute for `tech/05-milestones.md`.

## 2026-08-16

### Added

- Multi-mode map: Domain + Work. Intern / campus / social are work FilterPlugins, not extra map modes.
- Viewport Domain search (single-center AMap queue, soft cap 300, sessionStorage per mode).
- Secondary sidebar: glass POI cards, in-panel detail, sibling JD panel.
- Account slice: demo OTP / OAuth stubs, Profile L2 prefs, Recent = search history only.
- Saved places, applications, queued job-alert inbox (`008`–`010`).
- Layers L2 frost card: saved overlay + persisted basemap style.
- Public read API 30s process cache (`lib/public-cache.ts`).
- Shared `lib/server-catalog.ts` for `/api/pois`, `/api/pois/[id]`, `/api/search`, `/api/suggest`.
- Home lazy-loads `MapShell` (`next/dynamic`, `ssr: false`). See `tech/12-bundle-notes.md`.
- Account SQL / index inventory: `tech/13-db-query-notes.md`.
- Search/filter integration tests: `server/tests/search-integration.test.mjs`.
- Recruitment import planner: validate / dedupe seed companies (`lib/recruitment-import.ts`, `npm run import:seed`). Live upsert still waits on Postgres.
- Work seed expanded to 50 Hangzhou public-career companies (still representative examples, not a live crawl).
- Public work APIs (`/api/pois`, `/api/pois/:id`, `/api/search`, `/api/suggest`) read imported Postgres rows via `loadServerCatalog` when present; otherwise the seed.
- Work mode on the map loads that same catalog (`fetchWorkCatalogFromApi`); job-alert matching uses `loadServerCatalog` instead of a hardcoded seed. Coordinates that are already set are not geocoded again.
- Site geocode planner (`lib/site-geocode.ts`, `npm run geocode:sites`): seed already has points; missing imported rows are listed. Live AMap REST waits on `AMAP_WEB_KEY` and is a no-op without it.
- Public `/api/pois` and `/api/search` clip to `bounds` (`inBounds`) instead of only using the box as a distance origin.
- Official-career file adapter: drop JSON under `server/data/recruitment/official-career/`. `import:seed` merges it with the seed (same slug unions sites/positions). Empty dir is a no-op.
- Work autocomplete uses `GET /api/suggest` (imported companies included). Job suggestions carry `poiId`. Offline / empty falls back to `suggestRecruitment`.
- `/api/suggest` tag rows come from the same `TAG_FILTERS` map (`#大厂`, `#秋招`, industries), not a five-industry hardcode.
- Skip links (results / map), polite live result count, and `document.documentElement.lang` follow the UI language. `#` suggestions apply FilterPlugins via `applyTagSuggestion`.

### Changed

- Default map mode is **work**.
- Settings rail item moved into Profile L2.
- Contrast tokens: `--muted` / `--blue-ink` / `--green` meet WCAG AA on frost/white. Brand `#007AFF` stays chrome-only.
- Suggest empty-q hot list is `trendingForMode` (not a second hardcoded array).
- Failed session / OTP lookups delete expired rows when `DATABASE_URL` is set.

### Security

- Never print or commit `.env` secrets.
- Guests do not get a fake cloud Saved / Recent list.
- Notifications stay `queued`; nothing is emailed or SMSed.

## Earlier

Phase 0 docs scaffold and Phase 1 platform baseline (importer, migrations `001`–`004`, Apple Maps shell) landed on `feature/phase-1-platform-baseline`. See `tech/05-milestones.md`.
