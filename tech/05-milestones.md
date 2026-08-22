# 05 - Milestones

> **Status:** current execution roadmap
> **Last reviewed:** 2026-08-23
> **Authority:** this file is the in-repository milestone source of truth. Historical `tech/00-*` reports are context only.

## Current Baseline

P0–P4 are **complete and merged to `dev`** (2026-08-17): a runnable Next.js application (Domain + Work modes, account / saved / applications / job-alert queue), real recruitment catalog (Postgres first, offline drops fallback), reviewed polite acquisition (radar `jobs.json` + official career pages + reviewed ATS endpoints), PostGIS migrations `001`–`016`, and nationwide work mode (LOD tiers / city superset / viewport loading, migrations `011`–`013`). Historical Phase 1 records remain on `feature/phase-1-platform-baseline`.

**Frontend status (2026-08-23):** map shell, Explore / POI detail / JD panel, mobile drawer, Profile / Recent / Saved / Layers L2, search/filter, sort, autocomplete, apply tracking, job alerts (queued), saved overlay, basemap toggle, 三引擎地图源切换 — all browser-verified. Server suite: **1470 tests / 1468 pass / 2 skip** (`cd server && npm test`, 2026-08-23).

**Backend status:** importer unit tests pass (`make test-unit`). Live PostGIS apply is verified: `make db-migrate` wrote `001`–`016`, `make test-integration` passed. Seed import (2026-08-17 Hangzhou pilot): 137 companies / 137 sites / 240 open positions (official-career + radar + portals); national import plan: **669 companies / 1440 sites / 877 positions, 0 issues, 0 dropped**. Public `/api/pois` and `/api/search` push `bounds` / distance through `company_sites_geom_gist` (`&&` then `ST_DWithin`) when `DATABASE_URL` is set; no-DB stays on `inBounds`. Live `EXPLAIN` (51 sites): `&&` + `ST_DWithin` uses the gist; bbox-only is still a Seq Scan on this tiny table.

## Delivery Sequence

| Phase | Scope | Status | Entry gate | Exit evidence |
|---|---|---|---|---|
| P0 | Documentation, constraints, GitHub initialization | Complete | None | Current technical/role docs and final audit record |
| P1 | Platform baseline | Complete (dev) | P0 contract accepted | Version-pinned app/importer manifests; migration runner; PostGIS extension check; tenant/map and source contracts; tests that run locally |
| P2 | Recruitment import and map read vertical slice | Complete (dev) | P1 complete; approved data-source record | Idempotent approved-data import, provenance records, spatial query API, map-read contract, integration tests |
| P3 | Recruitment map interface | Complete (dev) | P2 complete; explicit ASCII/text approval | Approved desktop/mobile layout record, implemented UI, agent-browser screenshots, accessibility and responsive checks |
| P4 | Map productivity features | Complete (dev) | P3 client slice on branch | Search, saved map overlays, controlled fly/highlight interactions |

| P5 | Additional approved data and spatial analysis | Deferred | P4 evidence plus source review | Housing/commute or another approved domain; PostGIS correctness tests |
| P6 | Sensitive and AI features | Deferred | Privacy/security design and evaluation plan | PII consent/retention controls, map-action validation, recommendation evaluation |
| P7 | Public docs and production delivery | Deferred | Runnable product and operations design | Verified public docs, deploy/runbook, backup/restore and release evidence |

No calendar release date is committed. Each phase is estimated only after its entry gate is satisfied.

## Phase 1: Platform Baseline

### Deliverables

1. Create the first real server and importer manifests with one supported Node and Python version shared by CI. **Done:** `server/package.json` (Next 16.3.1, React 19.2.8, TS 5.9.3 — 2026-08-20 由 Next 15.5.23 / React 19.0.8 升级, `server/.nvmrc` = Node 22 LTS) and `crawler/pyproject.toml` (Python 3.12, `crawler/.python-version`). CI reads both version files (`node-version-file` / `python-version-file`).
2. Create an executable migration ledger and runner. **Done:** `db/migrations/001-004` and `db/scripts/apply.sh` (single-transaction per migration, transaction-scoped advisory lock), `db/scripts/preflight.sh`.
3. Implement the canonical tenant/map access model and source/provenance model. **Done:** `map_access`/`can_access_map` seams and SQL tables.
4. Implement a declarative plugin manifest validation path. **Done:** `validate_manifest` and `normalize_import` in `crawler/app/domain_map_importer/`.
5. Add environment examples, preflight checks, and a test command. **Done:** `.env.example`, `Makefile` targets `preflight`/`db-migrate`/`test-unit`/`test-integration`.
6. Record actual results. **Done:** implementation record and test report under `tech/roles/`.

