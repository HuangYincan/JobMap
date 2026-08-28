# WS2 Agent Domain Tools — boss-worker prompt

## 绝对路径

- 主仓库（只读，不得修改）：`/Users/acccan/Repos/huangyincan/domain-map`
- 你的 worktree：`/Users/acccan/dm-wt-job-navigation-ws2-agent-tools`
- 你的分支：`feature/job-navigation-ws2-agent-tools`
- 批次目录：`/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260828-job-navigation-ws2`
- 最终汇报：`/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260828-job-navigation-ws2/reports/ws2-agent-tools.md`

worktree 已由 boss 预建。所有代码、测试、文档修改与 commit 只发生在 worktree；不要 merge
回 `dev`，不要 push。`git add` 只添加你实际修改的具体路径。

## 开工前必读

1. worktree 内 `CLAUDE.md`、`agent.md`、`server/AGENTS.md`
2. `tech/31-job-navigation-agent-plan.md` §4、§5.1–5.5、§6、§9 WS2
3. `tech/24-agent-feature.md` §4.2–4.3、§5、§7
4. `tech/06-decisions.md` ADR-008
5. WS0/WS1：`server/src/lib/navigation/**`、`server/src/app/api/navigation/routes/**`
6. Agent：`server/src/lib/agent/{types,action-schema,prompts,run-agent}.ts`、
   `server/src/app/api/agent/chat/route.ts`、`server/src/lib/agent/tools/*`
7. Catalog：`server/src/lib/{server-catalog,public-search,recruitment-store,position-filters,position-alive}.ts`
8. 前端仅在必须收口 `AgentAction` union 时阅读：
   `server/src/components/agent-map-executor.ts`、`server/src/components/agent-panel.tsx`
   的 `actionLabel`。写 Next handler 前读
   `server/node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`

## 目标

把求职导航变成可验证的感知–规划链：Agent 只能通过白名单域工具读真实 DB 岗位与
WS1 `RouteService` 摘要；`showRoute` 只携带服务端签发的 `routeId`；生产默认仍是
直线 `estimate`。三主场景必须能用注入 fake catalog/route 在后端跑通。

## 必须交付

### A. 契约扩展（小而闭合）

- `AgentTool.provider` 增加 `'work' | 'navigation'`。
- `AgentContext` 增加 `navigationSession?: { fingerprint: string }`（SHA-256 hex，不是 cookie）。
- `AgentAction` 增加：
  `{ type: 'showRoute'; payload: { routeId: string } }`
- 服务端 `lib/agent/action-schema.ts` 的 `validateAction`：
  - 只接受匹配 WS0 `OPAQUE_ROUTE_ID_PATTERN` 的 `routeId`（36–128）
  - 拒绝 geometry、polyline、provider raw、未知字段中的几何
  - 不查 artifact store（那是 GET 端点的职责）
- `run-agent.ts` `toolKind`：`work__*` → `project`；`navigation__*` → `directions`（已有关键词可复用，补测试钉死）
- `prompts.ts`：在现有地图助手之上增加求职导航纪律（中英）：
  - 岗位/通勤必须走域工具，不得编造岗位、薪资、坐标、路线
  - `missingSlots` 非空时不得规划路线
  - 一次一个工具；通勤过滤必须先粗筛再 Top-K
  - 需要看路线时只输出 `showRoute{routeId}`，禁止在动作或正文里写 polyline
  - 动作契约示例从 6 种改为 7 种，且注明 `showRoute` 仅 `routeId`
  - 不做黑盒推荐总分

### B. Work 域工具

新增 `server/src/lib/agent/tools/work.ts`（工厂可注入 catalog 依赖，便于无 DB 测试）：

1. `work__searchPositions`
   - 输入：关键词、城市、有限结构化岗位条件、分页上限
   - 复用 `loadServerCatalog` + `searchPublicCatalog` / `runPOIPipeline` / `filterPositions` /
     alive 规则，**禁止**复制一套岗位过滤
   - 输出：稳定 ID（岗位 `external_id` / `Position.id`、办公点/公司 catalog id）、标题、城市、
     办公点标签、求职类型、薪资若有、来源/新鲜度字段若 catalog 已有
   - 不返回全量 JD/`description` 长文；pageSize 有硬上限（建议 ≤ 20，且 ≤ public search clamp）
