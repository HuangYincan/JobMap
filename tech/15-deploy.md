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

Account routes then write sessions / Recent / Saved / applications / queued notifications. After `npm run import:seed:apply`, public list APIs and the Work map read imported rows via `loadServerCatalog`. Public Work reads are strict DB-only: without a database (or on DB failure) they return HTTP 502 — there is no offline seed fallback and no cached empty list (seed examples are archived under `tech/backup/seed-data`). Live `EXPLAIN` notes are in `tech/13-db-query-notes.md`.

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

Next 按路由发送 CSP、Referrer-Policy、Permissions-Policy、`Cross-Origin-Opener-Policy: same-origin`、`X-Content-Type-Options: nosniff` 与反嵌入头;生产另加 HSTS。CSP 的路由范围和残余放宽项如下:

- `/` 是当前唯一挂载 `MapShell` 的页面(账号与 Agent 是该页面内的 overlay),使用地图策略: `script-src`/`style-src` 明确允许 `https://*.amap.com`、`https://*.map.baidu.com`、`http://*.map.baidu.com`、`https://*.bdimg.com`、`http://*.bdimg.com`、`https://map.qq.com`、`https://*.map.qq.com`;地图脚本的 `'unsafe-inline'` 和样式的 `'unsafe-inline'` 只在 `/` 保留。BMapGL v1.0 在 `http://localhost` 按 `location.protocol` 拉 `http://api.map.baidu.com/getmodules` 与 `http://*.bdimg.com` 样式脚本;只放行 https 时 getscript 能进、GL 渲染器被 CSP 拦,底图有壳无 canvas。`http:` 例外在 https 部署上会被浏览器 mixed-content 拦,不扩大生产明文脚本面。
- 非根路径(配置中的 `/:path+`,包括 `/api/*` 与未来独立账号页面)使用严格策略: `script-src 'self'`、`style-src 'self'`,不含任一 `'unsafe-*'`。因此不会把地图兼容性例外扩散到 API 或非地图页面。
- `/` 的 `img-src` 与 `connect-src` 仍保留 `https:`。这是有意的兼容性边界:当前 AMap 瓦片/CDN 主机随区域变化,工作地图还会显示外部公司 logo/岗位照片,而腾讯/百度适配器保留可切换实现;贸然改为少数主机会造成地图或卡片资源静默失败。这两个宽泛来源只存在于地图路由。
- `'unsafe-eval'` 与 `'wasm-unsafe-eval'` 只在 `/` 的 `script-src` 放行(AMap JSAPI 2.0 / BMapGL 用 eval 实例化 WebGL 模块;生产去掉后底图空白,`U.Module.WebGLRender is not a constructor`)。非地图路由的 `STRICT_CSP` 不含任一 `'unsafe-*'`。

当前架构没有把每个动态地图 `<script>`/`<style>` 注入点统一接入 nonce,也没有稳定的 hash 清单;因此没有做表面上的 nonce/hash 改造。上述 route-specific 收紧是真实生效的增量,但地图根路由仍有 `'unsafe-inline'` 与受限 host 列表外的 HTTPS 图片/连接风险。若将账号/Agent 移到独立页面,应继续使用严格策略并单独验证其资源需求;若要进一步收紧 `/`,先以浏览器 Network/CSP violation 证据建立完整瓦片/CDN 与动态样式清单,再落地 nonce/hash 或更窄 host allowlist。反代部署还必须按 `TRUSTED_PROXY_IPS` 文档清洗并声明转发头来源,auth/agent 限流才信任客户端 IP。
