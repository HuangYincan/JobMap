---
name: doc-maintenance
description: Keep Domain Map technical, role, and public-documentation claims synchronized with verified implementation.
---

# Domain Map Documentation Maintenance

Use this skill for every material change.

- `README.md`, `agent.md`, and `tech/01-07` are current contracts.
- `tech/roles/` contains evidence records; create them only when evidence exists.
- `tech/zh-cn/` is planned public documentation until implemented.
- `tech/00-*` documents are historical context and cannot override current contracts.
- Label claims as current, decided, planned, deferred, blocked, or historical.
- For migrations update `tech/02-data-model.md`; for plugins update `tech/03-plugin-system.md`; for workflow or command changes update `tech/04-workflow.md` and `Makefile`.
- Record command outcomes honestly. Do not claim a missing command, Docker-dependent test, deployment, authorization, or source review passed without evidence.
- Run `make docs-check` and `git diff --check` before submitting a PR.