2. `work__getPositionDetail`
   - 输入：`positionId`
   - 只返回当前仍可见（open + alive）岗位事实、办公点坐标（有则带坐标系声明）、来源、新鲜度
   - 下线/找不到 → 稳定错误，不猜
   - 不要为了详情物化全国全量 catalog；优先 targeted DB 读。若必须新增
     `recruitment-store` 的 by-`external_id` 薄查询，保持现有 alive/open 语义，不要新过滤引擎

工具 `call` 返回给 LLM 的是净化后的纯文本摘要（走现有 `sanitizeToolText`），不得含 geometry
数组、cookie、密钥。

### C. Navigation 域工具

新增 `server/src/lib/navigation/compare.ts`（深 module：通勤矩阵 + 约束命中，无总分）和
`server/src/lib/agent/tools/navigation.ts`。

1. `navigation__planRoute`
   - 输入先 `parseRouteRequest`；`parseNavigationIntent` 若 `missingSlots` 含 origin/destination
     则拒绝规划
   - 调用生产 `navigationRouteService`（可注入），使用 `ctx.navigationSession.fingerprint`
   - 无 fingerprint → 稳定错误，不规划
   - 输出 `RoutePlan` 摘要文本：provider/quality/duration/distance/warnings/fetchedAt；
     仅 `provider_route` 可带 `routeId`；永远无 geometry
2. `navigation__compareCommutes`
   - 1 个起点、2–5 个候选办公点、方式
   - 统一口径矩阵：成功项 + 失败项 + quality 标签
   - 并发/超时预算；部分失败显式列出，不静默丢
   - 不做综合推荐分，只陈述约束/时长/质量
3. `navigation__filterByCommute`
   - 候选岗位 ID、起点、上限分钟、方式、Top-K（K ≤ `MAX_CANDIDATE_IDS`）
   - 流程：已有候选/DB 粗筛 → Top-K 路线请求 → 严格分钟过滤
   - 严格 0 命中时返回 0，并单列最接近候选与放宽说明，不得把超限伪装成命中
   - 每轮路线调用有硬预算（建议默认 Top-K=5，并发有上限）；超预算停止并说明

生产无 live provider：上述路线结果必须是显式 estimate + 限制 warning。测试用 fake
`RouteProvider` 证明成功路径会签发 `routeId` 且工具文本仍无 geometry。

### D. Chat 路由：session 与工具注入

`POST /api/agent/chat`：

- 在全部前置校验之后、MCP/LLM 连接之前，读取 WS1 `dm_navigation_session` cookie
- 缺失则 mint（`createNavigationSessionToken`），在最终 SSE `Response` 上 `Set-Cookie`
  （`Path=/api`、HttpOnly、SameSite=Lax、生产 Secure）；token 不进 JSON/SSE/日志
- 把 fingerprint 放入 `AgentContext.navigationSession`
- 注入 `workTools()` + `navigationTools()`；保持「校验行号 < getMcpProvider/runAgent」契约
- 不改变限流、SSE allowlist、error 脱敏

### E. 前端类型收口（非设计改动）

因为 `AgentAction` 会增加 `showRoute`，下列 exhaustive switch 必须编译：

- `server/src/components/agent-map-executor.ts`
  - 本地 `validateAction`：格式合法则接受 `showRoute`，非法/带 geometry → null
  - `executeAction`：`showRoute` **必须 no-op**（不调用 map bridge 画线、不入 undo、不改相机）
  - 流式路径：校验通过后可以 `onAction`（建议卡片），但不得画 overlay
- `server/src/components/agent-panel.tsx` `actionLabel`：增加 `showRoute` 文案分支；
  不得改面板布局、CSS、地图 chrome

禁止：新 overlay 组件、改 liquid-glass 卡片结构、改桌面/移动信息架构。

### F. 测试与文档

新增充分 Node 测试（建议
`server/tests/navigation-agent-tools.test.mjs`、扩展
`agent-types.test.mjs` / `agent-prompts.test.mjs` / `agent-tools.test.mjs` /
`agent-route-contract.test.mjs`）：

