# Contributing to Domain Map Platform

> **Status:** contribution contract for the active application
> **Last reviewed:** 2026-08-21

## Before You Start

This repository contains a runnable application: a Next.js frontend + `/api/*` server, a Python importer, and PostGIS migrations, all shipped on `dev` (Phase 2/3/4 complete). Read [README.md](README.md), [agent.md](agent.md), [tech/04-workflow.md](tech/04-workflow.md), and the relevant technical contract before proposing implementation. Commands listed below exist and are verified; anything else must be verified before it is claimed or run.

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

The full command surface is live; the following are the documented entry points:

```bash
make help               # list all supported make targets
make docs-check         # documentation policy check
make scaffold-status    # show implementation prerequisites present/planned
make db-up              # start the local PostGIS database
make db-status          # show database service status
make db-migrate         # apply pending SQL migrations (requires DATABASE_URL)
make preflight          # verify DATABASE_URL and PostGIS availability
make test-unit          # crawler importer unit tests (no database required)
make test-integration   # DB integration tests (tests/integration/db/test_migrations.sh)
make crawl-official     # dry-run polite GET of curated official career pages (no write)
make refresh-radar      # download the reviewed radar snapshot, remap drops, validate import plan
make geocode-sites      # resolve city-text sites to real offices (needs AMAP_WEB_KEY; --dry-run prints the plan)
```

Server commands (`cd server`): `npm test` (1610 tests / 1608 pass / 2 skip, 2026-08-24), `npm run typecheck`, `npm run dev` / `build` / `start`. Data commands that touch Postgres (`npm run import:seed:apply`, `geocode:sites:apply`, `audit:pins`, `import:hz:pois:apply`) need `DATABASE_URL` from `server/.env.local` (never print or commit it) and, where noted, `AMAP_WEB_KEY` (geocode also accepts `BAIDU_MAP_AK` / `TENCENT_MAP_KEY` fallbacks).

`make db-up` starts only the local PostGIS database service; schema/migrations are applied separately with `make db-migrate`. Never claim a command exists or ran unless the referenced files exist and are verified.

## Documentation Rules

- Technical and internal documentation: `tech/` and `tech/roles/`.
- Planned public documentation: `tech/zh-cn/`; it currently has no pages.
- Historical `tech/00-*` files retain context but do not override current contracts.
- State whether a claim is current, decided, planned, deferred, or historical. Never claim a test, authorization, deployment, or feature passed without evidence.

## Data and Security

Approved acquisition is limited to reviewed sources recorded in `tech/roles/data/etl/` (xiaozhao-radar `jobs.json`, official career-page GET, reviewed ATS endpoints). BOSS / 牛客 / 小红书 / 实习僧 are not approved sources and must not be directly acquired. Do not bypass authentication, CAPTCHA, rate limits, source restrictions, or robots rules.

Report security-sensitive issues through the repository's private channel rather than public issue details. Do not include secrets, personal data, or raw restricted-source content in commits.

## Code Review Expectations

Reviewers verify scope, authorization, source provenance, input validation, PostGIS correctness, tests, accessibility, and documented operational impact. A third-party component or subagent statement is evidence to inspect, not proof of correctness.

## License

Contributions are provided under the [MIT License](LICENSE).
