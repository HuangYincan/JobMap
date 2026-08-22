# Environment Variables Reference

## Overview

Domain Map uses environment variables for configuration. Variables prefixed with `NEXT_PUBLIC_` are exposed to the browser and must be **client-safe** (no secrets).

## Required Variables

### Map Engine (AMap)

```bash
# AMap JavaScript API Key
# Get from: https://lbs.amap.com/
# Scope: Client-side map rendering (read-only)
# Security: Configure domain restrictions in AMap console
NEXT_PUBLIC_AMAP_KEY=your_amap_key_here

# AMap Security Code (防止盗用)
# Get from: AMap console > Application Security Settings
# Purpose: Prevents unauthorized domain usage
NEXT_PUBLIC_AMAP_SECURITY_CODE=your_security_code_here
```

**Security Notes:**
- These keys are visible in browser JavaScript
- Configure domain restrictions in AMap console:
  - Development: `localhost:3000`
  - Production: Your actual domain
- Keys are read-only (cannot modify data)
- Regenerate keys if exposed publicly

## Optional Variables (Phase 2+)

### Database (PostGIS)
```bash
# PostgreSQL connection string
# Format: postgresql://user:password@host:port/database
# Not used in Phase 1 (frontend only)
DATABASE_URL=postgresql://user:password@localhost:5432/domain_map

# Enable SQL query logging (development only)
DATABASE_LOG_QUERIES=false
```

### Authentication (demo + optional Postgres)
```bash
# Optional. When set, identities / sessions / OTP / search_history
# write to the 005 tables. When unset, APIs stay in process memory.
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/domain_map

# HMAC 签名密钥:会话 token(写入)与 OAuth `oauth_state`
# (2026-08-22)共用。**生产(NODE_ENV=production)必配**——≥32 字符强随机;
# 生产未设置时服务端拒绝签名(登录/OAuth start 报错),绝不会回退到
# 公开常量密钥。非生产未设置 → 进程启动时随机(boot 随机,单实例可用;
# 重启后已签发 token/state 失效)。
SESSION_SECRET=replace-me

# Sends email OTP codes via Resend (tech/25). When unset, email OTP send
# returns 503 EMAIL_NOT_CONFIGURED. Server secret: never commit or log.
RESEND_API_KEY=replace-me

# Sends phone OTP codes via Aliyun SMS Verification Service
# (SendSmsVerifyCode, dypnsapi 2017-05-25). When any of the four is unset,
# phone OTP send returns 503 SMS_NOT_CONFIGURED. Server secrets:
# never commit or log; secret key only participates in HMAC signing.
ALIYUN_ACCESS_KEY_ID=replace-me
ALIYUN_ACCESS_KEY_SECRET=replace-me
ALIYUN_SMS_SIGN_NAME=replace-me
ALIYUN_SMS_TEMPLATE_CODE=replace-me
```

Email OTP goes out for real via Resend (`RESEND_API_KEY`). Phone OTP goes
out for real via Aliyun SMS Verification Service (`ALIYUN_*` four-set,
template param `{"code": "..."}` direct-value mode) — both codes are
random 6-digit; never log codes or secrets.

### 第三方登录 (OAuth, tech/27)

Real OAuth 2.0 authorization code flow for GitHub / Google / WeChat
(`server/src/lib/oauth/`, routes under `/api/auth/oauth/*`). All three
providers are optional — when unconfigured the frontend falls back to demo
login (`POST /api/auth/oauth` stub, unchanged). Configured = both variables
of the pair non-empty (trimmed).

```bash
# GitHub OAuth App (github.com → Settings → Developer settings → OAuth Apps)
GITHUB_OAUTH_CLIENT_ID=replace-me
GITHUB_OAUTH_CLIENT_SECRET=replace-me

# Google Cloud OAuth Client — Application type: Web application
# (console.cloud.google.com → Credentials → OAuth client ID; configure the
# OAuth consent screen first, User type can be External)
GOOGLE_OAUTH_CLIENT_ID=replace-me
GOOGLE_OAUTH_CLIENT_SECRET=replace-me

# WeChat Open Platform website app (open.weixin.qq.com) — requires an
# ICP-registered domain (localhost does NOT work); approved apps only
WECHAT_OAUTH_APP_ID=replace-me
WECHAT_OAUTH_SECRET=replace-me
```

