# Domain Map Frontend

**Status:** Phase 2–4 + 全国 work 模式已合入 `dev`(2026-08-21 起,真实招聘 catalog + Postgres + auth);地图引擎打磨系列 2026-08-22/23 持续合入。当前状态以仓库根 [README](../README.md) 与 `tech/` 为准,本文件只保留本目录可操作信息与历史快照。
**Framework:** Next.js 16.3.1 (App Router) + React 19.2.8 + TypeScript 5.9 (以 `package.json` 为准)
**Map Engine:** 三引擎插件契约 —— AMap / 腾讯 TMap / 百度 BMapGL(图层面板「地图源」切换,偏好存 localStorage;架构见仓库根 `tech/23-map-engines.md`)

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your AMap credentials

# Run development server
npm run dev

# Open browser
open http://localhost:3000
```

## Environment Variables

Required for map functionality:

```bash
# .env.local
NEXT_PUBLIC_AMAP_KEY=your_amap_key_here
NEXT_PUBLIC_AMAP_SECURITY_CODE=your_security_code_here
```

**Note:** These are `NEXT_PUBLIC_*` variables, meaning they are exposed to the browser. Only use client-safe API keys with domain restrictions configured in AMap console. 三引擎各自的 key(s) 见 [docs/environment-variables.md](docs/environment-variables.md)(AMap / `TENCENT_MAP_KEY` / `BAIDU_MAP_AK`;引擎 `isConfigured` 判定按引擎实现)。

### Obtaining AMap Credentials

1. Register at [AMap Open Platform](https://lbs.amap.com/)
2. Create a JavaScript API application
3. Configure allowed domains (localhost for development)
4. Copy Key and Security Code to `.env.local`

### Fallback Behavior

挂载路径按 `mount.ts` 语义:偏好引擎(会话/本地存储)加载失败后按 `ENGINE_PRIORITY` 序回退其余**已配置**引擎,全部失败(或一个引擎都没配置)→ 抛错并回退 CSS-only fallback 地图占位。Shell UI 无 live 地图时仍可用于开发/测试。

## Project Structure

```
server/
├── src/
│   ├── app/                 # App Router + /api/*
│   ├── components/          # MapShell, Explore, detail, JD, Profile, Layers
│   └── lib/                 # search, modes, account-store, server-catalog
├── tests/                   # node:test — cd server && npm test
├── package.json
└── README.md
```

Never print or commit `.env` / `.env.local`.

## Test

```bash
./node_modules/.bin/tsc --noEmit
node --test tests/*.test.mjs
```

Do not run `npx tsc` from the repo root.

## Features

### Desktop UI
- Collapsed-first rail (58px). Search is a ghost 42px icon; typing opens Explore.
- Modes: Map + Work. Intern / campus / social are work filters.
- L2 frost cards: Explore, Profile, Recent, Saved, Layers. L3 JD docks in the same flex cluster.
- Liquid glass on POI / job cards only. Panel chrome stays `--soft-strong`.
- UI chrome is always `#007AFF`. Green is salary / hours / Sign in / Update Profile.

### Mobile UI
- ≤767px hides the rail and desktop L2/L3. The frost drawer owns search, list, detail, and JD.
- **Touch Optimized:** Larger tap targets, mobile-first layout

### Map Controls
- **Zoom:** +/- buttons with level indicator
- **Compass:** Reset to north (300ms smooth animation), needle rotates with map
- **Locate:** Return to user GPS position with accuracy circle
- **Map Style:** Switch between Standard/Satellite/Dark
- **3D Control:** Middle-button drag for rotation (X-axis) and pitch (Y-axis)
- **Scale:** Auto-repositioning (desktop bottom-left, mobile top-left)

### Interaction Details

#### Middle Button 3D Control
- **Press middle mouse button** and drag to rotate/pitch the map
- **X-axis (left/right):** Rotation 0-360°, sensitivity 0.13
- **Y-axis (up/down):** Pitch 0-83°, sensitivity 0.15
- **Cursor:** Changes to grab/grabbing during interaction

#### Sidebar Animation
- **Timing:** 350ms cubic-bezier(0.32, 0.72, 0, 1) for smooth ease-out
- **Choreography:** Collapse → text fades out (200ms), then width shrinks; Expand → width grows, then text fades in (250ms, 100ms delay)
- **Tooltips:** Appear on hover when sidebar collapsed

#### Geolocation
- **Automatic:** Tries to get user location on initial load
- **Accuracy Circle:** Shows GPS accuracy radius (minimum 30m)
- **Zoom Adaptation:** Circle visible at zoom ≥15, dot icon at lower zoom
- **Permission Handling:** Gracefully falls back to default center if denied

## Development

### Commands

```bash
npm run dev          # Start dev server (port 3000)
npm run build        # Production build
npm run start        # Run production server
npm run typecheck    # Run TypeScript compiler check
npm test             # node:test 全量(1517 tests / 1515 pass / 2 skip,2026-08-23)
```

`package.json` 没有 `lint` script(项目无 ESLint 配置);写 DB 的数据命令(`import:seed:apply` / `geocode:sites:apply` / `audit:pins` / `import:hz:pois:apply`)见根 README,属 Env-only 用户步骤。

### Code Style

- **TypeScript:** Strict mode enabled
- **React:** Server/Client components (use `"use client"` directive)
- **CSS:** CSS Modules for component styles
- **Formatting:** Consistent 2-space indentation
- **Naming:** PascalCase components, camelCase variables/functions

### Browser Support

- **Primary:** Modern evergreen browsers (Chrome, Safari, Firefox, Edge)
- **Tested:** macOS Safari, macOS Chrome
- **Mobile:** Responsive layout tested in DevTools, real device testing pending

## Internationalization

The app supports English and Chinese. Language detection is automatic via `navigator.language`.

```typescript
import { t } from '@/lib/i18n';

// Usage
t('search', 'en')     // → "Search"
t('search', 'zh')     // → "搜索"
```

See `docs/i18n.md` for full documentation.

## Architecture

### Map Engine Plugin Contract

前端通过统一引擎插件契约支持多地图引擎(`src/lib/map-engine/`):

- 契约定义于 `src/lib/map-engine/types.ts`:每引擎实现 `MapEngine`(生命周期 `isConfigured` / `load` / `isLoaded` / `createView` + `searchPOI` 检索能力)与 `MapView`(相机 / 样式 / 事件 / overlay / scale 控件)。
- 已实现:`amap/`(高德)、`tencent/`(腾讯 TMap)、`baidu/`(百度 BMapGL);`engine-registry.ts` 注册与优先级,`engine-preference.ts` 存本地偏好,`switch.ts` 交互式切换回滚,`mount.ts` 挂载回退。
- 用户在图层面板「地图源」section 切换引擎;`use-map-engine` 把活跃引擎的 `searchPOI` 注入 `poi-service`(域外 POI 检索随之切换,未注入时回落 amap-api)。架构详见仓库根 `tech/23-map-engines.md`。

### Data Flow

```
POST /api/search (work) / GET /api/pois (domain) / GET /api/pois/domain-local (hz_pois)
    ↓
lib (server-catalog / recruitment-store / hz-poi-store — Postgres first, offline drops fallback)
    ↓
Client Components (map-shell.tsx)
    ↓
Map Engine (契约层:AMap / 腾讯 TMap / 百度 BMapGL)
```

Work mode reads **Postgres first** (imported SQL rows via `loadServerCatalog`, 30s public cache), falling back to offline drops when the DB is absent. Domain mode: in-Hangzhou browse uses the local `hz_pois` table (`/api/pois/domain-local`); outside Hangzhou (或本地 0 命中) the **活跃引擎**的 `searchPOI` 承接检索(`poi-service` 经 `use-map-engine` 注入的 search provider;SSR/测试/零配置回落 amap-api,行为与迁移前一致)。The frontend no longer uses a hardcoded `places` array for live data.

### Plugin Readiness

The frontend establishes foundations for plugin architecture but is not yet fully modular. Phase 2+ will extract:
- Map controls as plugins
- Map layers as plugins
- Navigation items as plugin-contributed
- Event bus for plugin communication

## Styling

### Design System

```css
/* globals.css - CSS custom properties */
--soft: rgba(255, 255, 255, 0.58);      /* Glassmorphism background */
--line: rgba(0, 0, 0, 0.08);            /* Border color */
--ink: rgb(31, 41, 55);                 /* Primary text */
--muted: rgb(107, 114, 128);            /* Secondary text */
--blue: rgb(0, 122, 255);               /* Accent color */
--shadow: 0 2px 8px rgba(0, 0, 0, 0.08); /* Elevation shadow */
```

### Dark Mode

Automatic switching via `prefers-color-scheme: dark`:
- Map style switches to "whitesmoke" (dark theme)
- Button backgrounds adjust to `rgba(28, 28, 30, 0.72)`
- System-level preference, no manual toggle

### Responsive Breakpoint

```css
@media (max-width: 767px) {
  /* Mobile styles */
}
```

Desktop-first for main shell, mobile-optimized for drawer and controls.

## Known Limitations

1. **No offline support:** Requires network for map tiles
2. **Job alerts are queue-only:** email/SMS toggles enqueue inbox rows; nothing is actually sent (real send still deferred)
3. **No error boundary:** Map initialization errors are not caught at a React boundary; engine mount failures now surface a retry overlay (`mountError` / `retryMount` 状态机,2026-08-22),其他初始化错误仍可能白屏
4. **Accessibility:** ARIA labels present, screen reader testing pending (VoiceOver/NVDA manual tests deferred)
5. **DB write-path degradation (设计决策):** 写路径遇 DB 故障直接抛 `DbUnavailableError`,由 route 层转 503 `DB_UNAVAILABLE`——绝不静默回落内存(防内存/DB 数据分裂);读路径保持 offline drops 回退

## Testing

### Manual Testing Checklist

- [ ] Map loads with AMap tiles
- [ ] Geolocation prompts and centers on user
- [ ] Zoom in/out buttons work
- [ ] Compass resets to north smoothly
- [ ] Locate button returns to user position
- [ ] Map style picker switches themes
- [ ] Middle-button drag rotates and pitches
- [ ] Sidebar expands/collapses smoothly
- [ ] Tooltips appear on collapsed sidebar
- [ ] Mobile drawer switches states
- [ ] Dark mode switches automatically

### Automated Tests

```bash
npm test        # 1517 tests / 1515 pass / 0 fail / 2 skip (2026-08-23, npm test 实测)
npm run typecheck
```

Tests live in `server/tests/` (`node --test`, unit + component contracts + API integration with the same pipeline as `/api/search`). 2 skips are the DB-gated tests. Playwright E2E is not implemented yet (deferred).

## Troubleshooting

### Map Not Loading

**Issue:** Blank screen or "Loading map..." message  
**Check:**
1. `NEXT_PUBLIC_AMAP_KEY` and `NEXT_PUBLIC_AMAP_SECURITY_CODE` set in `.env.local`
2. AMap console shows key is active and domain is allowed
3. Browser console for script loading errors
4. Network tab for blocked requests (CORS/CSP)

### Geolocation Not Working

**Issue:** Map doesn't center on user location  
**Check:**
1. Browser permissions (click lock icon in address bar)
2. HTTPS required for geolocation (localhost exception exists)
3. Console for permission denied errors
4. Falls back to default center (120.15, 30.27) if permission denied

### Animations Jerky

**Issue:** Sidebar collapse/expand looks choppy  
**Check:**
1. Browser dev tools "Performance" tab
2. Hardware acceleration enabled
3. Too many other processes running
4. Try a different browser (Safari usually smoothest)

### Dark Mode Not Switching

**Issue:** Map stays light when system is dark  
**Check:**
1. System preferences > Appearance > Dark
2. Hard refresh browser (Cmd+Shift+R)
3. Check console for errors in theme listener

## Account & API Integration

Live account flows run against Postgres when `DATABASE_URL` is set (cookie session; guests get 401, never a fabricated list):

1. **Auth:** phone/email OTP 真发 —— phone 经阿里云短信认证服务、email 经 Resend(未配置 → 503 `SMS_NOT_CONFIGURED` / `EMAIL_NOT_CONFIGURED`;demo `000000` stub 已删)+ password accounts (`/api/auth/password/register|login`, scrypt-hashed, migration 014);OAuth 登录(github / google / wechat,authorization code flow)见 `tech/27-oauth-login.md`
2. **Persistence:** search history, saved places, applications, job-alert queue (`/api/me/*`); saved/compare are catalog-recruitment only (domain snapshots → 400 `NOT_PERSISTABLE`); guest Recent is browser-localStorage
3. **Public reads:** `/api/pois`, `/api/search`, `/api/suggest` — Postgres first, offline drops fallback, 30s cache; spatial clip via `geom && ST_MakeEnvelope` + `ST_DWithin` (PostGIS)
4. **Loading states:** map-shell lazy-loads (`next/dynamic`, `ssr: false`); viewport loader debounces 800ms with per-batch epoch guards

## Contributing

See `CONTRIBUTING.md` in the repository root.

## License

See `LICENSE` in the repository root.

---

**Phase 2–4 + 全国 work 模式(merged to `dev`)** — real catalog, auth (OTP 真发 / password / OAuth), saved, applications, alerts queue;地图引擎三引擎插件契约 + 源切换(tech/23)
**Last Updated:** 2026-08-23
