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
cp .env.example .env.local   # then fill NEXT_PUBLIC_AMAP_*
npm install
npm run dev                     # http://localhost:3000
```

Home lazy-loads `MapShell`. Without AMap keys, Work seed + chrome still load; Domain search stays empty.

```bash
./node_modules/.bin/tsc --noEmit
node --test tests/*.test.mjs
npm run import:seed             # import plan (复测 2026-08-21): 830 companies / 2101 sites / 11602 positions / 0 dropped
npm run import:seed:apply       # no-op without DATABASE_URL; upserts 006 tables when Docker is up
npm run geocode:sites           # lists drop / imported sites still at (0,0); does not call AMap
npm run geocode:sites:apply     # real office coords for city-list drops (needs AMAP_WEB_KEY; --dry-run prints the plan)
                                # AMap quota exhausted → Baidu → Tencent fallback (BAIDU_MAP_AK / TENCENT_MAP_KEY, all GCJ-02)
npm run audit:pins              # three-layer pin audit vs AMap Web services (needs AMAP_WEB_KEY + DATABASE_URL)
# Optional: drop official-career JSON in server/data/recruitment/official-career/
# Optional: refresh the reviewed radar snapshot → make refresh-radar (self-validates)
# Optional: polite GET of official career pages → make crawl-official (dry-run, no write)
```

Do not run `npx tsc` from the repo root.

**import plan 测量说明(2026-08-21 复测):** `npm run import:seed` 为 plan 模式(无 DB 副作用)。本次实测在 dev 状态(已并入 qqdoc-official 142 家腾讯文档源)进行:830 companies / 2101 sites / 11602 positions / 0 dropped。此前 688 / 1959 / 11602 为 qqdoc 源并入前的旧基线(2026-08-21 上午);qqdoc-jobs 批未合入 dev,故其数据不计入本 plan。

## Optional PostGIS

```bash
# from repo root
make db-up
# Homebrew libpq is keg-only — put psql on PATH before make
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
# DATABASE_URL from .env.example — do not echo it
export DATABASE_URL='postgresql://postgres:postgres@localhost:5432/domain_map'
make preflight
make db-migrate                 # 001–019
cd server && npm run import:seed:apply
```

Verified 2026-08-16 against `postgis/postgis:16-3.4`: ledger `001`–`010`, `make test-integration` passed twice (rerun is a no-op), seed apply wrote 51 / 51 / 67. Keep `DATABASE_URL` in `server/.env.local` so Next reads imported rows; do not commit that file.

**2026-08-17 re-import:** `npm run import:seed:apply` live-wrote **137 companies / 137 sites / 240 open positions** (official-career + radar + portals). The DB read path keeps ungeocoded radar sites off the map. `npm run geocode:sites:apply` (2026-08-17) resolved **65 city-list radar sites to real Hangzhou offices** via AMap place-text search (curated in `data/recruitment/geocode-overrides.json`; ~21 companies with no verifiable office stay off). Re-run `import:seed:apply` after a geocode apply so PostGIS picks the new coordinates up.

Account routes then write sessions / Recent / Saved / applications / queued notifications. After `npm run import:seed:apply`, public list APIs and the Work map read imported rows via `loadServerCatalog`. Public Work reads are strict DB-only: without a database (or on DB failure) they return an empty list — there is no offline seed fallback (seed examples are archived under `tech/backup/seed-data`). Live `EXPLAIN` notes are in `tech/13-db-query-notes.md`.

`make db-down` stops the container. Volume `postgres_data` keeps data until you `docker compose down -v`.

## What is not deployed

- No Vercel / Railway / CI publish.
- No Redis (public cache is in-process, 30s).
- OTP 已真发(Resend email / 阿里云短信,2026-08-22,见 tech/25/26);岗位提醒仍仅入队(queue-only:Inbox rows stay `queued`).
- No AMap → Postgres importer for Domain POIs. `npm run geocode:sites` only plans missing points (radar/portal recruitment data imports via `import:seed:apply`).
- Backup / restore is “the Docker volume + git”. Record a real runbook when there is a host.

## Rollback

The app is the git branch. `git revert` / `git reset` the last conventional commit. Session cookies are HMAC-signed; rotating `SESSION_SECRET` signs everyone out.

## SESSION_SECRET(生产必配)

会话 token 与 OAuth `oauth_state` 的 HMAC 签名密钥经 `sessionSigningSecret` 统一取自 `SESSION_SECRET`(scan #4)。**生产(NODE_ENV=production)必须显式设置**(≥32 字符强随机);非生产未设置 → boot 随机(重启失效,单实例可用);生产未设置 → 服务端拒绝签名(`createSession` / oauth_state 签发抛错),杜绝公开常量回退。配置见 `server/docs/environment-variables.md`。

## HTTP 安全头与可信代理

Next 全局响应带 CSP、Referrer-Policy、Permissions-Policy、`Cross-Origin-Opener-Policy: same-origin`、`X-Content-Type-Options: nosniff` 与反嵌入头;生产另加 HSTS。CSP 显式放行三家地图 JS 来源,图片和连接保留 `https:` 以兼容各地图瓦片/CDN;若收紧导致地图资源阻断,先在浏览器 Network 检查被 CSP 拦截的具体来源。反代部署还必须按 `TRUSTED_PROXY_IPS` 文档清洗并声明转发头来源,auth/agent 限流才信任客户端 IP。
