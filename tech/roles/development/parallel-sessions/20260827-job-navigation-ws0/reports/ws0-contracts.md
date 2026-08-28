# WS0 Contracts Report

**批次:** `20260827-job-navigation-ws0`

**报告日期:** 2026-08-28

**分支:** `feature/job-navigation-ws0-contracts`

**报告前 HEAD:** `3b1c0f5`

## 目标

在不接入真实路线供应商、不新增产品事件存储、不修改前端的前提下，冻结求职导航的
provider-neutral 契约、稳定错误和纯校验，建立 40 条版本化离线 fixture 基线，并完成高德、
腾讯、百度官方路线约束审查及阶段性 ADR，为 WS1 的无 live provider 路线核心留下可验证边界。

## 范围与明确未做

- 已实现导航契约、纯校验、离线 fixture 基线、供应商约束审查、ADR 和文档同步。
- 未选择、注册、配置或调用任何 live route provider；没有网络调用、真实路线、实时交通、路线服务/API 或供应商原始响应。
- 未实现 `RouteProvider`、`RouteService`、artifact store、navigation API、Agent 求职/导航工具、`showRoute` 或前端路线 UI/overlay。
- 未实现 eval runner、工具序列执行、真实路线 mock、指标采集、产品事件 sink、analytics persistence 或真实 key 冒烟。
- 未修改 `server/src/lib/commute.ts`，不把已有直线估算包装为 provider route；未修改前端、数据库或 `audit_events`。

## 实际修改文件

WS0 累计交付涉及以下文件：

- `server/src/lib/navigation/constants.ts`
- `server/src/lib/navigation/errors.ts`
- `server/src/lib/navigation/index.ts`
- `server/src/lib/navigation/types.ts`
- `server/src/lib/navigation/validation.ts`
- `server/tests/fixtures/navigation-eval-cases.json`
- `server/tests/navigation-contracts.test.mjs`
- `tech/roles/development/architecture/navigation-route-provider-review.md`
- `tech/06-decisions.md`
- `tech/31-job-navigation-agent-plan.md`
- `tech/01-architecture.md`
- `CHANGELOG.md`
- `tech/roles/development/parallel-sessions/20260827-job-navigation-ws0/reports/ws0-contracts.md`

本轮相对报告前 HEAD 的实际修改范围为以下八个文件：

- `CHANGELOG.md`
- `server/src/lib/navigation/constants.ts`
- `server/src/lib/navigation/validation.ts`
- `server/tests/navigation-contracts.test.mjs`
- `tech/01-architecture.md`
- `tech/31-job-navigation-agent-plan.md`
- `tech/roles/development/architecture/navigation-route-provider-review.md`
- 本报告

本轮没有修改 `reports/.gitkeep`，也没有修改批次 prompt/manifest、前端、数据库或供应商配置。
最终工作区核对不得出现其他未提交文件。

## 关键契约决策

- `RoutePlan = ProviderRoutePlan | EstimateRoutePlan`。`ProviderRoutePlan` 必须有 opaque
  `routeId`，`provider` 为 `amap`、`tencent` 或 `baidu`，`quality` 为 `provider_route`；
  `EstimateRoutePlan` 不允许 `routeId`，必须为 `provider: "estimate"`、`quality: "estimate"`
  和 `trafficAware: false`。
- 两类 `RoutePlan` 都不包含 `geometry`。可信几何仅属于服务端内部 `RouteArtifact`，其类型字段为
  `routeId`、`sessionId`、`provider`、`mode`、`coordinateSystem`、`geometry`、`fetchedAt`、
  `expiresAt`；原始 provider 响应默认不保留，也不进入 LLM。
- `RoutePlan` 和 `RouteArtifact` 均要求 `expiresAt > fetchedAt`，有效期最大为 3600 秒。
- WS1 才负责在服务端使用 CSPRNG 生成并与 session 绑定、匹配
  `^rte_[a-f0-9]{32,124}$` 的不可猜测 `routeId`；总长度为 36–128 字符，上限为 128。WS0
  当前只校验格式，不生成 ID。`routeId` 不是 estimate plan 或所有 plan 的必填字段。
- `startsAt` 等时间字段要求显式 `Z` 或可解析的 `±HH:MM`；带 offset 的值只接受本项目的闭区间
  `[-12:00, +14:00]`，`Z` 仍合法。这是本项目的接受范围，不是完整 ISO 8601 规范的断言；本阶段
  不验证 offset 与 IANA timezone 是否匹配。
- 坐标型 `NavigationLocationRef` 必须同时提供 `lng`、`lat` 和 `coordinateSystem`；非坐标型位置
  不伪造默认供应商坐标。`timezone` 只接受 `UTC` 或有效的 slash-based IANA timezone。
- WS0/WS1 不持久化 analytics，不复用 `audit_events`；后续事件 sink、同意、访问控制、删除和留存
  必须独立决策。

