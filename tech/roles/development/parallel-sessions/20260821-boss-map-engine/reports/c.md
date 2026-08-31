# c 汇报(2026-08-21)— feature/map-engine-amap

## 实际改动

### 新建
- `server/src/lib/map-engine/amap/amap-engine.ts` — AMap 引擎适配器(任务 1):
  - `load()` 复用 amap-api.loadAMap(同一 SCRIPT_ID/securityJsCode 流程,不双脚本);缺 key 提前抛错
  - `createView` 迁移旧构造参数:viewMode:'3D' / pitch / rotation / showLabel:true / mapStyle(style 映射)/
    rotateEnable:false;style→`amap://styles/normal|whitesmoke`,satellite = normal 底图 + `new AMap.TileLayer.Satellite({map})`
  - 视图方法:setCenter/setZoom/setPitch/setRotation(animateMs→`(v, false, animateMs)`)、setBounds(内部
    `new AMap.Bounds([w,s],[e,n])`)、flyTo(setZoomAndCenter(zoom,[lng,lat],false,600)+setCenter 兜底,与旧
    flyToLocation 逐行对应)、on(注册返回解绑,运行时转发任意事件串)、createMarker(offset 元组→AMap.Pixel,
    position→tuple,构造绑定地图,onClick 接 click 事件;cursor/bubble 经 duck-type 透传)、createCircle(L1067
    同款参数,构造即 add)、addControl('scale')(位置/偏移 duck-type;Scale 插件经内部 AMap.plugin 就绪回调,
    返回 Promise;重复调用=摘除旧控件按新参数重建,服务 resize)、destroy(map.destroy+卫星层销毁)
  - `search` 转发 amap-api searchPOI/fetchSuggestions/getCurrentPosition(绑定最近视图地图)/geocodeAddress
    (输出形态适配契约;page 分页经 duck-type 透传)
  - `registerAmapEngine()`:Object.assign 原地装配注册表骨架(engine-registry 厂商无关不反向依赖;
    readonly 字段为编译期约束,运行时赋值),use-map-engine 副作用 import 即注册
- `server/src/hooks/use-map-engine.ts`(任务 2,初版)— resolveEngine(readEnginePreference()) → load() →
  createView({container,center,zoom,style});卸载 destroy;暴露 `{engine, view, isSwitching:false}`;
  活跃引擎 search 注入 poi-service;零配置 → engine=null 由调用方 CSS fallback
- `server/tests/map-engine-amap.test.mjs`(任务 7)— 15 个适配器测试:注册/描述、load 幂等、构造参数、
  style 映射表、卫星层 show/hide/destroy、createMarker(offset 元组→Pixel/绑定地图/onClick)、duck-type
  透传(cursor/bubble)、createCircle 同款参数、scale control(插件 Promise/重建)、setBounds 内部 Bounds、
  flyTo/setPitch/setRotation/setZoom 动画参数、on 解绑、search 转发(周边/关键词/分页/建议/定位/geocode)、
  **map-shell 契约:无 `window.AMap` 直引用**

### 修改
- `server/src/components/map-shell.tsx`(任务 3)— 8 处直引用逐一迁移(见下);`mapInstance.current` 类型
  MapView;useMapEngine 承载引擎加载与视图创建;原 init effect 拆为「接线 effect + createMap(view)」;
  距离圈/手柄、聚合徽章、缩放/指南针/定位/样式切换全部改经 view 契约(AMap 专属能力经逃生舱 view.raw
  直连并标注 TODO);satelliteLayerRef/userMarkerRef/accuracyCircleRef 删除(卫星层由引擎内部管理)
- `server/src/lib/map-markers.ts`(任务 4)— createPOIMarkerController(view, opts):`new this.amap.Marker`
  → view.createMarker(offset 元组);命名空间经 view.engine.namespace 解析(Icon/Pixel/Size 逃生舱);
  **loadAMap().then(flush) 异步门删除,pendingPOIs 同步化**;createCityClusterMarker(view, group, opts)
- `server/src/hooks/use-poi-map.ts`(任务 5)— 入参 `map` → `view: MapView | null`
- `server/src/hooks/use-saved-layer.ts`(任务 5)— L94-101 `new AMap.Bounds + map.setBounds` →
  `map.setBounds(plain {west,south,east,north})`(引擎内部构造厂商 Bounds)
