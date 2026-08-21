# WS-done — 对话完成/停止显式 UI + 清屏功能(boss 派发,mini worker)

## 背景

用户要求(2026-08-22,两条):
1. 「单次对话完成或用户按停止后需要有显式ui说明」;
2. 「加入清屏功能」。

现状(agent-panel.tsx):流式结束(`done` 事件 / 用户点「停止」abort)后只清理状态,**无任何 UI 说明**;
面板无清屏入口(历史存 sessionStorage 'dm.agent-history.v1',agent 覆盖物留在地图上)。

worktree: `/Users/acccan/dm-wt-agent-done`(分支 `feature/agent-completion-ui`,boss 合并 bubble 后从 dev 切出)
汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-agent-navi/reports/ws-done.md`

## 任务

### A. 完成/停止显式 UI

1. `server/src/components/agent-panel.tsx`:
   - 新增完成状态:`completion: 'done' | 'stopped' | null`;
     - `done` 事件 → `'done'`(truncated 时文案可带「已截断」说明,可选);
     - 用户点「停止」→ abort 后 finally 判定 → `'stopped'`;
     - 新用户消息发送时清零;
   - 渲染:消息列表**尾部**(streaming 结束后)渲染一行弱化状态:
     - done:「✓ 回答完成」;stopped:「■ 已停止」(liquid glass 弱化小字,与现有 toolBar/notice 样式体系一致);
     - 位置在最后一条消息之后、输入框之前;流式期间不显示。
   - 顶部「正在调用工具」状态条与停止按钮逻辑不动;停止点击后状态置 stopped(以 finally 为准防重复)。
2. `server/src/lib/i18n.ts`:新键 `agentDone`(zh「回答完成」/en「Done」)、`agentStopped`(zh「已停止」/en「Stopped」);
   truncated 文案 `agentTruncated`(zh「已达回答上限,部分内容被截断」/en「Reached reply limit, truncated」)。

### B. 清屏功能

3. `server/src/components/agent-map-executor.ts`:
   - undo 栈条目带类型标记(如 `{kind: 'camera'|'overlay'|'select'|'detail', run}`);
   - 新增方法 `clearOverlays(): void`:只执行 `overlay` 类条目(flyTo 逆操作等非覆盖物不动),并清出栈;
     `undo()` 语义不变(仍从栈顶弹一条执行);
   - `canUndo()/reset()` 语义保持。
4. `server/src/components/agent-panel.tsx`:footer 控件区新增「清屏」按钮(与停止/撤销并列):
   - 点击:执行器 `clearOverlays()` + 清空 messages + 清 sessionStorage 历史 + 清 completion/notConfigured/fatalError 状态;
   - 流式期间禁用(或点击先 stop 再清,二选一,取稳妥:流式期间禁用)。
5. `server/src/lib/i18n.ts`:新键 `agentClear`(zh「清屏」/en「Clear」)。

### C. 测试

- `agent-map-executor.test.mjs`:clearOverlays 只清 overlay 类(相机/select 条目保留可继续 undo);undo 语义回归;
- 组件契约测试:agentDone/agentStopped/agentClear 键与渲染分支存在(正则);
- 完成状态如可纯函数化(如 `resolveCompletion(streaming, aborted, done)`)→ 抽出单测;不可则组件内 + 契约覆盖;
- 全量回归零漂移。

## 不碰(红线)

后端 agent 全套、markdown 管线/组件、bridge、ball、引擎、agent-panel-state(状态机不动)。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-done/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-done && make docs-check && git diff --check
```

## 纪律

小步 commit(`feat(agent-ui): ...`);不 push/不切分支;只动上述文件。

## 回报

写 `reports/ws-done.md`(改动摘要 + 测试结论 + 门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
