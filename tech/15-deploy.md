# Local deploy / runbook（2026-08-16）

This is how to run Domain Map on a laptop. There is **no** production host, TLS, or backup rotation yet. Do not treat this as a go-live checklist.

**Never print or commit `.env` / `.env.local` secrets.**

## Prerequisites

- Node 22 (`server/.nvmrc`)
- Docker Desktop — only if you want Postgres. The UI runs without it.
- An AMap JS key with `localhost` allowed (Domain mode). Work mode seed does not need AMap.

## Frontend only (default)

```bash
cd server
cp ../.env.example .env.local   # then fill NEXT_PUBLIC_AMAP_*
npm install
npm run dev                     # http://localhost:3000
```

Home lazy-loads `MapShell`. Without AMap keys, Work seed + chrome still load; Domain search stays empty.

```bash
./node_modules/.bin/tsc --noEmit
node --test tests/*.test.mjs
npm run import:seed             # 50 companies / 0 dropped today
npm run import:seed:apply       # no-op without DATABASE_URL; upserts 006 tables when Docker is up
```

Do not run `npx tsc` from the repo root.

## Optional PostGIS

```bash
# from repo root
make db-up
# DATABASE_URL from .env.example — do not echo it
make preflight
make db-migrate                 # 001–010
```

Account routes then write sessions / Recent / Saved / applications / queued notifications. Public list APIs still read `serverCatalog` (seed), not SQL. Live `EXPLAIN` notes are in `tech/13-db-query-notes.md`.

`make db-down` stops the container. Volume `postgres_data` keeps data until you `docker compose down -v`.

## What is not deployed

- No Vercel / Railway / CI publish.
- No Redis (public cache is in-process, 30s).
- No real SMS / email. Inbox rows stay `queued`.
- No AMap → Postgres importer.
- Backup / restore is “the Docker volume + git”. Record a real runbook when there is a host.

## Rollback

The app is the git branch. `git revert` / `git reset` the last conventional commit. Session cookies are demo HMAC; rotating `SESSION_SECRET` signs everyone out.
