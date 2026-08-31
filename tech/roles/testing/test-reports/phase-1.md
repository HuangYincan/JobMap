# Phase 1 Test Report

> **Status:** partial; local database integration pending Docker/PostGIS, covered in CI
> **Date:** 2026-08-15

## Results

| Check | Command | Result |
|---|---|---|
| Importer unit tests | `make test-unit` | **14 passed, 0 failed** |
| Database integration | `make test-integration` | SKIP locally (`DATABASE_URL` unset); CI `db-integration` job runs it against a PostGIS service |
| Documentation policy | `make docs-check` | passed |
| DB scripts syntax | `bash -n db/scripts/*.sh tests/integration/db/test_migrations.sh` | passed |
| Frontend typecheck | `cd server && npm run typecheck` | passed |
| Frontend smoke test | `cd server && npm test` | 1 passed |
| Frontend production build | `cd server && npm run build` | compiled successfully |
| Browser smoke (desktop 1440×900) | Playwright | sidebar 58→276px, basemap card, tools rendered |
| Browser smoke (mobile 390×844) | Playwright | drawer mini 96px / half 354px / full 726px (top margin), three states switch |
| Live local PostGIS migration | `make db-up` + `make db-migrate` | BLOCKED locally — Docker daemon unavailable; verified by CI job on push/PR |

## Coverage note

Python unit tests cover manifest validation, local fixture validation, deterministic normalization/provenance, duplicate and malformed record reporting, world-readable public maps, owner-spoof rejection, and owner/editor/viewer decisions. No coverage percentage is claimed until coverage tooling is configured.

## Security note

`postcss` transitive advisories are pinned via `overrides` (^8.5.12). Residual: `next@15.5.23` reports 2 high advisories via its optional `sharp` dependency (libvips); the app does not use `next/image`, so `sharp` is not loaded at runtime. Upgrading to `next@16` is a breaking decision tracked in the implementation record. **Resolved 2026-08-20:** `next@16.3.1` / `react@19.2.8` adopted (batch `20260820-boss-bugfix`, report `b3.md`).

## Blocker

Local Docker daemon is unavailable, so the migration runner, PostGIS extension checks, tenant/map authorization, and spatial integration checks were not run locally. The CI `db-integration` job provides this verification on push/PR. Before declaring Phase 1 complete, confirm the CI run passes or run `make db-up && make db-migrate && make test-integration` locally.
