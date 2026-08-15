# 05 - Milestones

> **Status:** current execution roadmap
> **Last reviewed:** 2026-08-15
> **Authority:** this file is the in-repository milestone source of truth. Historical `tech/00-*` reports are context only.

## Current Baseline

P0 is complete as a **documentation and repository scaffold**. Phase 1 is **in progress**: the importer project, PostGIS migration runner, SQL migrations, declarative plugin/import validation, and an Apple-Maps-inspired frontend shell now exist on `feature/phase-1-platform-baseline`. 

**Frontend status (2026-08-15):** The map shell is complete and browser-verified. All core interactions work (zoom, compass, locate, middle-button 3D control), sidebar animations are polished with Apple-style transitions, responsive layouts proven on desktop and mobile viewports, dark mode functional, i18n system operational. See `tech/00-phase1-frontend-completion.md` for full implementation evidence.

**Backend status:** The importer unit tests pass (11), migration runner exists. **Live PostGIS verification is still blocked** until Docker/PostGIS is available.

## Delivery Sequence

| Phase | Scope | Status | Entry gate | Exit evidence |
|---|---|---|---|---|
| P0 | Documentation, constraints, GitHub initialization | Complete | None | Current technical/role docs and final audit record |
| P1 | Platform baseline | In progress | P0 contract accepted | Version-pinned app/importer manifests; migration runner; PostGIS extension check; tenant/map and source contracts; tests that run locally |
| P2 | Recruitment import and map read vertical slice | Planned | P1 complete; approved data-source record | Idempotent approved-data import, provenance records, spatial query API, map-read contract, integration tests |
| P3 | Recruitment map interface | Planned | P2 complete; explicit ASCII/text approval | Approved desktop/mobile layout record, implemented UI, agent-browser screenshots, accessibility and responsive checks |
| P4 | Map productivity features | Deferred | P3 evidence | Search, saved map overlays, controlled fly/highlight interactions |
| P5 | Additional approved data and spatial analysis | Deferred | P4 evidence plus source review | Housing/commute or another approved domain; PostGIS correctness tests |
| P6 | Sensitive and AI features | Deferred | Privacy/security design and evaluation plan | PII consent/retention controls, map-action validation, recommendation evaluation |
| P7 | Public docs and production delivery | Deferred | Runnable product and operations design | Verified public docs, deploy/runbook, backup/restore and release evidence |

No calendar release date is committed. Each phase is estimated only after its entry gate is satisfied.

## Phase 1: Platform Baseline

### Deliverables

1. Create the first real server and importer manifests with one supported Node and Python version shared by CI. **Done:** `server/package.json` (Next 15.5.23, React 19.0.8, TS 5.9.3, `server/.nvmrc` = Node 22 LTS) and `crawler/pyproject.toml` (Python 3.12, `crawler/.python-version`). CI reads both version files (`node-version-file` / `python-version-file`).
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
- Frontend shell exists and is verified in-browser (user authorized ASCII gate relaxation for this phase). **Complete (2026-08-15)** — Apple Maps-inspired responsive shell with polished animations, all map controls functional, dark mode working, i18n operational. Full evidence in `tech/00-phase1-frontend-completion.md`.

## Phase 2: Multi-Mode System + POI Display + Search & Filter

**Scope:** Core differentiation features - multi-mode map system with Domain and Internship modes

**Duration:** 4-6 weeks (5 sprints)

**Key Features:**
1. **Multi-Mode System** - Mode switching architecture, Domain + Internship modes
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
- Testing: Jest + React Testing Library + Playwright

**Success Criteria:**
- [ ] 2 modes functional (Domain + Internship)
- [ ] Search with autocomplete working
- [ ] Filters: 5+ dimensions per mode
- [ ] Secondary sidebar with list + detail views
- [ ] Card-map linkage smooth
- [ ] Mobile responsive
- [ ] Performance: LCP < 2.5s, API P95 < 500ms
- [ ] Test coverage > 70%
- [ ] Accessibility: WCAG 2.1 AA baseline

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
- User authentication (optional in P2)
- Favorites/bookmarks
- Application tracking
- Data comparison
- PII handling
- Recommendation system

## Deferred Decisions

The following must have an ADR or security/data review before implementation: ORM, cache, pgvector, LLM provider, deployment topology, public docs framework, map-engine expansion, third-party/executable plugins, PII retention, and all additional data sources.
