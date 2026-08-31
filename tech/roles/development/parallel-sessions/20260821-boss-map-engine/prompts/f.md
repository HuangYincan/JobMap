# Workstream f — feature/map-engine-ui(UI 切换入口)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-eng-f`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine/reports/f.md`(末两行 token,见文末)。

## 背景

轮 1(引擎内核)+ 轮 2(amap/tencent/baidu 三引擎 + map-shell 迁移)已合并进 dev。本 WS:图层面板「地图源」section + 引擎切换编排,兑现「自动为主 + 手动可切」。UI 遵守项目设计系统(**Apple 风格 + liquid glass**:玻璃拟态卡片、`#007AFF` 蓝、绿仅用于薪资/工时;面板 chrome 用 `--soft-strong`,玻璃只用于卡片)。

## 布局图(boss 已批,照此实现)

图层面板(`server/src/components/layers-panel.tsx`)新增「地图源」section,置于「底图」之后:

```
┌─ 图层面板 ────────────────────────────────┐
│  图层面板                             ✕   │
│                                            │
│  收藏夹                                    │
│  [ 显示收藏 ....................  (●) ]    │
│                                            │
│  底图                                      │
│  ┌────────┐ ┌────────┐ ┌────────┐          │
│  │ [标准] │ │ 卫星   │ │ 素白   │          │
│  └────────┘ └────────┘ └────────┘          │
│                                            │
│  地图源                                    │
│  ┌────────┐ ┌────────┐ ┌────────┐          │
│  │ 高德 ● │ │ 腾讯 ░ │ │ 百度 ░ │          │
│  └────────┘ └────────┘ └────────┘          │
│  高德 · 自动选择 · 点击切换                │
└────────────────────────────────────────────┘
```

- **● 当前引擎**(实心,`#007AFF` 高亮)
- **░ 未配置 key 的引擎**:40% 透明 + `aria-disabled`,悬停 tooltip「未配置 NEXT_PUBLIC_TENCENT_JSAPI_KEY」(用现有 tooltip 模式),不可点
- 状态行:「高德 · 自动选择 · 点击切换」;手动点击某 chip 后写 localStorage 偏好(`domain-map:engine`),文案变「手动选择」;偏好引擎未配置时自动回落并显示「自动选择」
- 移动端抽屉(≤767px)同款 section,复用同一组件

## 任务

### 任务 1:`server/src/lib/map-engine/switch.ts`(新建,纯函数可测)

```ts
export function switchMapEngine(opts: {
  from: MapView | null;
  to: MapEngine;
  container: HTMLElement;
  state: MapViewState;             // 捕获自旧 view(或初始)
  style: MapStyleId;
  pois?: DomainPOI[];              // 回放到新 view 的 controller
  visibleIds?: Set<string>; visiblePOIs?: DomainPOI[];
  selectedId?: string | null; highlightedId?: string | null;
}): Promise<{ view: MapView; created: boolean }>
```

编排:捕获 state → `from?.destroy()`(先于新 view 创建)→ `to.load()` → `to.createView({container, center: state.center, zoom: state.zoom, pitch, rotation, style})` → 重建 controller 回放(POI 集/可见集/选中/高亮)→ 返回新 view。engine 由参数注入(DI 可测)。

### 任务 2:`server/src/hooks/use-map-engine.ts` 扩展(轮 2 已有初版)

- 加 `switchEngine(id: MapEngineId): Promise<void>`:调 switch.ts 编排 + 更新偏好(localStorage)+ `isSwitching` 状态
- 暴露 `{ engine, view, switchEngine, isSwitching }`

### 任务 3:UI
- `server/src/components/layers-panel.tsx`:新增「地图源」section(按布局图);引擎列表与 configured 状态来自 engine-registry(`getEngine(id).isConfigured()`);点击切换调 `switchEngine`
- `server/src/components/recent-panel.module.css`(或对应样式文件):chips/状态行/未配置降级样式(设计 token 对齐)
- `server/src/lib/i18n.ts`:新 key——地图源、三家引擎名、自动/手动选择、未配置 tooltip

