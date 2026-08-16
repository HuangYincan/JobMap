# Changelog

Dates are UTC+8. This file tracks shipped work on `feature/phase-2-multi-mode` and later. It is not a substitute for `tech/05-milestones.md`.

## 2026-08-17

### Added

- Guest Recent in the browser: persistable (work/internship) queries write `dm.guest-search-history.v1` (cap 30). Sign-in merges rows the account does not have and keeps a local mirror; sign-out restores. `lib/persistable.ts` is the extension seam (`PERSISTABLE_MODES`; add `college` when that catalog lands).
- Saved + Recent persist only recruitment catalog POIs. Domain AMap bookmarks are hidden; `POST /api/me/saved` and `POST /api/me/search-history` return 400 `NOT_PERSISTABLE` for non-persistable rows.
- Map-mode suggestion pick upserts a session `DomainPOI` (`suggestionToDomainPoi` + `mergePoisById`) so a card exists. Empty search boxes no longer render trending tags (Recent L2 still does).
- Login: Other = GitHub / Google / WeChat icon rows (X removed); mobile hides the promo and spaces method tabs with vertical dividers. Drawer handle gap unified via `--drawer-handle-gap`.
- Real recruitment data: `crawler/app/domain_map_importer/` — polite acquisition (`acquire.py`: robots + blocked commercial hosts; `html_jobs.py`: JSON-LD then link fallback; `radar_jobs.py`: maps the published Apache-2.0 `jobs.json`; `official_refresh.py`; `cli.py`). Server `radar` adapter + `mergeCompaniesIntoPois`; offline catalog filters ungeocoded sites (no (0,0) pins). Drops: `server/data/recruitment/radar/` (98 companies / 125 jobs) + curated verified official portals (betta / megvii / deepseek). Import plan now 137 companies / 240 positions. Source reviews: `tech/roles/data/etl/`; evidence: `tech/roles/data/data-quality.md`. `make refresh-radar` / `make crawl-official`.
- Freshness presentation proposal (awaiting approval): `tech/17-freshness-presentation-proposal.md`.

### Fixed

- **Work mode shows real data only (2026-08-17 decision).** Example jobs (seed / official-career curated titles like "前端开发工程师（2026 秋招）") are development scaffolding: `isAuthenticPositionId` keeps only `radar-*` / `portal-*` positions on every read path (offline catalog, DB read, client fallback). The seed still supplies the coordinate skeleton; DB example rows were marked `closed` (reversible). Map surface: 51 → 14 pins, all with real recruiting signals.
- Merge-on-sign-in wiped rows whose POST failed; now only rows absent from the account upload, and failed rows stay local. Merge logic extracted to `mergeGuestHistoryIntoAccount` (unit-tested).
- Persisted signed-in sessions now merge leftover guest rows on mount, not only after the auth modal.
- `mergeCompanyOntoSeedPois` no longer appends a new site's positions twice; `zhejiang-lab` site id corrected to `{slug}-site` per the merge rule.
- DB read path pinned ungeocoded sites at (0,0); `loadWorkCatalogFromDb` now filters them (matches the offline path). Verified over HTTP: 51 coordinated pins, 0 (0,0).
- `import:seed:apply` crashed on radar deadlines like "招满即止" (`positions.deadline` is a date column); `parse_deadline` (crawler) + `normalizeDeadline` (import) now emit ISO dates only. **Live DB import succeeded: 137 companies / 137 sites / 240 positions.**
- Polite fetcher survives transient SSL/network errors and a misspelled page charset; `parse_robots` follows RFC 9309 (specific UA group wins, Allow tiebreak). Stale `betta-hangzhou` careerUrl fixed.
- Desktop rail search used a static placeholder; now mode-specific (`modeConfig.searchPlaceholder`). 11 dead i18n keys removed.
- Reserved `college` / `overseas` modes return empty trending instead of borrowing work queries.

### Measured

- `npm run test:coverage` (Node built-in): **78.75% lines / 77.42% branches / 75% functions** — plan target >70% met.
- Warm local API (dev, DB imported): `/api/pois?mode=work` p95 **9.6ms**; `/api/pois/:id` p95 **8.2ms**; `/api/suggest` p95 **6.8ms** — all plan targets met.

### Pin location audit

- Three-layer audit of all 14 map pins against AMap Web services (geocoding / regeocoding / POI search) + public business records: **14/14 PASS** (offsets < 0.4 km, district matches).
- Corrected **11 pins** (address and/or coordinates): 蚂蚁 Z 空间（西溪路556号）、滴滴 EFC（景兴路896号）、深度求索（拱墅区环城北路169号汇金国际大厦）、贝达（临平区兴中路355号）、泰格医药（滨江区聚工路19号盛大科技园）、群核（余杭塘路515号莱茵·矩阵国际）、字节跳动、旷视、同花顺、新华三、之江实验室（+阿里微调）。网易/零跑原数据正确。
- `npm run audit:pins` added (`scripts/audit-pin-locations.mjs`, `AMAP_WEB_KEY` + `DATABASE_URL` from env).
- **Browser cache invalidation**: `MODE_CACHE_VERSION` bumped 1→2 — stale sessionStorage catalogs refetch the corrected coordinates. Data-fix workflow documented: seed/drops → `import:seed:apply` → bump cache version → `audit:pins`.