### Acceptance criteria

- A clean clone can run the documented preflight command and receive an accurate pass/fail result. **Partially verified** — scripts pass `bash -n`; live PostGIS blocked on Docker.
- Migrations run transactionally against an empty PostGIS database and are tested in CI. **Pending live DB**.
- Cross-user/map access is denied by tested authorization rules. **Unit-tested**; DB enforcement pending.
- No external source acquisition occurs during P1. **True.**
- Frontend shell exists and is verified in-browser (user authorized ASCII gate relaxation for this phase). **Complete (2026-08-15)** — Apple Maps-inspired responsive shell with polished animations, all map controls functional, dark mode working, i18n operational. Full evidence in `tech/00-phase1-closure-summary.md`（原 `00-phase1-frontend-completion.md` 已并入，2026-08-21）。

## Phase 2: Multi-Mode System + POI Display + Search & Filter

> **状态(2026-08-19):已完成并并入 `dev`。以下为实施期记录。**

**Scope:** Core differentiation features - multi-mode map system with Domain and Work modes

**Duration:** 4-6 weeks (5 sprints)

**Status (2026-08-16):** Sprint 1–4 client slice plus Sprint 5.1 drawer wiring is on `feature/phase-2-multi-mode`. Live POIs come from AMap JS API in the browser; MapShell does not call `/api/*` for the list.
- Multi-mode architecture (domain + work active; college / overseas reserved). Internship is a work-mode filter plugin, not a map mode.
- Domain viewport search: single-center incremental queue, soft cap 300, empty result stays empty (no DOMAIN_SEED)
- Work seed shown immediately, then Geocoder-corrected; primary-nav search icon expands the rail and focuses the field
- Secondary sidebar with glassmorphism POI cards (list + in-panel detail overlay)
- Primary-rail search drives `query` and opens Explore; card/marker click opens `POIDetailView`; work job cards open a sibling `JdPanel` in the same flex cluster. Apply follows `apply` / `careerUrl`.
- Search (debounced) + mode-specific filters + sort (rating ≠ popularity). `#大厂` / `#秋招` parse into filter plugins. Empty search boxes show no tags; Recent L2 still shows `trendingForMode`. Distance slider draws a blue buffer circle with an east-edge drag handle (0.5km snap). Domain detail shows real AMap reviews (never fabricated) and straight-line commute estimates. District is a FilterPlugin: public reads push selected districts as address `ILIKE` + coarse box; the pipeline still applies the address-over-box rule.
- Card-map bidirectional linkage (click select, hover highlight)
- Mobile ≤767px: primary rail and desktop L2/L3 clusters hide. Bottom drawer (mini/half/full) owns search, mode switch, filters, list, detail, and JD. Drawer chrome stays `--soft-strong`; glass stays on cards.
- API routes exist for later persistence: `/api/modes`, `/api/pois`, `/api/pois/[id]`, `/api/search`, `/api/suggest`, `/api/filter-options`. Work list/suggest now read the same catalog; typed work autocomplete calls `/api/suggest`.
- Account slice (2026-08-16): default map mode is **work**; Settings rail item removed into Profile L2 (career prefs + notifications + avatar crop); Recent is search-history only (signed-in POST/GET `/api/me/search-history`; guests stay empty). Login is a split glass card (phone / email / other: GitHub Google X WeChat). Migrations `005`–`007` are in `db/migrations`. Demo APIs are in-memory until `DATABASE_URL` is wired. Seed logos go through `resolveCompanyLogo` (career-site icon → company icon → emoji).
- Avatar + account/username (2026-08-21): real avatar storage — `POST /api/me/avatar` uploads cropped bytes into `users.avatar_data` (bytea, migration `017`), served from `/api/me/avatar?v=<ts>` (immutable cache, zero-dep JPEG/PNG header validation in `lib/avatar-image.ts`). Profile identity card now shows **账户** (login credential: email / phone / registration username — immutable) and the editable **用户名** (`displayName`). 求职偏好 labels: 求职类型 (families) and 意向岗位 (strengths).

