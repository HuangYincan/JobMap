# 23 — 多地图引擎插件架构(AMap / Tencent / Baidu)

> **Status:** 已落地(2026-08-21,`feature/map-engine` 批次 a–f 合并入库;本文件为批次收尾文档,ws-g)
> **Owner:** frontend / engine
> 来源:批次 `20260821-boss-map-engine` 各 ws 汇报(`reports/a.md`–`reports/f.md`);key 配置说明见 `server/docs/environment-variables.md`

## 背景与动机

Domain 主地图原本由 `map-shell.tsx` 直连 `window.AMap`(8 处直引用)+
`lib/map-adapter.ts`(6 行空壳 seam,`getMapAdapter()` 返回 `'fallback' | 'amap'`)
完成引擎隔离。2026-08-21 的 map-engine 批次把这条 seam 升级为**统一引擎插件契约**:

- 三家厂商(高德 AMap / 腾讯 TMap / 百度 BMapGL)各自完整实现
  `MapEngine` 契约,业务组件只依赖契约,不触碰厂商 API;
- 用户可在图层面板「地图源」section 切换引擎,偏好写入 localStorage;
- `lib/map-adapter.ts` 已删除(零引用确认后移除,ws-g)。

## 引擎插件架构(三层接口)

契约定义于 `server/src/lib/map-engine/types.ts`,三层职责:

| 层 | 接口 | 职责 |
|---|---|---|
| 引擎 | `MapEngine` | 描述字段(`id/label/namespace/coordSystem/keyVar`)+ 生命周期(`isConfigured` / `load` / `isLoaded` / `createView`)+ `search` 能力 |
| 视图 | `MapView` | 厂商地图实例的引擎统一包装:相机(`getState/getBounds/setCenter/setZoom/setPitch/setRotation/setBounds/flyTo`)、样式(`setStyle`)、事件(`on` 返回解绑)、overlay(`createMarker/createCircle`)、`addControl('scale')`、`destroy` |
| 搜索 | `MapSearchProvider` | `searchPOI` / `fetchSuggestions` / `getCurrentPosition` / `geocodeAddress`,统一返回规范化 `DomainPOI` / `AmapSuggestion` |

要点:

- **逃生舱 `view.raw`**:未迁移的 AMap 专属代码(缩放按钮、指南针复位、Geolocation
  蓝点绑定等契约无对应方法的场景)经 `view.raw` 直连厂商实例,代码标注 TODO 限期迁移;
- **厂商无关内核**:`engine-registry.ts` 不 import 任何厂商实现 / `amap-api`
  (契约测试钉住);三引擎完整实现由 `use-map-engine.ts` 模块级
  `registerEngine()` 装配进注册表骨架(与 `registerAmapEngine` 同款
  `Object.assign` 模式,方法 bind 到实现以兼容类实例 `this`);
- **数据源标注**:引擎归一化输出的 `BasePOI.source` 如实标注 —— AMap 引擎沿用
  `'amap'`,腾讯引擎 `'tencent'`,百度引擎 `'baidu'`(契约联合已扩展,ws-g;
  与 `'seed'`/`'api'` 一起参与持久化判定)。

### 注册表与优先级(`engine-registry.ts`)

```ts
ENGINE_PRIORITY: MapEngineId[] = ['amap', 'tencent', 'baidu'];
```

- `getConfiguredEngines()`:按优先级过滤 `isConfigured()`(key 存在即配置);
- `resolveEngine(preferred?)`:`preferred` 存在且已配置 → 它;否则读本地偏好
  (`readEnginePreference()`)已配置 → 偏好;再否则 → 优先级第一个已配置;
  全部未配置 → `null`(调用方回退 CSS fallback 地图);
- `getEngine(id)`:未知 id 抛错(闭合联合,属编程错误);
- `registerEngine(impl)`:三引擎统一装配入口(ws-f),幂等;装配前骨架调用抛
  `not-implemented`(错误信息标注落地 ws,调用方不得吞错)。

## key 矩阵