### 任务 4:测试
- `server/tests/map-engine-switch.test.mjs`(新建):switch.ts 编排——旧 view destroy 先于新 view create(顺序断言)、state/style/POI 回放、style 降级 warn、controller destroy→重建顺序、engine 注入(不真发网络)
- `server/tests/component-contracts.test.mjs` **追加**:
  - map-shell.tsx 不得再出现 `new window.AMap`(轮 2 迁移完成断言)
  - layers-panel.tsx 包含「地图源」section 与引擎 chip 契约(正则)

## 文件边界

- **只允许改**:`server/src/lib/map-engine/switch.ts`(新)、`server/src/hooks/use-map-engine.ts`、`server/src/components/layers-panel.tsx`、`server/src/components/recent-panel.module.css`(或对应样式)、`server/src/lib/i18n.ts`、`server/tests/map-engine-switch.test.mjs`(新)、`server/tests/component-contracts.test.mjs`(追加)
- **不碰**:`map-engine/{types,engine-registry,engine-preference,script-loader,coord-utils}.ts`、三引擎实现文件、`map-shell.tsx`(只读确认,不迁移)、`site-geocode.ts`、`scripts/`、`tech/`、`server/docs/`、`server/data/**`

## 门禁

1. `cd /Users/acccan/dm-wt-eng-f/server && npm test`(全绿零漂移 + 本 WS 新增)
2. `cd /Users/acccan/dm-wt-eng-f/server && npm run typecheck`
3. `cd /Users/acccan/dm-wt-eng-f && make docs-check`、`git diff --check`

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine/reports/f.md`。内容:switch 编排实现、UI section 落地(截图可附到日志)、偏好读写、测试用例、未配置降级行为。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

## 【轮 3 派发附录 — boss 裁决 2026-08-21(轮 2 合并后现状)】

轮 2 已合并(c/d/e 三引擎 + map-shell 迁移)。现状:
- `use-map-engine.ts` 初版已由 ws-c 创建(挂载时 resolveEngine+load+createView,活跃引擎 search 注入)——你在其上加 switchEngine/isSwitching。
- **注册表接线(boss 裁决新增任务)**:`engine-registry.ts` 中 AMap/Tencent/Baidu 仍是骨架(ws-b 的 not-implemented 占位),完整实现分别从 `amap-engine.ts`(经 ws-c 的 `registerAmapEngine()` 外部装配)、`tencent-engine.ts`(`TENCENT_ENGINE` 导出)、`baidu-engine.ts`(`BAIDU_ENGINE` 导出)获得。**你负责统一接线**:让 `resolveEngine/getConfiguredEngines/getEngine` 返回的引擎携带完整 createView/load/search(可沿用 registerAmapEngine 的装配模式为三引擎各写 register 函数,或改 registry 引入——以最小改动、不破坏 ws-b 契约测试为准则)。接线完成后 `engine-registry.ts` 契约测试(env 名/优先级)必须仍绿。
- map-shell 已迁移到 MapView(8 处直引用收口)——你的 UI 切换基于 `use-map-engine` 的 view,不直接操作 map-shell。
- component-contracts.test.mjs 的断言是 ws-c 同步后的形态,你追加时以其为基线。

## 【续作重派附录 — boss 裁决 2026-08-21(轮 3 完成后)】

你已完成主任务(4 commit,门禁全绿)。**一个遗留缺口需补齐**:

- **移动端抽屉「地图源」section 接线**(布局图明确要求「移动端抽屉同款 section」):`map-shell.tsx` 的移动端 layers sheet(约 L2633-2672 的 `mobileSheet==="layers"` 分支)需加一行 `<MapSourceSection lang={lang} />`。**boss 放行 map-shell 仅此单行改动**——除此之外 map-shell 不得有任何其他修改。
- 操作步骤:确认你的 4 个 commit 已在分支 → 加该行 → 跑全门禁(npm test/typecheck/docs-check/diff)→ 更新 `reports/f.md`(在文末追加「移动端接线补齐」小节,说明改动行与验证)→ 末两行 token 重写。
- 不要重做已完成的任何工作(先 `git log` 确认现状)。
