# ws-c 汇报(2026-08-21)

## 实际改动(分支 `feature/agent-frontend`,worktree `/Users/acccan/dm-wt-agent-c`,基于 dev 9b4cd8f)

| 文件 | 改动 |
|---|---|
| `server/src/lib/agent-map-bridge.ts`(新建) | MapBridge 接口 + `createAgentBridge(view, callbacks)`:实现只认 map-engine 的 `MapView` 门面(`view.flyTo`/`view.createMarker`/`view.createCircle`/`view.getState`/`view.isDestroyed`),零厂商全局依赖;`isReady`/`getSnapshot`(camera 快照,undo 用)/`flyTo`(zoom 缺省保持当前)/`select`/`addMarkers`(逐点坐标校验,label HTML 转义,返回幂等清理函数)/`drawCircle`(radius 10..50000 校验,返回清理函数)/`openDetail`;坐标/半径校验复用动作边界(与 `action-schema.ts` 同款规则,非法忽略) |
| `server/src/components/agent-chat-client.ts`(新建) | `parseSseChunk(chunk): AgentEvent[]` 纯函数(按 `\n\n` 切块 → `data:` 行 → JSON.parse 容错跳过坏 JSON/空行/残缺尾部)+ `streamAgentChat(req, signal)` AsyncGenerator(fetch POST `/api/agent/chat`,缓冲跨 chunk 事件,非 2xx → 统一转 `{type:'error', code}` 事件,`signal.abort` → 静默结束);`AgentEvent` 从 `lib/agent/types` import(同构) |
| `server/src/components/agent-map-executor.ts`(新建) | `validateAction`(与后端同款规则的本地复刻,`lib/agent/**` 只 import types)+ `createAgentMapExecutor(bridge, callbacks)` → `{handleEvent, undo, canUndo, reset}`:delta/tool/done/error 分流到渲染回调;action → 客户端校验(非法丢弃)→ 500ms 同类型限流(`ACTION_THROTTLE_MS`,可注入 `now` 时钟供测试)→ `bridge.isReady()` 检查(失败 → `MAP_NOT_READY` 错误回调)→ 执行 → 压 undo 栈(flyTo 逆操作 = 执行前 getSnapshot 捕获的旧 camera;addMarkers/drawCircle = 清理函数;select/openDetail = 各自动作历史栈,undo 回放上一条旧值) |
| `server/src/components/agent-ball.tsx` + `.module.css`(新建) | 44×44 圆形玻璃悬浮球(参照 `.toolButton`/`.locateButton`:rgba(255,255,255,0.72) + blur(24px) saturate(165%) + `--line` 边框 + `--shadow`;深色 rgba(28,28,30,0.72)),✦ 图标,`aria-label={t('agentBall', lang)}`,`z-index:11`;pointer 拖拽 3px 阈值区分点击/拖动,松手吸附最近边缘(left/right)+ clamp 12px 边距与顶部,吸附动画 `cubic-bezier(0.32,0.72,0,1) 0.35s`,位置持久化 localStorage `dm.agent-ball-pos`;点击(非拖动)→ toggle 面板;初始位 right:12/bottom:179 |
| `server/src/components/agent-panel.tsx` + `.module.css`(新建) | 360px × 70vh liquid glass 卡片浮层(外壳 `--soft-strong` + blur(24px) saturate(165%)),贴悬浮球吸附侧;消息列表(用户蓝泡/助手泡,white-space:pre-wrap)+ 输入框 + 发送/停止/撤销按钮 + tool 状态条(「{name} 正在执行…」,tool 事件驱动,`role="status"`)+ 建议卡片(执行器捕获 action 后渲染动作摘要按钮,点击 = `handleEvent` 重放该 action)+ 未配置提示(`LLM_UNCONFIGURED` → `agentNotConfigured`);历史 sessionStorage `dm.agent-history.v1` cap 30;新会话首条自动带视口快照(`bridge.getSnapshot()` → viewport 参数);「停止」→ `AbortController.abort()`(链到 fetch);「撤销」→ `executor.undo()`;移动端(≤767px)全宽底部 sheet(圆角顶 + 底贴齐,参照 mobileDrawer 动效) |
| `server/src/components/map-shell.tsx`(**seam,仅追加 27 行**) | ① 2 行 import(`createAgentBridge`/`MapBridge`/`AgentBall`);② bridge 惰性初始化块(`agentBridgeViewRef` + `agentBridgeRef`,活跃 `engineView` 可用后建一次、实例变更时重建;onSelect → `setSelectedId`,onOpenDetail → 按 id 查 `catalogRef`/`poisRef` 命中后 `setDetailPoi` + `setRailPanel('explore')` + 移动端 `setDrawer('full')`);③ `.mapControls` 之后一行 `<AgentBall bridge={agentBridgeRef.current} lang={lang} />`。**未动任何现有逻辑/样式/控件** |
| `server/src/lib/i18n.ts` | 追加 21 个 `agent*` 键(zh/en):`agentBall`/`agentTitle`/`agentClose`/`agentInput`/`agentSend`/`agentStop`/`agentUndo`/`agentThinking`/`agentNotConfigured`/`agentError`/`agentLocate`/`agentSearch`/`agentToolRunning`/`agentToolDone`/`agentToolError`/`agentActionCircle`/`agentActionMarkers`/`agentActionSelect`/`agentActionDetail`/`agentActionSearch`/`agentWelcome` |
| `server/tests/agent-chat-client.test.mjs`(新建,17 测试) | parseSseChunk 矩阵(单/多事件、坏 JSON、空行、非 data 行、非对象 JSON、跨 chunk 残缺尾部、JSON 转义换行、多 data 行拼接容错)+ streamAgentChat(mock fetch:跨 chunk 事件重组、viewport/lang 透传、503 LLM_UNCONFIGURED → error 事件、非 JSON 错误体状态码兜底、NO_STREAM、abort 静默、网络错误上抛) |
| `server/tests/agent-map-executor.test.mjs`(新建,14 测试) | validateAction 边界矩阵;各动作分流;flyTo undo 恢复旧 camera;addMarkers/drawCircle undo 调清理函数;select/openDetail undo 回放旧值;search 只通知不执行不入栈;非法丢弃;500ms 同类型限流(注入时钟);isReady 失败 → MAP_NOT_READY;reset 清栈清限流;混合栈后进先出 |
| `server/tests/component-contracts.test.mjs`(追加 3 测试) | agent-ball 有 `aria-label={t('agentBall')}` + 玻璃样式/44px/z-index/吸附曲线 + localStorage key;agent-panel 有输入框与停止/撤销按钮 + tool 条 + LLM_UNCONFIGURED + 历史 cap 30 + 视口快照 + 360px/70vh/移动端 sheet;map-shell 含 `<AgentBall bridge={agentBridgeRef.current} lang={lang} />` seam + bridge 只认 MapView 无厂商全局 |

