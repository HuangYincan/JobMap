---
name: phase-1-review
description: Review Phase 1 changes for migration safety, tenant isolation, provenance, tests, and documentation drift.
---

# Phase 1 Review

Review the fixed-point diff, not claims from an agent.

- Confirm no frontend UI or browser automation was added.
- Confirm no BOSS/Xiaohongshu acquisition, pgvector, PII, or executable plugin path was added.
- Check SQL ordering, transactional migration behavior, checksum drift handling, advisory locking, foreign keys, coordinate constraints, SRID, and GiST indexes.
- Check public seams and tests for manifest validation, source normalization, authorization, and truthful database skips.
- Check secrets, raw source retention, authorization boundaries, SQL parameterization, and destructive reset safeguards.
- Re-read changed docs and run `make docs-check`, `git diff --check`, unit tests, and available integration tests.
- Record each finding with severity, file/line, reproduction, and fix status under `tech/roles/development/code-review/`.
