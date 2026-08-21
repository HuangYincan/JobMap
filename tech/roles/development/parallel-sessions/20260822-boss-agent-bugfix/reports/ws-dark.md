# ws-dark 汇报(2026-08-22)

## 实际改动

- `server/src/components/agent-panel.module.css` → 末尾新增 `@media (prefers-color-scheme: dark)` 覆盖块(与 agent-ball.module.css 同模式,参考其 L48 写法)。面板 11 处硬编码浅色中 3 处为深色下刺眼白块,逐一覆盖:
  - `.memoryPanel, .sessionsPanel` 弹层玻璃底 `rgba(255,255,255,0.86)` → `rgba(28,28,30,0.92)`(比面板底略深,保持弹层浮于面板之上的层级);
  - `.input` 输入行 `rgba(255,255,255,0.6)` → `rgba(255,255,255,0.06)`(account-panel 输入框同款深色底;原浅底 + 深色下 `--ink` 白字不可读);
  - `.bubbleAssistant` 助手气泡底(中性灰 0.1)→ `rgba(255,255,255,0.07)`(深色下气泡面与面板区分度更好);
  - 语义色保留不动:主蓝 `#007aFF`(按钮/徽章/蓝点/发送)、错误红 `#ff3b30`(删除/清除 hover)、清除橙 `#b25e00`/`#ff9500`(清除按钮/工具失败)深浅两态通用。
  - `.panel`/`.memoryRow` 玻璃底本就走 `var(--soft-strong)`(fallback 不影响,变量由 globals.css 随系统翻转),未改。
- `server/src/components/markdown-text.module.css` → **核对后无需改动**:无硬编码白底,全部为半透明中性灰(0.08–0.14 alpha,深色下自然呈暗面)或语义蓝;文本继承 `.bubbleAssistant` 的 `var(--ink)` 自动翻转。
- `server/src/components/agent-ball.module.css` → **核对后覆盖已完整**:`.ball`(底 + 描边)+ `.ball:hover` 均有 dark 覆盖;`.ball:active`/`.dragging` 仅光标/过渡,无需颜色覆盖。未改。
- `server/tests/component-contracts.test.mjs` → 新增契约测试 `agent panel dark mode: 深色覆盖块 + 关键类无硬编码白底 (ws-dark)`,断言:
  1. agent-panel.module.css 含 `prefers-color-scheme: dark` 覆盖块;
  2. 深色块内弹层/输入行/助手气泡均有深底覆盖,且块内无高不透明 `rgba(255,255,255,0.5-0.9)` 白底;
  3. `.panel`/`.memoryRow` 玻璃底走 `var(--soft-strong)`(禁止硬编码白底);
  4. agent-ball 深色覆盖完整(球底 + hover);
  5. markdown-text 无硬编码白底。

## 门禁结果

- npm test: 1374 通过 / 0 失败 / 2 skip(新增 1 条 dark 契约测试在内,全绿)
- typecheck: 通过(tsc --noEmit 零输出)
- make docs-check: 通过(Documentation policy check passed)
- git diff --check: 通过

## 遇到的问题

- 无。提交 `make docs-check` 时注意了 cwd 需在 worktree 根(server/ 下无 Makefile)。
- 说明:`make docs-check` 为策略漂移 grep(非文档覆盖率检查),本次无 docs/agent.md 变更需求;CSS 改动无新增文档义务。

## 证据

- commit `32d7821` fix(agent-ui): 深色模式覆盖面板硬编码浅色(弹层玻璃底/输入行/助手气泡底)
- commit `addd36a` test(agent-ui): agent 深色契约——覆盖块存在 + 关键类无硬编码高不透明白底 (ws-dark)
- 测试摘要:`ℹ tests 1376 / pass 1374 / fail 0 / skipped 2`;新测试 `✔ agent panel dark mode: 深色覆盖块 + 关键类无硬编码白底 (ws-dark)`
- 审计:agent-panel.module.css 现存 `rgba(255,255,255,…)` 均为浅色态规则(深色覆盖块接管)或 var fallback;`#fff` 全部为蓝底上的白字(语义,深浅通用)

门禁: PASSED
结论: OK
