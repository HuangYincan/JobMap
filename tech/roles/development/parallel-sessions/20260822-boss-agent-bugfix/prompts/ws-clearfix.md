# WS-clearfix — 清屏改为「归档当前会话 + 新建空会话」(boss 派发)

## 背景

用户反馈(2026-08-22):清屏后会话界面没有历史会话(澄清:全部会话消失)。

Explore 根因(带证据):`server/src/components/agent-panel.tsx:472` 清屏调 `saveMessages(cur, cur.activeId, [])`
把当前会话整份清空(store 语义本身正确,其他会话保留;旧历史迁移后绝大多数用户只有**一个**会话,
清空后标题重置「新会话」→ 弹层只剩空「新会话」一行 → 用户视角「历史会话全部消失」)。

修复裁决:清屏 = **归档当前会话(有消息时,标题保留)+ 新建空会话并激活** + 清覆盖物/状态。
清屏后历史会话(含刚才的内容)留在会话列表可回溯,当前是全新画布。

worktree: `/Users/acccan/dm-wt-agent-clearfix`(分支 `fix/agent-clear-archive`,已从 dev `df4b26d` 切出)
汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-agent-bugfix/reports/ws-clearfix.md`

## 任务

1. `server/src/lib/agent-session-store.ts`:
   - 新增纯函数 `archiveAndNew(state, {activeId, messages, title})`:把当前会话消息**落库为历史**
     (有消息才归档;空会话不产生空历史)、再创建并激活新空会话(新 id,标题「新会话」);
     其他会话不动;cap 裁剪照旧(归档可能挤出最旧会话);返回新 state。导出可单测。
2. `server/src/components/agent-panel.tsx`(约 L467-480 的 clearScreen):
   - 改为:clearOverlays(覆盖物清理照旧)+ `archiveAndNew`(当前会话有消息才归档;标题保留原样,不清 title)+
     载入空消息 + 清 completion/notConfigured/fatalError 等状态 + persist;
   - 语义:清屏 = 开新画布,旧内容可回溯;覆盖物/undo 清理不变;记忆不动;
   - 流式期间禁用不变;清屏后会话弹层可见历史会话(含刚归档的)。
3. 测试:
   - `agent-session-store.test.mjs` 追加:archiveAndNew(有消息归档/空会话不归档/标题保留/cap 挤出最旧/activeId 指向新会话);
   - 组件契约:清屏按钮存在 + 清屏路径调 archiveAndNew(正则断言);
   - 全量回归零漂移。

## 不碰(红线)

后端 agent 全套、引擎(ws-pinfix2 在改)、markdown、executor(仅调用其 clearOverlays,不改)。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-clearfix/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-clearfix && make docs-check && git diff --check
```

## 纪律

小步 commit(`fix(agent-ui): ...`);不 push/不切分支;只动上述文件。

## 回报

写 `reports/ws-clearfix.md`(改动摘要 + 测试结论 + 门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
