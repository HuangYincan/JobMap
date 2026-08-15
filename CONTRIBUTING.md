# Contributing to Domain Map Platform

> **Status:** contribution contract for the documentation/scaffold stage
> **Last reviewed:** 2026-08-15

## Before You Start

This repository does not yet contain a runnable application. Read [README.md](README.md), [agent.md](agent.md), [tech/04-workflow.md](tech/04-workflow.md), and the relevant technical contract before proposing implementation. Do not rely on planned commands, paths, or examples as executable behavior.

## Branch and Review Process

```bash
git switch dev
git pull --ff-only origin dev
git switch -c feature/<scope>
```

- Use `feature/<scope>` or `fix/<scope>` for all work, including documentation.
- Use Conventional Commits: `feat`, `fix`, `docs`, `test`, `refactor`, or `chore`.
- Open a PR to `dev`. Do not target or merge `main`.
- The user owns release PRs/tags from `dev` to `main`.

## Mandatory Gates

- New external data acquisition requires an evidence-based source review under `tech/roles/data/` before code is written.
- New user-facing UI flow or material visual interaction requires an ASCII/text layout record and explicit user approval before frontend code.
- New dependency use requires review of the actual version's source, license, security posture, SSR/bundle implications, and recorded rationale.
- New persistent behavior requires tests and updated technical documentation.

## Current Supported Commands

Only the documentation-scaffold commands are supported today:

```bash
make help
make docs-check
make scaffold-status
make db-up
make db-status
```

`make db-up` starts only the local PostGIS database service. It does not create schema, migrations, application, importer, or test environment. Do not add setup/run commands until the referenced files exist and are verified.

## Documentation Rules

- Technical and internal documentation: `tech/` and `tech/roles/`.
- Planned public documentation: `tech/zh-cn/`; it currently has no pages.
- Historical `tech/00-*` files retain context but do not override current contracts.
- State whether a claim is current, decided, planned, deferred, or historical. Never claim a test, authorization, deployment, or feature passed without evidence.

## Data and Security

`xiaozhao-radar` is the sole approved MVP import candidate, subject to recorded attribution and provenance. BOSS and Xiaohongshu are not approved sources and must not be directly acquired. Do not bypass authentication, CAPTCHA, rate limits, source restrictions, or robots rules.

Report security-sensitive issues through the repository's private channel rather than public issue details. Do not include secrets, personal data, or raw restricted-source content in commits.

## Code Review Expectations

Reviewers verify scope, authorization, source provenance, input validation, PostGIS correctness, tests, accessibility, and documented operational impact. A third-party component or subagent statement is evidence to inspect, not proof of correctness.

## License

Contributions are provided under the [MIT License](LICENSE).
