# Phase 1 Test Plan

> **Status:** in-progress; no test results are claimed before execution.

## Public seams

- Migration runner: ordered application, rerun no-op, checksum drift rejection.
- Manifest validator: accepted declarative manifests and rejected capabilities/unknown fields.
- Import normalization: deterministic records, provenance requirement, duplicate handling, invalid-record report.
- Map access: owner/editor/viewer/public-read decisions and cross-map denial.
- Database integration: PostGIS extension, schema constraints, and spatial behavior against a disposable database.

## Required evidence

- Unit command and exact dependency/runtime versions.
- Database URL/service readiness and migration output.
- Pass/fail/skip counts; skipped integration tests must include the reason.
- Coverage only after executable tests exist; it is not a substitute for authorization or migration tests.
