# Batch Manifest — 20260820-boss-rail-prefetch

## 目标

修复 bug:**第一次点击侧控栏中任何会弹出二级卡片的 item(如 Profile / Saved / Recent / Layers)时,整个网页刷新一次**;期望:初次加载后点击不刷新,直接弹出卡片。

## 根因(Explore 已确认,双代理交叉验证)

- 应用代码**零刷新路径**:全 `server/src` 无 `router.refresh` / `window.location` / form / history API(两个 Explore 代理全量 grep 确认)。
- 真凶 = **dev 模式(Turbopack)下 `next/dynamic` 懒加载 chunk 的按需编译**:
  - 8 个面板(map-shell.tsx:48-55:`POIDetailView / JdPanel / AuthModal / ProfilePanel / RecentPanel / SavedList / SavedPanel / LayersPanel`)全部 `dynamic(() => import(...))`,无 `ssr:false`、无 loading 兜底。
  - 冷启动 dev 服务器上,首次点击触发 chunk 按需编译;Next dev 客户端 `node_modules/next/dist/client/dev/hot-reloader/app/hot-reloader-app.js`(performFullReload → `window.location.reload()`,约 L110-120 / L312 / L359-363)在编译完成后整页刷新。
  - 编译完成后 chunk 进缓存,后续点击秒开 → 与「首点刷新、之后正常」完全吻合。
- 偶发性解释:map-shell.tsx:57-67 `prefetchRail(panel)` 在 rail 按钮 `onMouseEnter`/`onFocus` 时 `void import(...)` 预载 —— 先悬停/聚焦再点就不刷新。
- 热机实测:已热机 dev server(端口 3001)上 Playwright 首点无刷新(navigation.type 恒为 'navigate',JS 上下文未重建);生产构建预编译不受影响。
- 历史先例:`7b8c600 fix(map): work 全量加载修复首点刷新/聚合计数漂移` —— 同一思路(挂载时全量加载,消灭冷路径)。

## 修复方案

MapShell **挂载时一次性预载全部 rail 面板 chunk**(复用/扩展 `prefetchRail` 的模块清单),把「首点才编译」变成「页面加载时编译」,首点不再触发按需编译 → 不刷新。保留悬停预取作兜底。单文件改动,不改任何视觉/交互语义。

## workstream 表

| ws | 分支 | worktree | 主题 | 拥有 | 不碰 |
|---|---|---|---|---|---|
| w1 | fix/rail-first-click-refresh | /Users/acccan/dm-wt-w1 | MapShell 挂载时预载全部 rail 面板 chunk | server/src/components/map-shell.tsx(+ 如需独立 lib 可新增) | 其他一切文件;不改 dynamic 声明语义、不改 UI 设计/交互、不加 ssr:false |

## 合并顺序

1. w1(唯一 WS,直接合并)

## 门禁(每分支)

- `cd server && npm test`(基线 486 pass / 2 skip)
- `cd server && npm run typecheck`
- `make docs-check`
- `git diff --check`

## 验证(行为)

- boss VERIFY 阶段:Playwright 冷启动 dev server 首点 rail item,确认无整页刷新(performance navigation type 不变、JS 上下文不重建)。
