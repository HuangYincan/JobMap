# WS-thinkfix — 思考过程隐藏,只留「思考中/思考完成」状态(boss 派发,mini worker)

## 背景

用户要求(2026-08-21):「把agent的思考过程隐藏不要暴露,只留'思考中'与'思考完成'」。

现状:`server/src/components/agent-panel.tsx` 把 reasoning 事件内容累积到消息 `reasoning` 字段,渲染成
可折叠「💭 思考过程」块(默认展开)——思考原文对用户可见。要求:**内容一律不渲染**,只显示两个状态。

**后端不改**:reasoning 事件继续从 SSE 下发(run-agent 的 onTurnReasoning 回传机制是 DeepSeek
思考模式必需,与事件转发同源),前端只是不再展示内容、只用它标记「是否有过思考」。

worktree: `/Users/acccan/dm-wt-agent-thinkfix`(分支 `feature/agent-think-hide`,已从 dev `4f73104` 切出)
汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-agent-thinkfix/reports/ws-thinkfix.md`

## 任务(4 文件 + 测试)

### 1. 消息状态(agent-panel-state.ts 或 panel 内,以实际实现为准)

- `AgentMessage.reasoning` 从「内容字符串」改为**状态标记**(建议 `reasoning?: 'thinking' | 'done'` 或布尔,
  随实际状态机选型;保留事件累积逻辑的位置,但值不再用于渲染内容)。
- `reduceAgentEvent` 的 reasoning 分支:标记消息为「正在思考」;该消息出现 delta(内容产出)或流轮结束时,
  标记翻转为「思考完成」——纯函数内可判定(消息 content 非空或收到 done/tool 事件即视为本轮思考结束)。
- 轮次语义保持(uxfix 已实现的按轮拆分不能破坏:reasoning 归属轮、拆轮规则、tool 原位更新等现有测试全绿)。

### 2. 渲染(agent-panel.tsx)

- **移除**:折叠思考块(thinkingToggle/thinkingBody/thinkingChevron/collapsedThinking 状态与 toggleThinking)、
  「💭 agentThinkingSection」标题。
- **新增**:每条**有思考标记**的助手消息顶部渲染一行弱化状态(替代原折叠块位置,样式沿用/微调现有 thinking 容器):
  - 该消息思考未结束(仍在本轮流式、内容为空)→「💭 思考中…」(可用三点动画或静态省略号,建议加 pulse 弱动画,沿用 liquid glass 弱化文字样式);
  - 思考已完成 →「💭 思考完成」(静态弱化行)。
- 判定以纯函数结果为准(第 1 节),组件只消费状态值。
- 顶部「正在调用工具」状态条逻辑不动;思考状态不单独占顶部条。

### 3. i18n(server/src/lib/i18n.ts)

- 新增 `agentThinking`(zh:「思考中…」/ en:「Thinking…」)与 `agentThinkingDone`(zh:「思考完成」/ en:「Thinking done」)。
- `agentThinkingSection` 若不再被引用 → 删除(全仓 grep 确认;component-contracts 等测试如有断言 → 同步更新)。

### 4. 测试

- `agent-panel-state.test.mjs`:reasoning 标记流转用例(思考中→思考完成翻转;多轮各自标记;与既有拆轮/工具用例共存)。
- `component-contracts.test.mjs`:折叠块断言更新为状态行断言(如有);SSE 侧 reasoning 事件转发契约不动(后端不改)。
- 全量回归:`npm test` 988+ 零漂移。

## 不碰(红线)

后端 agent 全套(types/run-agent/route/llm-provider/mcp-*/tools/*)、chat-client、executor、bridge、
ball、map-shell、map-engine/**。i18n 只改上述键。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-thinkfix/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-thinkfix && make docs-check && git diff --check
```

## 纪律

小步 commit(`fix(agent-ui): ...`);不 push/不切分支;只动上述文件。

## 回报

写 `reports/ws-thinkfix.md`(改动摘要 + 测试结论 + 门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
