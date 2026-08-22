# Domain Map Platform

> A plugin-oriented map platform for location-bound domain data. The first planned vertical slice is a recruitment map built only from approved data imports.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://www.postgresql.org/)
[![PostGIS](https://img.shields.io/badge/PostGIS-3.4-green.svg)](https://postgis.net/)

## Project Status

**Status: Phase 2/3/4 complete on `dev` (2026-08-21, merged from `feature/phase-2-multi-mode`).** Phase 1 baseline remains on `feature/phase-1-platform-baseline` (historical).

Implemented and verified:
- Importer project `crawler/` (Python 3.12, uv): declarative plugin-manifest validation, deterministic local-fixture normalization with provenance, map access policy, and **reviewed polite acquisition** — published xiaozhao-radar `jobs.json` mapping (`radar_jobs.py`) + official career-page GET with robots and blocked commercial hosts (`official_refresh.py` / `acquire.py`) + reviewed ATS JSON endpoint adapters (feishu / hotjob / zhiye). 103 unit tests pass (`make test-unit`).
- Real recruitment data: `server/data/recruitment/` — JSON drops by source (2026-08-23 计数, `server/data/recruitment/<源>/*.json`): **radar 646 / official-career 78 / qqdoc-official 142 / qqdoc-jobs 163 / embodied-jobs 47**; `boss` / `nowcoder` / `shixiseng` 是 stub(空目录,无采集)。**Import plan 2026-08-23 `plan-seed-import` dry-run 实测:companies 1040 / sites 2351 / positions 12932 / dropped 0 / issues []**(drops 刷新后请重跑 dry-run 取新计数,本文不硬编码)。**Work mode shows authentic positions only** (`radar-*` 快照行 + `portal-*` 已验证招聘官网 + qqdoc/embodied 真岗位);seed/official-career 示例岗位是开发脚手架,所有读路径过滤(2026-08-17)。地图 pin:2026-08-17 杭州 pilot `geocode:sites:apply` 落地 **79 pin**(21 家无杭州办公点不上图);此后 geocode 覆盖扩到 5 源 + r4/r5 修正(304 站落真实坐标,2026-08-22)——当前精确 pin 数待下次 apply 后回填。来源审查记录:`tech/roles/data/etl/`。
- **National scope (2026-08-17+):** work mode is nationwide (北京/上海/广州/深圳/成都/武汉/杭州) with per-location on-demand loading + zoom-tier (LOD) display; schema/drops/read paths are merged to `dev` (migrations `011` national / `012` tier+category / `013` hz_pois, multi-city drops, viewport LOD). 全国 drops 的 geocode 已于 2026-08-22 扩至 5 源(radar/official-career/qqdoc-jobs/qqdoc-official/embodied-jobs)+ 地址回填 342/373 站;r4/r5 城市中心堆叠闭环,剩余 `city_pending`/脏值站点待 geocode 重跑。Domain mode stays refresh-only:杭州内走本地 `hz_pois` 表(`/api/pois/domain-local`),市外由**活跃地图引擎** `searchPOI` 承接(引擎未注入时回落 amap-api)。Plan: `tech/18-national-scale-plan.md`; parallel workstreams + agent prompts: `tech/roles/development/parallel-sessions/`。
- Database `db/`: ordered PostGIS migrations `001`–`018`(`011` national scope / `012` tier+category / `013` hz_pois / `014` credentials / `015` recent / `016` site-key / `017` avatar / `018` memories)。Live apply verified in the ledger, `make test-integration` passes。`npm run import:seed:apply` 首次 live-write 137 companies / 137 sites / 240 open positions(2026-08-17 杭州 pilot,含 radar + portals);后续增量/全量 apply 属用户操作(2026-08-23 dry-run 计划见上,apply 后实入行数待回填)。
- PostGIS spatial queries: `/api/pois` and `/api/search` use `geom && ST_MakeEnvelope` + `ST_DWithin` for viewport/distance clip. Warm local Next P95: `/api/pois` 12.7ms, bounds clip 5.8ms.
- Frontend `server/` (Next.js 16.3.1, React 19.2.8): Domain + Work map modes, Explore / POI detail / JD panel, mobile drawer, Profile / Recent / Saved / Layers L2, search/filter (30+ dimensions), sort (6 modes), autocomplete, apply tracking, job alerts (queued), saved overlay, basemap toggle. Guest Recent persists in localStorage (persistable work queries only); Saved/Recent reject domain POIs. 1470 tests pass (1468 pass / 2 skipped, 2026-08-23). `cd server && npm test && npm run typecheck`. Pin coordinates are audited against AMap Web services (`npm run audit:pins`, needs `AMAP_WEB_KEY`).
- Official-career file adapter: drops 现 **78 家公司**(2026-08-23 计数);适配器首版 51 家(32 个 JSON drops 覆盖全部有公开 career URL 的 seed slug + 之江实验室新 slug)。曦曦AI stays seed-only (no career page)。审查记录:`tech/roles/data/etl/official-career.md`。
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
├── db/                      # PostGIS migrations 001–018 + apply/preflight scripts
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