## 离线 fixture 基线

版本化文件：`server/tests/fixtures/navigation-eval-cases.json`，恰好 40 条，分布如下：

| 场景 | 数量 |
|---|---:|
| 通勤搜索（`commute_search`） | 12 |
| 岗位比较（`job_compare`） | 10 |
| 面试到达（`interview_arrival`） | 10 |
| 安全异常（`safety`） | 8 |

所有 fixture 中的 location 都是 `precision: approximate`。内容只覆盖意图、契约和安全边界，
不包含 runner、工具序列执行、真实路线 mock、指标采集或真实 key 冒烟；也不包含完整地址、精确
个人起点、polyline、供应商原始响应或完整对话。

## 供应商结论与未核实项

没有选定、注册、配置或调用 live provider。审查只记录公开官方正文能够确认的接口和字段：

- **高德路线规划 2.0：** 官方文档按方式拆分 endpoint：`/v5/direction/driving`、
  `/v5/direction/walking`、`/v5/direction/transit/integrated`、`/v5/direction/bicycling`、
  `/v5/direction/electrobike`；使用 `key`；坐标顺序为 `lng,lat`；官方 FAQ 可确认 `GCJ-02`。
  驾车存在交通态势字段/策略；`arrival-by`、更新频率和 SLA 未核实。
- **腾讯 Direction API：** 有步行、骑行、驾车、公交；使用 `key`；`from/to` 为 `lat,lng`；
  距离、时长和策略可核实。该路线正文未明确输入/输出坐标系，`departure-time`、`arrival-by`
  和实时性未核实。
- **百度普通 Direction API v2：** 有 `walk`、`riding`、`driving`、`transit`；使用 `ak`，
  启用 SN 校验时按官方规则携带 `sn`/`timestamp`；`origin/destination` 为 `lat,lng`；
  `coord_type` 默认 `bd09ll`，可选 `bd09ll`/`bd09mc`/`gcj02`/`wgs84`，`ret_coordtype`
  默认 `bd09ll`，可选 `bd09ll`/`gcj02`。公交有 `departure_date`/`departure_time`；驾车策略
  可包含躲避拥堵/时间优先，但不承诺 SLA。
- **百度 DirectionLite：** 官方文档标注 2026-03-19 更新的 v1.0，并列出 `driving`、`riding`、
  `walking`、`transit`；其输入/输出坐标系、时间参数、实时性和 SLA 未核实。普通 Direction API v2
  的坐标参数和公交时间字段不外推到 DirectionLite。静态配额、缓存、展示和商业许可对所有 provider
  均不猜。

腾讯路线输入/输出坐标系仍未核实。账号是否开通、公开配额是否可用、缓存/展示/商业使用权均需
账号后台或法务人工确认。公开正文能证明接口/字段存在，不等于账号已开通、配额可用或获得缓存、
展示/商业使用权。原始 provider 响应默认不保留。

## 隐私与分析边界

WS0/WS1 不持久化产品分析事件，不复用 `audit_events`。fixture、日志和未来路线边界不得保存
完整地址、精确用户起点、完整对话、key、供应商原始响应或 polyline；原始 provider 响应默认不保留，
也不进入 LLM。任何未来事件 sink、留存、同意、访问控制和删除策略必须单独决策。

## 历史提交

截至本报告前的四个提交为：

1. `2c2ce5b feat(navigation): freeze navigation contracts and eval baseline`
2. `de3d226 fix(navigation): tighten navigation contract invariants`
3. `45d818b docs(navigation): review route provider constraints`
4. `3b1c0f5 docs(navigation): synchronize ws0 decisions and status`

本报告记录的四个历史提交不包含本轮边界修订；本轮修订与前序 WS0 文档同步共同记录在本轮
Conventional Commit 中。未修改 `reports/.gitkeep`。

## 门禁结果

本报告更新后已按用户指定顺序完成最终复跑。实际观测到的结果为：

- `cd server && node --test tests/navigation-contracts.test.mjs`：通过；18 tests、18 pass、0 fail、0 skipped。
- `cd server && npm test`：通过；1741 tests、1738 pass、0 fail、3 skipped。
- `cd server && npm run typecheck`：通过；执行 `tsc --noEmit`，无错误。
- `cd .. && make docs-check`：通过；输出 `Documentation policy check passed.`
- `git diff --check`：通过；无输出。

Node 测试另输出已有的 `MODULE_TYPELESS_PACKAGE_JSON` 性能警告，不影响退出码。

## 越界检查

本轮编辑范围限定为本报告“实际修改文件”列出的八个 WS0 文件；未 merge、未 push，未触碰主工作树、
前端、数据库、供应商 key、`.env` 或 `.gitkeep`。最终以 `git status --short`、`git diff --name-only`
和未跟踪文件核对仅有上述八个文件变更。
