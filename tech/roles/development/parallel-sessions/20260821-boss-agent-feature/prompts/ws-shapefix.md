# WS-shapefix — tool_calls 消息形状修复(boss 派发,mini worker)

## 背景

boss 用真实 API 复现定位到第二个 bug(第一个 reasoning_content 回传已由 ws-rfix 修复并合并):
agent 循环发送 assistant 消息时,**tool_calls 用了扁平形状** `{id, name, arguments}`,而 OpenAI 兼容 API 要求
`{id, type:'function', function:{name, arguments}}`。DeepSeek 真实响应:
`400 Failed to deserialize the JSON body into the target type: messages[2]: missing field 'type'`。
已用真实 API 验证:扁平形状 → 400;正确形状 → 200。

根因:`server/src/lib/agent/types.ts` 的 `ChatMessage.tool_calls` 存的是扁平形状(delta 解析产物),
`llm-provider.ts` 序列化请求体时**未转换**为 OpenAI chat-completions 消息格式。

worktree: `/Users/acccan/dm-wt-agent-sfix`(分支 `feature/agent-toolcalls-shape`,已从 dev `6bfb73a` 切出)
汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-agent-feature/reports/ws-shapefix.md`

## 任务(2 文件 + 测试)

1. `/Users/acccan/dm-wt-agent-sfix/server/src/lib/agent/llm-provider.ts`:构建请求体(约 L102 JSON.stringify 处)时,
   对 `role==='assistant'` 且带 `tool_calls` 的消息,映射为:
   ```ts
   tool_calls: msg.tool_calls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } }))
   ```
   (保留 id 原值;arguments 保持字符串原样;工具消息 role:'tool'/tool_call_id 已正确,不动)。
2. 测试 `/Users/acccan/dm-wt-agent-sfix/server/tests/agent-llm-provider.test.mjs`:追加用例——mock fetchLike 捕获请求体,
   断言 assistant(tool_calls) 消息的 tool_calls 条目含 `type:'function'` 与嵌套 `function:{name,arguments}`;无 tool_calls 的消息不受影响。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-sfix/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-sfix && make docs-check && git diff --check
```

## 纪律

小步 commit(`fix(agent): ...`);不 push/不切分支;只动上述文件。

## 回报

写 `reports/ws-shapefix.md`(改动摘要 + 测试结论 + 门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