## 门禁结果

- npm test:**848 通过 / 0 失败 / 2 skip**(基线 dev 9b4cd8f 为 814 全绿 + 本 WS 34 新增)
- typecheck:`tsc --noEmit` 通过
- docs-check:`Documentation policy check passed`
- git diff --check:通过(工作树干净)

## 遇到的问题

1. **多 data 行拼接的 SSE 语义与 JSON 冲突** → SSE 规范「多 data 行按 \n 拼接」对 JSON 负载不成立(JSON 字符串内不允许裸换行,拼接结果必非法)。契约是 route 逐事件单行 `data: <单行 JSON>`。处理:保留按 `\n\n` 切块 + 容错跳过逻辑;测试改为「JSON 转义换行正常解析」+「多 data 行拼接非合法 JSON 被跳过」两条,注释说明契约前提。
2. **限流干扰测试** → 同一测试内连续两个同类型 action,第二个被 500ms 限流吞掉。处理:executor 支持注入 `now` 时钟(测试专用),测试内推进时间越过窗口。
3. **bridge 头注释含 `window.AMap` 字样** → component-contracts 断言 bridge 无厂商全局引用,注释文本违规。处理:改写注释为「不直连任何厂商全局命名空间」(代码本就零引用)。
4. **search 动作的执行语义**(设计决策,供 boss 知悉)→ MapBridge 接口(按 prompt 定稿)不含 search 方法,seam 也未接线;executor 对 search 只做校验 + `onAction` 通知(面板渲染「搜索 {query}」建议卡片,点击重放),不调 bridge、不入 undo 栈(无地图副作用可撤销)。如需「搜索按钮直接填入搜索框/触发搜索」,属后续迭代(可加 `onSearch` 回调,当前未做)。
5. **环境限制** → `server/node_modules` 为未跟踪 symlink,全部 `git add` 只按具体文件路径,无 `-A`;Next.js 16 文档在 symlink 目标(主仓)不可读,组件严格沿用仓内现有客户端组件约定("use client" + CSS Modules + `@/` 别名)。

## 证据

- `cd server && npm test` → `ℹ tests 848 / ℹ pass 846 / ℹ fail 0 / ℹ skipped 2`(2026-08-21 跑两次均绿)
- `npm run typecheck` → 无输出(通过)
- `make docs-check` → `Documentation policy check passed`
- `git diff --check` → 无输出;`git status --short` 空
- 分支提交(7 个,全部 Conventional Commits,seam 独立 commit `5a74f7e`):
  `384523c` bridge → `ac52518` SSE 客户端 → `42a2d7d` 执行器 → `f322673` i18n → `e0d7296` 悬浮球+面板 → `5a74f7e` map-shell seam → `e366749` 测试
- 未 merge 回 dev、未 push;worktree/分支留原地待 merger

门禁: PASSED
结论: OK
