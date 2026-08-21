# ws-done 汇报(2026-08-22)

## 实际改动

worktree `/Users/acccan/dm-wt-agent-done`(分支 `feature/agent-completion-ui`),3 个 commit:

- `server/src/components/agent-map-executor.ts`
  - undo 栈条目改为带类型标记 `{kind: AgentUndoKind, run}`:`camera`(flyTo 逆操作)/ `overlay`(addMarkers/drawCircle 清理)/ `select` / `detail`(历史回放);
  - 新增 `clearOverlays(): void`:只执行并移出栈中 `overlay` 类条目(倒序遍历,后进先出),camera/select/detail 保留,`undo()` 语义不变;`canUndo()/reset()` 不变;
  - 新增纯函数 `resolveCompletion(doneReceived, aborted): 'done' | 'stopped' | null`(done 优先,abort → stopped,其余 null)+ 导出 `AgentCompletionState` 类型。
- `server/src/components/agent-panel.tsx`
  - 新增完成状态 `completion: 'done' | 'stopped' | null` + `truncated: boolean` + `doneRef`(finally 判定用同步 ref):
    - `done` 事件 → `completion='done'` + `truncated`(有截断标记);无执行器分支同样透传 `ev.truncated`;
    - 用户点「停止」→ abort → `finally` 用 `resolveCompletion(doneRef.current, controller.signal.aborted)` 置 `'stopped'`(以 finally 为准,防重复);
    - 新消息发送 / 清屏时清零;
  - 渲染:消息列表**尾部**、输入框之前渲染弱化状态行(`role="status"`):done →「✓ 回答完成」(truncated 附「 · 已达回答上限,部分内容被截断」)、stopped →「■ 已停止」;流式期间不显示(`completion && !streaming`);
  - footer 控件区新增「清屏」按钮(与停止/撤销并列):`clearOverlays()` + 清空 messages + `sessionStorage.removeItem(HISTORY_KEY)` + 清 completion/truncated/notConfigured/fatalError/tool;流式期间禁用(`disabled={streaming}`,不打断回答);清屏后 undo 栈的相机/select 条目保留(可继续撤销)。
- `server/src/components/agent-panel.module.css`:新增 `.completion`(居中弱化小字,`--muted` 11px,与 thinking/toolBar 弱化体系一致)。
- `server/src/lib/i18n.ts`:新键 `agentDone`(回答完成/Done)、`agentStopped`(已停止/Stopped)、`agentTruncated`(已达回答上限,部分内容被截断/Reached reply limit, truncated)、`agentClear`(清屏/Clear)。
- `server/tests/agent-map-executor.test.mjs`(+3 测试):`resolveCompletion` 四态纯函数;`clearOverlays` 混合栈只清 overlay(camera/select 保留可继续 undo);`clearOverlays` 无 overlay 条目栈不变。
- `server/tests/component-contracts.test.mjs`(+1 契约测试 ws-done):4 个 i18n 键双语、completion 双分支渲染与 `completion && !streaming` 门控、`resolveCompletion` finally 接线、清屏按钮 `onClick={clearScreen} disabled={streaming}` + clearOverlays + removeItem(HISTORY_KEY)、undo 栈 kind 标记与 `clearOverlays` 契约。

## 门禁结果

- npm test: 1157 通过 / 0 失败 / 2 skip(全量,含新增 4 条:3 executor 单测 + 1 组件契约)
- typecheck: 通过
- docs-check: 通过
- git diff --check: 通过(提交后工作树干净)

## 遇到的问题

无。「清屏」是否清空输入框:spec 未列,按 spec 精确实现未清(输入框内容保留,仅清消息/历史/状态/覆盖物)。

## 证据

- 新增测试运行输出(全量 1159 测试摘要):
  - `✔ resolveCompletion: done 优先,abort 判定 stopped,其余 null(纯函数)`
  - `✔ clearOverlays: 只清 overlay 类条目(相机/select 保留,可继续 undo)`
  - `✔ clearOverlays: 无 overlay 条目 → 栈不变,不执行任何逆操作`
  - `✔ agent panel completion status + clear screen (ws-done)`
  - `ℹ tests 1159 / pass 1157 / fail 0 / skipped 2`
- `git log --oneline -4`:
  - `47a0af0 test(agent-ui): clearOverlays/resolveCompletion 单测 + ws-done 组件契约(ws-done)`
  - `a18c7f1 feat(agent-ui): 完成/停止显式状态行 + 清屏按钮,新 i18n 键(ws-done)`
  - `e4e1b14 feat(agent-ui): undo 栈条目带 kind 标记,新增 clearOverlays 只清覆盖物(ws-done)`
- 未截图(无浏览器会话);UI 视觉为弱化小字状态行 + footer 第三个控件按钮,与现有 controlBtn/thinking 体系同源。

门禁: PASSED
结论: OK
