# WS-bubble — 删除空白气泡与思考提示(boss 派发,mini worker)

## 背景

用户要求(2026-08-22):「删掉agent的空白气泡与思考提示」。

现状(agent-panel.tsx + agent-panel-state.ts,thinkfix 起):
1. **思考提示**:每条有思考标记的助手消息顶部渲染「💭 思考中… / 💭 思考完成」状态行 —— 整体删除;
2. **空白气泡**:助手消息 content 为空时(纯工具轮、或思考标记所在消息)渲染一个空 bubble div —— 内容为空则不渲染气泡。

reasoning 事件流(SSE)后端照发不变;前端不再消费其内容与状态。

worktree: `/Users/acccan/dm-wt-agent-bubble`(分支 `feature/agent-drop-think-ui`,已从 dev `c5dd6fd` 切出)
汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-agent-navi/reports/ws-bubble.md`

## 任务

1. `server/src/lib/agent-panel-state.ts`:
   - reasoning 分支改为 **no-op**(事件到达不产生消息、不存状态、不触发拆轮);
   - `AgentMessage` 移除 `reasoning` 字段(如该文件定义;类型随用随清);
   - 拆轮规则保持(delta/tool/action 现有语义不变),既有轮序(文本1→工具1→文本2…)不回归。
2. `server/src/components/agent-panel.tsx`:
   - 删除思考状态行 JSX 与相关状态/回调(collapsedThinking 等若已成死代码一并清);
   - **气泡条件渲染**:assistant 消息 `content` 为空(trim 后)且无 actions → 不渲染气泡 div;
     纯工具轮(有 tools 无内容)只显示工具活动列表;
   - 事件入口中 reasoning 分支移除(dispatchEvent/执行器回调链)。
3. `server/src/lib/i18n.ts`:`agentThinking`/`agentThinkingDone` 键删除(全仓 grep 确认无引用;组件/契约测试同步)。
4. `server/src/components/agent-panel.module.css`:thinking 相关类清理(零残留,按需删)。
5. 测试:
   - `agent-panel-state.test.mjs`:reasoning 不再产生消息/状态(更新原思考流转用例);拆轮/工具/action 用例全绿;
   - `component-contracts.test.mjs`:思考状态行断言删除;空气泡不渲染相关断言(如有)更新;
   - 全量回归零漂移。

## 不碰(红线)

后端 agent 全套、markdown-pipeline/markdown-text(ws-navi2 在改)、executor、bridge、ball、引擎。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-bubble/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-bubble && make docs-check && git diff --check
```

## 纪律

小步 commit(`fix(agent-ui): ...`);不 push/不切分支;只动上述文件。

## 回报

写 `reports/ws-bubble.md`(改动摘要 + 测试结论 + 门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
