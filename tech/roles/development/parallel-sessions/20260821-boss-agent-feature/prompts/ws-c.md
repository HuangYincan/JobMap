# WS-c — 前端:悬浮球 + 聊天面板 + SSE 客户端 + 地图动作执行器(boss 派发,headless worker)

## 背景

AI Agent 功能批次 `20260821-boss-agent-feature`。后端(ws-a/ws-b)提供 `POST /api/agent/chat` SSE 事件流:事件 `{type:'delta'|'tool'|'action'|'done'|'error'}`(契约见 ws-a prompt 的 `AgentEvent/AgentAction` 定义,本 prompt 下方也列出)。你的任务:前端悬浮球 + 聊天面板 + SSE 客户端 + 地图动作执行器 + map-shell 最小 seam。

**布局图已由 boss 按设计系统自审(新增 UI,用户已授权自主开发)**:

```
┌─ 地图页面(右下角)───────────────────────────┐
│  …(地图)                                   │
│                          ┌──────┐          │
│                          │  ✦   │ ← AgentBall│
│                          └──────┘   44px 圆 │
│                          ┌──────┐          │
│                          │  ＋   │          │
│                          │  12  │ ← 现有   │
│                          │  －   │  mapControls│
│                          │  ◎   │ (不动)   │
│                          └──────┘          │
└────────────────────────────────────────────┘
初始:right:12px; bottom:179px(mapControls 实测高 ~147 + 底距 20 + 间距 12)
拖拽:pointer 事件,3px 阈值区分点击/拖动;松手吸附最近边缘(left/right),clamp 12px 边距与顶部,动画 cubic-bezier(0.32,0.72,0,1) 0.35s

┌─ 点击展开 ──────────────────────────────────┐
│  ┌─ agent-panel(贴吸附侧)──────────────┐    │
│  │  ✦ AI 助手                    ✕    │    │
│  │  ───────────────────────────────   │    │
│  │  [正在查询周边…] ← tool 状态条      │    │
│  │  ┌────────────────────────────┐    │    │
│  │  │ 建议:滨江区长河街道…        │    │    │
│  │  │ [在地图上定位]              │    │    │
│  │  └────────────────────────────┘    │    │
│  │  ┌────────────────────────────┐    │    │
│  │  │ 输入问题…              [发送]│    │    │
│  │  │ [⏹ 停止] [↩ 撤销上一步]     │    │    │
│  │  └────────────────────────────┘    │    │
│  └──────────────────────────────────────┘    │
│  360px × 70vh;liquid glass 卡片;消息列表滚动  │
└────────────────────────────────────────────┘
```

设计系统硬约束:玻璃拟态(backdrop-filter: blur+saturate)**只用于卡片级浮层**(本面板是浮层卡片,可用);强调色 `#007AFF`;面板外壳霜面 `--soft-strong`;动画 `cubic-bezier(0.32, 0.72, 0, 1)`;CSS Modules;i18n 走 `t()`。

## 任务

### 1. `server/src/lib/agent-map-bridge.ts` — 地图操作适配层(单文件隔离,可测)

