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
- Home lazy-loads `MapShell` (`next/dynamic`, `ssr: false`). Rail panels (detail / JD / auth / Profile / Recent / Saved / Layers) are split the same way inside the shell; hover/focus on the rail prefetches the matching chunk. See `tech/12-bundle-notes.md`.
- Account SQL / index inventory: `tech/13-db-query-notes.md`.
- Search/filter integration tests: `server/tests/search-integration.test.mjs`.
- Recruitment import planner: validate / dedupe seed companies (`lib/recruitment-import.ts`, `npm run import:seed`). Live upsert still waits on Postgres.
- Work seed expanded to 50 Hangzhou public-career companies (still representative examples, not a live crawl).
- Public work APIs (`/api/pois`, `/api/pois/:id`, `/api/search`, `/api/suggest`) read imported Postgres rows via `loadServerCatalog` when present; otherwise the seed.
- Work mode on the map loads that same catalog (`fetchWorkCatalogFromApi`); job-alert matching uses `loadServerCatalog` instead of a hardcoded seed. Coordinates that are already set are not geocoded again.
- Site geocode planner (`lib/site-geocode.ts`, `npm run geocode:sites`): seed already has points; missing imported rows are listed. Live AMap REST waits on `AMAP_WEB_KEY` and is a no-op without it.
- Public `/api/pois` and `/api/search` clip to `bounds` (`inBounds`) instead of only using the box as a distance origin.
- Official-career file adapter: drop JSON under `server/data/recruitment/official-career/`. `import:seed` and the no-DB work catalog (`loadOfflineWorkCatalog`) merge it with the seed (same slug unions sites/positions; new slugs become catalog POIs). Sample drops: Alibaba / ByteDance 2026 autumn frontend + 之江实验室. Empty dir is still a no-op. `apiRecruitmentAdapter` is `kind: catalog` (read `/api/pois`), not official-career. Closed / paused official-career rows stay in the import plan but drop out of the no-DB catalog, same as `positions WHERE status = 'open'`.
- Work autocomplete uses `GET /api/suggest` (imported companies included). Job suggestions carry `poiId`. Offline / empty falls back to `suggestRecruitment`.
- `/api/suggest` tag rows come from the same `TAG_FILTERS` map (`#大厂`, `#秋招`, industries, `#西湖区`, `#在招`, `#班车`, `#住宿`, `#硕士`), not a five-industry hardcode. Bare `#西湖` stays a Domain keyword. Work toggles: `onlyOpen` / `providesHousing` / `providesShuttle`. Education is a multi-select plugin (`#本科` / `#硕士` / `#博士`). internship and work share one filter list.
- Skip links (results / map), polite live result count, and `document.documentElement.lang` follow the UI language. `#` suggestions apply FilterPlugins via `applyTagSuggestion`.
- Search boxes are comboboxes: Arrow / Enter / Escape share `lib/suggest-nav.ts` on desktop L2 and the mobile drawer.
- Applied `#` plugins render as removable chips (`activeFilterChips`) so a picked tag stays visible after the query clears. Recent / trending hashes use the same `applyTagSuggestion` path. District, salary, and distance also chip when the mode configs are passed. District hashes are generated from `HANGZHOU_DISTRICTS` (`#西湖区` is a plugin; bare `#西湖` is still the lake).
- Job-title aliases: `FE` / `frontend` match 前端, `backend` matches 后端, `PM` matches 产品. Short codes (`fe`, `be`, `pm`) are token-aware so they do not hit Alibaba. Domain place aliases: `westlake` / `West Lake` match 西湖; `lingyin` matches 灵隐. Company aliases: `alibaba` / `bytedance` / `tencent` / `netease` / `huawei` hit the Chinese seed titles.
- Work `education` FilterPlugin: `#本科` / `#硕士` / `#博士` parse into a multi-select; companies stay if any open position lists that degree. internship and work share `WORK_FILTERS`.
- Work 职能 plugin (`roleFamily`): `#技术` / `#产品` / `#运营` / `#设计` match title/department/skills. intern/campus/social stay on `jobTaxonomy`. Deadline sort ranks the soonest `position.deadline` first (seed rows without a date sink).

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
