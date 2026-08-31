# WS-mem-b — agent 个性化记忆:前端管理 UI(boss 派发,在 ws-done 合并后派发)

## 背景

用户要求:「实现记忆功能,对每个用户实现个性化记忆」。后端核心由 ws-mem-a 完成
(migration/memory-store/agent 注入/route;tech/25-agent-memory.md 为权威 spec)。

本 WS 只做前端:**记忆管理入口与 UI**。注意派发顺序:本 WS 在 ws-done(完成/停止 UI + 清屏)
合并**之后**从 dev 切出(agent-panel.tsx/i18n.ts 已被 ws-done 改过,以最新 dev 为准)。

worktree: `/Users/acccan/dm-wt-agent-memb`(分支 `feature/agent-memory-ui`,boss 从最新 dev 切出后派发)
汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-agent-memory/reports/ws-mem-b.md`

## 任务

1. **`server/src/components/agent-panel.tsx`**:
   - Props 加 `user`(登录态;map-shell 已有 user,经 AgentBall 透传——agent-ball.tsx Props 同样加 user 透传);
   - header 右侧(关闭钮旁)加**记忆按钮**(登录用户才显示;guest 不渲染):
     点击 → 打开记忆弹层(面板内嵌,参照现有工具活动/思考折叠的样式体系,liquid glass);
   - 弹层内容:记忆列表(「加载中/空态「暂无记忆」/条目 + 逐条删除钮」)+「一键清除」按钮;
     数据经 `GET/POST /api/me/memories`(ws-mem-a 提供;列表 GET、清除 DELETE);
     列表加载失败 → 弱提示;
   - 「清屏」按钮语义不变(清对话,不清记忆——记忆是跨会话的)。
2. **`server/src/lib/i18n.ts`**:`agent*` 组加键:`agentMemory`(zh「记忆」/en「Memory」)、
   `agentMemoryEmpty`(zh「暂无记忆」/en「No memories yet」)、`agentMemoryClear`(zh「清除全部记忆」/en「Clear all memories」)、
   `agentMemoryDelete`(zh「删除」/en「Delete」)、`agentMemoryLoading`(zh「加载中…」/en「Loading…」)、
   `agentMemoryError`(zh「记忆加载失败」/en「Failed to load memories」)、
   `agentMemoryClearConfirm`(zh「确认清除全部记忆?」/en「Clear all memories?」——清除前轻确认)。
   (若 ws-mem-a 加了 'memory' 工具类别 → 补 `agentToolMemory`(zh「记忆」/en「Memory」)显示名;未加则跳过。)
3. **透传链**:`agent-ball.tsx`(Props 加 user 透传)+ `map-shell.tsx` 的 AgentBall 调用处传 `user`(map-shell 已有该变量,仅接线)。
4. **测试**:
   - 组件契约测试:记忆按钮仅在 user 非空时渲染(正则断言);agentMemory* 键存在;
   - 纯函数可抽则抽(如弹层可见性/列表渲染判定),不可则组件内 + 契约覆盖;
   - 全量回归零漂移。

## 不碰(红线)

后端(ws-mem-a 的文件)、executor、bridge、markdown 管线、引擎、agent-panel-state。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-memb/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-memb && make docs-check && git diff --check
```

## 纪律

小步 commit(`feat(agent-memory): ...`);不 push/不切分支;只动上述文件。

## 回报

写 `reports/ws-mem-b.md`(改动摘要 + 测试结论 + 门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
