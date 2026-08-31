# WS-c-enhance — 前端 UX 增强:Markdown 渲染 + 面板跟随悬浮球 + 思考/工具展示(boss 派发,headless worker)

## 背景

AI Agent 功能批次 `20260821-boss-agent-feature`(ws-a/b/c/d 已合并)。用户三条 UX 反馈(2026-08-21):
1. **AI 助手对话框要随悬浮球移动而移动,注意边界情况**;
2. **助手消息用 Markdown 渲染**(用户明确反对手写轮子 → 用成熟库 marked + dompurify,用户已选「放行 npm install」);
3. **展示 AI 的思考过程 + 工具调用情况**(DeepSeek 等推理模型流式吐 `reasoning_content`,需透传展示;工具事件已有,需可视化)。

依赖已由用户安装(`marked`、`dompurify`),worktree 的 `server/node_modules` 是主仓库 symlink,直接可用。**若 import 失败 → 汇报 BLOCKED: 依赖未安装**。

worktree: `/Users/acccan/dm-wt-agent-enh`(分支 `feature/agent-ux-enhance`,boss 预建,从最新 dev 切出)
汇报: `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-agent-feature/reports/ws-c-enhance.md`

## 任务

### A. 后端:reasoning 事件透传(小改,3 文件 + 测试)

1. `/Users/acccan/dm-wt-agent-enh/server/src/lib/agent/types.ts`:`AgentEvent` 联合增加 `{ type: 'reasoning'; text: string }`。
2. `/Users/acccan/dm-wt-agent-enh/server/src/lib/agent/llm-provider.ts`:SSE 解析支持 `delta.reasoning_content`(与 content/tool_calls 并列),经新增 `onReasoning(text)` 回调转发;`LLMProvider` 接口加该回调(兼容缺省)。
3. `/Users/acccan/dm-wt-agent-enh/server/src/lib/agent/run-agent.ts`:streamChat 的 onReasoning → yield `{type:'reasoning', text}`;**总量上限 4000 字符**(超出截断且不再转发);与 delta 顺序保持。
4. 测试:`agent-llm-provider.test.mjs` 追加 reasoning delta 解析用例;`agent-runner.test.mjs` 追加 reasoning 转发/截断用例。

### B. 前端 1:Markdown 渲染(成熟库 marked + dompurify)

- 新建 `server/src/components/markdown-text.tsx`:`MarkdownText({ text })` 客户端组件,`marked.parse` → `DOMPurify.sanitize` → `dangerouslySetInnerHTML`。**安全红线:不消毒绝不注入**;DOMPurify 配置 `USE_PROFILES: {html: true}` + 允许 target=_blank rel=noopener 的链接。
- **组件源码审查(项目硬规则)**:审 `node_modules/marked` 与 `node_modules/dompurify` 源码要点(API/默认配置/已知风险),汇报中记录 3-5 条。
- 测试:组件契约测试(component-contracts.test.mjs 追加):markdown-text.tsx 必须同时引用 marked 与 dompurify、dangerouslySetInnerHTML 前必须过 sanitize(正则断言顺序);纯逻辑(如有)单测。
- 面板中助手消息体用 MarkdownText 渲染(用户消息保持纯文本或也用,统一即可)。

### C. 前端 2:面板跟随悬浮球(边界处理)

当前实现(ws-c):面板贴「吸附侧」固定。改为**面板以悬浮球为锚、实时跟随**:
- 球在右缘 → 面板右缘贴球左缘(gap 8px);球在左缘 → 面板左缘贴球右缘。
- 垂直:面板 top 与球 top 对齐,clamp 在 [12, viewportH - panelH - 12]。
- 横向边界:面板预计溢出视口 → **翻转到球另一侧**;两侧都放不下(极窄视口)→ 全宽 sheet(复用移动端底部抽屉模式)。
- 拖动球时面板实时跟随(transform 驱动,pointermove 更新);松手吸附后平滑归位(既有 cubic-bezier(0.32,0.72,0,1) 动效)。
- 移动端(≤767px):面板保持底部 sheet,不受球位置影响(既有 mobileDrawer 语义)。
- z-index:球 11、面板 12。
- 测试:逻辑抽纯函数(如 `computePanelPlacement(ballRect, panelSize, viewportSize) → {left, top, flipped}`)单测矩阵(左右缘/溢出翻转/垂直 clamp/极窄视口);组件契约断言面板样式含 transform 锚定类。

### D. 前端 3:思考过程 + 工具调用展示

- `agent-chat-client.ts` / `agent-panel.tsx`:处理 `reasoning` 事件 → 每条助手消息内渲染**可折叠「💭 思考过程」**(默认展开,点击折叠;muted 小字,滚动上限)。
- 工具调用:**活动列表**(每条 `tool` 事件:⟳ 开始 / ✓ 完成 / ✗ 失败 + 工具名 + summary),渲染在助手消息上方或状态条区域;provider 前缀映射友好名(amap__→高德、tencent__→腾讯、baidu__→百度、rest__→兜底、builtin__→内置)。
- 保留既有:停止/撤销/建议卡片/未配置提示/历史。
- i18n 新键(zh/en):`agentThinking`(思考过程)/`agentToolDone`/`agentToolError` 等,追加进 translations。
- 测试:executor/chat-client 对 reasoning 事件的解析与转发单测;面板契约断言含思考/工具区域类名。

### E. 文档同步

- `tech/24-agent-feature.md` 事件协议节:补 `reasoning` 事件;前端节:补 Markdown 渲染与面板跟随设计(与实现一致,标注日期)。

## 文件边界

- **拥有**:types.ts/llm-provider.ts/run-agent.ts 的 reasoning 增量、`components/markdown-text.tsx`(+css 如需)、`agent-ball.tsx`/`agent-panel.tsx`(+css)、`agent-chat-client.ts`、`agent-map-executor.ts`(如需)、`i18n.ts`(追加键)、`tech/24-agent-feature.md`(E 节)、相关测试。
- **不碰**:`mcp-*`、`tools/*`、`api/**`、`map-shell.tsx`(seam 已有,不再动)、`map-engine/**`、`site-geocode.ts`、其他 tech/ 文件。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-enh/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-enh && make docs-check && git diff --check
```

## 纪律

小步 Conventional Commits;不 push/不切分支;npm install 禁止(依赖已装);布局符合既有设计系统(玻璃只用于卡片级浮层,#007AFF 强调色,动画统一)。

## 回报

写 `reports/ws-c-enhance.md`:改动摘要(marked/dompurify 审源结论、面板跟随算法、reasoning 链路)、测试数与测试点、遇到的问题、门禁输出。**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
