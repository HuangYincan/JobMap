# Session Prompt — ws0-contracts：导航契约与评测地基

> 你是本 workstream 的执行者，模型指定为 `gpt-5.6-luna`。先读 `AGENTS.md`、
> `agent.md`、`.agents/skills/workstream-agent/SKILL.md`、本 prompt 和
> `tech/31-job-navigation-agent-plan.md`。所有实现只发生在独立 worktree；不要 merge 或 push。

## Worktree

主 Agent 会优先预建：

- branch: `feature/job-navigation-ws0-contracts`
- path: `/Users/acccan/Repos/huangyincan/domain-map-wt-job-navigation-ws0-contracts`

开始时先执行 `git status --short --branch`、`git rev-parse HEAD` 和 `git worktree list`，确认该
worktree 基于包含本 prompt 的最新 `dev`。若路径已存在，直接使用，不要创建第二个 worktree；
若不存在，才按 `parallel-development` skill 从 `dev` 创建。不得触碰主工作树中的用户改动。

## 背景与已验证事实

- P5 是 Work 模式内的求职导航 Agent，不是通用逐向导航产品：
  `tech/31-job-navigation-agent-plan.md:19-36`。
- 当前 `commute.ts` 仅按直线距离估算四种方式，且已有文案明确为估算：
  `server/src/lib/commute.ts:1-64`。
- 浏览器 `map-engine` 与服务端 `RouteProvider` 必须分离：
  `tech/31-job-navigation-agent-plan.md:248-267`。
- LLM 不得生成路线几何；可信几何未来只能由短 TTL、会话绑定的 route artifact 提供：
  `tech/31-job-navigation-agent-plan.md:230-246`。
- Agent 现有动作只有 6 类，定义在 `server/src/lib/agent/types.ts:34-41`；本 WS 不新增
  `showRoute`，该动作属于 WS2。
- 现有项目没有直接依赖运行时 schema 库，动作边界采用纯函数手写校验：
  `server/src/lib/agent/action-schema.ts:1-110`。本 WS 沿用该风格，不新增依赖。
- 本阶段质量和隐私边界见 `tech/31-job-navigation-agent-plan.md:347-399`；完整地址、精确起点、
  完整对话和 polyline 不得进入评测 fixture、日志或分析事件。

## 任务

### 1. 冻结 provider-neutral 导航契约

在新目录 `server/src/lib/navigation/` 中实现纯类型与纯校验，不做网络、数据库或 session IO。
至少覆盖并导出：

- `NavigationTask`、`TravelMode`、`CoordinateSystem`、`NavigationLocationRef`、
  `NavigationIntent`。
- `RouteProviderId`、`RouteQuality`、`RouteRequest`、`RoutePlan`、`RouteArtifact`、
  `RouteErrorCode` 与稳定错误对象。
- `parseNavigationIntent(raw)`：输入 `unknown`，返回显式 success/error union；拒绝未知顶层和
  嵌套字段，规范化数组，并由服务端重新计算 `missingSlots`，不得信任候选对象自报的缺失槽位。
- `parseRoutePlan(raw)` 或等价纯校验：验证数值、枚举、时间顺序以及 provider/quality/routeId
  的一致性。
- 集中导出有限的契约上限，避免测试和后续服务散落 magic numbers。

契约必须满足：

- 所有坐标 finite、经纬度合法，坐标型 location 必须显式声明坐标系；不得默认为某供应商坐标。
- 文本、ID、数组长度、候选数、`maxMinutes`、缓冲时间均有上限；模式去重且只能取闭合枚举。
- `appointment.startsAt` 必须是带 `Z` 或显式 UTC offset 的可解析 ISO 8601；timezone 必须是有效
  IANA 时区；相对时间文本不得直接进入契约。
- `job_compare` 至少需要 2 个且最多 5 个岗位 ID，并需要 origin；`interview_arrival` 需要 origin、
  appointment time，以及 destination 或 position；通勤约束存在时必须有 origin。
- `missingSlots` 由规范化后的任务字段确定，固定顺序、无重复；非空时仅代表需要澄清，本 WS
  不调用路线规划。
- `provider_route` 必须有不可猜测 routeId 摘要引用；`estimate` 必须使用 provider=`estimate`，
  不得携带 routeId、geometry 或伪造 `trafficAware=true`。
- `fetchedAt`/`expiresAt` 为绝对时间且 `expiresAt > fetchedAt`；duration/distance 为有限非负数。
- `RouteArtifact` 明确是服务端内部类型，包含会话归属、过期时间、坐标系和几何；不得提供面向
  LLM 的序列化 helper。

若计划书示例与上述不变量冲突，以安全边界为准，并同步修订 `tech/31`。已知需要消除的歧义：
坐标系必须进入 location 契约；`estimate` 不应拥有可绘制的 `routeId`。

### 2. 建立 40 条可执行评测骨架

新增 `server/tests/fixtures/navigation-eval-cases.json`，恰好 40 条，至少覆盖：

- 通勤约束找岗 12 条。
- 岗位/通勤比较 10 条。
- 面试到达计划 10 条。
- 非法、缺槽、越界和隐私边界 8 条。