Callback URLs registered in each provider console must match
`<origin>/api/auth/oauth/callback/<provider>` exactly. Manual config
checklist with click-by-click steps: `tech/27-oauth-login.md` §3. All six
variables are **server secrets: never commit or log**.

### API Configuration
```bash
# API base URL (for frontend to call backend)
# Default: Same origin in production
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api

# Rate limiting (requests per minute)
API_RATE_LIMIT=60

# Maximum query results per request
API_MAX_PAGE_SIZE=100
```

### Feature Flags (Phase 3+)
```bash
# Enable experimental features
NEXT_PUBLIC_FEATURE_SAVED_MAPS=false
NEXT_PUBLIC_FEATURE_SEARCH=false
NEXT_PUBLIC_FEATURE_AI_ASSISTANT=false
```

## Geocode 兜底链(REST,服务端秘密)

geocode 工具链(`server/src/lib/site-geocode.ts` + `server/scripts/geocode-sites-apply.mjs`)
按**固定链顺序** `AMap → 百度 → 腾讯` 依次尝试三家 REST provider,脚本 REPORT
会输出 `PROVIDERS …` 行(由 `getGeocodeProviders()` 注册表生成)展示当前配置。

```bash
# 高德 Web 服务 key —— 链首。
# 申请:https://console.amap.com/dev/key/app(创建「Web服务」类型 key)
AMAP_WEB_KEY=your_amap_web_key_here

# 百度 Web 服务 key —— 第二级兜底(高德配额耗尽或缺 key 时启用)。
# 申请:https://lbs.baidu.com/apiconsole/key(服务端 AK,无需 referer 白名单)
BAIDU_MAP_AK=your_baidu_ak_here

# 腾讯 WebService key —— 第三级兜底(百度也失败时启用)。
# 申请:https://lbs.qq.com 控制台创建 WebService key(可选 IP 白名单;
# status 110 时核对白名单)
TENCENT_MAP_KEY=your_tencent_key_here
```

**语义:**

- **无 key 自动跳过**:某家未配置时,链直接跳到下一家,不影响其他家。
- **配额耗尽切换**:AMap 返回 `status="0"` + `infocode 10044`(日配额超限)/`10043`
  视为耗尽 → 切百度;百度 `status 302`(日配额超限)视为耗尽 → 切腾讯;
  腾讯 `status 121`(每日调用量上限)/`321`/`322` 视为耗尽。
- 三家均不可用(全缺 key 或配额耗尽)时,脚本短路停止并打印 `QUOTA_EXHAUSTED`
  报告,已写入结果保留,重跑幂等。
- 以上三个 key 均为**服务端秘密**:永不打印、永不提交
  (详见 `server/.env.example` 对应注释)。

## 前端地图引擎 key(NEXT_PUBLIC_*,公开)

前端可选用腾讯/百度地图 JS API 渲染地图(与高德并存)。`NEXT_PUBLIC_*` 变量
会**内联进浏览器构建产物**,是公开 key:只用于前端加载地图,不能用于服务端
REST 调用;生产环境切换 key 必须**重新构建**部署,仅改环境变量不生效。

```bash
# 腾讯位置服务 JS API GL key。
# 申请:https://lbs.qq.com 控制台新建 key,产品勾选「JS API GL」。
NEXT_PUBLIC_TENCENT_JSAPI_KEY=your_tencent_jsapi_key_here

# 百度地图 JS API AK —— 必须与控制台「浏览器端」类型 AK 对应。
# ⚠️ 与服务端 BAIDU_MAP_AK 严格区分:百度按应用类型隔离(服务端/浏览器端),
# 服务端 key 调 JSAPI 会被拒(弹窗「APP服务被禁用了」),不可复用。
# 申请:https://lbs.baidu.com 控制台新建「浏览器端」应用;JSAPI 需配置
# referer 白名单(开发 localhost:3000,生产填真实域名)。
NEXT_PUBLIC_BAIDU_AK=your_baidu_jsapi_ak_here
```

**安全注意:** 这两个 key 浏览器可见,务必在控制台配好域名/referer 白名单;
不要当作服务端秘密使用(服务端 REST 调用请用上文三个 Web 服务 key)。

## Development Setup

### 1. Create Local Environment File

