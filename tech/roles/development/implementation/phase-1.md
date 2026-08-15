# Phase 1 Implementation Record

> **Status:** in-progress
> **Started:** 2026-08-15
> **Branch:** `feature/phase-1-platform-baseline`

## Scope

Build the first runnable platform foundation without external source acquisition:

- Python 3.12-targeted migration/importer project.
- Ordered, checksum-protected PostgreSQL/PostGIS migrations.
- Application-level map access policy (`owner`, `editor`, `viewer`, anonymous public read).
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

## Evidence (verified 2026-08-15)

- `make test-unit` → 11 tests OK (manifest, imports, map access).
- `make test-integration` → SKIP truthfully when `DATABASE_URL` is unset; BLOCKED when set but PostGIS unreachable.
- `make docs-check` → passed.
- `make scaffold-status` → server package, crawler pyproject, migrations, apply.sh, tests all present.
- SQL migrations `001-004` written with PostGIS/pg_trgm, ledger, advisory lock, provenance and spatial constraints; runner applies each migration and its ledger row in one transaction.
- DB integration could not run because Docker daemon is unavailable; `make db-up` is blocked until Docker is running. This must be re-verified before Phase 1 is declared complete.

## Remaining

- Verify migrations against a real PostGIS 16/3.4 database (Docker required).
- Frontend shell and documented server manifest alignment (Next.js contract).
- Final independent review and documentation sync.