### Geocode apply — radar-only companies to real Hangzhou offices (2026-08-17)

- `npm run geocode:sites:apply` (`scripts/geocode-sites-apply.mjs`): resolves city-text-only radar sites ("北京/杭州") to a **real Hangzhou office** via AMap place-text search (`v3/place/text`, city-scoped) instead of pinning a company at a city center. It regeocodes every hit to confirm it sits inside 杭州市, skips companies already on the map (no duplicate pins), and copy-on-write replaces only `site.location` in the owning drop JSON. Missing `AMAP_WEB_KEY` → dry-run.
- New helpers in `lib/site-geocode.ts`: `cleanCompanySearchName` / `normalizeNameForMatch` (strip decor + legal forms, known aliases), `gradeOfficePoi` (rejects out-of-city and wrong-entity name mismatches — the 海天集团 trap), `pickBestOfficePoi` (office type over retail store), `placeTextSearchRest`, `regeoCityRest`. Unit tests: `tests/site-geocode.test.mjs`.
- Hand-curated resolutions live in `data/recruitment/geocode-overrides.json` (real office for wrong-entity hits: 白贝壳 for Babycare, 游卡滨江基地, 阿里巴巴西溪园区 for 淘天集团/淘宝闪购/阿里淘天, 兴业银行杭州分行, 台达电子杭州设计中心, 华润置地浙江公司, vivo杭州研发中心, 海信星海科技, 舜宇光学(浙江)研究院, 迈瑞杭州分公司, 禾赛赫兹智能制造中心, 吉利科技大厦…) plus explicit `exclude` markers for companies with **no verifiable Hangzhou office** in AMap (奥比中光 / MPS / 星宸 / 多益 / 昆仑芯 / 拓竹 / 恒瑞 / 海天集团…).
- **Result: map surface 14 → 79 pins**, all with a street address and 0 (0,0) pins. Import plan stays valid: 137 companies / 137 sites / 241 positions, 0 dropped, 0 issues. `MODE_CACHE_VERSION` bumped 2→3 so browsers refetch the expanded catalog. DB refresh (`import:seed:apply`) picks the coords up from the same drops when Postgres is back up.

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
- Home lazy-loads `MapShell` from a Client Component (`home-map.tsx` + `next/dynamic`, `ssr: false`). Next 15 rejects `ssr: false` on the Server Component `page.tsx`. Rail panels (detail / JD / auth / Profile / Recent / Saved / Layers) are split the same way inside the shell; hover/focus on the rail prefetches the matching chunk. See `tech/12-bundle-notes.md`.
- Account SQL / index inventory: `tech/13-db-query-notes.md`.
- Search/filter integration tests: `server/tests/search-integration.test.mjs`.
- Recruitment import planner: validate / dedupe seed companies (`lib/recruitment-import.ts`, `npm run import:seed`). Live upsert still waits on Postgres.
- Work seed expanded to 50 Hangzhou public-career companies (still representative examples, not a live crawl).
- Public work APIs (`/api/pois`, `/api/pois/:id`, `/api/search`, `/api/suggest`) read imported Postgres rows via `loadServerCatalog` when present; otherwise the seed.
- Work mode on the map loads that same catalog (`fetchWorkCatalogFromApi`); job-alert matching uses `loadServerCatalog` instead of a hardcoded seed. Coordinates that are already set are not geocoded again.
- Site geocode planner (`lib/site-geocode.ts`, `npm run geocode:sites`): seed already has points; missing imported rows are listed. Live AMap REST waits on `AMAP_WEB_KEY` and is a no-op without it.
- Public `/api/pois` and `/api/search` clip to `bounds` (`inBounds`) instead of only using the box as a distance origin.
- Official-career file adapter: drop JSON under `server/data/recruitment/official-career/`. `import:seed` and the no-DB work catalog (`loadOfflineWorkCatalog`) merge it with the seed (same slug unions sites/positions; new slugs become catalog POIs). Sample drops: Alibaba / ByteDance / Tencent / NetEase / Huawei / Ant 2026 autumn frontend + 之江实验室. Empty dir is still a no-op. `apiRecruitmentAdapter` is `kind: catalog` (read `/api/pois`), not official-career. Closed / paused official-career rows stay in the import plan but drop out of the no-DB catalog, same as `positions WHERE status = 'open'`.
- Work autocomplete uses `GET /api/suggest` (imported companies included). Job suggestions carry `poiId`. Offline / empty falls back to `suggestRecruitment`.
- `/api/suggest` tag rows come from the same `TAG_FILTERS` map (`#大厂`, `#秋招`, industries, `#西湖区`, `#在招`, `#班车`, `#住宿`, `#硕士`), not a five-industry hardcode. Bare `#西湖` stays a Domain keyword. Work toggles: `onlyOpen` / `providesHousing` / `providesShuttle`. Education is a multi-select plugin (`#本科` / `#硕士` / `#博士`). internship and work share one filter list.
- Skip links (results / map), polite live result count, and `document.documentElement.lang` follow the UI language. `#` suggestions apply FilterPlugins via `applyTagSuggestion`.
- Search boxes are comboboxes: Arrow / Enter / Escape share `lib/suggest-nav.ts` on desktop L2 and the mobile drawer.
- Applied `#` plugins render as removable chips (`activeFilterChips`) so a picked tag stays visible after the query clears. Recent / trending hashes use the same `applyTagSuggestion` path. District, salary, and distance also chip when the mode configs are passed. District hashes are generated from `HANGZHOU_DISTRICTS` (`#西湖区` is a plugin; bare `#西湖` is still the lake).
- Job-title aliases: `FE` / `frontend` match 前端, `backend` matches 后端, `PM` matches 产品. Short codes (`fe`, `be`, `pm`) are token-aware so they do not hit Alibaba. Domain place aliases: `westlake` / `West Lake` match 西湖; `lingyin` matches 灵隐. Company aliases: `alibaba` / `bytedance` / `tencent` / `netease` / `huawei` hit the Chinese seed titles.
- Work `education` FilterPlugin: `#本科` / `#硕士` / `#博士` parse into a multi-select; companies stay if any open position lists that degree. internship and work share `WORK_FILTERS`.
- Work 职能 plugin (`roleFamily`): `#技术` / `#产品` / `#运营` / `#设计` match title/department/skills. intern/campus/social stay on `jobTaxonomy`. Deadline sort ranks the soonest `position.deadline` first (seed rows without a date sink).
- Domain 人均消费 range (`price` from `priceLevel`) plus `priceAsc` / `priceDesc`. Both modes gain a `relevance` sort (exact / prefix name, then rating and distance).
- Client suggest LRU (max 100, 5 minutes) in `lib/public-cache.ts`; `fetchSearchSuggest` hits it before `/api/suggest`. Public API cache stays a separate 30s store.
- Work `deadline` date filter: keep companies whose jobs close on or after the picked day (or have no date). Same key as the existing deadline sort.
- Official-career drops for Tencent / NetEase / Huawei / Ant Hangzhou offices: 2026 autumn frontend unions onto the existing seed pin (`${slug}-site`). No second map marker.
- Avatar crop dialog portals to `document.body` so Profile’s `pointer-events: none` cluster cannot swallow drag / zoom / save.
- Mobile search suggestions appear only in half/full as a liquid-glass overlay over the list (`mobileSearchStack`), not an in-flow block.
- Mobile Profile / Recent keep a visible close on the embedded sheet. Account, Saved, and Layers also expose a `mobileBackBtn`. Tapping the drawer avatar again while already on Profile returns to Explore.
- Public `/api/pois` and `/api/search` push `bounds` and `filters.distance` into PostGIS (`s.geom &&` then `ST_DWithin` on `company_sites`). Selected Hangzhou districts become address `ILIKE` + coarse-box SQL (a superset); `poiMatchesDistrict` still prefers named addresses. No database still clips in memory with `inBounds`. Suggest / job-alert stay unclipped. Live `EXPLAIN` on 51 sites: gist is used for `&&` + `ST_DWithin`; bbox-only stays a Seq Scan until the table grows. Warm local Next: `/api/pois` P95 12.7ms, bounds clip 5.8ms.
- File-drop adapters for `boss` / `nowcoder` / `shixiseng` (empty dirs are a no-op). Official-career 2026 autumn frontend drops now cover every seed slug that already has a public career URL (曦曦AI stays seed-only). Live `import:seed:apply` wrote 51 companies / 110 open positions.


