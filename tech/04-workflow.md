# 04 - Contribution and Release Workflow

> **Status:** current process contract
> **Last reviewed:** 2026-08-15

## Branch Policy

- `main` is the protected release branch. Agents do not merge, tag, publish, or deploy it.
- `dev` is the integration branch.
- All work, including documentation, starts from `feature/<scope>` or `fix/<scope>` and arrives in `dev` through review.
- The user alone creates the release PR/tag from `dev` to `main`.

## Required Gates

Before implementation, satisfy the gates that apply to the change:

1. **Scope gate:** a PRD or recorded task exists under `tech/roles/product/` for material product work.
2. **Data gate:** external acquisition has a source record with authorization/terms/robots/rate/retention review. No record means no acquisition code or job.
3. **Frontend gate:** new user-facing flows or material visual/interaction changes have an ASCII/text layout record under `tech/roles/development/implementation/` and explicit user approval. Accessibility fixes and strictly internal changes may proceed under the approved design system, but must be recorded.
4. **Decision gate:** unresolved architecture choices receive an ADR before they become implementation dependencies.

## Feature Workflow

```bash
git switch dev
git pull --ff-only origin dev
git switch -c feature/<scope>
```

1. Read [agent.md](../agent.md), the relevant technical contract, and role record.
2. Write/update the implementation record before coding a material feature.
3. Implement only the approved scope; add tests at the layer affected.
4. Run only commands that exist for the current scaffold. Do not claim a planned command passed.
5. Update technical docs, role records, and public docs only when corresponding artifacts exist.
6. Open a PR targeting `dev` with test evidence, source-review evidence for third-party packages, and UI evidence where applicable.

Use Conventional Commits: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`.

## Review Checklist

- [ ] Scope and data-source gates satisfied.
- [ ] Tenant/map authorization and provenance impacts evaluated.
- [ ] PostGIS queries use documented coordinate and index policy.
- [ ] Tests are real, runnable, and accurately reported.
- [ ] Third-party dependency source/license/security review recorded.
- [ ] New UI has required layout approval, agent-browser evidence, and accessibility checks.
- [ ] Documentation describes the actual implementation state rather than intended behavior.

## Release Workflow

The user owns release promotion:

1. Review `dev` and run the then-current verified release checks.
2. Create a release PR from `dev` to `main`.
3. Resolve all required checks and review findings.
4. Merge, tag, and publish release notes.
5. Deploy only when a verified operations runbook, backup/restore procedure, and rollback plan exist.

`tech/roles/operations/deployment/` is currently a planned record location, not an existing release checklist.
