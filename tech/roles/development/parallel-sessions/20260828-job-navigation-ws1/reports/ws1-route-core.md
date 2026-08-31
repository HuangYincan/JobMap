# ws1-route-core 汇报（2026-08-28）

## 实际改动

- `server/src/lib/navigation/route-provider.ts` → 新增小型可注入 `RouteProvider` seam，以及不含 route/session ID 和 raw response 落点的封闭 provider success/failure 契约。
- `server/src/lib/navigation/estimate-provider.ts` → 复用 `commute.ts` 的四方式估时规则与仓库 `haversineDistance`；固定输出 `provider: estimate` / `quality: estimate` / `trafficAware: false`，不生成 geometry/routeId，并明确直线估算、非实时路况和 arrival-by 倒推边界。
- `server/src/lib/navigation/route-service.ts` → 输入重走 WS0 `parseRouteRequest`；实现 provider 选择、超时与请求 abort 传播、timer 清理、安全错误收敛、显式 estimate 降级、provider 身份/数值/TTL/坐标系/geometry/端点偏差校验、`node:crypto` CSPRNG route ID 签发和 artifact 写入。生产默认 provider 列表为空。
- `server/src/lib/navigation/route-artifacts.ts` → 新增有 TTL、1,000-entry 默认上限和 50,000 aggregate-geometry-point 安全默认预算的进程内 artifact store；预算可由构造参数收窄，单条超预算拒绝，累计超预算或 entry 满载时逐出最老 entry；写入重用 WS0 artifact 校验，读取稳定区分 malformed、unauthorized、not found、wrong session、expired，并以专用 public shape 排除内部 session fingerprint。
- `server/src/lib/navigation/navigation-session.ts`、`route-runtime.ts`、`route-http.ts` → 新增独立 CSPRNG navigation cookie、SHA-256 会话指纹、跨两个 route entry 共享的有界进程 store、有界 JSON、`no-store` 响应与稳定 HTTP 状态映射；cookie 保持 host-only/HttpOnly/SameSite=Lax 并用 `Path=/api` 覆盖后续 Agent 与 route handlers，artifact 不保存原始 cookie；所有 navigation 错误体统一为顶层 `RouteError`。
- `server/src/app/api/navigation/routes/plan/route.ts`、`server/src/app/api/navigation/routes/[routeId]/route.ts` → 新增 Node.js runtime 薄 route handlers；POST 当前正常生产结果必为显式 estimate，GET 仅允许同一 navigation session 读取未过期 provider artifact。
- `server/src/lib/navigation/index.ts` → 仅增加调用方所需 provider/service 类型与构造器导出，不从 barrel 暴露 artifact 内部写路径。
- `server/tests/navigation-route-core.test.mjs`、`server/tests/navigation-routes-api.test.mjs` → TDD 覆盖四方式 estimate、时间/TTL、fake provider 成功与 CSPRNG ID、失败降级、abort/timer、非法结果、artifact entry/aggregate-point 双上限、会话/过期/public shape、`Path=/api`、顶层错误 JSON、no-store 与状态矩阵。
- `tech/01-architecture.md`、`tech/06-decisions.md` ADR-008、`tech/14-api-contract.md`、`tech/31-job-navigation-agent-plan.md` → 同步 WS1/M1、双预算、跨 API cookie path 和顶层 navigation 错误体等可验证事实，并继续明确 live provider、WS2+、analytics persistence 与前端均未实现。

## 关键 interface 与不变量

- `RouteProvider` 仅有 `id`、`isConfigured()`、`supports(request)`、`plan(request, signal)`；provider 无权指定 routeId/sessionId。
- 只有校验通过的 `provider_route` 才能由服务端签发 `^rte_[a-f0-9]{32,124}$` ID 并写 artifact；estimate 永远没有 routeId 或 geometry。
- 不同坐标系 fail closed 为 `COORDINATE_ERROR`；本 WS 未新增未经审查的坐标转换。
- cookie token 与 route ID 均由 `node:crypto` CSPRNG 生成；artifact 只存 SHA-256 会话指纹，跨会话拒绝不会续期、复制或删除合法 artifact。
- artifact 仅为 entry 数和 aggregate geometry points 双重有界的进程内存，不写 DB、文件、analytics 或 provider raw response；所有 navigation HTTP 响应均为 `Cache-Control: no-store`。

## 门禁结果

- 专项：`node --test --experimental-strip-types tests/navigation-contracts.test.mjs tests/navigation-route-core.test.mjs tests/navigation-routes-api.test.mjs` → 67 通过 / 0 失败。
- `npm test` → 1790 tests；1787 通过 / 0 失败 / 3 跳过。
- `npm run typecheck` → 通过。
- `make docs-check` → 通过（`Documentation policy check passed.`）。
- `git diff --check` → 通过。
- `git status --short` → 空；worktree 干净。

## 遇到的问题 / 剩余风险

- TDD 首轮按预期因新模块尚不存在失败；实现后专项全绿。
- 首轮 typecheck 暴露 estimate adapter 的 optional coordinate narrowing；改为在前置 finite 校验后构造显式坐标对象，复跑通过。
- Boss 二次审查发现 cookie path、错误体层级与 artifact 可变内存上限问题；均以第三个聚焦 commit 修正，专项由 65 增至 67 项。
- follow-up 全量测试首轮在与其他门禁并行时，既有 `llm-validate` CLI 子进程达到 30s 超时并返回 `exitCode=null`；该文件隔离复验 19/19 通过，随后无资源竞争重跑全量 1790 tests 全绿。
- 生产仍刻意不注册 live provider，因此当前 POST 只返回直线 estimate；真实道路 geometry、实时路况和供应商 arrival-by 尚不可用。
- artifact store 仅进程内且有界，不跨 Node 进程共享、不持久化；这是 WS1 的明确边界，未来多实例方案需单独 ADR。

## Commits 与 branch tip

- `e4dd175 feat(ws1-route-core): implement trusted route planning core`
- `1fb937a docs(ws1-route-core): record route foundation boundaries`
- `be4fe91 fix(ws1-route-core): harden route session and artifact bounds`
- 最终 branch tip：`be4fe91`
- 分支：`feature/job-navigation-ws1-route-core`；未 merge、未 push。

## 范围核对

- `dev...HEAD` 仅包含 prompt 授权的 navigation lib、两个 navigation API、两份 navigation 测试、三份原指定技术文档及 Boss 明确要求同步的 `tech/14-api-contract.md`。
- 未触碰前端、`server/src/lib/agent/**`、map-engine、`commute.ts`、DB、crawler、migration、analytics persistence、`.env*`、provider key/config 或 live provider/network 调用。
- 未运行 DB/live provider/seed/geocode 等 Env-only 命令；未 merge `dev`，未 push。

门禁: PASSED
结论: OK
