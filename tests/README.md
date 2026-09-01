# Test Strategy

> **Status:** current; Node/crawler/database test infrastructure exists, but live database verification depends on the configured PostGIS service
> **Last reviewed:** 2026-09-01

## Current State

The repository has importer unit tests (`crawler/tests`, run via `make test-unit`), a database integration runner (`tests/integration/db/test_migrations.sh`, run via `make test-integration`), and the Node `server/tests/*.test.mjs` suite. CI (`.github/workflows/test.yml`) runs docs policy, Python unit tests, frontend typecheck/test/build, and database integration against a PostGIS 16-3.4 service. The Node suite includes security contract tests in `security-headers.test.mjs`, `account-security.test.mjs`, `agent-route-contract.test.mjs`, `rate-limit-xff.test.mjs`, and `agent-mcp.test.mjs`; these are application tests, not static or dynamic scanners. E2E, accessibility, performance, SAST, DAST, and dependency scanning are not configured; do not report them as passing or as having been run.

## Phase 1 Test Baseline

Phase 1 delivers the first evidence per layer. The following layers are covered by the current suite; API/tenant-DB and spatial layers are enforced by the CI database integration job.

| Layer | Required first evidence |
|---|---|
| Migration/integration | Empty PostGIS database; extension existence; migration ordering and idempotent runner behavior |
| Authorization | owner/editor/viewer/public read and denied cross-user/map cases |
| Data import | schema validation, source provenance, duplicate/idempotent import, failed-record reporting |
| Spatial | coordinate constraints, known-distance fixtures, bbox/radius bounds, index/query-plan checks where practical |
| Plugin | manifest validation, invalid capability rejection, tenant enablement/deactivation |
| API | request/error contract, pagination limits, parameter validation, authorization |

## Browser and UI QA

After UI implementation begins, `agent-browser` is the primary interactive/screenshot QA tool requested for this project. Playwright may be added for repeatable regression and accessibility checks; it is not a substitute for the required interactive review.

Every user-facing flow requires:

- approved ASCII/text layout evidence before code;
- desktop and mobile viewport screenshots; iPhone SE, iPhone 14 Pro Max, and a tablet matrix;
- light/dark, keyboard, touch, reduced-motion, loading/error/empty, and API-key/network failure checks;
- accessibility checks targeting WCAG 2.2 AA, including focus order and a map list/text alternative.

Use state/role-based locators and explicit readiness conditions. Do not use fixed sleeps such as `waitForTimeout` as a readiness assertion.

## CI Policy

CI (`.github/workflows/test.yml`) now runs: docs policy, importer unit tests (`make test-unit`), frontend typecheck/test/build, and database integration (`make test-integration`) against a PostGIS 16-3.4 service with a PostgreSQL client installed. Lint, coverage thresholds, E2E, accessibility, security, performance, and agent-browser screenshot artifact jobs are added only when their commands and fixtures are real. Each documented check must identify its trigger, command, artifact, and blocking status.

## Coverage

The `>80%` target applies to critical executable modules only after coverage tooling is configured. It does not excuse missing integration, authorization, spatial, or security tests, and screenshots do not count as logic coverage.
