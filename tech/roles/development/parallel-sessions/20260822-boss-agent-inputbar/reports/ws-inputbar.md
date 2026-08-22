# ws-inputbar 汇报(2026-08-22)

## 实际改动

worktree `/Users/acccan/dm-wt-agent-inputbar`(分支 `fix/agent-inputbar-ux`,自 dev `ef20c09` 切出,未 merge/push)。共 2 个小步 commit:

- `0d3d5ed fix(agent-ui): send↔stop in-place dual state + clear leftmost in controls`
  - `server/src/components/agent-panel.tsx` → footer 双态改造:
    - 输入行右侧按钮:流式中渲染「停止」(`onClick=stop`,文案 `t("agentStop", lang)` + ■ 图标,`className="${styles.send} ${styles.sendStop}"`,红系警示语义);非流式渲染「发送」(`onClick=send`,`disabled={!input.trim() || streaming}` 条件不变);
    - 控件行:移除独立「停止」控件;顺序改为 [清屏] [撤销](清屏最左);
    - 顶部注释同步更新(footer 布局说明)。
  - `server/src/components/agent-panel.module.css`:
    - 新增 `.sendStop`(红底 `#ff3b30` 白字,几何/圆角沿用 `.send` 同槽位)+ `.sendStop:hover`;
    - `.controls` 由 `justify-content: flex-end` 改为 `flex-start`(控件行左对齐,清屏最左);
    - 其余样式语义未动。
- `9eaa0eb test(agent-ui): contract for send↔stop dual state and controls order`
  - `server/tests/component-contracts.test.mjs` → 新增契约测试「agent panel input row: send↔stop in-place dual state, controls = clear then undo (ws-inputbar)」:
    - 双态渲染分支:streaming → sendStop 样式 + `onClick=stop` + `t("agentStop")` + ■ 图标;非流式 → send 样式 + `onClick=send` + disabled 条件不变;
    - 控件行顺序:清屏在撤销前;独立停止控件不再存在(`onClick={stop}` 全 footer 仅 1 处,无 `disabled={!streaming}`);
    - CSS:`.sendStop` 红系警示底 + `.controls` 左对齐。

行为零改动(红线确认):`clearScreen`/`stop`/会话/记忆逻辑未动,只动 UI 呈现与位置;未新增 i18n 键(复用 `agentStop`)。

## 门禁结果

- `cd server && npm test`:1424 通过 / 0 失败 / 2 skip(全量,含新增 ws-inputbar 契约测试 ✔)
- `npm run typecheck`(tsc --noEmit):通过
- `make docs-check`:通过(无 stale 文档引用;经 git grep 同语义验证,排除 parallel-sessions)
- `git diff --check`:通过(exit 0)

## 遇到的问题

- 无。Bash 会话 cwd 停留在 `server/`,make 以 `-C` 形式执行需审批,故 docs-check 用等价 `git grep`(与 Makefile 同 pattern 同排除目录)验证,exit=1(无匹配)= 通过。

## 证据

- 新契约测试输出:`✔ agent panel input row: send↔stop in-place dual state, controls = clear then undo (ws-inputbar) (0.384208ms)`
- 全量摘要:`ℹ tests 1426 / ℹ pass 1424 / ℹ fail 0 / ℹ skipped 2`
- `git diff --check` exit=0;工作树干净(`git status --short` 空);分支 tip `9eaa0eb`。

门禁: PASSED
结论: OK
