# WS-pstream — agent 会话并行流(切换不打断)(boss 派发)

## 背景

用户反馈(2026-08-22):「agent会话间不能并行,现在切会话必定打断现有会话」。

现状(agent-panel.tsx):单个 `runStream` + 单个 abortRef + 单一 messages 状态;切换会话时
`if (streaming) stop()`(panel2 起)—— 切走即中止当前流。要求:**切会话不打断**;流式中的会话
切走后继续在后台跑,切回时看到完整结果;同一时刻可有多会话流式(并行)。

worktree: `/Users/acccan/dm-wt-agent-pstream`(分支 `feat/agent-parallel-streams`,已从 dev `7b515e6` 切出)
汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-agent-parallel-stream/reports/ws-pstream.md`

## 任务(`server/src/components/agent-panel.tsx` 重构 + 测试;纯函数可抽则抽)

### 1. 每会话独立流状态

- 流状态从单例改为 **`Map<sessionId, SessionStream>`**:
  `{ controller: AbortController, streaming: boolean, messages: AgentMessage[] }`(内存为事实源);
- 发送消息:`runStream(sessionId, req)` —— 事件(delta/reasoning/tool/action/done/error)按**流所属
  sessionId** 路由到该会话的 messages(不再写「当前会话」),done/error 时置 streaming=false 并同步 store;
- 当前显示 = `streams.get(activeId)?.messages ?? 从 store 载入`;切换会话只改 activeId,
  **不 stop、不打断**;
- 停止按钮(发送位变体)= 停止**当前会话**的流(该会话 streaming=false,其余会话不受影响);
- 完成/停止状态行、顶部工具条:per-session(切走再切回,状态仍正确);
- 会话删除:同时终止并移除该会话的 stream;清屏:当前会话清空(流式时先停当前会话);
- 会话列表(弹层):流式中的会话显示**进行中标记**(弱化蓝点/转圈,沿用 liquid glass 弱化样式)—— 加分项,必做;
- 流式中的会话切走:**store 同步**——切回时若内存无该会话(刷新过)则回落到 store 最后状态;
  正常路径(未刷新)内存为准。

### 2. 边界

- 同一会话重复发送:streaming 中发送按钮已是「停止」,防重入不变;
- 会话列表 cap/删除/迁移语义不变(agent-session-store 不动);
- 记忆/清屏/覆盖物逻辑不变(clearOverlays 等照旧);
- React 严格模式/组件卸载:所有 stream 的 controller 在卸载时 abort(清理不泄漏)。

### 3. 测试

- 纯函数化(如 `createSessionStreamMap` 增删/路由/终止 或等价)→ 单测矩阵:
  并发两会话流互不打断、done 只落该会话、删会话终止流、卸载清理;
- 组件契约:切会话不再调用 stop(正则断言切换路径无 `stop()` 或行为等价断言)、会话列表进行中标记条件渲染;
- 全量回归零漂移。

## 不碰(红线)

后端 agent 全套、agent-session-store(存储格式不动)、记忆 API、executor(仅调用,不改)、引擎、markdown、
i18n(如需新键仅「进行中」类小键,注明)。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-pstream/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-pstream && make docs-check && git diff --check
```

## 纪律

小步 commit(`feat(agent-ui): ...`);不 push/不切分支;只动上述文件。

## 回报

写 `reports/ws-pstream.md`(改动摘要 + 测试结论 + 门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

## 续作说明(boss 恢复派发,2026-08-22)

上一轮 worker 中途退出:分支已有 1 commit(561e668 agent-stream-store 纯函数)。**不要重做已提交成果**:
先 `git log --oneline -5` 核对,验证 561e668 的纯函数符合上述契约(不合才改),继续完成:agent-panel.tsx
的每会话流接线(任务节 1),更新 2 个行为变更测试(组件契约切会话不再 stop 等——以实际失败用例为准),
跑全量门禁,写汇报。
