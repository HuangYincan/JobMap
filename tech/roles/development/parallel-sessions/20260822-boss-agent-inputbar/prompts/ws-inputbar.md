# WS-inputbar — 输入行 UX:发送↔停止原位切换 + 清屏移左(boss 派发,mini worker)

## 背景

用户要求(2026-08-22):
1. 发送消息后,原先的「发送」按钮改成「停止」——即**流式进行中,输入行右侧的发送按钮原位变为「停止」**(点击 = 中止,语义替代现有 footer 里独立的停止控件);
2. 清屏按钮移到左侧——footer 控件行清屏移到最左(停止并入发送位后,控件行剩 清屏 + 撤销)。

现状(agent-panel.tsx footer):输入行 [input] [发送];控件行 [停止] [撤销] [清屏]。

目标布局:
```
┌────────────────────────────────────────────┐
│ [清屏] [撤销]                                │ ← 控件行:清屏最左;停止控件移除(并入发送位)
│ [输入框.........................] [发送|停止] │ ← 流式中按钮原位变「停止」(图标/文案切换)
└────────────────────────────────────────────┘
```

worktree: `/Users/acccan/dm-wt-agent-inputbar`(分支 `fix/agent-inputbar-ux`,已从 dev `ef20c09` 切出)
汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-agent-inputbar/reports/ws-inputbar.md`

## 任务

1. `server/src/components/agent-panel.tsx` footer:
   - 发送按钮:`streaming ? 渲染「停止」(onClick=stop,样式=警示语义,与现有 stop 视觉一致或红系)
     : 渲染「发送」(onClick=send,disabled 条件不变)`;
   - 控件行:移除独立「停止」控件;顺序改为 [清屏] [撤销](清屏最左);
   - 「停止」文案复用现有 i18n `agentStop`;不需要新键。
2. `agent-panel.module.css`:按需调整(发送/停止双态样式类、控件行布局);现有样式语义保持。
3. 测试:
   - 组件契约:断言发送按钮双态渲染分支(streaming → stop)、控件行顺序(清屏在撤销前)、独立停止控件不再存在;
   - 全量回归零漂移。

## 不碰(红线)

后端 agent 全套、会话/记忆逻辑(clearScreen/stop 的**行为**不动,只动 UI 呈现与位置)、引擎、markdown。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-inputbar/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-inputbar && make docs-check && git diff --check
```

## 纪律

小步 commit(`fix(agent-ui): ...`);不 push/不切分支;只动上述文件。

## 回报

写 `reports/ws-inputbar.md`(改动摘要 + 测试结论 + 门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