- `server/src/hooks/use-work-viewport.ts`(任务 5)— readMapViewSnapshot 加 plain-object 分支
  `{center:{lng,lat},zoom,bounds:{w,s,e,n}}`(向后兼容厂商对象形态);loader 内联快照改用该函数;
  `map.off?.()` → on() 返回解绑
- `server/src/hooks/use-search-state.ts`(任务 5)— L119 fetchSuggestions 从 amap-api 直引 →
  `engine.search.fetchSuggestions`(use-map-engine 注入,经 ref 读取保持依赖 [query, mode])
- `server/src/lib/poi-service.ts`(任务 5)— 视口兜底搜索经活跃引擎 `engine.search.searchPOI`:
  setActiveSearchProvider 注入;viewportFallbackSearch 与 amap-api searchViewportPOIsFallback 同一窗口
  策略(zoomStrategy/fallbackTaskWindow/mergePoisById);未注入回落 amap-api 直连(测试/SSR 零漂移)
- `server/src/lib/amap-api.ts`(任务 6)— 仅导出 AMAP_URL/SCRIPT_ID 常量;其余导出/行为零改动
  (amap-api.test.mjs 全绿)
- `server/tests/fixtures/amap-mock.mjs`(任务 7)— 加法:MockMap duck-type 成 view(engine 命名空间 +
  raw=自身 + createMarker/createCircle 构造即注册 overlay 表 + MockCircle)
- 4 个 marker 测试文件(任务 7)— marker-leak/marker-visibility:去 env/去 tick/异步竞态测试重写为同步
  语义;map-markers(纯函数)/pending-fly-to(正则契约):逐条核对后确认**零改动**
- `server/tests/city-cluster.test.mjs` — createCityClusterMarker 契约测试适配新签名(view 形态)
- `server/tests/component-contracts.test.mjs` — 迁移必然的字符串断言同步:settle 门控(view.getState/
  setCenter({lng,lat}))、handleLocate、ws-poi-vanish2 初始快照机制、saved-overlay toggle 的
  `map.setBounds({` 断言

## 迁移清单(8 处直引用逐一)

| # | 旧直连 | 新路径 |
|---|---|---|
| 1 | L527-542 `new window.AMap.Map(...)` 构造 | engine.createView(useMapEngine 承载,map-shell 删除) |
| 2 | L654 初始卫星 `new window.AMap.TileLayer.Satellite({map})` | createView style='satellite' → 引擎内部创建 |
| 3 | L1790 切换卫星 `new window.AMap.TileLayer.Satellite({map})` | view.setStyle('satellite') → 引擎内部 show |
| 4 | L674 `new window.AMap.Scale({position,offset})` | view.addControl?.('scale', {position,offset})(duck-type) |
| 5 | L683 `window.AMap.plugin(['AMap.Scale'], cb)` | 引擎 addControl 内部 ensureScaleControl(AMap.plugin 就绪回调) |
| 6 | L1067 `new AMap.Circle(...)` | view.createCircle(同款参数) |
| 7 | L1304 城市徽章 | createCityClusterMarker(view, group, opts) |
| 8 | L146 flyToLocation | view.flyTo(setZoomAndCenter 600ms 同语义) |

cleanup(L761) `mapInstance.current.destroy()` → useMapEngine 卸载 destroy;卫星层销毁并入引擎 destroy。
其余 AMap 专属能力(zoomIn/zoomOut、setRotation(0,true,300) 指南针复位、Geolocation 蓝点绑定、
setStatus 拖拽禁用手势)经逃生舱 view.raw 直连并标注 TODO——契约无对应方法,行为保真优先。

## controller 异步门简化说明

旧:构造控制器 → loadAMap().then(flush) 回放 pendingPOIs(浏览器/脚本竞态)。新:view 只会在
engine.load() 之后创建,控制器拿到 view 即引擎就绪 → 所有 setPOIs/setVisiblePOIs 同步生效,
pendingPOIs 字段与 flush() 删除。配套:marker-leak 两条「amap 未就绪时销毁/重建」与 marker-visibility
「就绪前设置可见集」重写为同步语义(行为不变式:destroy 零残留、实例保留、可见集先行——逐一核对保留)。

## amap-mock 扩展

