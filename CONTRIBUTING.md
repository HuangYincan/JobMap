# Contributing to JobMap

This repository is a runnable application: Next.js UI + `/api/*`, a Python importer, and PostGIS migrations. Start from [README.md](README.md). Only claim a command exists or ran if you have verified it.

## Branch and review

```bash
git switch dev
git pull --ff-only origin dev
git switch -c feature/<scope>
```

- Use `feature/<scope>` or `fix/<scope>`.
- Use Conventional Commits: `feat`, `fix`, `docs`, `test`, `refactor`, or `chore`.
- Open a PR to `dev`. Do not target or merge `main`.
- The maintainer owns release PRs from `dev` to `main`.

## Gates

- New external data acquisition needs a source review (license, ToS, robots, rate limits, retention) before code.
- New user-facing UI needs an ASCII/text layout and explicit approval before frontend code.
- New dependencies need a review of that version’s source, license, and SSR/bundle impact.
- New persistent behavior needs tests.

BOSS / 牛客 / 小红书 / 实习僧 are not approved sources. Do not bypass login, CAPTCHA, rate limits, or robots rules.

## Commands

```bash
make help
make db-up
make db-migrate          # needs DATABASE_URL
make preflight
make test-unit           # crawler tests, no database
make test-integration    # PostGIS migrations
make crawl-official      # dry-run GET of curated career pages
make refresh-radar       # reviewed radar snapshot → import plan
make geocode-sites       # office coords (AMAP_WEB_KEY; --dry-run prints the plan)
```

In `server/`: `npm test`, `npm run typecheck`, `npm run dev`. Data commands that write Postgres (`npm run import:seed:apply`, `geocode:sites:apply`) read `server/.env.local`. Never print or commit that file.

`make db-up` starts PostGIS only; apply schema with `make db-migrate`.

## License

Contributions are under the [MIT License](LICENSE).