```bash
# Copy example file
cp .env.example .env.local

# Edit with your values
nano .env.local
```

### 2. Obtain AMap Credentials

1. Visit [AMap Open Platform](https://lbs.amap.com/)
2. Register/login
3. Create new application → JavaScript API
4. Configure domain restrictions:
   - Development: `localhost:3000`
   - Add more as needed
5. Copy Key and Security Code to `.env.local`

### 3. Verify Configuration

```bash
# Start dev server
npm run dev

# Check browser console
# Should see map loading (if keys correct)
# Or "NEXT_PUBLIC_AMAP_KEY required" warning (if missing)
```

## Production Deployment

### Environment Variable Checklist

- [ ] `NEXT_PUBLIC_AMAP_KEY` - Domain restricted to production URL
- [ ] `NEXT_PUBLIC_AMAP_SECURITY_CODE` - Matches key
- [ ] `DATABASE_URL` - Production PostgreSQL connection
- [ ] `SESSION_SECRET` - Strong random secret (32+ characters); **production 必配**(未设时服务端拒绝签名)
- [ ] `NODE_ENV=production` - Set automatically by hosting platform

### Security Best Practices

1. **Never commit `.env.local` to git** (already in `.gitignore`)
2. **Use different keys for dev/staging/prod**
3. **Rotate secrets regularly** (every 90 days)
4. **Restrict database access** by IP whitelist
5. **Use managed secrets** on hosting platform (Vercel Env Vars, Railway, etc.)

## Hosting Platform Configuration

### Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Set environment variables
vercel env add NEXT_PUBLIC_AMAP_KEY production
vercel env add NEXT_PUBLIC_AMAP_SECURITY_CODE production
vercel env add DATABASE_URL production

# Deploy
vercel --prod
```

### Railway

```bash
# Add variables in Railway dashboard
# Or via CLI
railway variables set NEXT_PUBLIC_AMAP_KEY=your_key
railway variables set DATABASE_URL=postgresql://...
```

### Docker

```bash
# Pass via docker run
docker run -e NEXT_PUBLIC_AMAP_KEY=your_key \
           -e DATABASE_URL=postgresql://... \
           domain-map:latest

# Or use .env file
docker run --env-file .env.production domain-map:latest
```

## Troubleshooting

### Map Not Loading

**Symptom:** Blank screen or "Loading map..." forever

**Check:**
1. Browser console for error messages
2. Environment variables are set: `console.log(process.env.NEXT_PUBLIC_AMAP_KEY)`
3. Key is active in AMap console
4. Domain is whitelisted in AMap console
5. Security code matches key

**Fix:**
```bash
# Restart dev server after changing .env.local
# Next.js doesn't hot-reload environment variables
npm run dev
```

### Wrong Environment Variables Loaded

**Symptom:** Production getting development values

**Cause:** Multiple `.env*` files with conflicting values

**Precedence (highest to lowest):**
1. `.env.local` (ignored by git, use for secrets)
2. `.env.production` (committed, production defaults)
3. `.env.development` (committed, development defaults)
4. `.env` (committed, shared defaults)

**Fix:**
```bash
# Remove conflicting files
rm .env.production.local  # Usually not needed

# Verify loaded values
npm run dev -- --debug
# Check startup logs for loaded environment
```

### Environment Variables Not Updating

**Symptom:** Changed `.env.local` but app still uses old values

**Cause:** Next.js caches environment variables at build time

**Fix:**
```bash
# For NEXT_PUBLIC_* variables (client-side)
# Must restart dev server
npm run dev

# For server-only variables
# Must rebuild
npm run build
npm run start
```

## Reference

### Next.js Environment Variables
- [Official Docs](https://nextjs.org/docs/basic-features/environment-variables)
- `NEXT_PUBLIC_*` exposed to browser
- Server-only variables without prefix
- `.env.local` for secrets (gitignored)

### Variable Naming Conventions
- `NEXT_PUBLIC_*` - Client-safe, visible in browser
- `*_URL` - Connection strings, endpoints
- `*_SECRET` - Sensitive keys, passwords
- `*_KEY` / `*_ID` - API credentials
- `FEATURE_*` - Feature flags
- `ENABLE_*` - Boolean toggles

---

**Last Updated:** 2026-08-22
**Phase:** 2 (Multi-mode: Domain + Work)