每条包含稳定 ID、用户 utterance、结构化候选输入、预期 task、预期 success/error、预期
`missingSlots` 或错误码、场景标签。fixture 只用合成/公开 POI 标签和近似信息，不包含真实个人
地址、精确个人起点、完整对话、key、供应商原始响应或 polyline。

新增 `server/tests/navigation-contracts.test.mjs`，逐条运行 fixture，并额外覆盖：未知字段、NaN /
Infinity、数组上限、ID 去重、坐标系、时间 offset、IANA timezone、route quality/provider 组合、
routeId 与 estimate 互斥、时间顺序。测试还要断言 fixture 数量和四类覆盖数量，防止骨架缩水。

本 WS 不实现自然语言抽取模型或 eval runner；utterance 是 WS3 的输入资产，当前只验证其对应的
结构化候选和期望契约。

### 3. 官方路线供应商审查

新增 `tech/roles/development/architecture/navigation-route-provider-review.md`。只使用高德、腾讯位置
服务、百度地图开放平台的官方产品/开发文档，记录访问日期、原始 URL 和以下维度：

- 服务端路线产品名称与鉴权方式。
- walk / bike / transit / drive 支持情况。
- 出发/到达时间与 traffic-aware 语义。
- 输入/输出坐标系。
- 可核实的配额、缓存或展示限制。
- 在本项目中仍需账号后台或法务人工确认的项目。

不得用博客、聚合教程或搜索摘要代替官方来源；不得把未找到写成“不存在”。若官方页面受限，
明确记录“未能核实”，不要猜测。不得调用真实 API，不读取或输出任何 `.env`/key。

### 4. 记录保守的阶段性决策

在 `tech/06-decisions.md` 追加 ADR：

- 浏览器 `MapEngine` 与服务端 `RouteProvider` 分离。
- 在用户批准供应商顺序且官方权限完成核实前，不选择/注册 live provider；WS1 只实现接口、
  fixture 和显式 `estimate` 降级。
- WS0/WS1 不持久化产品分析事件；先使用仓库内无敏感信息的离线评测。未来若落库，必须新建
  独立事件存储并重新决定同意、访问控制、删除与留存天数，禁止复用 `audit_events`。
- 该 ADR 是阶段性安全默认，不得声称真实路线、实时路况或产品留存已上线。

同步：

- `tech/31-job-navigation-agent-plan.md`：修正契约歧义并把 WS0 的已实现/仍待决策状态写准确。
- `tech/01-architecture.md`：只增加已实现 navigation contract 模块说明，不添加不存在的 API。
- `CHANGELOG.md`：记录契约与评测骨架，不宣称路线服务可用。

不要声称 5–8 名用户访谈已经完成；这仍是产品研究待办。

## 文件边界

**拥有：**

- `server/src/lib/navigation/**`（新建）
- `server/tests/navigation-contracts.test.mjs`（新建）
- `server/tests/fixtures/navigation-eval-cases.json`（新建）
- `tech/roles/development/architecture/navigation-route-provider-review.md`（新建）
- `tech/06-decisions.md`
- `tech/31-job-navigation-agent-plan.md`
- `tech/01-architecture.md`
- `CHANGELOG.md`
- `tech/roles/development/parallel-sessions/20260827-job-navigation-ws0/reports/ws0-contracts.md`

**明确不碰：**

- `server/src/app/**`、`server/src/components/**`、CSS 和任何前端文件
- `server/src/lib/agent/**`、`server/src/lib/agent-map-bridge.ts`
- `server/src/lib/map-engine/**`
- `server/src/lib/commute.ts`
- `db/**`、migration、数据库 schema、`audit_events`
- `server/package.json`、lockfile、依赖安装
- `.env*`、地图 key、真实供应商调用
- 本批 manifest 与 prompt

如必须越界才能完成，停止并在汇报中说明，不要自行扩大范围。

## 实现纪律

- 先写失败测试，再实现最小契约；沿用仓库 2 空格 TypeScript 风格。
- 不引入抽象层以外的业务服务，不预做 WS1/WS2。
- 未知对象必须安全失败；错误码稳定、对客户端安全，不携带原始输入或供应商细节。
- 文档中的供应商事实必须能回指官方来源；实现状态必须能由代码和测试验证。
- Conventional Commit：`feat(navigation): freeze navigation contracts and eval baseline`。

## 门禁

先跑专项：

```bash
cd /Users/acccan/Repos/huangyincan/domain-map-wt-job-navigation-ws0-contracts/server
node --test tests/navigation-contracts.test.mjs
npm run typecheck
```

再跑完整门禁：

```bash
cd /Users/acccan/Repos/huangyincan/domain-map-wt-job-navigation-ws0-contracts/server
npm test
npm run typecheck
cd ..
make docs-check
git diff --check
```

不得省略完整 `npm test`。不需要启动 dev server，不需要 Playwright。

## 回报

将汇报写入：

`tech/roles/development/parallel-sessions/20260827-job-navigation-ws0/reports/ws0-contracts.md`

内容包括：实际修改文件、关键契约选择、官方来源审查结论与未核实项、专项/完整门禁结果、提交号、
越界检查。保持分支和 worktree 原地，不 merge、不 push。
