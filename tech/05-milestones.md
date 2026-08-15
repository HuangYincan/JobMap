# 05 - Milestones

> **Status:** current execution roadmap
> **Last reviewed:** 2026-08-15
> **Authority:** this file is the in-repository milestone source of truth. Historical `tech/00-*` reports are context only.

## Current Baseline

P0 is complete as a **documentation and repository scaffold**. Phase 1 is **in progress**: the importer project, PostGIS migration runner, SQL migrations, declarative plugin/import validation, and an Apple-Maps-inspired frontend shell now exist on `feature/phase-1-platform-baseline`. The importer unit tests pass (11), the frontend typechecks/tests/builds, and a browser smoke check confirmed the desktop sidebar and mobile three-state drawer render and switch correctly. **Live PostGIS verification is still blocked** until Docker/PostGIS is available.

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
- Frontend shell exists and is verified in-browser (user authorized ASCII gate relaxation for this phase). **Done** — see Phase 3 for full interface evidence.

## Phase 2: Recruitment Vertical Slice

P2 is limited to the approved `xiaozhao-radar` import candidate and one recruitment-domain read path. It must capture attribution, original URL, retrieval time, content hash/version, parser version, and import result. BOSS, Xiaohongshu, resume parsing, recommendation, and any PII remain out of scope.

## Deferred Decisions

The following must have an ADR or security/data review before implementation: ORM, cache, pgvector, LLM provider, deployment topology, public docs framework, map-engine expansion, third-party/executable plugins, PII retention, and all additional data sources.
