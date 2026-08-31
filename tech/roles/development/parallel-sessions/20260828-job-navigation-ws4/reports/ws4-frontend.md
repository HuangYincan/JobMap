# ws4-frontend 汇报(2026-08-28)

## 实际改动

- `server/src/lib/map-engine/types.ts` + amap/tencent/baidu `createPolyline` → 三引擎折线契约；非法/过短路径不挂图；百度 gcj02→bd09 与 marker 同套；estimate 用虚线。
- `server/src/lib/map-engine/polyline.ts` + engine mocks → 路径规范化与测试替身。
- `server/src/lib/agent-map-bridge.ts` → `drawRoute(path, opts) => cleanup`；业务不直连厂商 Polyline。
- `server/src/lib/navigation/route-client.ts` → 同会话 `GET /api/navigation/routes/:routeId`（`credentials: 'include'`）；geometry 不回写动作/SSE/日志。
- `server/src/components/agent-map-executor.ts` → 合法 `showRoute` 不再 no-op：ready → GET → 200 画实线入 undo；410/403/404/5xx 不画线；`onRouteLoading` 驱动来源条。
- `server/src/lib/commute-filter.ts` / `commute-compare.ts` → 客户端直线粗筛（strict/near/closest）；对比列无 `score`；不对每个 POI POST plan。
- `server/src/components/route-overlay-bar.tsx` → 地图底部霜面来源条（`z-index: 6`，不挡 `mapControls` z-index 10）；缺起点/拒绝/加载/估算/过期/离线/岗位下线均有文案。
- `server/src/components/commute-chrome.tsx` / `commute-compare-table.tsx` → Work 通勤头与列式事实表。
- `server/src/components/poi-card.tsx` / `poi-list.tsx` / `secondary-sidebar.tsx` → 估算分钟徽章 + 对比勾选；Saved 两家公司对比语义未改。
- `server/src/components/agent-panel.tsx` / `agent-ball.tsx` → 卡片「看路线」+ 摘要 hint；overlay 错误码不升格为致命聊天错误。
- `server/src/lib/i18n.ts` → 通勤/来源条/页签中英键。
- `server/src/components/map-shell.tsx` → Work Explore 用粗筛列表；地图 marker 池仍为 `runPOIPipeline` 的 `pois`；选中岗位虚线估算；桌面来源条 `shifted={exploreOpen}`；移动 Explore 内页签岗位|对比|行程（工具栏仍 5 项）。
- 文档：`tech/31` §8 已于 2026-08-28 批准、WS4/M3 本分支已实现（生产 estimate-only）；`tech/01` / `07` / `24` / ADR-008 / `CHANGELOG.md` 同步。

## 不变量

- estimate 不伪装道路：无 `routeId`、不 GET showRoute、虚线 +「直线估算，无路况」。
- 无 N+1 `POST /api/navigation/routes/plan`；未知 commute key 不写入 `/api/pois`。
- 来源条可见，不能只藏 tooltip。
- 移动不是第 6 个工具栏按钮；AI 仍开既有 agent sheet。
- 不写 `audit_events`；不碰 live provider / db / `.env*`。

## 门禁结果

- npm test: 1835 通过 / 0 失败 / 3 skip（`npm test -- --test-concurrency=1`）
- typecheck / docs-check / git diff --check: 通过

## 遇到的问题

- 生产 `providers: []`，正常规划仍为 estimate；实线 overlay 仅在同会话未过期 provider artifact 存在时出现。
- Playwright 截图按 prompt 由合并后补；本 WS 用源码契约 + 单测覆盖布局。
- `secondary-sidebar.tsx` / `agent-ball.tsx` 仅做 props 透传，未改 Saved 对比或 Agent 球信息架构。

## 证据

- 定向：`map-engine-{amap,tencent,baidu}`、`agent-map-executor`、`commute-filter`、`component-contracts` ws4 条、`i18n` ws4 条均绿。
- 全量：1832 pass / 3 skip。
- 分支 tip `ebd8bbe`（未 merge、未 push）。

## commits

- `648c2b1` feat(ws4-frontend): add MapView.createPolyline across three engines
- `736debe` feat(ws4-frontend): draw showRoute from session artifact GET
- `c836614` feat(ws4-frontend): add commute filter, overlay bar, and compare table
- `a5857e7` feat(ws4-frontend): show commute badges and 看路线 without geometry in the card
- `d22f173` feat(ws4-frontend): wire Work commute chrome, source bar, and mobile trip tabs
- `104b84a` test(ws4-frontend): cover overlay contracts, commute i18n, and showRoute loading
- `ebd8bbe` docs(ws4-frontend): record approved §8 layout and estimate-only overlay

门禁: PASSED
结论: OK
