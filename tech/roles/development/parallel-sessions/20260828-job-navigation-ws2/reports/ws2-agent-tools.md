# ws2-agent-tools 汇报(2026-08-28)

## 实际改动

- `server/src/lib/agent/types.ts` → `AgentTool.provider` 增加 `work` / `navigation`；`AgentContext.navigationSession.fingerprint`（SHA-256 hex）；`AgentAction` 增加 `showRoute{routeId}`。
- `server/src/lib/agent/action-schema.ts` → `showRoute` 只接受 `OPAQUE_ROUTE_ID_PATTERN`；拒绝 geometry / polyline / provider raw；不查 artifact store。
- `server/src/lib/agent/prompts.ts` → 求职导航纪律（中英）；动作契约 6→7 种，注明 `showRoute` 仅 `routeId`。
- `server/src/lib/agent/run-agent.ts` → `work__*` → `project`；`navigation__*` → `directions`；透传 `navigationSession`。
- `server/src/lib/agent/tools/work.ts`（新建）→ `work__searchPositions` / `work__getPositionDetail`，工厂可注入 catalog；复用 public search / filterPositions / alive；详情无全文 JD。
- `server/src/lib/recruitment-store.ts` → 薄查询 `loadWorkPositionByExternalIdFromDb`（open + deadline-alive，不选 description）。
- `server/src/lib/navigation/compare.ts`（新建）+ `index.ts` 最小导出 → 通勤矩阵与分钟过滤，无总分。
- `server/src/lib/agent/tools/navigation.ts`（新建）→ `planRoute` / `compareCommutes` / `filterByCommute`；无 fingerprint 或 missing origin/destination 不打 provider。
- `server/src/app/api/agent/chat/route.ts` → 前置校验后 mint/复用 `dm_navigation_session`；指纹进 ctx；注入 `workTools()` + `navigationTools()`；cookie 原文不进 SSE。
- `server/src/components/agent-map-executor.ts` → 合法 `showRoute` 接受；execute/流式 **no-op**（不画 overlay、不入 undo、不改相机）；流式可 `onAction`。
- `server/src/components/agent-panel.tsx` → `actionLabel` 增加 `showRoute` 文案；未改布局/CSS。
- 测试：`navigation-agent-tools.test.mjs` 及 `agent-types` / `agent-prompts` / `agent-tools` / `agent-route-contract` / `agent-runner` / `agent-map-executor`。
- 文档：`tech/24-agent-feature.md`、`tech/31-job-navigation-agent-plan.md`、`tech/01-architecture.md`、`tech/14-api-contract.md`、`CHANGELOG.md`。

## 关键不变量

- 工具文本无 geometry 数组、cookie、密钥；仅 `provider_route` 摘要可带 `routeId`。
- 生产 `RouteService` 仍零 live provider，正常结果为显式 `estimate`。
- `showRoute` 客户端暂不绘制。
- 严格通勤 0 命中不得伪装成命中；比较无推荐总分。
- chat 校验行号仍先于 `getMcpProvider` / `runAgent`。

## 门禁结果

- npm test: 1810 通过 / 0 失败 / 3 skip（2026-08-28，本 worktree）
- typecheck / docs-check / git diff --check: 通过

## 遇到的问题

- 无阻塞。`showRoute` 在 executor 中提前 return，switch 内不再列该 case（否则 TS 收窄后不可比）。

## 证据

- 专项：`tests/navigation-agent-tools.test.mjs` 覆盖五工具注册、注入 catalog search/detail、无 session/缺起点不打 provider、estimate 无 routeId、fake provider 签发 routeId 且文本无 geometry、compare 部分失败、filter Top-K 预算、三主场景后端链。
- 全量：`cd server && npm test` → 1807 pass / 3 skip。
- 分支 tip：`0238b79`（`feature/job-navigation-ws2-agent-tools`）。
- commits：`c15b172` → `735cb91` → `f5abff7` → `4bfbcda` → `0238b79`。

## 剩余风险

- 生产仍为 estimate-only，无真实道路/路况/arrival-by。
- `showRoute` 未绘制 overlay（待 WS4 布局批准）。
- 详情生产路径依赖 DB；测试走注入 catalog，无 DATABASE_URL。

## 范围核对

- 只改「拥有」文件 + 对应测试与所列文档；未 merge/push；未碰 overlay 新组件、CSS、map-engine、commute.ts、db/、crawler、.env、live adapter、eval fixture 40 条。

门禁: PASSED
结论: OK
