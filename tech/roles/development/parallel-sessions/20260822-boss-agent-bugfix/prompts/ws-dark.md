# WS-dark — agent UI 深色模式适配(boss 派发)

## 背景

用户要求(2026-08-22):「UI需要适配深色界面」。

现状:项目深色机制 = `globals.css` 的 `@media (prefers-color-scheme: dark)` 重定义 CSS 变量
(`--ink`/`--muted`/`--soft-strong`/`--line` 等,见 globals.css:58-99)。**agent-ball.module.css 已有 dark 适配(L48)**;
但 **agent-panel.module.css 有 11 处硬编码浅色(rgba(255,255,255,0.72) 玻璃底、#0b2545/#111 文字等)且无 dark 覆盖** ——
深色系统下面板/记忆/会话弹层刺眼。markdown-text.module.css 可能同样。

worktree: `/Users/acccan/dm-wt-agent-dark`(分支 `fix/agent-dark-theme`,已从 dev `5f29134` 切出)
汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-boss-agent-bugfix/reports/ws-dark.md`

## 任务

1. `server/src/components/agent-panel.module.css`:
   - 硬编码浅色逐一改为 CSS 变量(玻璃底 → `--soft-strong`,文字 → `--ink`/`--muted`,描边 → `--line`),
     或在该文件加 `@media (prefers-color-scheme: dark)` 覆盖块(与 agent-ball.module.css 同模式);
   - 语义色保留:主色 `#007AFF`(按钮/徽章/蓝点)、错误红 `#ff3b30`、清除橙 —— 主题色在深浅两态通用,不动;
   - 逐类核对:面板底/消息气泡/输入行/按钮/工具活动/记忆卡/会话卡/状态行/弹层,深色下无刺眼白块、文字可读;
   - 与 agent-ball 的 dark 风格一致(参考其 L48 起的写法)。
2. `server/src/components/markdown-text.module.css`(如有硬编码)→ 同法适配;
3. `agent-ball.module.css`:核对已有 dark 适配覆盖完整(球体玻璃在深色下的底/描边),缺则补;
4. 测试:组件契约测试追加 —— 断言 agent-panel.module.css 含 `prefers-color-scheme: dark` 覆盖
   (或全部颜色引用为变量,二选一,以实现为准);硬编码浅色(#fff 系/rgba(255,255,255) 高不透明底)不再出现在
   面板容器/气泡关键类;全量回归零漂移。

## 不碰(红线)

JS/TSX 逻辑(agent-panel.tsx 等)、后端、其他组件 CSS(account/filter 等已有 dark 的组件不动)。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-dark/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-dark && make docs-check && git diff --check
```

## 纪律

小步 commit(`fix(agent-ui): ...`);不 push/不切分支;只动上述文件。

## 回报

写 `reports/ws-dark.md`(改动摘要 + 测试结论 + 门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
