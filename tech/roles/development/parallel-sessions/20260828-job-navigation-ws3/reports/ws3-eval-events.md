# ws3-eval-events 汇报(2026-08-28)

## 实际改动

- `server/src/lib/navigation/analytics.ts` → 可替换产品事件 sink：闭合 9 个 §7.1 事件名、允许字段白名单、`parseNavigationEvent` / `assertSafeNavigationEvent` 对未知字段与禁止字段失败；`createMemorySink` / `createJsonlSink`；不落库。
- `server/src/lib/navigation/eval-policy.ts` → 确定性首工具策略（`job_search`→`work__searchPositions`，`job_compare`→`navigation__compareCommutes`，`interview_arrival`→`navigation__planRoute`，缺槽/解析失败禁止规划）与 §7.3 指标纯函数。
- `server/src/lib/navigation/eval-runner.ts` → 离线 runner：40 条 fixture 解析/发射事件/按 playbook 跑注入工具；extra 安全用例（过期/越权 artifact、超时显式降级、estimate 无 `routeId`、三主场景 fake provider 成功链、非法动作）。
- `server/src/lib/navigation/index.ts` → 最小导出 sink / 策略 / runner。
- `server/tests/fixtures/navigation-eval-playbook.json` → 覆盖全部 40 个 id 的 sidecar（未改 `navigation-eval-cases.json` 契约内容）。
- `server/tests/navigation-eval-runner.test.mjs` → sink、40 条 12/10/10/8、策略一致性、非法动作 100%、estimate 无 geometry/`routeId`、fake provider 成功路径、Python 数字对齐、源码不写 `audit_events`。
- `server/scripts/navigation-eval/**` → 数据字典指针、`funnel.sql`（示例 SQLite 表 `navigation_events`）、stdlib `report.py`、无 PII 的 `events.example.jsonl`。
- `tech/roles/development/eval/navigation-events.md`、`navigation-ws3-baseline.md` → 字段字典与基线（样本量/偏差/不能推出的结论）。
- `tech/31-job-navigation-agent-plan.md`、`tech/01-architecture.md`、`tech/06-decisions.md` ADR-008、`tech/20-development-plan.md` D4、`CHANGELOG.md` → 按可验证事实同步；WS3/M4 只写离线指标/报告已实现，UI/真实用户未实现。

## 关键不变量

- 不落库；生产 chat / RouteService 未接线 sink（测试 grep 覆盖）。
- 不复用、不 `INSERT INTO` `audit_events`；漏斗查示例 SQLite 表。
- 40 条契约 fixture 的 `id` / `scenario` / `utterance` / `candidate` / `expected.{task,ok,missingSlots,errorCode}` 未改；`navigation-contracts.test.mjs` 仍绿。
- 指标是确定性契约/策略，不是线上 LLM；事件无 utterance、无 lng/lat、无 geometry、无密钥。

## 门禁结果

- 指定三文件：39 通过 / 0 失败
- npm test: 1815 通过 / 0 失败 / 3 skip（共 1818）
- typecheck / docs-check / git diff --check: 通过
- 工作树干净；未 merge、未 push

## 遇到的问题

- 无阻塞。漏斗 SQL 用 Python stdlib `sqlite3` 执行（不依赖 `sqlite3` CLI）。
- 测试文件自身含 `audit_events` 字样的否定断言，源码扫描排除测试文件，只扫实现与 SQL/Python。

## 证据

- 本批 runner 观察值：槽位 200/200、工具 40/40、质量标注 13/13、非法动作 204/204、显式降级 12/12（均为 1.00）。
- extra 10 条：过期/越权 artifact、timeout→estimate、timeout 且禁止 fallback 不静默成功、estimate 无 routeId、三主场景 fake provider、额外非法动作。
- Python `report.py` spawn 对比 Node 指标，允许 1e-9 浮点误差，实际整数完全一致。
- tip `d52f0b4`；commits：`f278ea5` feat sink/policy/runner → `5481c18` test → `b02374a` feat SQL/Python → `d52f0b4` docs。

## 剩余风险

- 未测 UI / overlay / 桌面移动端到端（WS4）。
- 无 LLM、无真实路况、无真实用户；40 条仍是合成输入。
- 产品事件 persistence 仍 deferred。
- 生产仍零 live provider。

## 范围核对

- 拥有文件均已改；`navigation-eval-cases.json`、前端、`db/**`、`.env*`、chat 落库、`crawler/**`、npm/pip 依赖：零改动。

门禁: PASSED
结论: OK
