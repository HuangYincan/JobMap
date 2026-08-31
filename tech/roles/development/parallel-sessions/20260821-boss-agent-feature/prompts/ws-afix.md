# WS-afix — system prompt 嵌入完整动作契约(boss 派发,mini worker)

## 背景

boss VERIFY 冒烟(真实 API + 真实工具)定位:agent 完整走通工具流后,LLM 输出
`{"type":"flyTo","payload":{"lng":120.158108,"lat":30.241651,"zoom":15}}`,**flat lng/lat**,
但 `action-schema.ts` 的 `validateAction` 要求 flyTo payload 为**嵌套** `{"center":{"lng":..,"lat":..},"zoom":..}`,
校验拒绝 → extractActions 返回空 → SSE 无 action 事件 → 前端地图不动。

根因:`server/src/lib/agent/prompts.ts` 只写「每个动作的 type 与 payload 必须严格符合平台定义」,
**从未把具体 payload 形状给 LLM** —— LLM 只能猜,自然猜出扁平形状。动作契约权威定义在
`server/src/lib/agent/action-schema.ts`(validateAction)与 `tech/24-agent-feature.md` 动作协议节,
prompt 必须与之完全一致。

worktree: `/Users/acccan/dm-wt-agent-afix`(分支 `feature/agent-action-prompt`,已从 dev `bb4252a` 切出)
汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-agent-feature/reports/ws-afix.md`

## 任务(1 文件 + 测试)

1. `/Users/acccan/dm-wt-agent-afix/server/src/lib/agent/prompts.ts`:
   - 「动作纪律 / Action discipline」节追加**完整动作契约**,中英文各一份(逐字与
     validateAction 对齐,以 action-schema.ts 为准)。每个动作一个可复制的 JSON 示例:
     - flyTo:`{"type":"flyTo","payload":{"center":{"lng":120.15,"lat":30.25},"zoom":14}}`
       (center 为嵌套 {lng,lat};zoom 可选,数字)
     - select:`{"type":"select","payload":{"id":"poi-id","mode":"card"}}`(mode 可选:'card'|'detail')
     - addMarkers:`{"type":"addMarkers","payload":{"points":[{"lng":120.15,"lat":30.25,"label":"可选"}]}}`
       (1..5 个点)
     - drawCircle:`{"type":"drawCircle","payload":{"center":{"lng":120.15,"lat":30.25},"radiusMeters":1000,"label":"可选"}}`
       (radiusMeters 数字边界与 schema 一致)
     - openDetail:`{"type":"openDetail","payload":{"id":"poi-id"}}`
     - search:`{"type":"search","payload":{"query":"关键词","mode":"card"}}`(mode 可选)
   - 明确强调:payload 字段名/嵌套必须与示例逐字一致,不允许扁平替代(如 lng/lat 必须包在 center 里)。
   - 其余 prompt 内容不动;字符串保持拼接风格与现有函数结构(如适用)一致。
2. 测试 `server/tests/agent-prompts.test.mjs`(或现有 prompt 测试文件)追加:
   - 断言 prompt(中英文两节)均含每个动作类型的示例 JSON(如 `"type":"flyTo"` 与 `"center"` 在同一
     payload 内;`"type":"search"` 等逐个断言)。
   - 若已有「动作契约」相关断言,追加而非改旧。
3. 文档:检查 `tech/24-agent-feature.md` 动作协议节与 prompt 契约无矛盾;若 prompt 示例与文档
   有一致性表述缺失,在文档动作协议节补一句「LLM 所见动作契约由 prompts.ts 承载,以 validateAction 为准」。
   只在确有必要时改,不重写。

## 验证(冒烟等效)

单测覆盖 prompt 内容后,`npm test` 全量(含现有 972+)必须零漂移。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-afix/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-afix && make docs-check && git diff --check
```

## 纪律

小步 commit(`fix(agent): ...`);不 push/不切分支;只动上述文件。

## 回报

写 `reports/ws-afix.md`(改动摘要 + 测试结论 + 门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