```ts
export interface MapBridge {
  isReady(): boolean;
  getSnapshot(): { center: { lng: number; lat: number }; zoom: number } | null;
  flyTo(lng: number, lat: number, zoom?: number): void;        // 经活跃引擎 view.flyTo/setCenter
  select(id: string, mode?: string): void;                     // 经 seam 传入的回调
  addMarkers(points: Array<{ lng: number; lat: number; label?: string }>): () => void; // 返回清理函数
  drawCircle(center: { lng: number; lat: number }, radiusMeters: number): () => void;
  openDetail(id: string, mode?: string): void;
}
export function createAgentBridge(view: MapView | null, callbacks: { onSelect?: (id: string, mode?: string) => void; onOpenDetail?: (id: string, mode?: string) => void }): MapBridge;
```
- **重要:dev 上的 map-engine 批次已合并**(fbbdc66),`map-shell.tsx` 已迁移到 `MapView` 门面:`server/src/lib/map-engine/types.ts` 的 `MapView` 接口(含 flyTo/setCenter/setZoom/createMarker/createCircle/getState/getBounds)+ `server/src/hooks/use-map-engine.ts` 的 `useMapEngine()` hook(活跃引擎视图)。**你的 bridge 用 MapView 实现**(`view.flyTo`/`view.createMarker`/`view.createCircle`/`view.getState`),不要直接 window.AMap。若发现 MapView 缺某方法,调用方(seam)回退可用底层 map,但 bridge 文件内只认 MapView。
- 覆盖物(addMarkers/drawCircle)创建后自维护引用,返回清理函数;坐标校验复用动作边界(非法 → 忽略)。

### 2. `server/src/components/agent-chat-client.ts` — SSE 客户端(纯逻辑,可单测)

`export async function* streamAgentChat(req: AgentChatRequest, signal: AbortSignal): AsyncGenerator<AgentEvent>` — fetch POST `/api/agent/chat` → `response.body.getReader()` → 按 `\n\n` 切块,`data: ` 行 JSON.parse(容错:跳过非 JSON/空行)→ yield 事件;`signal.abort()` 即 abort fetch。`AgentEvent/AgentAction` 类型从 `server/src/lib/agent/types.ts` **import**(同构,前端可 import lib 类型)。导出 `parseSseChunk(chunk: string): AgentEvent[]` 纯函数供测试。

### 3. `server/src/components/agent-map-executor.ts` — 动作执行器(纯逻辑,可单测)

`export function createAgentMapExecutor(bridge: MapBridge)` 返回 `{ handleEvent(ev: AgentEvent): void; undo(): boolean; canUndo(): boolean; reset(): void }`:
- 按 type 分流:delta/tool/done/error 交给回调(供面板渲染);action → 执行前客户端再校验(坐标/radius/points 边界,与后端同款规则,非法丢弃)→ **500ms 同类型动作限流** → 执行 → 压 undo 栈(逆操作:flyTo→旧 camera(经 getSnapshot 捕获执行前);addMarkers/drawCircle→保存清理函数,undo 时调用;select/openDetail→旧值回调)。
- 执行前 `bridge.isReady()` 检查,失败 → 错误回调。

### 4. `server/src/components/agent-ball.tsx` + `agent-ball.module.css` — 悬浮球

- 44×44 圆形玻璃按钮(参照 `map-shell.module.css` 的 `.toolButton`/`.locateButton` 造型:rgba(255,255,255,0.72) + backdrop-filter blur(24px) saturate(165%) + 1px `--line` 边框 + `--shadow`;深色 rgba(28,28,30,0.72)),内容为 ✦(或按 i18n 的 agent 图标),`aria-label={t('agentBall', lang)}`。
- 拖拽吸附:pointerdown/move/up,3px 阈值;松手吸附最近边缘,clamp;初始 `bottom:179px; right:12px`(记 localStorage `dm.agent-ball-pos` 持久化用户位置);`z-index:11`。
- 点击(非拖动)→ toggle 面板。

### 5. `server/src/components/agent-panel.tsx` + css — 聊天面板

- 360px × 70vh(移动端:全宽 sheet,参照 mobileDrawer 动效),贴吸附侧;消息列表(用户/助手气泡,助手侧可含建议卡片)+ 输入框 + 发送/停止/撤销按钮 + tool 状态条(「正在…」,tool 事件驱动)+ 未配置提示(503 LLM_UNCONFIGURED → 显示 t('agentNotConfigured'))。
- 建议卡片:delta 文本中若出现 `{"actions":[...]}` 后的结构化建议(实现:执行器捕获 action 时,面板在消息底部渲染动作摘要按钮「在地图上定位」等,点击 = 重放该 action)。
- 历史:sessionStorage `dm.agent-history.v1` cap 30 条;新会话首条自动带视口快照(bridge.getSnapshot() → viewport 参数)。
- 「停止」→ abort(链到 fetch);「撤销」→ executor.undo()。

