# WS1 Route Core — boss-worker prompt

## 绝对路径

- 主仓库（只读，不得修改）：`/Users/acccan/Repos/huangyincan/domain-map`
- 你的 worktree：`/Users/acccan/dm-wt-job-navigation-ws1-route-core`
- 你的分支：`feature/job-navigation-ws1-route-core`
- 批次目录：`/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260828-job-navigation-ws1`
- 最终汇报：`/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260828-job-navigation-ws1/reports/ws1-route-core.md`

worktree 已由 boss 预建。所有代码、测试、文档修改与 commit 只发生在 worktree；不要 merge
回 `dev`，不要 push。`git add` 只添加你实际修改的具体路径。

## 开工前必读

1. worktree 内 `CLAUDE.md`、`agent.md`、`server/AGENTS.md`
2. `tech/31-job-navigation-agent-plan.md`，重点 §4.4、§5.2–5.4、§6、§9–§13
3. `tech/06-decisions.md` 的 ADR-008
4. `tech/roles/development/architecture/navigation-route-provider-review.md`
5. WS0 的 `server/src/lib/navigation/**` 与 `server/tests/navigation-contracts.test.mjs`
6. `server/src/lib/commute.ts`、`server/src/lib/request-body.ts`、现有会话/有界内存模块
7. 写 Next.js 16 route handler 前读取：
   - `server/node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
   - `server/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`

## 目标

实现一个深的、provider-neutral 的路线 module：调用方只提交经过 WS0 校验的 `RouteRequest`
和当前导航会话，module 隐藏 provider 选择、超时/中止、显式 estimate 降级、可信结果校验、
CSPRNG route ID、artifact TTL/容量/会话隔离及安全错误收敛。生产默认不得注册 live provider。

## 必须交付

### A. Provider seam 与结果契约

- 新增 `server/src/lib/navigation/route-provider.ts`（可按实现需要补充少量同目录文件）。
- 保持 `RouteProvider` 接口小而可注入，至少覆盖 `id`、`isConfigured()`、`supports(request)`、
  `plan(request, signal)`；为测试 fake 定义 provider result/error 的稳定、封闭类型。
- provider result 可以在服务端内部携带 geometry，但不得让 provider 指定 `routeId`、`sessionId`
  或向 `RoutePlan` 泄露 geometry/原始响应。
- 不新增高德/腾讯/百度 adapter、registry 配置、环境变量或 HTTP 调用。测试 fake 不是生产
  provider 注册。

### B. Explicit estimate adapter

- 新增 `server/src/lib/navigation/estimate-provider.ts`，复用
  `server/src/lib/commute.ts` 的估算规则与仓库已有 haversine 实现，禁止复制一套速度常量。
- estimate 结果固定 `provider: 'estimate'`、`quality: 'estimate'`、
  `trafficAware: false`，没有 `routeId`、没有 geometry。
- 返回来源/获取/过期时间和明确 warning，不能把直线估算描述为道路路线、实时路况或可信
  polyline。
- 对不同坐标系不得静默当作同一坐标系计算；要么在受测 adapter seam 显式转换，要么以稳定
  `COORDINATE_ERROR` fail closed。本批不要求新增未经审查的坐标转换。
- 到达/出发时间推导必须可解释、绝对时间有序，不能凭空声称供应商支持 arrival-by。

### C. Route module 与失败降级

- 新增 `server/src/lib/navigation/route-service.ts`（文件名按已批准计划保留；实现应表现为深
  module，而不是 pass-through）。
- 输入先走 WS0 `parseRouteRequest`；依赖（providers、clock、timeout、ID generator、
  artifact store）可注入，生产构造器默认 providers 为空。
- 对注入 provider 的 success、unsupported、unconfigured、timeout/abort、rate limit、
  unauthorized、no-route、provider error 全部收敛到 WS0 稳定错误语义。
- provider 不可用/失败时，在可以安全估算的前提下显式降级为 estimate，并以客户端安全的
  warning 说明降级类别；不得泄露异常文本、内部 URL、key 或原始响应。
- 校验 provider 结果的 provider 身份、有限数值/范围、TTL、geometry 点数/坐标、坐标系，
  以及 geometry 起终点与请求的合理偏差。非法结果不得签发 route ID 或写 artifact。
- provider 成功时仅由服务端 `node:crypto` CSPRNG 生成匹配
  `^rte_[a-f0-9]{32,124}$` 的 ID；严禁 `Math.random`、provider/client supplied ID。
- 请求 abort 必须向 provider 传播；超时 timer 必须清理，不留下悬挂调用。

### D. 有界、会话隔离的 artifact store

- 新增 `server/src/lib/navigation/route-artifacts.ts`。
- 仅进程内存，容量有硬上限，过期可清理；不写 DB/文件/analytics，不保存 provider 原始响应。
- 写入前复用/等价执行 WS0 artifact 校验；estimate 永远不能写 artifact。
- 读取结果要能稳定区分 malformed、unauthorized（无会话）、not found、wrong session、
  expired；任何失败均不返回 geometry。
- wrong-session 读取不能续期、复制或删除合法会话的 artifact。
- 对客户端输出专门的 public artifact shape，排除 `sessionId`；不要直接序列化内部对象。
- route ID 与会话 token 均不可猜测。若使用 cookie token，artifact 中只存不可逆会话指纹，
  不存原始 cookie。

### E. Navigation route handlers

- 新增：
  - `server/src/app/api/navigation/routes/plan/route.ts`
  - `server/src/app/api/navigation/routes/[routeId]/route.ts`
- `runtime = 'nodejs'`，使用有界 JSON 读取，所有响应 `Cache-Control: no-store`。
- POST 校验后调用生产 route module；当前无 live provider，因此正常结果必须是显式 estimate。
- 为匿名和登录浏览器都使用独立、HttpOnly、SameSite=Lax、生产环境 Secure、窄 path、有限
  lifetime 的 navigation session cookie；原始 token 不进 JSON、不进日志、不进 artifact。
- GET 只允许同一 navigation session 读取未过期 artifact，并只返回 public artifact shape。
- HTTP 状态至少稳定覆盖：bad request 400、missing session 401、wrong session 403、
  not found 404、expired 410、rate limited 429、provider unavailable 503、timeout 504。
  当前生产 estimate fallback 可使部分 provider 状态只在纯 module/fake 测试中出现。
- route handler 保持薄；把可测试行为放在纯 module/interface 后面。不得在日志中记录精确
  起终点、geometry、cookie、key 或 provider raw error。

### F. 导出、测试与文档

- 更新 `server/src/lib/navigation/index.ts` 只暴露调用方需要的最小接口，避免导出可绕过验证
  的内部写路径。
- 新增充分的 Node 测试（建议 `server/tests/navigation-route-core.test.mjs` 和
  `server/tests/navigation-routes-api.test.mjs`），必须覆盖：
  1. estimate 四方式、来源/quality/no-routeId/no-geometry、时间/TTL；
  2. fake provider 成功签发 CSPRNG ID并写入 artifact；
  3. provider timeout、rate limit、unsupported、unconfigured、no-route、malformed geometry
     的显式降级/安全错误；
  4. abort 传播和 timer 清理；
  5. artifact 容量、过期、not-found、同会话成功、跨会话拒绝、public shape 无 sessionId；
  6. 坐标系 mismatch、非 finite、geometry 点数与起终点偏差；
  7. POST bad/oversize JSON、estimate 返回不含 geometry/routeId、cookie 属性/no-store；
  8. GET malformed/missing-session/not-found/wrong-session/expired 的状态与无 geometry 泄露。
- 测试必须纯本地、确定性、无真实网络、无 key、无 sleep 型长等待；用注入 clock/timer/fake。
- 更新可验证事实：
  - `tech/01-architecture.md`：两个 navigation route handler 与安全/降级语义；
  - `tech/06-decisions.md` ADR-008 当前状态；
  - `tech/31-job-navigation-agent-plan.md`：WS1/M1 和模块清单改为真实实现状态，同时继续明确
    live provider、WS2+、analytics persistence、前端均未实现。
- 不把“provider-neutral + estimate”写成“真实路线/实时导航已上线”。

## 文件边界

### 你拥有

- `server/src/lib/navigation/**`
- `server/src/app/api/navigation/routes/**`
- 与本 WS 直接相关的新 `server/tests/navigation-*.test.mjs`
- `tech/01-architecture.md` 中 navigation API/模块相关段落
- `tech/06-decisions.md` 的 ADR-008 当前状态
- `tech/31-job-navigation-agent-plan.md` 中实现状态/WS1/M1/模块清单

### 明确不碰

- `server/src/components/**`、`server/src/app/**/*.tsx`、CSS 与所有现有前端代码
- `server/src/lib/agent/**`（WS2 所有）
- `server/src/lib/map-engine/**`
- `server/src/lib/commute.ts`（只复用，不改）
- `db/**`、`crawler/**`、现有 migration
- `.env*`、provider key/config、live provider adapter/网络调用
- analytics/event persistence、`audit_events`
- WS0 fixture 的 40 条内容（除非发现确定性契约 bug；若发现先在汇报 BLOCKED 给 boss 裁决）

## 质量要求

- TDD：先补失败测试，再实现；测试通过后做边界自审。
- 沿用项目 2 空格/现有 TypeScript 风格，不新增依赖。
- route module 的小接口必须让调用方不需要理解超时、fallback、artifact 或 provider raw shape。
- 错误与 warning 对客户端安全，任何 raw `Error.message` 不得直接下发。
- 不执行真实 provider 冒烟、DB apply、seed/geocode 等 Env-only 操作。
- 频繁小步 Conventional Commits；每次 `git add` 只列具体文件。

## 门禁

至少运行并在汇报中给出实际计数：

```bash
cd /Users/acccan/dm-wt-job-navigation-ws1-route-core/server
node --test --experimental-strip-types tests/navigation-contracts.test.mjs tests/navigation-route-core.test.mjs tests/navigation-routes-api.test.mjs
npm test
npm run typecheck
cd /Users/acccan/dm-wt-job-navigation-ws1-route-core
make docs-check
git diff --check
git status --short
```

如果测试文件拆分命名不同，专项命令按实际文件调整并在汇报注明。任何门禁失败都必须如实写
`门禁: FAILED`；不要为了绿而删测试、弱化安全断言或声称未运行的命令已通过。

## 汇报格式

写入指定 report，包含：

1. 实际改动（按文件/模块）
2. 关键 interface 与不变量
3. 门禁结果和测试计数
4. 遇到的问题/剩余风险（特别是 production 无 live provider）
5. commits 与最终 branch tip
6. 范围核对（确认未触碰前端/Agent/DB/key/live provider）

末两行必须精确：

```text
门禁: PASSED
结论: OK
```

若阻塞则改为 `FAILED` 与 `结论: BLOCKED: <一句话>`。stdout 只回报不超过 3 行摘要，不贴代码。
