# Workstream c — feature/map-engine-amap(AMap 引擎 + map-shell 迁移)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-eng-c`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine/reports/c.md`(末两行 token,见文末)。

## 背景(本 WS 是最大风险,行为零回归是第一目标)

轮 1(branch `feature/map-engine-core`)已合并进 dev:引擎三层接口(`server/src/lib/map-engine/types.ts`)、注册表、preference、script-loader、coord-utils。本 WS 把 map-shell 从 `window.AMap` 直连迁移到 MapView 抽象,**AMap 引擎行为必须与现状逐项一致**(构造参数/样式映射/事件/比例尺/卫星/暗色/收藏 setBounds/domain 搜索/定位蓝点)。

## 任务

### 任务 1:`server/src/lib/map-engine/amap/amap-engine.ts`(新建)
- `load()`:**复用 `amap-api.loadAMap`**(同一 SCRIPT_ID 与 securityJsCode 流程,不双脚本)
- `createView(opts)` 迁移 map-shell 现有构造参数(L527-542):`viewMode:'3D'`、pitch、showLabel、mapStyle、rotateEnable:false;container/center/zoom 来自 opts
- style 映射:`normal → 'amap://styles/normal'`、`whitesmoke → 'amap://styles/whitesmoke'`、`satellite → new window.AMap.TileLayer.Satellite()`(沿用 map-shell L653-654 用法)
- `search`:转发 amap-api 现有 `searchPOI/fetchSuggestions/getCurrentPosition/geocodeAddress`(行为零改动)
- 视图方法实现:setCenter/setZoom/setPitch/setRotation(animateMs 映射 AMap 动画参数)/setBounds(`new AMap.Bounds(...)` 内部构造)/flyTo(onPanTo 或对应)/on(事件注册,返回解绑)/createMarker(`new AMap.Marker` + 事件绑定,offset 元组 → AMap.Pixel)/createCircle(`new AMap.Circle`,L1067 同款参数)/addControl('scale' → `new AMap.Scale()`)/destroy(map.destroy())/getState/getBounds/isDestroyed
- `keyVar: 'NEXT_PUBLIC_AMAP_KEY'`、`namespace: 'AMap'`、`coordSystem: 'gcj02'`

### 任务 2:`server/src/hooks/use-map-engine.ts`(新建,初版;f 后续扩展切换)
- 挂载时:`resolveEngine(readEnginePreference())` → `engine.load()` → `engine.createView({ container, center, zoom, style })`;卸载时 destroy
- 暴露 `{ engine, view, isSwitching: false }`(isSwitching 由 f 扩展)
- container 来自调用方(ref);center/zoom/style 初始值由调用方传入

### 任务 3:map-shell.tsx 迁移(2817 行,改动面 ~350 行)
- `mapInstance.current` 类型 → `MapView`;改用 use-map-engine 获取 view
- **8 处 `window.AMap` 直引用全部迁移**:
  - L527-542 create 构造 → 已由 engine.createView 承载(删除)
  - L654 / L1790 `TileLayer.Satellite` → `view.setStyle('satellite')` 语义(引擎内部处理)
  - L674 / L683 Scale 插件 → `view.addControl?.('scale')`
  - L1067 Circle → `view.createCircle`
  - L1304 城市徽章 → 经 map-markers 的 createCityClusterMarker(view, …)
  - L146 `flyToLocation` → `view.flyTo`
  - cleanup(L761) → `view.destroy()`
- **契约**:迁移后 map-shell.tsx 不得再出现 `new window.AMap`(契约测试断言)

### 任务 4:map-markers.ts ctx 化
- `createPOIMarkerController(map, opts)` → `createPOIMarkerController(view: MapView, opts)`,内部 `new this.amap.Marker(...)`(L476)→ `view.createMarker(...)`;`createCityClusterMarker(amap, map, group, opts)`(L333)→ `createCityClusterMarker(view, group, opts)`(content 徽章语义保留)
- **删除内部 `loadAMap().then(amap => flush())` 异步门**(L370-400):view 只会在 engine.load() 之后创建,控制器拿到 view 即引擎就绪;pendingPOIs 回放简化为同步(配套测试重写)
- `getMarkerByPOIId` 保留(测试探针)

### 任务 5:hooks/poi-service 改向
- `use-poi-map.ts`:入参 `map` → `view: MapView | null`(内部调 view 方法)
- `use-saved-layer.ts` L94-101:`new AMap.Bounds + map.setBounds` → `view.setBounds(plain bounds)`
- `use-work-viewport.ts` L38 `readMapViewSnapshot`:**加 plain-object 分支**(view 可能已归一化为 `{center:{lng,lat}, zoom, bounds:{west,south,east,north}}`),向后兼容现有厂商对象形态
- `use-search-state.ts` L119 `fetchSuggestions` 从 amap-api 直引 → 活跃引擎 `engine.search.fetchSuggestions`(经 use-map-engine 注入)
- `poi-service.ts`:视口兜底搜索经活跃引擎 `engine.search.searchPOI`

### 任务 6:amap-api.ts 行为零改动
仅按需导出 `AMAP_URL`/`SCRIPT_ID` 常量供 amap-engine 复用;**任何现有导出/行为不变**(amap-api.test.mjs 契约钉住)。

### 任务 7:测试
- `tests/fixtures/amap-mock.mjs`:**加法**扩展 MockMap `createMarker/createCircle`(duck-type 成 view;现有 4 个 marker 测试文件几乎零改动)
- 4 个现有测试文件(map-markers / marker-leak / marker-visibility / pending-fly-to):机械适配 ctx 化 + 异步门简化(逐个核对行为,不可偷懒)
- 新增 `tests/map-engine-amap.test.mjs`:适配器断言(createMarker offset 元组→Pixel、setStyle 映射表、satellite 层、createCircle、scale control、search 转发)

## 文件边界

- **只允许改**:`server/src/lib/map-engine/amap/amap-engine.ts`(新)、`server/src/hooks/use-map-engine.ts`(新)、`server/src/components/map-shell.tsx`、`server/src/lib/map-markers.ts`、`server/src/lib/amap-api.ts`(仅导出常量)、`server/src/hooks/{use-poi-map,use-saved-layer,use-work-viewport,use-search-state}.ts`、`server/src/lib/poi-service.ts`、`server/tests/fixtures/amap-mock.mjs`、4 个 marker 测试文件、`server/tests/map-engine-amap.test.mjs`(新)
- **不碰**:`map-engine/{types,engine-registry,engine-preference,script-loader,coord-utils}.ts`、`map-engine/{tencent,baidu}/`、`site-geocode.ts`、`scripts/`、`tech/`、`server/docs/`、`server/data/**`、qqdoc 相关一切文件

## 门禁

1. `cd /Users/acccan/dm-wt-eng-c/server && npm test`(基线 549 + 轮1新增:**全部绿零漂移**,本 WS 新增也绿)
2. `cd /Users/acccan/dm-wt-eng-c/server && npm run typecheck`
3. `cd /Users/acccan/dm-wt-eng-c && make docs-check`、`git diff --check`
4. 行为对比自检(本地 `npm run dev` 可做则做,做不了在汇报注明):卫星/暗色(whitesmoke)/比例尺/视口抑制/收藏 setBounds/domain 搜索/定位蓝点 逐项与迁移前一致

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine/reports/c.md`。内容:迁移清单(8 处直引用逐一)、controller 异步门简化说明、amap-mock 扩展、测试适配说明、行为自检结果、遇到的回归与处理。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
