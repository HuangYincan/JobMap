# f 汇报(2026-08-21)

WS: feature/map-engine-ui(轮 3 — UI 切换入口)worktree `/Users/acccan/dm-wt-eng-f`,分支 `feature/map-engine-ui`,5 个 commit,未 merge 未 push。

## 实际改动

- `server/src/lib/map-engine/switch.ts`(新)→ `switchMapEngine(opts)` 纯函数编排(DI 注入引擎,不 import 注册表/厂商,node 全 mock 可测):守卫(未配置引擎抛错且**不销毁旧 view**;同引擎 `created:false` 直接返回)→ `from?.destroy()` → `to.load()` → `to.createView({container, center, zoom, pitch, rotation, style})` → 有回放数据时在新 view 上重建 `POIMarkerController` 并回放(POI 集→可见集→选中→高亮,与 usePOIMap.applySync 同口径)→ 返回 `{view, created}`。导出 `EngineSwitchReplay` 类型。
- `server/src/lib/map-engine/engine-registry.ts`(附录 boss 裁决新增任务)→ 新增 `registerEngine(impl)` 通用装配(registerAmapEngine 同款 Object.assign 模式,方法 bind 到 impl 以兼容 baidu 类实例 `this`;幂等);骨架/描述字段/env 契约零改动 → **骨架门禁测试仍绿**。
- `server/src/hooks/use-map-engine.ts` → ①模块级三引擎统一接线(`registerEngine(AMAP_ENGINE_IMPL/TENCENT_ENGINE/BAIDU_MAP_ENGINE)`,resolveEngine/getConfiguredEngines/getEngine 自此返回完整引擎);②`switchEngine(id, replay?)`:调 switch.ts + 成功后 `writeEnginePreference(id)`(失败不持久化)+ `isSwitching` 状态 + `setActiveSearchProvider(to.search)` 随引擎路由;竞态守卫(切换重入 switchingRef、卸载后在飞结果销毁 aliveRef、挂载 load 与切换先落地互斥);③引擎总线(`subscribeEngineBus`/`useMapEnginePanel`,与 poi-service.setActiveSearchProvider 同款模块级模式)——图层面板无需 map-shell 传 props。暴露 `{ engine, view, switchEngine, isSwitching }`。
- `server/src/components/layers-panel.tsx` → 新增「地图源」section(`MapSourceSection` **独立导出组件**,移动端抽屉可直接复用),置于底图之后;引擎列表/configured 来自注册表(`ENGINE_PRIORITY` + `getEngine(id).isConfigured()`);chip:● 当前引擎实心 `#007AFF`(engineChipOn)、░ 未配置 40% 透明 + `aria-disabled` + `data-tooltip`「未配置 NEXT_PUBLIC_TENCENT_JSAPI_KEY」(现有 tooltip 模式);状态行「高德 · 自动选择 · 点击切换」,手动点击后 localStorage 偏好生效 → 「手动选择」,偏好未配置自动回落 → 「自动选择」。
- `server/src/components/recent-panel.module.css` → engineGrid/engineChip/engineChipOn/engineChipDisabled(0.4 透明)/engineDot(激活实心蓝)/engineStatus/data-tooltip::after(悬停 tooltip,map-shell 同款样式)+ focus-visible。
- `server/src/lib/i18n.ts` → 8 个新 key:mapSource / engineAmap / engineTencent / engineBaidu / engineAuto / engineManual / engineClickToSwitch / engineNotConfigured。
- `server/tests/map-engine-switch.test.mjs`(新,8 用例)→ 编排顺序(`destroy:from → load → createView` 深度断言)、state/style 回放(createView 实参)、控制器回放(3 POI→3 marker、可见集 show/hide、选中 100/高亮 80 zIndex、回放晚于 createView)、visiblePOIs 派生可见集、style 降级(baidu 语义 mock:whitesmoke → normal + console.warn 捕获)、同引擎守卫(created:false 零调用)、未配置引擎(抛错不销毁旧 view)、from=null 首切零控制器。
- `server/tests/component-contracts.test.mjs` 追加 2 用例 → ①map-shell 不再出现 `new window.AMap`/`new AMap.Map`(轮 2 迁移完成断言);②地图源 section + 接线契约(panel 正则:mapSource/ENGINE_PRIORITY/getEngine(id)/isConfigured/switchEngine(id)/engineChip/data-tooltip/export function MapSourceSection;hook:switchMapEngine/writeEnginePreference/isSwitching/useMapEnginePanel;switch.ts 不 import engine-registry/厂商实现;registry registerEngine;i18n 8 key)。

