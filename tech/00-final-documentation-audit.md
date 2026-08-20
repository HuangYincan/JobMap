# Final Pre-development Documentation Audit

> **Status:** current audit record  
> **Date:** 2026-08-15  
> **Scope:** documentation, workflow, scaffold configuration; no product code
>
> **注（2026-08-21）：部分结论已过时——当前契约以 `tech/01`–`22` 与 `agent.md` 为准。** 该审计
> 记录于开发前（scaffold 阶段），文中「尚未实现/延后」的条目（迁移、API、前端等）此后大多已
> 落地并并入 `dev`；本文档保留为历史记录，正文未改。

## Outcome

The review found that the repository was a documentation scaffold while several documents presented planned application code, migrations, tests, public docs, plugins, and deployment as already available. The current contracts now distinguish repository facts from target design and deferred work.

## Corrected

- Canonical paths are `tech/` and `tech/roles/`; `tech/zh-cn/` is a planned public-doc source and currently has no pages.
- P0 means documentation/repository initialization only. It no longer implies a runnable application.
- The roadmap has no stale calendar release promise and now includes explicit entry/exit evidence.
- PostgreSQL/PostGIS is the MVP hard requirement; pgvector is deferred.
- Canonical entities are separated conceptually from tenant/map overlays; provenance, membership, and authorization are Phase 1 requirements.
- Plugins are declarative, versioned, capability-limited, and separate from source authorization. Executable user plugins are out of scope.
- `xiaozhao-radar` is the sole MVP import candidate subject to recorded attribution/provenance. BOSS and Xiaohongshu direct acquisition is prohibited in the MVP.
- AI is deferred and constrained to a future server-validated map-action allowlist.
- Desktop sidebar is consistently default-collapsed. Mobile drawer rules now use explicit CSS-pixel/second units and include safe-area, accessibility, reduced-motion, and performance requirements.
- Frontend implementation remains blocked by explicit user approval of an ASCII/text layout record.
- Makefile and CI no longer claim to run absent application tests; they report scaffold state and check documentation policy.
- Historical `tech/00-*` reports are labeled non-authoritative.

## Intentionally Deferred

Application manifests, SQL migrations, migration runner, importer, API, frontend, executable tests, public docs site, production deployment, additional domains, PII, recommendation/RAG, pgvector, and external data acquisition beyond an approved import candidate.

## Phase 1 Entry Point

Use [05-milestones.md](05-milestones.md), especially “Phase 1: Platform Baseline.” Before implementation, resolve the listed decisions and create real, runnable artifacts with corresponding tests. Frontend work additionally requires the separate ASCII/text approval gate.
