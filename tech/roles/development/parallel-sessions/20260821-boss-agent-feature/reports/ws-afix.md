# ws-afix 汇报(2026-08-21)

worktree: `/Users/acccan/dm-wt-agent-afix`(分支 `feature/agent-action-prompt`,基线 dev `bb4252a`)
交付 1 commit:`d591222`(fix(agent): prompts 内嵌完整动作契约示例)。

## 实际改动

- `server/src/lib/agent/prompts.ts` → 「动作纪律 / Action discipline」节后追加**完整动作契约**,
  中英文各一份,6 种动作逐字与 `action-schema.ts` 的 `validateAction` 对齐,每个动作含可复制
  JSON 示例 + 字段说明:
  - `flyTo`:`{"type":"flyTo","payload":{"center":{"lng":120.15,"lat":30.25},"zoom":14}}`
    — center 为嵌套对象必含 lng/lat;zoom 可选数字
  - `select`:`{"type":"select","payload":{"id":"poi-id","mode":"card"}}` — id 必填;mode 可选
    `"card"|"detail"`
  - `addMarkers`:`{"type":"addMarkers","payload":{"points":[{"lng":120.15,"lat":30.25,"label":"可选"}]}}`
    — points 数组 1..50 个点,label 可选
  - `drawCircle`:`{"type":"drawCircle","payload":{"center":{"lng":120.15,"lat":30.25},"radiusMeters":1000,"label":"可选"}}`
    — radiusMeters 必填 10..50000(米)
  - `openDetail`:`{"type":"openDetail","payload":{"id":"poi-id"}}` — id 必填
  - `search`:`{"type":"search","payload":{"query":"关键词","mode":"card"}}` — query 必填非空;mode 可选
  - 节首明确强调:payload 字段名与嵌套必须与示例逐字一致,**不允许扁平替代**(lng/lat 必须包在
    center 里)。原有 3 条动作纪律/能力边界/安全红线/输出格式行零改动,字符串拼接风格保持一致。
- `server/tests/agent-prompts.test.mjs` → 追加 3 测试(原有测试零修改):
  1. 中英文均含 6 种动作的完整示例 JSON(逐字 `includes` 断言,与 validateAction 形状一致);
  2. flyTo/drawCircle 不得出现扁平 `"payload":{"lng":` 形态(zh/en);
  3. 边界数字与 schema 一致(points `1..50`、radiusMeters `10..50000`,zh/en)。
- `tech/24-agent-feature.md` → §4.3 校验边界末尾补注(沿用文档「增补(ws-*)」体例):
  「LLM 所见动作契约由 `prompts.ts` 的动作契约示例承载(中英文各一份,逐字段与 `validateAction`
  对齐),以 `validateAction` 为准。」文档 §4.2 白名单类型与 §4.3 边界表与 prompt 契约无矛盾,
  未重写其余内容。

## 门禁结果

- `npm test`(server):**975 测试,973 通过 / 2 skip / 0 失败**(含新增 3 测试全绿,零漂移)
- `npm run typecheck`:通过(tsc --noEmit 无输出)
- `make docs-check`:通过(Documentation policy check passed)
- `git diff --check`:通过(无空白错误);`git status --short` 干净

## 遇到的问题

1. **addMarkers 点数边界:brief 写「1..5 个点」,schema 实为 1..50** — `action-schema.ts` 与前端
   执行器 `agent-map-executor.ts` 的 `MAX_POINTS` 均为 50,代码中不存在 5 点上限;按 brief 自身
   裁决规则「逐字与 validateAction 对齐,以 action-schema.ts 为准」,prompt 写为 **1..50** 并与
   schema 完全一致。若 boss 本意是刻意收紧 LLM 输出(产品策略),需改 schema 或另行指示。
2. `node --test` 直接跑单文件被沙箱拦截,门禁以 `npm test --prefix <worktree>/server` 全量跑通
   (975 条),覆盖同一套命令。

## 证据

- 新增测试运行结果(grep 于全量输出):
  - `✔ buildSystemPrompt: 动作契约(zh/en)均含 6 种动作示例 JSON(逐字段与 validateAction 一致)`
  - `✔ buildSystemPrompt: flyTo/drawCircle 必须嵌套 center,不允许扁平 lng/lat(zh/en)`
  - `✔ buildSystemPrompt: 动作契约边界数字与 validateAction 一致(points 1..50、radiusMeters 10..50000,zh/en)`
- 全量输出尾部:`ℹ tests 975 / ℹ pass 973 / ℹ fail 0 / ℹ cancelled 0 / ℹ skipped 2`
- commit:`d591222`(prompts.ts + agent-prompts.test.mjs + tech/24-agent-feature.md,3 files,+57)

门禁: PASSED
结论: OK
