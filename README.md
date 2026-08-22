# Domain Map Platform

> A plugin-oriented map platform for location-bound domain data. The first planned vertical slice is a recruitment map built only from approved data imports.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://www.postgresql.org/)
[![PostGIS](https://img.shields.io/badge/PostGIS-3.4-green.svg)](https://postgis.net/)

## Project Status

**Status: Phase 2/3/4 complete on `dev` (2026-08-21, merged from `feature/phase-2-multi-mode`).** Phase 1 baseline remains on `feature/phase-1-platform-baseline` (historical).

Implemented and verified:
- Importer project `crawler/` (Python 3.12, uv): declarative plugin-manifest validation, deterministic local-fixture normalization with provenance, map access policy, and **reviewed polite acquisition** — published xiaozhao-radar `jobs.json` mapping (`radar_jobs.py`) + official career-page GET with robots and blocked commercial hosts (`official_refresh.py` / `acquire.py`) + reviewed ATS JSON endpoint adapters (feishu / hotjob / zhiye). 103 unit tests pass (`make test-unit`).
- Real recruitment data: `server/data/recruitment/` — 51 official-career + 98 radar companies in the Hangzhou pilot (137 merged in the pilot import plan, 241 positions; all-cities import plan: **669 companies / 1440 sites / 877 positions, 0 issues, 0 dropped**, 2026-08-17). **Work mode shows authentic positions only** (`radar-*` snapshot rows + `portal-*` verified career portals); seed/official-career example jobs are development scaffolding and are filtered out of every read path (2026-08-17). **79 companies pin on the map**, each at a real Hangzhou office resolved via AMap place-text search (`npm run geocode:sites:apply`, curated in `data/recruitment/geocode-overrides.json`); ~21 radar-only companies with no verifiable Hangzhou office stay off the map. Source review records: `tech/roles/data/etl/`.
- **National scope (2026-08-17+):** work mode is nationwide (北京/上海/广州/深圳/成都/武汉/杭州) with per-location on-demand loading + zoom-tier (LOD) display; schema/drops/read paths are merged to `dev` (migrations `011` national / `012` tier+category / `013` hz_pois, multi-city drops, viewport LOD). Nationwide geocoding of radar city-text sites is an Env-only step still pending (AMap place-text quota; the Hangzhou pilot is already geocoded). Domain mode stays refresh-only and calls the AMap API directly (no POI import; in-Hangzhou browse uses the local `hz_pois` table). Plan: `tech/18-national-scale-plan.md`; parallel workstreams + agent prompts: `tech/roles/development/parallel-sessions/`.
- Database `db/`: ordered PostGIS migrations `001`–`016` (identity through site-key; `011` national scope / `012` tier+category / `013` hz_pois / `014` credentials / `015` recent / `016` site-key). Live apply verified in the ledger, `make test-integration` passes. `npm run import:seed:apply` live-wrote 137 companies / 137 sites / 240 open positions (2026-08-17 Hangzhou pilot, includes radar + portals).
- PostGIS spatial queries: `/api/pois` and `/api/search` use `geom && ST_MakeEnvelope` + `ST_DWithin` for viewport/distance clip. Warm local Next P95: `/api/pois` 12.7ms, bounds clip 5.8ms.
- Frontend `server/` (Next.js 16.3.1, React 19.2.8): Domain + Work map modes, Explore / POI detail / JD panel, mobile drawer, Profile / Recent / Saved / Layers L2, search/filter (30+ dimensions), sort (6 modes), autocomplete, apply tracking, job alerts (queued), saved overlay, basemap toggle. Guest Recent persists in localStorage (persistable work queries only); Saved/Recent reject domain POIs. 1470 tests pass (1468 pass / 2 skipped, 2026-08-23). `cd server && npm test && npm run typecheck`. Pin coordinates are audited against AMap Web services (`npm run audit:pins`, needs `AMAP_WEB_KEY`).
- Official-career file adapter: 51 companies (32 from JSON drops covering every seed slug with a public career URL, 之江实验室 as new slug). 曦曦AI stays seed-only (no career page).
- Changelog: [CHANGELOG.md](CHANGELOG.md). API: [tech/14-api-contract.md](tech/14-api-contract.md). Local run: [tech/15-deploy.md](tech/15-deploy.md). Roadmap: [tech/05-milestones.md](tech/05-milestones.md).

Deferred to future phases:
- `boss` / `nowcoder` / `shixiseng` adapters are stubs (empty dirs); no acquisition is run against them. `xiaozhao-radar` and official career pages are **reviewed and implemented** (records: `tech/roles/data/etl/xiaozhao-radar.md`, `etl/official-career.md`).
- VoiceOver/NVDA manual testing, Playwright E2E, cross-browser compat, aXe scan, LCP measurement.
- Real notification send (email/SMS; currently `queued` only).
- AMap REST batch geocoding (requires `AMAP_WEB_KEY`).

## Scope

### Platform direction

- PostgreSQL 16 and PostGIS 3.4 are required platform infrastructure (migrations written).
- A canonical entity/item model with map overlays, data provenance, and tenant-scoped visibility (implemented).
- Declarative domain plugins; a plugin does not grant permission to acquire data (validator implemented).
- A full-screen map UI with an Apple Maps-inspired shell, responsive drawer, system theme, and controlled AI map actions (shell implemented; AI deferred).
- Amap is the intended first map adapter; additional adapters are deferred.

### MVP data boundary

The only approved MVP candidate is the Apache-2.0 `xiaozhao-radar` `jobs.json` import, with required attribution and provenance capture. The importer will be built only after the exact license notice and field mapping are recorded.

BOSS and Xiaohongshu are **not** MVP sources. No direct automated acquisition, login automation, CAPTCHA bypass, anti-rate-limit workaround, or similar access circumvention is permitted. An official ATS/API source may be added only after a source-specific authorization, terms, robots, rate-limit, and retention review.

### Explicitly deferred

- Resume upload, user profiling, AI recommendation, RAG, and all PII processing.
- Housing, university, and other domain plugins.
- Runtime map-engine switching and executable third-party plugins.
- Production deployment and the public documentation website.

## Documentation

| Document | Purpose | Status |
|---|---|---|
| [agent.md](agent.md) | Mandatory AI development contract | Current |
| [tech/README.md](tech/README.md) | Technical-document index and source-of-truth rules | Current |
| [tech/01-architecture.md](tech/01-architecture.md) | Target architecture and Phase 1 boundaries | Design contract |
| [tech/02-data-model.md](tech/02-data-model.md) | PostGIS, tenancy, and provenance data contract | Design contract |
| [tech/03-plugin-system.md](tech/03-plugin-system.md) | Declarative plugin lifecycle | Design contract |
| [tech/04-workflow.md](tech/04-workflow.md) | Branch, review, and release workflow | Current |
| [tech/05-milestones.md](tech/05-milestones.md) | In-repository roadmap and entry gates | Current |
| [tech/07-frontend-design-system.md](tech/07-frontend-design-system.md) | UI constraints and approval gate | Design contract |
| [tech/roles/README.md](tech/roles/README.md) | Internal role-record taxonomy | Current |

Future public documentation will live at `tech/zh-cn/` and be deployed at `https://map.nvc.ac/doc/zh-cn` only after the site is implemented. It is not present in this repository yet.

## Repository Layout

```text
domain-map/
├── agent.md                 # AI development contract
├── tech/                    # current technical and internal documentation
│   └── roles/               # internal product/development/test/ops/security/data records
├── db/                      # PostGIS migrations 001–016 + apply/preflight scripts
├── server/                  # Next.js 16.3.1 app: UI + /api/* + data drops + scripts/ automation
├── crawler/                 # Python importer + reviewed polite acquisition (radar/official/ATS)
├── tests/                   # integration/db migration tests (unit tests live in server/tests + crawler/tests)
├── Makefile                 # command policy: test-unit / db-migrate / refresh-radar / docs-check …
└── docker-compose.yml       # local PostGIS database only
```

## Development Workflow

1. Start from `dev` and create `feature/<name>`.
2. Read the relevant technical and role documentation before writing code.
3. For a new data source, complete the source authorization record before implementing acquisition.
4. For frontend work, create an ASCII/text layout record and wait for explicit user approval.
5. Implement with tests and update the affected documentation.
6. Open a pull request to `dev`; review is required.
7. Only the user promotes `dev` through a release PR/tag to `main`.

See [tech/04-workflow.md](tech/04-workflow.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT License](LICENSE) © 2026 Yincan Huang