## 门禁结果

- npm test: 764 通过 / 0 失败(基线 754 + 本 WS 新增 10;2 skip 为基线既有)
- typecheck: 通过
- make docs-check: 通过
- git diff --check: 通过(工作树干净)

## 遇到的问题

1. **移动端抽屉(≤767px)「地图源」section 未能接线** —— map-shell.tsx 硬性只读(不碰清单 + 附录「不直接操作 map-shell」),而移动端 layers sheet(约 2633-2672 行)是 map-shell 内联实现。已将 `MapSourceSection` 作为独立导出组件(经引擎总线自取数据、零 props),桌面端已接线;移动端 drop-in 只需在 map-shell 的 mobileSheet==="layers" 分支加一行 `<MapSourceSection lang={lang} />` —— **留给 merger/下一轮(需 boss 裁决是否放行 map-shell 单行改动)**。
2. **切换沿用首渲染 style 快照** —— hook 只持有初始 style(contract 无 getStyle()/引擎无 getStyle),切换后若用户此前改过底图会回到初始底图;map-shell 的 mapStyle state 不受影响。已注释说明,后续可在 MapView 契约加 getStyle() 后消除(建议 deferred-notes)。
3. **非 AMap 引擎的 geolocation 蓝点** —— map-shell createMap 里 `getCurrentPosition(view.raw)` 是 amap-api 专属(逃生舱),切到 tencent/baidu 后该调用行为未验证(不影响切换功能本身,view 创建/事件/搜索均正常);属 map-shell 层适配,超本 WS 边界,记 deferred。
4. 汇报用 Playwright 截图未做:本 WS 为 headless 逻辑 + 契约测试;UI 视觉效果建议 merger 合并后统一截图验证(或下轮 UI 复核)。

## 证据

- 门禁输出:见上方各项;新增测试明细 `node --test`(全 mock,无网络):`tests/map-engine-switch.test.mjs` 8/8 绿。
- 契约测试:`tests/component-contracts.test.mjs` 新增 2 用例绿(基线全部保持)。
- 提交:`b5f108e`(switch 编排+测试)、`1fde4a6`(registry 接线+hook 切换)、`7b12849`(图层面板 UI+i18n+样式)、`a359e61`(契约测试追加)。

## 移动端接线补齐(boss 重派 2026-08-21)

- **改动行**:`server/src/components/map-shell.tsx` 仅 2 行(boss 放行范围内):
  1. L57(紧随 LayersPanel dynamic 之后)新增 `const MapSourceSection = dynamic(() => import("./layers-panel").then((mod) => mod.MapSourceSection));` —— 复用 layers-panel 已预载模块(RAIL_PANEL_MODULES["layers-panel"]),不新增预载;
  2. `mobileSheet==="layers"` 分支(原 L2671,`mobileStyleRow` 之后、`</div>` 之前)加一行 `<MapSourceSection lang={lang} />` —— 复用桌面端同一组件,数据经引擎总线(useMapEnginePanel)自取,零 props。
- 除此之外 map-shell 无任何其他修改(`git diff` 确认仅 +2 行)。
- **验证**:5th commit `7da6fdd`;全门禁重跑绿——npm test 766(764 pass / 2 skip 基线既有 / 0 fail)、typecheck 通过、make docs-check 通过、git diff --check clean。契约测试(component-contracts:map-shell 无 `new window.AMap` + 地图源 section 正则)不受影响仍绿。
- 移动端抽屉视觉效果(≤767px)建议 merger 合并后统一截图复核(本 WS headless,无截图)。

## 证据(追加)

- 提交 `7da6fdd`:feat(map-engine-ui): 移动端 layers 抽屉接入地图源 section(MapSourceSection,复用桌面组件),1 file +2 行。

门禁: PASSED
结论: OK
