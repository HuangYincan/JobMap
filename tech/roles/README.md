# Internal Role Documentation

> **Status:** current taxonomy; subdirectories are created as work requires them
> **Last reviewed:** 2026-08-15

`tech/roles/` holds internal evidence and decision records. It is not the public documentation site. Public documentation is planned for `tech/zh-cn/`, which does not yet contain pages.

## Current Directories

| Role | Current location | Create records when |
|---|---|---|
| Product | `product/` | MVP scope, non-goals, and acceptance criteria are agreed |
| Development | `development/` | A phase begins or an implementation decision is made |
| Testing | `testing/` | A test plan, run, defect, or quality gate has real evidence |
| Operations | `operations/` | A verified runbook, release procedure, or incident exists |
| Security | `security/` | A threat model, review, finding, or remediation is performed |
| Data | `data/` | A source, import, quality check, or retention decision is reviewed |

The directories may contain empty placeholders. A path mentioned as a future record is not proof that the record exists.

## Required Records by Event

| Event | Evidence location |
|---|---|
| Product scope accepted | `product/PRD/<feature>.md` |
| Phase implementation begins | `development/implementation/phase-<n>.md` |
| New UI flow approved | the relevant implementation record, with layout version, user approval quote, and timestamp |
| Test run or defect | `testing/test-reports/` |
| Data-source approval | `data/data-sources.md` |
| Security review | `security/` |
| Verified release/incident | `operations/` |

## Record Integrity

- Record observed results, commands, dates, and evidence; never prefill success, coverage, deployment, or authorization claims.
- Architectural decisions live in [tech/06-decisions.md](../06-decisions.md).
- Product-facing claims must match implemented, testable behavior. Planned functionality remains explicitly planned.
- Keep internal records under `tech/roles/`; do not recreate the legacy internal-role location.
