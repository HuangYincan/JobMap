# WS3 Eval Runner and Event Sink — boss-worker prompt

## 绝对路径

- 主仓库（只读，不得修改）：`/Users/acccan/Repos/huangyincan/domain-map`
- 你的 worktree：`/Users/acccan/dm-wt-job-navigation-ws3-eval-events`
- 你的分支：`feature/job-navigation-ws3-eval-events`
- 批次目录：`/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260828-job-navigation-ws3`
- 最终汇报：`/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260828-job-navigation-ws3/reports/ws3-eval-events.md`

worktree 已由 boss 预建。所有代码、测试、文档修改与 commit 只发生在 worktree；不要 merge
回 `dev`，不要 push。`git add` 只添加你实际修改的具体路径。

## 开工前必读

1. worktree 内 `CLAUDE.md`、`agent.md`、`server/AGENTS.md`
2. `tech/31-job-navigation-agent-plan.md` §7、§9 WS3、§10 M4
3. `tech/06-decisions.md` ADR-008（当前状态段在 WS2 后已部分过时，本批须按可验证事实更新）
4. WS0 fixture + 契约测试：`server/tests/fixtures/navigation-eval-cases.json`、
   `server/tests/navigation-contracts.test.mjs`
5. WS1/WS2：`server/src/lib/navigation/**`、`server/src/lib/agent/tools/{work,navigation}.ts`、
   `server/src/lib/agent/action-schema.ts`
6. `db/migrations/004_overlays_and_audit.sql`（只读：确认 **不要** 复用 `audit_events`）

## 目标

让 §7 的槽位/工具策略/质量标注/非法动作/显式降级指标可以离线自动计算，并产出
SQL/Python 报告。本批测量的是**确定性契约与策略**，不是线上 LLM。40 条 fixture
仍是合成输入；结论必须写明样本量、偏差、不能推出的结论。

生产 chat / RouteService **不要**开始持久化或默认发射产品事件（persistence 仍 deferred）。

## 必须交付

### A. 可替换事件 sink（契约闭合，不落库）

新增 `server/src/lib/navigation/analytics.ts`（名称可微调，保持深 module）：

- 事件名闭合为 tech/31 §7.1 首批（可少不可多；若少必须在数据字典说明为何）：
  `navigation_intent_parsed`、`navigation_slot_clarified`、`navigation_job_search_completed`、
  `navigation_route_requested`、`navigation_route_resolved`、`navigation_route_degraded`、
  `navigation_comparison_viewed`、`navigation_route_action_applied`、`navigation_task_completed`
- 允许字段：任务类型、城市、方式、候选数、耗时、结果数、路线质量、失败类别、是否完成、
  稳定 caseId、事件名、ISO 时间
- **禁止**出现在事件对象键或值里：原始 utterance/完整对话、完整地址、精确起终点
  （不要写 lng/lat）、polyline/geometry、供应商原始响应、密钥、cookie、用户记忆全文
- `NavigationEventSink`：`emit(event)`；至少实现
  1. `createMemorySink()`（测试默认）
  2. `createJsonlSink(writable)` 或等价，供报告消费
- `parseNavigationEvent` / `assertSafeNavigationEvent`：未知字段失败；禁止字段失败
- 生产默认：不把 sink 接到 chat route 或 RouteService。runner 显式注入。

### B. 离线 runner + 确定性策略

新增 runner 模块（建议 `server/src/lib/navigation/eval-runner.ts` +
`eval-policy.ts`）和 sidecar
`server/tests/fixtures/navigation-eval-playbook.json`：

- **不要改** `navigation-eval-cases.json` 的 40 条 `id` / `scenario` / `utterance` /
  `candidate` / `expected.{task,ok,missingSlots,errorCode}`。现有
  `navigation-contracts.test.mjs` 必须继续绿。
- playbook 按 fixture `id` 给出：允许工具序列、禁止动作、缺槽时禁止规划、期望
  quality（`estimate` vs 注入 fake 的 `provider_route`）。
- runner 对每条 fixture：
  1. `parseNavigationIntent(candidate)`，对照 `expected`
  2. 发射 intent/slot 事件（事件中不得含 utterance）
  3. `missingSlots` 非空或 `ok=false` → 不打 RouteService / 域工具
  4. 否则按策略选择**一个**首工具，并可用注入的 `workTools` / `navigationTools` /
     `RouteService` 跑完 playbook 序列（合成 catalog + estimate 或 fake provider）
  5. 对禁止动作调用 `validateAction`（畸形/过短/带 geometry/`showRoute` 越权 ID）
     必须 100% 拒绝
- 额外 runner 用例（不要塞进那 40 条契约 fixture）：过期/越权 artifact、超时、
  estimate 不得带 `routeId`。可复用 WS1 store API，进程内、无网络。
- 策略必须可测：`job_search`+通勤完整 → 先 `work__searchPositions`；`job_compare`
  完整 → `navigation__compareCommutes`；`interview_arrival` 完整 →
  `navigation__planRoute`；缺槽 → 无工具。

三主场景后端链（注入 fake）必须在 runner 或专项测试里各至少 1 条成功路径。

### C. 指标计算（§7.3 中本批能测的）

Node 侧纯函数计算并在测试里钉死门槛：

| 指标 | 本批门槛 | 口径 |
|---|---:|---|
| 必填槽位识别准确率 | ≥ 90% | 40 条 fixture 逐槽位 micro accuracy（相对 `expected.missingSlots`） |
| 工具选择准确率 | ≥ 90% | 策略首工具 vs playbook；缺槽/失败案例的「禁止规划」算对 |
| 路线来源/质量标注 | 100% | runner 产生的每条路线结果均有 provider、fetchedAt、quality |
| 非法动作阻断率 | 100% | 注入的非法 `showRoute` / 未知动作全拒绝 |
| 供应商失败显式降级 | 100% | estimate 不得标成 `provider_route`；失败不得静默变成功 |