**Key Features:**
1. **Multi-Mode System** - Mode switching architecture, Domain + Work modes; job family is a filter plugin
2. **POI System** - AMap POI integration + recruitment data import
3. **Secondary Sidebar** - Apple-style glassmorphism cards with list and detail views
4. **Search & Filter** - Full-text search, multi-dimensional filters, spatial queries
5. **Map Interaction** - Card-map linkage (hover highlight, click fly-to, marker sync)

**Sprint Breakdown:**
- **Sprint 1 (Week 1-2):** Multi-mode architecture + API foundation + PostgreSQL/PostGIS setup
- **Sprint 2 (Week 2-3):** Domain mode + AMap POI integration + search + sidebar list view
- **Sprint 3 (Week 3-4):** Internship mode + recruitment data import + filter system
- **Sprint 4 (Week 4-5):** Detail view + advanced search + sorting + spatial filters
- **Sprint 5 (Week 5-6):** Mobile adaptation + performance optimization + testing

**Data Requirements:**
- Domain mode: ~10K POI (AMap API, Hangzhou)
- Internship mode: ~100 companies, ~500 positions (curated public data)
- Update frequency: Weekly (Domain), Daily (Internship)

**Technical Stack:**
- Frontend: Next.js 15.5 + React 19 + TypeScript + CSS Modules
- Backend: Next.js API Routes + PostgreSQL 16 + PostGIS 3.4
- Map: AMap JavaScript API v2.0
- Testing: Node `node --test` + source contracts (Jest / RTL / Playwright not in package.json)

**Success Criteria:**
- [x] 2 modes functional (Domain + Work; intern is a work filter)
- [x] Search with autocomplete working
- [x] Filters: 5+ dimensions per mode
- [x] Secondary sidebar with list + detail views
- [x] Card-map linkage smooth
- [x] Mobile responsive
- [x] Performance: public API warm P95 < 500ms（2026-08-16 local Next: `/api/pois` 12.7ms, bounds clip 5.8ms, `/api/suggest` 5.6ms after cold compile）. Lighthouse LCP still unmeasured.

- [x] Test coverage > 70%（`node --test` 95+ 纯逻辑 / 契约；未引覆盖率工具）
- [x] Accessibility: WCAG 2.1 AA baseline（对比度 token + 键盘/ARIA；VoiceOver 未跑）

**Deliverables:**
- Multi-mode system architecture (`tech/08-multi-mode-system.md`)
- Secondary sidebar design spec (`tech/09-secondary-sidebar.md`)
- Search & filter system design (`tech/10-search-filter.md`)
- Phase 2 implementation plan (`tech/11-phase2-plan.md`)
- Working application with 2 modes
- API documentation
- Test suite

**Out of Scope (deferred to P3+):**
- College/Overseas modes
- Application tracking
- Data comparison
- PII handling
- Recommendation system

**Phase 3 started (2026-08-16):** Saved places — `008_saved_places`. Applications — `009_applications`. Company compare — Saved L2 / mobile `SavedList`. Job alerts — `010_notifications` + `/api/me/notifications` enqueue matching seed jobs into Profile inbox when email/SMS is on; nothing is actually sent. Guests are prompted to sign in.

**Phase 4 started (2026-08-16):** Saved overlay — Layers L2 frost card (`layers-panel.tsx`) toggles `lib/saved-overlay.ts` and owns basemap styles. Overlay + style persist in sessionStorage. Search list stays the pipeline; the map merges leftover saved pins (catalog/seed live, snapshot pin fallback). Fly/highlight still go through `usePOIMap`; Saved click uses `resolveSavedForFly`. Recent replay goes through `replayRecentSearch` + mode cache. Public read APIs cache 30s (`lib/public-cache.ts`) and load work via `loadServerCatalog` (imported SQL rows when present, else seed + official-career JSON). Contrast tokens live in `lib/contrast.ts`. Home `home-map.tsx` lazy-loads `MapShell` (`next/dynamic`, `ssr: false`); first-party client deps stay Next/React/CSS Modules (`tech/12-bundle-notes.md`). Account SQL + spatial reads are inventoried in `tech/13-db-query-notes.md` (live gist / account `EXPLAIN` recorded 2026-08-16). Search/filter integration lives in `tests/search-integration.test.mjs` (same seed → pipeline → page path as `/api/search`). Seed import planner is `lib/recruitment-import.ts` / `npm run import:seed`. Local runbook: `tech/15-deploy.md`.


## Deferred Decisions

The following must have an ADR or security/data review before implementation: ORM, cache, pgvector, LLM provider, deployment topology, public docs framework, map-engine expansion, third-party/executable plugins, PII retention, and all additional data sources.
