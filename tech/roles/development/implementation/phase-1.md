# Phase 1 Implementation Record

> **Status:** in progress — live PostGIS verification pending
> **Started:** 2026-08-15
> **Branch:** `feature/phase-1-platform-baseline`

## Scope

Build the first runnable platform foundation without external source acquisition:

- Python 3.12-targeted migration/importer project.
- Ordered, checksum-protected PostgreSQL/PostGIS migrations.
- Application-level map access policy (`owner`, `editor`, `viewer`, public read).
- Declarative plugin manifest validation.
- Local fixture normalization and provenance planning only.

## Non-goals

No network crawler, BOSS/Xiaohongshu access, live `xiaozhao-radar` download, user upload, PII, pgvector, AI, or production deployment.

## Public Test Seams

1. `MigrationRunner.apply_all()` reports applied/unchanged migrations and rejects checksum drift (see `db/scripts/apply.sh`).
2. `validate_manifest()` accepts only a declarative supported plugin contract (`crawler/app/domain_map_importer/manifest.py`).
3. `normalize_import()` produces deterministic normalized records and reports invalid records without a network request (`imports.py`).
4. `can_access_map()` returns the access decision for a principal, visibility, and membership role (`access.py`).
5. Database integration checks verify the migration contract only when a reachable `DATABASE_URL` is supplied (`tests/integration/db/test_migrations.sh`).

## Approvals

The user explicitly relaxed the ASCII/text layout approval gate for this development round, authorizing autonomous continuation including the frontend shell. This is the approval that Phase 3 otherwise requires; the Phase 1 shell is the working base, not the full Phase 3 interface evidence.

## Evidence (verified 2026-08-15)

- `make test-unit` → **14 tests OK** (manifest, imports, map access), including world-readable public maps, owner-spoof rejection, and valid-records-kept-alongside-rejected.
- `make test-integration` → SKIP truthfully when `DATABASE_URL` is unset; BLOCKED when set but PostGIS unreachable.
- `make docs-check` → passed.
- Frontend `server/` (Next 15.5.23, React 19.0.8, TS 5.9.3): `npm run typecheck`, `npm test`, `npm run build` all pass. Browser smoke check at 1440×900 and 390×844 viewports confirmed desktop sidebar collapse/expand (58→276px), basemap card, and mobile drawer mini/half/full (96px / 354px / 726px with top margin).
- SQL migrations `001-004` written with PostGIS/pg_trgm, provenance and spatial constraints; runner applies each migration and its ledger row in one transaction, with the applied-check after a transaction-scoped advisory lock (concurrent runners skip, not re-run).
- CI now runs docs policy, Python unit tests, frontend typecheck/test/build, and database integration against a PostGIS 16-3.4 service.
- Live DB verification could not run because the Docker daemon was unavailable locally; CI's `db-integration` job covers it on push/PR.

## Security notes

- `NEXT_PUBLIC_AMAP_KEY` is a public browser key restricted by the Amap console; `.env.example` documents this. It is not set locally and the shell renders a CSS-map fallback without it.
- `postcss` transitive advisories are resolved via an `overrides` pin (^8.5.12).
- Residual advisory: `next@15.5.23` carries 2 high advisories inherited via its optional `sharp` dependency (libvips). The app does not use `next/image`, so `sharp` is not loaded at runtime. Upgrading to `next@16` is a breaking change and must be an explicit decision/ADR before adoption.

## Remaining

- Verify migrations against a real PostGIS 16/3.4 database (local Docker or rely on CI `db-integration`).
- Independent review findings were applied (see this record + test report); a second review confirmed the fixes.
- Full Phase 3 interface/accessibility evidence and screenshots still belong to Phase 3.