**不要**声称「三条核心场景端到端桌面/移动 100%」——那是 WS4。文档写明未测 UI。
业务增长指标（任务完成率等）只建口径和示例计算，不编造生产基线。

### D. SQL + Python 报告

在 `server/scripts/navigation-eval/`（新建，stdlib only）：

1. **数据字典**（Markdown，可放同目录 `README.md` 或
   `tech/roles/development/eval/navigation-events.md`）：字段、类型、禁止字段、
   示例一行。
2. `funnel.sql`：任务漏斗、路线降级率、各方式耗时分布、0 结果率、澄清后完成率。
   查询的是**示例事件表/CSV/SQLite**，不是 Postgres `audit_events`。测试可用
   `sqlite3`（macOS 自带）把 runner JSONL 导入后跑 SQL，或用 Python 等价断言；
   若环境无 sqlite3，用 Python 完成同一口径并在汇报写明。
3. `report.py`：读 runner JSON 结果，计算与 Node 相同的槽位/工具/动作指标，输出
   Markdown + CSV。Node 测试 spawn `python3`，对比关键数字（允许浮点误差）。
   不新增 pip 依赖，不改 `crawler/pyproject.toml`。
4. 基线结论：
   `tech/roles/development/eval/navigation-ws3-baseline.md`
   必须包含：样本量（40 合成 + runner 附加安全用例）、偏差（无 LLM、无真实路况、
   无真实用户）、不能推出的结论、下一轮假设。禁止写成产品已达标或真实通勤可用。

Runner 写出的示例 JSON/JSONL 必须检查禁止字段；可以提交一份小的
`*.example.jsonl`（无 PII）。

### E. 测试与文档

新增充分 Node 测试（建议 `server/tests/navigation-eval-runner.test.mjs`）：

1. sink 接受允许字段、拒绝禁止字段/未知字段
2. 40 条 fixture 经 runner 后槽位指标 ≥ 90%，且 12/10/10/8 覆盖不变
3. playbook 覆盖全部 40 个 id；策略与 playbook 一致
4. 非法动作 100% 阻断；estimate 无 routeId/geometry
5. fake provider 成功路径有 routeId，事件与报告文本仍无 geometry
6. Python 报告数字与 Node 一致
7. 源码/SQL 不含 `INSERT INTO audit_events` 或对 `audit_events` 的写入

测试必须本地、确定性、无真实网络、无 key、无 DATABASE_URL。

文档（只写可验证事实）：

- `tech/31`：WS3 改为已实现；§7.2「当前没有 runner」改为已实现；M4 只能写
  「离线指标/报告已实现，UI/真实用户样本未实现」
- `tech/01-architecture.md`：事件 sink + runner 模块；写明不落库
- ADR-008 当前状态：补 WS2 工具已合并、WS3 sink/runner 已实现；仍无 persistence、
  仍无 live provider、仍无 overlay
- `tech/20-development-plan.md` D4：部分完成（离线评测/报告已实现；persistence 仍
  deferred / 等同意与留存决策）
- `CHANGELOG.md` 一行可验证事实

## 文件边界

### 你拥有

- `server/src/lib/navigation/analytics.ts`、`eval-runner.ts`、`eval-policy.ts`（名称可微调）
- `server/src/lib/navigation/index.ts` 的最小导出
- `server/tests/fixtures/navigation-eval-playbook.json`（新建 sidecar）
- `server/tests/navigation-eval-runner.test.mjs` 及必要的小型 fixture/example
- `server/scripts/navigation-eval/**`
- `tech/roles/development/eval/navigation-ws3-baseline.md` 与事件数据字典
- `tech/31-job-navigation-agent-plan.md`、`tech/01-architecture.md`、`tech/06-decisions.md` ADR-008、
  `tech/20-development-plan.md` D4 状态、`CHANGELOG.md`

### 明确不碰

- `server/tests/fixtures/navigation-eval-cases.json` 的 40 条契约内容
- 前端组件、CSS、map-engine、overlay
- `db/**`、migration、`audit_events` 读写
- `.env*`、live provider adapter、chat route 事件落库
- `crawler/**`、npm/pip 依赖
- 不要为了「更像 LLM eval」去接真实模型

如必须越界才能完成，停止并 `结论: BLOCKED: …`，不要自行扩大范围。

## 质量要求

- TDD：先失败测试再实现
- 2 空格；不新增依赖
- 事件/报告/日志无 key、无 cookie、无 geometry 数组、无精确坐标
- 频繁小步 Conventional Commits；每次 `git add` 只列具体文件

## 门禁

```bash
cd /Users/acccan/dm-wt-job-navigation-ws3-eval-events/server
node --test --test-concurrency=1 tests/navigation-eval-runner.test.mjs tests/navigation-contracts.test.mjs tests/navigation-agent-tools.test.mjs
npm test
npm run typecheck
cd /Users/acccan/dm-wt-job-navigation-ws3-eval-events
make docs-check
git diff --check
git status --short
```

全量 `npm test` 必须串行、不要与其他重 CPU 任务并行（已知 `llm-validate` CLI 在资源
竞争下会 30s 超时变成 `exitCode=null`）。

## 汇报格式

写入指定 report，含实际改动、关键不变量（不落库、不复用 audit_events、40 条未改契约、
指标非 LLM）、门禁计数、剩余风险、commits/tip、范围核对。

末两行必须精确：

```text
门禁: PASSED
结论: OK
```

stdout ≤ 3 行，不贴代码。
