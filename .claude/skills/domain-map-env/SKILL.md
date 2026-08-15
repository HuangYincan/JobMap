---
name: domain-map-env
description: Verify and operate the Phase 1 Domain Map local environment without overstating results.
---

# Domain Map Environment

Use this skill before migrations, imports, or tests.

1. Confirm the branch is `feature/*` and preserve existing changes.
2. Run `make preflight` when available; otherwise run `make scaffold-status` and report missing artifacts as missing.
3. Python commands must run through uv with the project's Python 3.12 constraint. Do not use the system Python 3.14 beta as proof of compatibility.
4. `make db-up` starts only PostGIS. Verify Docker daemon and database health before migrations.
5. A skipped database test is **skipped**, never passed.
6. Never print or commit secrets from `.env` files.
7. Finish with the exact commands, versions, pass/fail/skip state, and remaining blockers.