### 6. `server/src/components/map-shell.tsx` — **seam(~30 行,红线豁免,只追加)**

- **注意:map-engine 批次已合并(fbbdc66),map-shell.tsx 已大改**(8 处 window.AMap 直引用收口到 `useMapEngine` hook,构造逻辑移入 hook)。先读当前 map-shell.tsx 与 `server/src/hooks/use-map-engine.ts`,在**最新结构**上加 seam。
- `import AgentBall from './agent-ball'`;在现有地图控件 JSX 之后(参考 `.mapControls` 区域)追加 `<AgentBall bridge={agentBridgeRef.current} />`;
- 定义 `agentBridgeRef = useRef<MapBridge | null>(null)` + 惰性初始化:经 `useMapEngine()` 的活跃视图(view)+ map-shell 内部回调(`setSelectedId`、`setDetailPoi` 或迁移后等价物,select/openDetail 用)。
- **红线纪律**:只加 import + ref + 一行 JSX,不动 map-shell 任何现有逻辑/样式/控件;seam 独立成 commit 便于合并。

### 7. `server/src/lib/i18n.ts` — 追加 agent* 键组(zh/en,约 20 键)

`agentBall`(AI 助手)/`agentTitle`/`agentInput`(输入问题…)/`agentSend`/`agentStop`/`agentUndo`/`agentThinking`/`agentNotConfigured`(AI 助手未配置,请在服务器配置)/`agentError`/`agentLocate`(在地图上定位)/`agentSearch`(搜索)/`agentToolRunning`({name} 正在执行…)等,文案简短,中文为主。

### 8. 测试(`/Users/acccan/dm-wt-agent-c/server/tests/`)
- `agent-chat-client.test.mjs` — parseSseChunk 矩阵(单/多事件、坏 JSON、空行、事件跨 chunk 切分按 `\n\n`)
- `agent-map-executor.test.mjs` — mock bridge:各动作分流、非法动作丢弃、限流、undo 栈逆操作顺序、canUndo、isReady 失败
- `component-contracts.test.mjs` **追加**(现有文件末尾追加断言):agent-ball.tsx 有 aria-label 且含 t('agentBall');agent-panel.tsx 有输入框与停止/撤销按钮;map-shell.tsx 含 `<AgentBall` seam

## 文件边界

- **拥有**:上述 1-8 的文件与 i18n 键组、tests 追加。
- **不碰**:`server/src/lib/agent/**`(只 import types)、`map-engine/**`、`site-geocode.ts`、`layers-panel.tsx`、`hooks/*`、`secondary-sidebar.tsx`、`jd-panel.tsx`、`poi-detail.tsx`、`account-panel.tsx`、`tech/**`、`.env.example`。
- map-shell.tsx 是红线豁免文件:**仅允许 seam 追加(约 3 处:import/ref/JSX)**,任何其他改动(含样式)视为违规。

## 门禁

```bash
cd /Users/acccan/dm-wt-agent-c/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-agent-c && make docs-check && git diff --check
```

## 纪律

- 小步 Conventional Commits;seam 单独 commit(如 `feat(agent): map-shell seam 挂载悬浮球`),便于合并冲突处理;可 `git merge dev`。
- 禁止:push/切分支/rebase/npm install/npx/Env-only/改现有 UI 设计(悬浮球与面板是新增 UI,允许;修改现有控件样式不允许)。
- Next.js 16 breaking changes:写组件前读 `server/node_modules/next/dist/docs/` 相关章节(动态 import/客户端组件约定)。

## 回报

写 `reports/ws-c.md`(实现摘要、seam 说明、i18n 键清单、遇到的问题、门禁输出),**末两行**:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