### Changed

- Coordinate CHECKs in `003` / `006` use `lng = lng` (NaN-reject) instead of `isfinite()`, which PostgreSQL 16 does not have for `double precision`.
- `db/scripts/apply.sh` compares ledger checksums in SQL so a second `make db-migrate` works with psql 18 (`\if` is boolean-only).
- Default map mode is **work**.
- Settings rail item moved into Profile L2.
- Contrast tokens: `--muted` / `--blue-ink` / `--green` meet WCAG AA on frost/white. Brand `#007AFF` stays chrome-only.
- Suggest empty-q hot list is `trendingForMode` (not a second hardcoded array).
- Failed session / OTP lookups delete expired rows when `DATABASE_URL` is set.
- Embedded Profile / Recent preference cards are fluid in the drawer (`max-width: 100%`); `.sheet` follows `.sidebar` so `width: 100%` wins over the desktop 380px lock.

### Security

- Never print or commit `.env` secrets.
- Guests do not get a fake cloud Saved / Recent list.
- Notifications stay `queued`; nothing is emailed or SMSed.

## Earlier

Phase 0 docs scaffold and Phase 1 platform baseline (importer, migrations `001`–`004`, Apple Maps shell) landed on `feature/phase-1-platform-baseline`. See `tech/05-milestones.md`.
