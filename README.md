# Domain Map Platform

> A plugin-oriented map platform for location-bound domain data. The first planned vertical slice is a recruitment map built only from approved data imports.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://www.postgresql.org/)
[![PostGIS](https://img.shields.io/badge/PostGIS-3.4-green.svg)](https://postgis.net/)

## Project Status

**Status: Phase 2 client slice + Phase 3/4 account/overlay work on `feature/phase-2-multi-mode`.** Phase 1 baseline remains on `feature/phase-1-platform-baseline`.

Implemented and verified:
- Importer project `crawler/` (Python 3.12, uv): declarative plugin-manifest validation, deterministic local-fixture normalization with provenance, and map access policy. 11 unit tests pass.
- Database `db/`: ordered PostGIS migrations `001`–`010` (identity through notifications). Live apply: `make db-up`, then `export PATH="/opt/homebrew/opt/libpq/bin:$PATH"` if `psql` is keg-only, then `make preflight` + `make db-migrate`.
- Frontend `server/` (Next.js 15.5.23, React 19): Domain + Work map, Explore / detail / JD, mobile drawer, Profile / Recent / Saved / Layers. Home lazy-loads `MapShell`. `cd server && ./node_modules/.bin/tsc --noEmit && node --test tests/*.test.mjs` is the test command.
- Changelog: [CHANGELOG.md](CHANGELOG.md). API: [tech/14-api-contract.md](tech/14-api-contract.md). Local run: [tech/15-deploy.md](tech/15-deploy.md). Roadmap: [tech/05-milestones.md](tech/05-milestones.md).

Not yet verified:
- Live PostGIS apply is verified locally (2026-08-16): `001`–`010` in the ledger, `make test-integration` passes, `npm run import:seed:apply` wrote 51 companies / 67 open positions. Spatial query API still uses in-process `inBounds` until PostGIS `ST_DWithin` is wired.
- No external source acquisition has occurred and none is enabled. `xiaozhao-radar` remains an import candidate only.
- Frontend UI full interface/accessibility evidence and screenshots belong to Phase 3; the Phase 1 shell is a working base.

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
├── db/                      # reserved for future SQL migrations
├── server/                  # reserved for future Next.js application
├── crawler/                 # reserved for future Python importer/crawler
├── tests/                   # test strategy; test code arrives with implementation
├── scripts/                 # reserved for verified automation scripts
├── Makefile                 # scaffold-aware command policy
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