| 用途 | env | 消费方 | 说明 |
|---|---|---|---|
| 前端引擎(公开,构建期内联) | `NEXT_PUBLIC_AMAP_KEY` | amap 引擎 `isConfigured` | 高德 JS API key |
| 前端引擎(公开,构建期内联) | `NEXT_PUBLIC_TENCENT_JSAPI_KEY` | tencent 引擎 `isConfigured` | lbs.qq.com 新建 key 须勾选「JS API GL」;**WebService 浏览器直连另需勾选 WebServiceAPI 产品 + 域名 CORS 白名单**(deferred #1) |
| 前端引擎(公开,构建期内联) | `NEXT_PUBLIC_BAIDU_AK` | baidu 引擎 `isConfigured` | lbs.baidu.com 控制台 AK;可复用服务端 `BAIDU_MAP_AK` 值,JSAPI 需配 referer 白名单(deferred #2) |
| 后端 geocode 链(服务端秘密) | `AMAP_WEB_KEY` / `BAIDU_MAP_AK` / `TENCENT_MAP_KEY` | `site-geocode.ts` provider 注册表 | 见「后端 geocode 链」节;绝不打印 |

## 坐标规范(gcj02)

- **规范坐标 = gcj02**(`types.ts` 注释契约):所有 `MapEngine/MapView/MapSearchProvider`
  接口入参/出参一律 gcj02;高德/腾讯原生坐标系直通,百度引擎适配层负责换算;
- `coord-utils.ts` 纯函数:`wgs84ToGcj02` / `gcj02ToWgs84`(2 次迭代逆变换,往返
  <1e-7)/ `gcj02ToBd09` / `bd09ToGcj02`;境外零偏移直通;固定点位精度 ±1e-5(约 1 米);
- **百度引擎 bd09 边界转换**(适配层内部一律 bd09,对外一律 gcj02):
  - 入参 gcj02→bd09:`createView` 初始中心 / `setCenter` / `setBounds`(sw+ne)/
    `flyTo` / `createMarker`(含 `setPosition`) / `createCircle` / `searchPOI` 周边检索中心;
  - 出参 bd09→gcj02:`getState().center` / `getBounds` / `searchPOI` 结果 POI /
    `fetchSuggestions` 结果 / `getCurrentPosition` / `geocodeAddress`;
  - 漏转 ≈700m 偏移 —— 测试用**固定点位字面量**钉住(天安门
    gcj02 (116.397428, 39.90923) → bd09 (116.4038005645, 39.9155730161);上海人民广场 /
    深圳市民中心 / 杭州西湖同款);⚠️ 网传对照点「天安门 bd09 (116.403963,
    39.915119)」与官方公式差 ~4.5e-4,**不用网传值做断言**(ws-b/ws-e 双重声明);
  - 俯仰/朝向换算:AMap pitch → BMapGL `setTilt`(钳制 0-45)、rotation →
    `setHeading`(归一 [0,360));
- 腾讯定位:GL 核心无定位服务 → 浏览器 `navigator.geolocation`(WGS84)→
  `wgs84ToGcj02` 换算(境内点位非直通,测试断言偏移)。

## 样式支持矩阵

| MapStyleId | AMap(高德) | Tencent(腾讯) | Baidu(百度) |
|---|---|---|---|
| `normal` | `mapStyle: 'amap://styles/normal'` | `baseMap: { type: 'vector' }` | `setMapType(BMAPGL_NORMAL_MAP)` |
| `satellite` | normal 底图 + `AMap.TileLayer.Satellite({map})`(show/hide,引擎内部管理) | `baseMap: { type: 'raster' }` | `setMapType(BMAPGL_SATELLITE_MAP)` |
| `whitesmoke` | `'amap://styles/whitesmoke'` | **不支持 → 回退 normal + console.warn**(暗色 `styleType:'dark'` 存在但契约无 dark 项,未暴露) | **不支持 → 回退 normal + console.warn**(无对应常量) |

降级语义:样式降级由**引擎视图自身**兜底(`setStyle` 内回退 normal + `console.warn`,
不抛错);`switchMapEngine` 只透传目标样式,不做二次猜测。运行期切换:AMap
`setMapStyle` / 腾讯 `setBaseMap` / 百度 `setMapType`。

## 切换编排(`switch.ts` + `use-map-engine.ts`)

`switchMapEngine(opts)` 纯函数编排(DI 注入引擎,不 import 注册表/厂商,node 全 mock 可测):

1. 状态捕获:调用方传入旧 view 的 `getState()`(或初始快照);
2. `from?.destroy()` —— 先于新 view 创建(同一容器同时只能有一个地图实例);
3. `to.load()` —— 幂等脚本注入(script-loader 同 URL 缓存 + namespace 就绪短路;
   失败移除标签+清缓存可重试;callback/onload 双模式);
4. `to.createView({ container, center, zoom, pitch, rotation, style })`;
5. 有回放数据时在新 view 上重建 `POIMarkerController` 并回放
   (POI 集 → 可见集 → 选中 → 高亮,与 `usePOIMap.applySync` 同口径);
6. 返回 `{ view, created }`。

守卫:目标引擎未配置(`isConfigured()` false)→ 抛错且**不销毁旧 view**;同引擎
(`to.id === from.engine.id`)→ `created:false` 直接返回。

`use-map-engine.ts` 接线:

- **偏好**:localStorage key `domain-map:engine`(SSR/非浏览器守卫:读 null、写 no-op);
  `switchEngine` 成功后 `writeEnginePreference(id)`(失败不持久化);
- **自动/手动语义**:手动选择 = 偏好引擎即当前活跃引擎;偏好缺失/未配置
  (活跃引擎为优先级回落结果)→ 自动选择 —— 图层面板状态行据此显示「高德 · 自动选择 ·
  点击切换」;
- **竞态守卫**:切换重入 `switchingRef`、卸载后在飞结果销毁 `aliveRef`、挂载 load 与
  切换先落地互斥(同容器双实例防御);
- **引擎总线**:`subscribeEngineBus` / `useMapEnginePanel` —— 图层面板无需
  MapShell 传 props;`setActiveSearchProvider(to.search)` 随引擎路由(视口兜底搜索/建议);
- **UI**:图层面板「地图源」section(`MapSourceSection` 独立导出组件,桌面 + 移动端
  抽屉复用):引擎 chip(● 当前实心蓝 `#007AFF` / ░ 未配置 40% 透明 +
  `data-tooltip`「未配置 NEXT_PUBLIC_…」)、`isSwitching` 期间禁用切换入口;
  i18n 8 key(mapSource/engineAmap/engineTencent/engineBaidu/engineAuto/
  engineManual/engineClickToSwitch/engineNotConfigured)。

已知限制(见 deferred-notes):切换后底图样式沿用**首渲染快照**(契约无 `getStyle()`,
deferred #5);非 AMap 引擎的 geolocation 蓝点行为未验证(`getCurrentPosition(view.raw)`
为 amap-api 专属逃生舱,deferred #6)。

## 后端 geocode 链(`site-geocode.ts`)

- **provider 注册表**(只读配置面):`getGeocodeProviders()` 按固定链顺序
  `amap → baidu → tencent` 返回 `{ id, envVar, configured }`,读与
  `amapWebKey()/baiduWebKey()/tencentWebKey()` **同一 env**(trim 后非空即 configured);
  脚本 REPORT 输出 `PROVIDERS amap=set … | chain=AMap→Baidu→Tencent (skip no-key)`;
- **固定链顺序,不做配置**:无 key 自动跳过;注册表与 key getter 不共享实现,
  一致性由 `tests/geocode-providers.test.mjs` 钉住(2^3 全 env 组合,防漂移);
- **配额切换**:AMap 日配额耗尽(`infocode` 10044 / 10043,`status="0"` +
  `QUERY_OVER_LIMIT`)→ 该次运行切换百度;百度天配额(status 302,重试一次仍 302)→
  腾讯;腾讯每日上限 status 121(遗留 321/322,key/IP/功能配置永久失效
  110/112/190/199/311)→ 判配额类;连续 N 个站点配额类失败 → `shouldShortCircuitQuota`
  提前停止(`fix/geocode-quota-short-circuit`,2026-08-21 真实探测校准 311);
- 消费方:`geocode-sites-apply.mjs` / `plan-site-geocode.mjs` REPORT 行。

## vendor API 核实记录(ws-d 腾讯 / ws-e 百度)

> ⚠️ 两 ws 运行环境沙箱禁网,**以下依据官方文档已知稳定形态 + 轮 1
> loader 测试已固化的 URL 形态交叉验证**,未实机核实。标注 **[冒烟待验]** 的项
> 须在真实 key 配置(deferred #1/#2)后冒烟核对,结果**回填本文件**。

### 腾讯(JS API GL + WebService)

| 项 | 形态 | 出处 |
|---|---|---|
| 脚本 URL | `https://map.qq.com/api/gljs?v=1.exp&key=<KEY>[&callback=onTMapScriptLoad]`,callback 须注入前注册 | glAPI 快速开始;[冒烟待验] |
| 命名空间 | `TMap`(window.TMap) | 同上 |
| 地图构造 | `new TMap.Map(container, { center: TMap.LatLng, zoom, pitch, rotation, baseMap })` 双参 | glMap 地图展示 |
| 坐标类 | `TMap.LatLng(lat, lng)` **纬度在前**,属性 `.lat/.lng`;`TMap.LatLngBounds(sw, ne)` 访问器 `getWest/getSouth/getEast/getNorth` | glMap LatLng/Bounds;[冒烟待验] |
| 视图方法 | `setCenter/getCenter、setZoom/getZoom、setPitch/getPitch、setRotation/getRotation、setBounds、flyTo({center,zoom,pitch,rotation,duration})、setBaseMap、on/off、addControl、destroy`;setCenter/setZoom 无动画参数 → 动画经 `flyTo(duration)` | glMap 地图方法;[flyTo 参数可选性冒烟待验] |
| 事件映射 | 无原生 moveend/zoomchange/complete → `zoomchange→'zoom'`、`moveend→'idle'`、`complete→'idle'`(相机静止超集) | glMap 事件;[冒烟待验] |
| Marker | `new TMap.Marker({ position: LatLng, map, content, offset: {x,y}, zIndex })`;移除 `setMap(null)`(无 remove);`on('click')`;`setPosition/setContent` | glMarker;[冒烟待验] |
| Circle | `new TMap.Circle({ center, radius, map, strokeColor, fillColor, fillOpacity })`;移除 `setMap(null)` | glCircle;[冒烟待验] |
| 比例尺 | `new TMap.control.ScaleControl({ position: 'bottomRight' })` + `addControl` | glControl;[冒烟待验] |
| 搜索 | **GL 无内置搜索类** → WebService:关键词 `GET /ws/place/v1/search?keyword=&boundary=&page_size=&key=`(`boundary`: region(城市)/nearby(lng,lat,radius));建议 `GET /ws/place/v1/suggestion?keyword=&region=&key=`;geocode `GET /ws/geocoder/v1/?address=&region=&key=`;响应 `{status:0, data:[…]}` 坐标 **gcj02**;page_size 上限 20 | webServiceGuide;[冒烟待验] |
| 定位 | GL 无定位 → 浏览器 `navigator.geolocation`(WGS84)→ `wgs84ToGcj02` | 通用 Web 标准;[冒烟待验] |

引擎实现策略:**vendor 优先**(`TMap.search` 存在时直调,engine-mock 注入用)、
**真实生产回落 WebService**(fetch);失败一律安全值([]/null + console.warn),
不向消费方抛错。

### 百度(BMapGL)

| 项 | 形态 | 出处 |
|---|---|---|
| 脚本 URL | `https://api.map.baidu.com/api?v=1.0&type=webgl&ak=<AK>`;本实现 script-loader **onload 模式**(脚本同步定义 window.BMapGL)[冒烟待验];官方示例原文含 `&&` 系笔误 | webgl/quick-start |
| 命名空间 | `BMapGL`(window.BMapGL) | 同上 |
| 地图构造 | `new BMapGL.Map(container)`(id 或元素);`map.centerAndZoom(point, zoom)` 初始化中心+级别 | class-map |
| 相机 | `setCenter/getCenter、setZoom/getZoom、setTilt/getTilt(0-45)、setHeading/getHeading(0-360)、panTo、setBounds/getBounds(getSouthWest/getNorthEast)、destroy` | class-map |
| 事件映射 | `zoomchange→'zoomend'`、`moveend→'moveend'`、`complete→'tilesloaded'`;`addEventListener/removeEventListener` | class-map 事件表 |
| 底图 | 常量 `BMAPGL_NORMAL_MAP` / `BMAPGL_SATELLITE_MAP`(另有 EARTH);运行期 `setMapType`;whitesmoke 无对应 → 回退 normal + warn | class-map setMapType |
| Marker | `new BMapGL.Marker(point, { offset: Size, zIndex, … })`;`setPosition/setContent/addEventListener('click')/remove`;上地图 `addOverlay`、移除 `removeOverlay`;[setContent 存在性冒烟待验,适配器可选链降级] | class-marker |
| Circle | `new BMapGL.Circle(center, radius, { strokeColor, strokeOpacity, strokeWeight, fillColor, fillOpacity })`;`remove()` | class-circle |
| 比例尺 | `new BMapGL.ScaleControl()` + `addControl` | class-control |
| PlaceSearch | `new BMapGL.PlaceSearch({ location, pageCapacity, onSearchComplete })`;`search/searchNearby`;`getCurrentNumPois()/getPoi(i)`(title/point/address/tags/type/uid) | class-place-search;[未设 location 默认区域冒烟待验] |
| Autocomplete | 官方为**输入框 UI 组件**;headless 探测 `prototype.search` 存在才直用,现实大概率回退 PlaceSearch 顶部结果;headless 路径 5s 超时兜底防挂起 | class-autocomplete |
| Geocoder | `new BMapGL.Geocoder()`;`getPoint(address, callback, city?)` 第三参形态(字符串 vs {city} 对象)[冒烟待验],失败仅丢城市提示 | class-geocoder |
| Geolocation | `new BMapGL.Geolocation()`;`getCurrentPosition(callback)` → `{ point, accuracy }` | class-geolocation |
| 就绪信号 | `setMapReadyCallback` 是 **BMapGL 2.0 API,v1.0 getscript 不存在**(SDK 源码 0 处命中);v1.0 真实就绪事件(派发原名):`onfirsttilesloaded`/`onfirsttileloaded`(首帧瓦片批完成)、`ontilesloaded`(全部瓦片完成,注册 `tilesloaded` 经 BaseClass 自动补 "on" 前缀归一命中)、`onstyle_loaded`(样式配置加载,早于瓦片);多通道任一即就绪,`setMapReadyCallback` 存在时仍优先(升级兼容) | 2026-08-22 SDK 源码核实(ws-c) |
| 就绪时序 | GL 构造器**跳过默认视图初始化**(仅非 GL 分支 `centerAndZoomIn` 默认中心),底图图层在 `centerAndZoomIn` 内才创建(`if(!this.loaded){_addTileLayer}`)→ **必须先 `centerAndZoom` 再等就绪信号**(旧「等就绪后再设相机」时序 = 零瓦片请求 = 就绪事件永不派发 = 必然 1.5s 超时回滚,与 AK 有效与否无关);SDK 无任何异步初始化重置相机(GL 不应用 `_initViewport`、注册插件不动相机) | 2026-08-22 SDK 源码核实(ws-c) |
| 坐标系 | **bd09**(百度原生);适配层边界 gcj02↔bd09(coord-utils 官方公式),漏转 ≈700m | — |

引擎实现策略:官方服务四方法(PlaceSearch / Autocomplete headless + 超时兜底 /
Geocoder / Geolocation);`coordSystem: 'bd09'`;失败一律安全值([]/null + warn);
项目无 @types/bmapgl,厂商 API 最小类型面按官方文档命名声明(仅覆盖用到的成员)。

## 冒烟记录与未验证项

| 来源 | 自检 | 未验证项 |
|---|---|---|
| ws-c(AMap,15 适配器测试) | 构造参数/样式映射/卫星/比例尺/事件/收藏 setBounds/搜索转发逐参数核对 | 真实浏览器冒烟未做(无浏览器/真实 key 环境) |
| ws-d(腾讯,21 测试) | 脚本 URL 断言/callback 时序/双参构造/纬度在前/事件映射/WebService 端点/失败安全值 | **腾讯真实 key 冒烟缺口**(mock 代替,deferred #1);WebService CORS 依赖 |
| ws-e(百度,35 测试) | 脚本 URL/onload/相机闭环(防 700m 偏移)/bd09 固定点位/事件映射/搜索四方法/5s 超时 | [冒烟待验] 项(Geocoder 第三参、setContent、onload 时序等,deferred #2);Autocomplete 现实降级 |
| ws-c 就绪信号修正(2026-08-22,百度 47 测试) | 就绪信号选型:SDK 源码核实 v1.0 无 `setMapReadyCallback`、就绪事件 = `onfirsttilesloaded`/`ontilesloaded`/`onstyle_loaded`;GL 构造不设默认视图 → 相机先行修复(先 centerAndZoom 再等就绪);多通道任一即就绪;超时 1.5s + 销毁 + 抛错回滚契约不变;测试钉注册事件名/任一触发/超时路径/相机先行时序 | **真实浏览器冒烟未做**(无浏览器环境):就绪信号选型依据为 SDK 源码静态核实(getscript v1.0 直连本体 1.2MB 抓取);真实验证待 boss 合并后 Playwright(有效 AK 下 createView 应在数十 ms 内就绪、相机不丢、禁 AK 应 1.5s 超时回滚) |
| ws-f(切换,8 测试) | 编排顺序深度断言/回放/降级/守卫 | 三引擎**同配**真实冒烟(deferred #4);移动端抽屉截图复核 |

**所有「[冒烟待验]」项 = 待真实 key 冒烟回填(deferred #1/#2)**;三家同配真实冒烟
(默认高德、手动切腾讯/百度、状态保持、样式降级)见 deferred #4,结果回填本文件。
切换后底图样式回退快照语义(deferred #5)与非 AMap 引擎蓝点行为(deferred #6)
已在「切换编排」节一句话注明。

## 非目标(明确排除)

- **引擎热插拔插件运行时**:注册表是静态 MODES 式(三引擎描述 + `registerEngine`
  装配),不支持运行期动态注册/卸载新引擎厂商;
- **后端 chain 顺序配置**:geocode 链固定 AMap→Baidu→Tencent,无 key 跳过,不做
  顺序配置化;
- **多引擎同时加载**:单视图单引擎,切换为「销毁旧 view → 加载新引擎 → 重建」,
  不存在双引擎同屏。

## ws-5 收尾与验证回填(2026-08-22,feature/engine-search-cleanup)

> 本批次第 5 轮(轮 1-4 = 契约扩展 + 控制器引擎无关化 + 切换生命周期 + 层级)。

### 搜索引擎化(poi-service 关键词回退 provider 化)

关键词回退(domain 搜索)原硬绑 `amap-api.searchPOI`,与视口兜底
(`viewportFallbackSearch`,轮 1 已 provider 化)口径不一致——引擎切到腾讯/百度后
关键词搜索仍走高德。修复:改走活跃引擎 `activeSearchProvider.searchPOI`
(`limit/page/city` 与视口兜底同口径,`page` 为契约 duck-type 扩展);未注入
(SSR/测试/零配置)回落 `amap-api.searchPOI` 直连,行为与迁移前一致;provider
抛错仍为错误信号(可重试),不静默 return existing。注入机制不变
(`use-map-engine` 挂载/卸载时 `setActiveSearchProvider`,poi-service L42-46)。

### 聚合徽章清理(city cluster 摘除能力分派)

聚合徽章清理原调 `marker.setMap(null)`——`createCityClusterMarker` 返回的是
**厂商裸实例**(`wrapper.raw`),BMapGL 无 setMap → 静默 no-op → 跨 zoom 分桶
切换旧徽章泄漏叠图。修复:按能力分派摘除(`typeof marker.setMap === 'function'
→ setMap(null)`,否则 `remove()`),与契约 `MapMarker.remove` 的引擎语义一致
(AMap/TMap glMarker = setMap(null),BMapGL = remove())。

### 验证结果(ws-5 验收)

| 项 | 结果 |
|---|---|
| 三引擎 marker 生命周期贯通(创建 → setZIndex → setVisible → on/off → remove,engine-mock 断言三引擎语义一致)| ✅ 6/6(map-engine-lifecycle.test.mjs)|
| 徽章形态摘除回归(offset/zIndex/bubble 透传 + 分派摘除)| ✅ 3/3(同上文件)|
| poi-service 关键词 provider 路由(杭州外/全国+翻页/杭州内回退/抛错信号)| ✅ 4/4 |
| 全量 npm test(含轮 1-4 合并基线:切换回滚/重入取代/层级隔离 CSS 断言)| ✅ 1096 pass / 2 skip / 0 fail |
| typecheck / git diff --check | ✅ |
| 契约 grep(徽章段不再出现裸实例 setMap(null) 直调)| ✅(distance overlay 遗留见下)|
| 真实验证(切三家 / POI 交互 / 徽章聚合在腾讯 MultiMarker 降级与百度 HTML 徽章)| ⛔ 未做:headless worker 无浏览器工具、worktree 无真实 key;记 deferred #1 依赖真实 key + 浏览器回填 |

**遗留(边界外,建议后续 fix WS)**:distance overlay(距离圈/手柄,
map-shell L1097/1101/1120/1138 等)仍持 `.raw` 直调 AMap 专属 API
(setMap(null)/setCenter/setRadius/getMap/getRadius)——腾讯/百度引擎下与徽章
同款风险(无 setMap 的 raw 上直调会 TypeError / no-op);ws-5 行段边界未及,
已记 deferred,待后续轮次契约化。

## ws-6 修复与验证回填(2026-08-22,feature/engine-fixes:百度加载器 + TMap 批量化)

> 来源:批次 `20260821-boss-map-engine-rework` ws-6 汇报;轮 1-5 合入后 boss
> Playwright 冒烟坐实两问题(百度切换失败 / TMap 数据层爆炸),本 WS 修复。

### 百度加载器:直连 getscript 绕开 document.write 拦截

**诊断(实测坐实)**:官方 `/api` 包装器
(`https://api.map.baidu.com/api?type=webgl&v=1.0&ak=...`,实测 401B)内部
`document.write` 注入 getscript 子脚本 + bmap.css——SPA 运行时异步注入时浏览器
拦截 document.write(`Failed to execute 'write' on 'Document'`)→ 子脚本不加载 →
`window.BMapGL` 永不就绪 → 切换百度失败回滚。**`v=3.0` 的 /api 包装器与
v=1.0 逐字节相同(2026-08-22 实测),升级版本号无效**。

**修复**:直连 getscript 本体
(`https://api.map.baidu.com/getscript?type=webgl&v=1.0&ak=<AK>`,实测 1.2MB,
grep **零 document.write**,同步定义 `window.BMapGL` + `BMAPGL_*` 常量)+
**同步注入**(`script.async=false` + 无 defer + head 最前,百度专用注入器,
script-loader 默认 async 路径不动)+ **就绪轮询**(50ms × 40 ≈ 2s 超时;
getscript 开头即 `BMapGL={}` 占位,残缺命名空间由轮询兜住,超时抛既有
「命名空间未就绪」,switch 回滚契约文案不变)+ **bmap.css 幂等注入**
(包装器第二支 document.write 的等价物,失败静默)。`isLoaded()` 改功能判定
(`typeof ns.Map === 'function'`),半载命名空间视为未就绪。

**验收(离线)**:mock 断言注入 URL(async=false + head 最前)、就绪轮询补全、
2s 超时抛错、CSS 幂等、isLoaded 功能判定(43/43 绿)。

### TMap MultiMarker 批量化:单共享实例承载全部 geometry

**诊断**:旧实现每 marker 一个 MultiMarker 实例 → ~145 数据层(TMap 连续警告
「数据层过多,影响点击拾取」)+ `MaxListenersExceededWarning`(mousemove 监听
泄漏)。**SDK v1.8.0.2 源码核实**单实例内部方法面齐备:
`add(geos)` 增量 / `remove(ids)` 按 id 摘除 / `updateGeometries` 按 id 更新 /
`setStyles(styles)` 全量替换 / `getGeometryById` / `setMap(null)` 移除 /
`setZIndex`·`setVisible` 实例级 / click 载荷 `e.geometry.id`。

**修复**(types.ts 契约零改动):

- **单共享实例**:首次 createMarker 惰性构造,后续 `raw.add([geometry])` 增量;
  身份映射表 `multiGeometries`(id → 活 geometry 引用)+ `multiAttached`(挂载集);
- **样式归组**:icon 规格 + offset 签名 → styleId(`dm-st-N`),同签名共享(样式
  字典不随 marker 数膨胀);新签名经 `setStyles` 全量替换上实例(**先于 add**,
  geometry 引用的 styleId 不能缺失);无 icon/offset → `default`(SDK 内建 pin);
- **zIndex 实例级**(overlay layer rank)→ `max(全部 marker)` 近似契约层级
  语义:选中(100)/高亮(80)整体抬升图层、移除/降级回落;老 SDK 无 setZIndex
  → 一次性 warn 降级;
- **setVisible 经 remove/add 摘挂单 geometry**:隐藏 = 不在图层,天然不可点击/
  零渲染开销(实例级 setVisible 会误伤全部 marker,弃用;老 SDK 无实例级
  setVisible 也照常工作,无降级路径);
- **事件**:单实例 click 按 `e.geometry.id` 过滤分发(ws-1 模式扩展);off 缺省
  cb 按 id 精确解绑本 marker(不误伤他 marker);remove 同步清理回调簿记;
- destroy 显式 `setMap(null)` 摘除共享实例 + 清簿记。

**验收(离线)**:145 marker 只构造 1 个实例(无数据层爆炸/监听爆炸)、样式归组、
增删改(添加/移除/可见性/层级/点击)契约测试全绿 + 批量化专项(49/49 绿)。

### 验证结果(ws-6 验收)

| 项 | 结果 |
|---|---|
| baidu 加载器(mock:getscript URL/同步注入/轮询补全/超时抛错/CSS 幂等/isLoaded 功能判定)| ✅ 43/43(map-engine-baidu.test.mjs)|
| TMap 批量化(mock:145 单实例/样式归组/off·remove 隔离/zIndex 回落/可见性摘挂)| ✅ 49/49(map-engine-tencent.test.mjs)|
| 全量 npm test | ✅ 1104 pass / 2 skip / 0 fail |
| typecheck / git diff --check | ✅ |
| make docs-check | ⛔ 基线红(`20260821-boss-agent-thinkfix/merge-report.md:20` 复述 grep 正则自匹配,先于本批并入 dev;本批零新增违例)|
| 真实验证(dev server 切高德→百度→腾讯往返 + TMap 无数据层警告)| ⛔ 未做:headless worker 无浏览器、worktree 无 .env.local;由 boss 合并后 Playwright 冒烟回填(deferred)|

**遗留(边界外)**:v=3.0 加载器与 v=1.0 同源同 document.write 形态,若百度未来
发布无 document.write 的新加载器可再评估升级;TMap 单 marker 精确 zIndex
(SDK 无 per-geometry zIndex)以实例 max 近似,若产品要求单 marker 层级差需
按层级分实例(与批量化权衡)。

## ws-7 就绪等待与超时回填(2026-08-22,feature/engine-baidu-ready:百度 createView 就绪超时回滚)

### 诊断(boss 真实验证,2026-08-22 Playwright)

轮6 后百度加载器已生效,但用户 Baidu AK 被禁用(服务端弹窗「APP服务被禁用了」)
→ SDK 内部异步崩溃(`BMapGL._rd` null 等 telemetry 错误),`new BMapGL.Map()`
创建**成功但不渲染、不抛错** → switch 报告成功 → UI 显示百度选中但地图全空,
无回滚(旧 AMap 已销毁,容器无图)。

根因:`createView` 构造 Map 后直接返回,不等就绪事件——SDK 对象创建成功即
通过,异步渲染失败无法触发回滚。对比:腾讯引擎(ws-4)已有
`TENCENT_MAP_READY_TIMEOUT_MS=1.5s` 就绪超时模式,百度缺失。

### 修复(baidu-engine.ts;switch.ts 零改动,回滚契约已就绪)

- **就绪等待双通道**(`waitForMapReady`,任一先到即就绪):
  1. `setMapReadyCallback`(BMapGL 2.0 官方就绪回调,存在时优先注册);
  2. `tilesloaded` 事件(官方事件集,`EVENT_MAP.complete` 同源)兜底。
  双通道防 SDK 单通道异常(回调注册了但永不触发)造成误判回滚。
- **超时抛错**:`BAIDU_MAP_READY_TIMEOUT_MS = 1500`(与腾讯同量级);超时
  → 先 `map.destroy()` 销毁未渲染的 Map(容器交还回滚视图),再抛
  「BMapGL 地图就绪超时」——switch.ts:181-206 已实现 createView 抛错回滚,
  零改动直接生效。**与腾讯的差异(有意)**:腾讯超时兜底放行(不阻塞),
  百度超时抛错(绝不返回空图)——AK 禁用/渲染失败必须触发回滚。
- **相机时序**:就绪信号到达**后**才应用 centerAndZoom/setTilt/setHeading/
  setStyle(创建后立即设置会被异步初始化重置,丢失相机;正常 AK 下
  tilesloaded 数十 ms 内触发,延迟不可感知)。事件系统/回调通道均不可用
  → 立即放行(测试 mock/异常形态不阻塞);就绪/超时均解绑 tilesloaded 监听。
- **共享测试 mock 适配**(map-engine-lifecycle.test.mjs RawMap,ws-5 同款
  先例:tencent 就绪等 idle):构造后同时触发 `tilesloaded`(baidu 就绪信号)。

### 验收(离线 mock)

| 项 | 结果 |
|---|---|
| baidu 就绪等待(mock:tilesloaded 触发后才返回/相机就绪后应用/监听解绑)| ✅ 46/46(map-engine-baidu.test.mjs,含 3 新增)|
| 超时抛错(mock:就绪信号永不触发 → 1.5s 超时抛「BMapGL 地图就绪超时」+ Map 销毁 + 监听解绑)| ✅ |
| setMapReadyCallback 优先(mock:回调触发即就绪;回调注册但永不触发 → 超时)| ✅ |
| 全量 npm test | ✅ 1107 pass / 2 skip / 0 fail |
| typecheck / git diff --check | ✅ |
| make docs-check | ⛔ 基线红(既有:`20260821-boss-agent-thinkfix/merge-report.md:20` 复述 grep 正则自匹配;本批零新增违例)|
| 真实验证(AK 禁用场景 Playwright 冒烟:百度选中 → 1.5s 超时 → 自动回滚旧引擎)| ⛔ 未做:headless worker 无浏览器、worktree 无 .env.local;由 boss 合并后冒烟回填(deferred)|

**遗留(边界外)**:BMapGL 真实 SDK 中 `setMapReadyCallback` 是否存在于
getscript v=1.0(官方标注 BMapGL 2.0 API)未能离线核实——实现按「存在即优先、
不存在走 tilesloaded」双通道防御,真机行为由 boss Playwright 冒烟坐实。

---

## ws-8:挂载失败回退(2026-08-22,feature/engine-mount-fallback)

### 背景(boss 真实验证结论)

交互式切换失败回滚已全部验证通过;**唯一剩余缺口在页面挂载时**:
sessionStorage 偏好 = 百度(故障引擎)→ 刷新页面 → 挂载切换失败 →
旧实现只 `console.warn`(use-map-engine.ts L316-318)、engine 状态停留在
失败引擎、无视图、地图空白,UI 显示「百度 · 手动选择」但无图。挂载时
无「from」旧引擎可回滚(from=null),需要独立的**回退策略**。

### 修复(use-map-engine.ts 接线 + lib/mount.ts 纯函数)

- **回退顺序依据**:尝试顺序 = 偏好引擎(resolveEngine 结果)优先,其后按
  `ENGINE_PRIORITY` 序的其余已配置引擎(调用方传 `getConfiguredEngines()`,
  天然优先级序)。preferred 已在 configured 中时去重——**不回试同一故障引擎**。
- 每个候选完整重试 `load + createView`(脚本加载失败与初始化失败同口径回退);
  首个成功即返回其 view;全部失败 → 抛错,调用方保持空视图 + warn(回退
  CSS fallback 地图)。
- **回退成功状态落地**:`setEngine(created.engine)` +
  `setActiveSearchProvider(created.engine.search)`——engine/search 随实际
  挂载引擎更新(首引擎成功时同引用,no-op)。
- **取消/竞态防护**(与主路径同口径):每次 await 恢复后查 `cancelled`(卸载
  竞态 → 不创建/销毁已建视图、不继续回退);createView 后查
  `isViewTaken`(viewRef.current 已接管 → 销毁,同容器双实例防护)。hook
  `.then` 内保留 `if (cancelled)` / `if (viewRef.current)` 双保险(hooks-contracts
  既有契约锚点)。
- **偏好写入取舍(决策:回退不写偏好)**:
  - 沿用 L213 语义——交互式切换失败回滚不写偏好;挂载回退同样不覆盖
    sessionStorage。
  - 理由:偏好是用户显式选择,故障可能是瞬时的(AK 临时异常/CDN 抖动);
    回退成功即静默改写偏好会让用户选择**永久丢失**(下次刷新不再尝试
    其选中的引擎)。代价:偏好指向故障引擎时每次刷新都多一次失败尝试
    (有 1.5s 就绪超时上限兜底)。若产品希望「回退成功即改写偏好以利
    下次加载」,只需在 hook `.then` 内加一行 writeEnginePreference,语义
    与 switchEngine 成功路径一致——留给 boss 裁决。
- **实现位置说明**:纯函数 `mountEngineView` 在 `lib/mount.ts`(无 @ 别名、
  无 React 依赖,node 测试可直接 import,同 switch.ts 先例);hook re-export 并接线。**边界说明**:任务书「只允许改」未列新文件,
  但既有契约测试(hooks-contracts)要求挂载路径的 cancelled 销毁逻辑仍在
  hook 内(hook 双保险保留),行为逻辑提取为 lib 是代码库既有可测性模式,
  已在汇报标注,供 boss 复核。

### 验收(离线 mock)

| 项 | 结果 |
|---|---|
| 首引擎 createView 失败 → 回退第二引擎,view 挂载 + engine 归属正确 | ✅ 13/13(map-engine-mount.test.mjs)|
| 首引擎 load 失败同样回退(load+createView 全链路重试)| ✅ |
| 偏好引擎健康 → 零回退(回退不预跑)| ✅ |
| 去重:preferred 已在 configured → 不回试同一引擎 | ✅ |
| preferred=null → 从优先级序第一个开始 | ✅ |
| 全部候选失败 → 抛错(保持空视图 + warn),每候选仅一次 | ✅ |
| 取消:load 恢复后 / createView resolve 后 → 零泄漏(已建视图销毁) | ✅ |
| isViewTaken → 销毁已建视图(切换抢先落地双实例防护) | ✅ |
| hook 接线契约:mountEngineView(resolved, getConfiguredEngines, ...)、setEngine(created.engine)、失败保持 warn + 空视图、挂载路径不写偏好 | ✅ |
| 全量 npm test | ✅ 1126 pass / 2 skip / 0 fail |
| typecheck / git diff --check | ✅ |
| make docs-check | ✅ 通过 |
| 真实验证(boss Playwright 冒烟:偏好=故障引擎刷新 → 自动回退高德渲染) | ⛔ 未做:headless worker 无浏览器、worktree 无 .env.local;由 boss 合并后冒烟回填(deferred)|

**遗留(边界外)**:回退成功是否写偏好(见上「偏好写入取舍」)留 boss 裁决;
真实浏览器挂载回退路径由 boss 冒烟坐实。

## ws-a TMap POI 缩放/聚合 + 公司 icon(2026-08-22,feature/tmap-poi:bug 1+6)

### 诊断(boss 调查 + ws-a 核实)

- **bug 1「poi 缩放与聚合没做好」两层**:
  1. 聚合徽章是 HTML content(`map-markers.ts` `.dm-cluster` div)→ TMap MultiMarker
     不支持 HTML → 降级默认点(console: 徽章降级为默认点);
  2. **更深的缩放 bug**:`createCityClusterMarker` 返回 `wrapper.raw`,TMap MultiMarker
     批量化(ws-6)下 raw = **共享实例**(与个体 pin 同图层);map-shell 徽章清理
     按 ws-5 分派走 `raw.setMap(null)` → **整层摘除**(徽章+pin 同死)→ zoom 越
     过 8 后 pin 重新挂载到已摘除图层,全部不可见(聚合↔个体切换 pin 消失)。
- **bug 6「公司 icon」**:公司 POI 的徽章(logo img HTML)→ 同样降级默认点;契约
  `icon: {src, size}`(ws-1)在 TMap MultiMarker 路径的 styleId 归组已存在,但
  调用方(map-markers)只传 content 不传 icon → 真图标路径空转。

### 修复

- **tencent-engine.ts(MultiMarker 段)**:
  - **SDK 类名核实**:GL API **无 `IconStyle` 类**,MultiMarker 图片样式类就是
    `MarkerStyle`,内嵌 `{ src, width, height, anchor }`(src 可 dataURL/远程 URL);
    现有归组实现正确,零改动;
  - content 降级告警改为**仅无 icon 时**(icon 存在 → MarkerStyle(src) 真图标
    渲染,content 只是 AMap 等引擎的 HTML 形态,不写入 geometry);setContent
    同理(icon marker 变更不告警,纯 HTML 形态仍一次性告警)。
- **map-markers.ts**:
  - `cityClusterBadgeIcon`:徽章 SVG 数据图(白底圆 + #007AFF 描边 + 「城市名 N」
    两行,与 HTML 徽章同视觉;SVG 无 ellipsis → >4 字城市名确定性截断)经契约
    icon → TMap 真图标;content+icon 双形态同传(AMap/BMapGL 走 content,行为不变);
  - **徽章清理句柄**(bug 1 根因):`createCityClusterMarker` 返回 setMap/remove
    收敛为契约 `wrapper.remove()` 的句柄(按 marker 摘单 geometry,共享实例保持
    挂图)——AMap/TMap 单点 raw 的 setMap 本就按 marker 摘除,收敛后行为不变;
    BMapGL(raw 无 setMap)原样返回;
  - **公司 icon(bug 6)**:`addMarker` 对 recruitment POI 在 **tencent 引擎**
    (`view.engine.id === 'tencent'` 门控,AMap/BMapGL 零影响)另传契约 icon——
    logoUrl 直接作图标,缺 logo 回退 emoji 徽章数据图(与 AMap 徽章同视觉);
    状态样式(选中/高亮放大+环)TMap 上以实例 zIndex 层序近似(content 重渲染
    在 MultiMarker 不可用,记 deferred)。
- **LOD 可见性**:zoom tier 的 setVisible 在 TMap = add/remove 摘挂单 geometry
  (ws-6 已有);本轮核实缩放边界(zoom≤8 聚合 / >8 个体)切换:徽章按 marker 摘除
  + pin 重新挂载到始终挂图的共享实例,不销毁不重建。

### 验收(离线)

| 项 | 结果 |
|---|---|
| icon+content 并存不降级告警;content-only 仍降级(契约行为不变)| ✅ |
| 徽章 dataURL → MarkerStyle src/size/anchor(同签名共享,样式字典不膨胀)| ✅ |
| 新签名在实例已存在时经 setStyles 全量替换上实例(调用断言)| ✅ |
| 徽章清理句柄:setMap(null)/remove → 按 marker 摘单 geometry,共享实例全程挂图,跨 zoom 分桶 pin 不误伤不泄漏| ✅ |
| map-engine-tencent.test.mjs | ✅ 53/53(49 + 4)|
| 相关回归(map-markers/marker-visibility/marker-leak/lifecycle/amap/baidu/switch/mount/selection/coord/loader/city-cluster/lod)| ✅ 182/182 |
| typecheck / git diff --check | ✅ |
| 真实验证(boss Playwright:全国视野徽章形态 + zoom 穿越 8 个体 pin 可见 + 公司 icon 显示)| ⛔ 未做:headless worker 无浏览器、worktree 无 .env.local;由 boss 合并后冒烟回填(deferred)|

**遗留(边界外)**:TMap 状态样式(选中/高亮)仅 zIndex 层序近似,content 重渲染
不可用;远程 logoUrl 经 GL 纹理加载的 CORS 表现待真机核实(失败时图标缺失,
AMap 的 onerror 回退链在 icon 路径不可用);徽章 dataURL 图标阴影(SVG filter)
未做,视觉与 HTML 版差阴影一层。

## ws-b 回填:样式(卫星/深色)+ 水印 + 比例尺 + 右下角控制(2026-08-22,feature/tmap-style-controls)

> SDK v1.8.0.2 **实包源码核实**(map.qq.com/api/gljs?v=1.exp,非文档猜测;此前
> 「styleType:'dark' 存在」「TMap.control.ScaleControl」两条记录均与实际 SDK 不符,
> 以本节为准)。

### 样式:暗色(深色)的正确配置

- **baseMap 无 styleType 字段**(上文样式矩阵「styleType:'dark' 存在」有误);
  `baseMap.type` 合法值仅 `vector/satellite/traffic/handdraw/oversea`
  (DEFAULT_BASEMAP 常量);
- **暗色 = Map 构造选项 `mapStyleId`**,取值见 STYLE_ID 常量
  `{DEFAULT:0, DARK:1, LIGHT:2, GAME:3}`;`'DARK'` → 矢量暗色底图层
  `Tencent.Normal.Dark`(LITEMODE_LAYER_TYPE 常量,`_addLayerByBaseMapInfo`
  `"DARK" === this._mapStyleId` 分派);运行期切换 `map.setMapStyleId(id)`
  (清底图层 + 按新 styleId 重建);
- 引擎映射(契约 MapStyleId 三值语义不变):`whitesmoke`(UI「深色」按钮与
  系统深色偏好的 value,layers-panel 桌面 + 移动样式行均以 whitesmoke 承载
  「深色」)→ 暗色矢量底图(mapStyleId 'DARK');`satellite` → `raster`;
  `normal` → `vector`;createView 构造期按初始样式透传 mapStyleId
  (初始 whitesmoke 即暗色,非空转);
- 卫星核实:`raster` 实现正确(SDK satellite 底图层,审图号 GS(2025)5644号);
  用户「卫星、深色没实现」中**深色**才是真缺口(旧实现 whitesmoke 回退
  normal),本轮一并修复;老 SDK 无 `setMapStyleId` → 降级 normal + warn
  (不假装实现)。

### 水印隐藏与 ToS 权衡

- 用户明确要求去掉腾讯水印。水印 DOM 经 SDK 源码核实:logo 控件 =
  `img[src*="logo_def.png"]`(URL mapapi.qq.com/web/jsapi/logo/logo_def.png)
  + `div.logo-text`(innerText = `©2026 Tencent - GS(2026)1190号`,审图号来自
  loader `mapApprovalNumber.vector`);
- **ToS 权衡(2026-08-22 决策)**:地图 SDK 通常要求保留版权署名(高德同样有
  amap-logo/amap-copyright,本项目此前即按惯例隐藏)。用户真机反馈明确要求
  去掉腾讯水印 → **用户决策优先**:engine `hideControlDom` 对
  copyright/logo/attribution 类名 `display:none`(顺带解除点击拦截),
  map-shell.module.css 追加 `img[src*="logo_def.png"]` / `.logo-text` 隐藏
  (与 .amap-copyright 同款双保险)。如需恢复署名:删除 engine 隐藏段 +
  CSS 追加块即可,行为不变;
- 防御面:隐藏选择器只命中 copyright/logo/attribution 类名,自有样式
  (.dm-cluster 等)不受影响(测试钉住)。

### 比例尺(ScaleControl 真相与自绘降级)

- **根因**:v1.exp(v1.8.0.2)公共命名空间装配表(Yd)只含 Map/LatLng/
  MultiMarker/MarkerStyle/constants 等,**无 control/Control/ScaleControl**;
  旧实现 `this.tmap.control ?? this.tmap.Control` 双路径恒失败 → 旧 warn
  「TMap ScaleControl 不可用,比例尺降级」,比例尺缺失。SDK 内部比例尺类存在
  但不公开(DOM 类名 `tmap-scale-control/line/text`;自动更新经
  zoom_changed/scale_changed 事件,onAdd 时挂载);position 内部为数值枚举
  CONTROL_POSITION(BOTTOM_RIGHT=8),文档字符串 'bottomRight' 是组件文档形态;
- **修复**:`addControl('scale')` 保留双路径构造(未来 SDK 兼容,位置
  'bottomRight');不可用时**自绘比例尺降级** —— SDK 同款类名 + 同款公式
  (Oo/Mo 模块:m/px = 156543.04/scale·cos(lat·π/180)/2^zoom;Eo 档位
  [2e6,2e6,2e6,2e6,1e6,…,5,2,1] 按 zoom 索引;条宽 = round(g/mpx)−10;
  文案「N 米 / N 公里」,vo 常量 米/公里),监听 zoom_changed/scale_changed/
  zoomend/idle 自动更新;位置/偏移与 AMap 引擎同语义('LT'/'LB'/'RT'/'RB' +
  [x,y] 像素,map-shell duck-type 透传,移动端左上角/桌面左下角);
  返回 `Promise<{hide,show}>` 与 AMap 引擎同 duck-type(移动端抽屉全开可隐藏);
  destroy / resize 重建时摘除旧 DOM,无双比例尺(测试钉住);
- 降级说明一次性 console.info(可观测不刷屏);不再出现「不可用」warn。

### 右下角 zoom 控制契约化(bug 7)

- 根因:`handleZoomIn/handleZoomOut` 经逃生舱 `raw.zoomIn?.()` 直连 —— AMap
  有 zoomIn/zoomOut,TMap raw 无此方法 → 点击无效;
- 修复:契约化 `view.setZoom(view.getState().zoom ± 1)`(无视图 guard 保留,
  按钮视觉/交互不变);component-contracts 契约测试防回归(全库零
  raw.zoomIn/zoomOut 直连)。

### 测试

- 新 `server/tests/map-engine-tencent-style.test.mjs`(7 用例):卫星/深色
  setStyle 断言、createView 初始暗色透传、无 setMapStyleId 降级 warn、命名
  空间双路径、自绘比例尺(类名/公式/事件自动更新/hide-show/destroy 清理/
  resize 重建去重)、水印隐藏 DOM 类名断言(自有样式不受影响);
- `component-contracts.test.mjs` 追加 zoom 契约化防回归;既有
  map-engine-tencent.test.mjs 的 setStyle / addControl 降级 / 版权隐藏三个
  用例按新语义更新(行为变更的必然结果)。