1. 五个工具的 schema/名称/provider 注册
2. search/detail 走注入 catalog；找不到/下线 fail closed；详情无全量 JD
3. planRoute 无 session / missing origin → 不打 provider
4. planRoute estimate：无 routeId、无 geometry；fake provider 成功：有 routeId、文本无 geometry
5. compare：2–5 点矩阵、部分失败可见、无总分字段
6. filterByCommute：严格命中 vs 超限近似；Top-K/预算阻止 N+1
7. `validateAction('showRoute')` 合法 ID 通过；畸形/过短/带 geometry 拒绝
8. prompt 含 7 种动作且禁止编造岗位/polyline
9. chat route 源码：注入 work/navigation 工具、cookie mint、校验仍先于 MCP/LLM
10. 三主场景后端链（注入 fake）：通勤搜索、岗位通勤比较、面试到达倒推

测试必须本地、确定性、无真实网络、无 key、无 DATABASE_URL 依赖。

文档（只写可验证事实）：

- `tech/24-agent-feature.md`：动作白名单 7 种、`showRoute` 校验、域工具清单；写明客户端暂不绘制
- `tech/31-job-navigation-agent-plan.md`：WS2/M2 与工具文件改为已实现；前端 overlay 仍未实现
- `tech/01-architecture.md`：Agent 域工具与 session 共享；live provider/UI overlay 仍未实现
- 必要时代码注释同步 `tech/14-api-contract.md` 的 chat cookie 事实

## 文件边界

### 你拥有

- `server/src/lib/agent/types.ts`、`action-schema.ts`、`prompts.ts`、`run-agent.ts`（仅 toolKind/必要 ctx 传递）
- `server/src/lib/agent/tools/work.ts`、`navigation.ts`（新建）
- `server/src/app/api/agent/chat/route.ts`（注入工具 + navigation cookie，保持既有校验顺序）
- `server/src/lib/navigation/compare.ts`（新建）及 `index.ts` 的最小导出
- 若详情需要 targeted 读：`server/src/lib/recruitment-store.ts` 的**薄** by-position 查询 + 对应测试
- `server/src/components/agent-map-executor.ts`、`agent-panel.tsx` 的 `showRoute` **类型/no-op/文案**收口
- 相关 `server/tests/agent-*.test.mjs`、`navigation-agent-tools.test.mjs`
- `tech/24-agent-feature.md`、`tech/31-job-navigation-agent-plan.md`、`tech/01-architecture.md`、必要时 `tech/14-api-contract.md`

### 明确不碰

- 地图 overlay 新组件、CSS Modules、面板布局、筛选条、列表页
- `server/src/lib/map-engine/**`、`commute.ts`（只复用）
- `db/**`、`crawler/**`、migration
- `.env*`、live provider adapter、analytics persistence
- WS0 `navigation-eval-cases.json` 的 40 条内容
- 不要改现有 6 种动作的校验边界，除非发现确定性 bug（先 BLOCKED）

## 质量要求

- TDD：先失败测试再实现
- 2 空格；不新增依赖
- 工具错误对 LLM/客户端安全：无 key、无内部 URL、无 cookie、无 raw provider
- 频繁小步 Conventional Commits；每次 `git add` 只列具体文件

## 门禁

```bash
cd /Users/acccan/dm-wt-job-navigation-ws2-agent-tools/server
node --test --experimental-strip-types tests/agent-types.test.mjs tests/agent-prompts.test.mjs tests/agent-tools.test.mjs tests/agent-route-contract.test.mjs tests/navigation-agent-tools.test.mjs tests/navigation-contracts.test.mjs tests/navigation-route-core.test.mjs tests/navigation-routes-api.test.mjs
npm test
npm run typecheck
cd /Users/acccan/dm-wt-job-navigation-ws2-agent-tools
make docs-check
git diff --check
git status --short
```

若测试文件名不同，专项命令按实际调整并在汇报注明。全量 `npm test` 必须串行、不要与其他重 CPU
任务并行（已知 `llm-validate` CLI 在资源竞争下会 30s 超时变成 `exitCode=null`）。

## 汇报格式

写入指定 report，含实际改动、关键不变量、门禁计数、剩余风险（estimate-only、showRoute 未绘制）、
commits/tip、范围核对。

末两行必须精确：

```text
门禁: PASSED
结论: OK
```

stdout ≤ 3 行，不贴代码。