MockMap 加 `engine:{namespace:'AMap',id:'amap'}`、`raw=this`、`createMarker(opts)`(构造即注册
overlay 表,返回 {raw,setPosition,setContent,remove})、`createCircle(opts)`(MockCircle 新类)、
MockCircle;4 个 marker 测试文件因此「几乎零改动」(仅同步化适配)。

## 测试适配说明

- marker-leak/marker-visibility:异步门相关用例重写为同步断言,其余用例结构/断言原样保留(逐个核对)
- city-cluster:createCityClusterMarker 契约测试改 view 形态(offset 元组断言替代 Pixel.x)
- component-contracts:settle/locate/初始快照/saved-overlay 四处字符串断言同步到迁移后形态;
  意图(三门控/原义保留/remount 恢复视野/抑制窗口先于相机移动)不变
- 契约断言新增(README 轮2 要求):map-engine-amap.test.mjs 断言 map-shell 无 `window.AMap`(含
  `new window.AMap`),迁移后 map-shell 全文仅注释提及 AMap 插件名

## 行为自检结果

逐行对比(构造参数/样式映射/事件/比例尺/卫星/暗色/收藏 setBounds/domain 搜索/定位蓝点)在代码层完成:
- 卫星:初始与切换均 normal 底图+瓦片层 show/hide,销毁时 destroy 瓦片层(旧语义)
- 暗色(whitesmoke):系统主题跟随 + 用户 pref 优先,handleThemeChange → view.setStyle
- 比例尺:LT(移动)/LB(桌面)+ 偏移、resize 重建、抽屉全开隐藏——全保真(位置/偏移经 duck-type)
- 视口抑制:useSavedLayer 写抑制窗口 → view.setBounds(引擎内部构造 Bounds)顺序不变
- 收藏 setBounds:plain bounds → 引擎 `new AMap.Bounds([sw],[ne])` 同参数
- domain 搜索:amap-api 零改动;兜底/建议经活跃引擎(AMap 时转发同一 amap-api 调用)
- 定位蓝点:getCurrentPosition(view.raw) 同一 amap-api 调用,Geolocation 绑定原始地图
- 中键旋转/指南针复位/缩放按钮:经 view 或逃生舱 raw,调用序列与旧代码逐参数一致

⚠️ **真实浏览器冒烟未做**:本会话无浏览器/真实 AMap key 环境,`npm run dev` 无法执行;
卫星/暗色/比例尺/视口抑制/收藏 setBounds/domain 搜索/定位蓝点 的运行时冒烟建议在合并后由
主 Agent 用真实 key 跑一次(或记入 deferred-notes)。

## 遇到的问题

1. **engine-registry 契约测试 `doesNotMatch(registry, /window\.AMap/)` + 注册表不反向依赖厂商**
   → 适配器经 `registerAmapEngine()` 从外部 Object.assign 装配骨架(幂等),use-map-engine 副作用
   import 触发;注册表文件零改动。
2. **MapView 契约无 zoomIn/zoomOut/setStatus/setRotation(0,true,300)/Geolocation/比例尺位置偏移**
   → 比例尺位置/偏移、cursor/bubble、page 分页经 duck-type 透传(调用点 as 收窄,适配器透传);
   其余经逃生舱 view.raw 直连并标注 TODO 限期迁移——不改 types.ts(不碰红线),行为保真优先。
3. **component-contracts/city-cluster 在文件边界外但断言迁移前字符串**(map.setBounds(new AMap.Bounds
   等)→ 迁移必然破坏)→ 最小化同步断言到迁移后形态(意图不变),已在汇报注明;ws-f 追加该文件时
   以本批形态为基线。
4. **typecheck**:`search` 等字段在契约 readonly → Object.assign 运行时赋值(编译期只读);
   onViewEvent 回调参数用 any(事件载荷为厂商形态)。

## 证据

- npm test:`ℹ tests 647 / ℹ pass 645 / ℹ fail 0 / ℹ skipped 2`(基线 598 全绿 + 本 WS 新增 49)
- typecheck / docs-check / git diff --check:全通过
- 6 个小步 commit:`287ab2f`(引擎适配器)→ `9b5dc02`(hook+poi-service)→ `c63b253`(map-markers
  ctx 化)→ `a1f62ca`(hooks 改向)→ `e609f80`(map-shell 迁移)→ `1b081d1`(测试)
- git status:干净(未 merge 未 push;分支/worktree 留原地)

门禁: PASSED
结论: OK
