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

## ws-d 回填:卫星底图修正 —— 'raster' 非法,正确形态 `{type:'satellite'}`(2026-08-22,feature/tmap-satellite)

> **本节修正 ws-b 节「卫星核实:raster 实现正确」的记录错误**。ws-b 真机合并后
> 冒烟(boss Playwright 2026-08-22)坐实:切「卫星」后 TMap 地图全白(中心亮度
> 231/标准差 21,瓦片未渲染,console 无瓦片请求错误 = 请求根本没发出)。
> 根因与 SDK 实包源码完全吻合(见下),以本节为准。

### SDK v1.8.0.2 实包源码核实(ws-d,2026-08-22,map.qq.com/api/gljs?v=1.exp 2.2MB 全包)

- **MAP_TYPE 常量**(constants 模块 `o`):`{vector:"vector", satellite:"satellite",
  traffic:"traffic", handdraw:"handdraw", oversea:"oversea"}` —— **无 `raster`**;
  全包 2.2MB **零处** `"raster"` 字符串 → `baseMap:{type:'raster'}` 是非法值;
- **卫星判定**:`hasSatellite()` 用 `oc(t)=t.type===MAP_TYPE.satellite`;底图层
  分派 `"Tencent.Satellite.Map"===i ? {type:"satellite",feature:"base"}`
  (LITEMODE_LAYER_TYPE.Satellite = "Tencent.Satellite.Map");
- **features 缺省回退**:`Vl(type, features)` 对缺省 features 查
  `DEFAULT_BASEMAP[type].features` —— `DEFAULT_BASEMAP.satellite` =
  `{type:o.satellite, features:[satellite_base, road]}`(影像 + 道路注记,
  审图号 GS(2025)5644号);`DEFAULT_BASEMAP['raster']` = undefined →
  features 空 → resetBaseLayer 不建任何底图层 → **瓦片请求不发、地图全白**
  (与真机症状逐项吻合:无请求、无报错、白屏);
- **正确形态**:`{ type: 'satellite' }`(features 缺省即影像+道路注记);
  构造期 `baseMap` 选项与运行期 `setBaseMap` 同路径
  (layerResource.setBaseMap → _initBaseLayer);`{type:'satellite'}` 与暗色
  mapStyleId 不冲突(引擎对卫星不传/复位 'DEFAULT',LITEMODE 暗色层不激活)。

### 修复(仅 setStyle 段)

- `styleToBaseMap`:satellite 映射 `'raster'` → `'satellite'`(构造期 + 运行期
  setStyle 共用,一处修复两路生效);其余(whitesmoke → vector+DARK、
  normal → vector、setMapStyleId 复位顺序)不变;
- 契约 MapStyleId 三值语义不变;其他引擎零改动。

### 测试

- `map-engine-tencent-style.test.mjs`:卫星断言 `raster` → `satellite`;新增
  「卫星 setBaseMap 调用断言」回归 —— mock 忠实复刻 SDK 图层解析
  (MAP_TYPE/DEFAULT_BASEMAP 查表:satellite → [base,road] 两层、raster →
  零层),钉死非法值白图根因 + 卫星→深色→标准往返;
- `map-engine-tencent.test.mjs` setStyle 用例同步更新(钉旧 'raster' 的断言
  是修复的必然结果,不改则门禁红);
- 相关回归:map-engine-tencent-style + map-engine-tencent 61/61 通过。

## ws-a 回填:anchor 核实(SDK 常量默认)+ LOD 摘挂状态 + click 绑定簿记(2026-08-22,fix/tmap-poi-interaction)

> 来源:批次 `20260822-boss-tmap-interaction` ws-a(bug 1:腾讯 POI 失效 + 缩放偏移)。
> 本轮对 SDK v1.8.0.2 实包(map.qq.com/api/gljs?v=1.exp,2.2MB)做 marker/anchor/click
> 段源码核实,结论与修复如下。**既有 anchor 归组公式(w/2-ox, h-oy)核实正确,零
> 改动**;本轮修的是三处真实缺陷(见下)。

### SDK v1.8.0.2 源码核实(本段结论)

- **MarkerStyle 默认 anchor 是常量 (17,50),不随 width/height 归一化**:
  构造 `{iconUrl: src||默认pin, iconSize:[width||34, height||50],
  iconAnchor:[t.anchor&&t.anchor.x||17, t.anchor&&t.anchor.y||50]}` —— 自定义尺寸
  图标(60×60 徽章等)不显式传 anchor 即锚点错位(34×50 默认 pin 的底部中心 ≠
  60×60 的底部中心)→ **缩放级别变化时表现为视觉漂移 + 点击命中区与视觉不一致**
  (boss 调查线索坐实;engine 侧 resolveMultiStyle 恒显式传 anchor,核实正确);
- **锚点渲染公式双路径同语义**:DOM 2d-adapter 路径 `marginLeft/Top = -anchor`
  (`_setIconStyles`),GL 实例路径 `instanceInfos.xy = (width/2-anchor.x,
  height/2-anchor.y)`(marker fill `Ct`)→ 均为 imageTopLeft = 屏幕位 - anchor;
- **像素偏移不随 zoom 缩放**(无漂移):着色器 `relativeZoomScale =
  mix(1.0, calZoomScale(uZoom, ...), instanceRelativeScale.x)`,而
  `enableRelativeScale` 默认关闭(instanceRelativeScale.x = 0)→ scale = 1;
- **remove(ids) 全量清理**:`_idSet`/`_idGeoIndexSet` 删除 + `_removeGeoFromMap`
  摘除该 geometry 的 DOM 拾取元素(Leaflet 式 marker,`_geometryId` 标记 →
  click 链:DOM 拾取元素 → `_fireGeometryOverlayEvent` → `_idSet` 查 id →
  `e.geometry`);摘挂后重 add 同 id 不冲突(updateGeometries/add 均按 id 键控);
- **updateGeometries 对不在 _idSet 的 id 会重新 add**(`_idSet.has(t.id)?替换:push`)
  —— 这是本轮 LOD 状态缺陷的 SDK 侧根因。

### 修复(tencent-engine.ts marker 段,三段独立)

1. **anchor 纯函数化**:`resolveTMapMarkerAnchor(iconW, iconH, offset)` 导出纯函数
   (无 offset = (w/2, h) 底部中心,与高德 content 锚点语义对齐;契约 offset 经
   Δanchor = -(x,y) 合并,AMap 同位移语义),resolveMultiStyle 改调该函数;
   文件头/TENCENT_DEFAULT_MARKER_ANCHOR 注释回填 SDK 常量默认锚点核实结论。
2. **LOD 摘挂状态一致性**:`setPosition` 仅挂载态(multiAttached)调 updateGeometries
   ——隐藏(LOD 摘除)期只原地改共享 geometry 对象,重新挂载时自然带新位置;
   旧实现隐藏期 setPosition 会把摘除 geometry **重挂回图层(隐藏变可见+可点)**,
   破坏 LOD 可见性状态;`setVisible` 在 remove 后(geometry 已注销)置空 no-op,
   防僵尸重挂。
3. **click 绑定簿记数组化**:`multiClickHandlers`(Map<cb, entry>)→
   `multiClickBindings`(数组)——同一 cb 注册到多个 marker 时旧实现后注册覆盖
   先注册,off/remove 解绑错位;数组按 (cb, id) 精确解绑 + 同 (cb, id) 重复
   注册去重(防 on 两次双触发)。

### 测试(map-engine-tencent.test.mjs,+5,53→58)

- `resolveTMapMarkerAnchor` 纯函数断言:60×60→(30,60) 底部中心、offset 位移合并
  (40/54 徽章 → (40,60)/(54,81),与既有归组断言同源)、34×50→(17,50) 默认常量
  对齐、60×60 不得落回常量(原 bug 回归);
- **缩放一致性(纯函数级)**:任意 zoom 下 imageTopLeft = 屏幕位 - anchor → 锚点
  恒钉地理点(2 级缩放前后不漂移,锚点为 zoom 无关常量);
- LOD 摘挂后 click 分发不失效:隐藏 → 隐藏期 setPosition 不重挂 → 显示后同 id
  命中恢复(handler 跨摘挂存活,同 id 同 geometry 引用无冲突);
- 同一 cb 注册到两个 marker → off/remove 按 id 精确解绑(旧 Map<cb> 覆盖 bug);
- remove 后 setVisible no-op(防僵尸重挂)。

### 验收(离线)

| 项 | 结果 |
|---|---|
| map-engine-tencent.test.mjs | ✅ 58/58(53 + 5)|
| 全量 npm test | ✅ 1259 pass / 2 skip / 0 fail |
| typecheck / git diff --check | ✅ |
| make docs-check | ✅ 通过 |
| 真实验证(Playwright:点击 marker 命中 + 缩放前后像素一致性)| ⛔ 未做:headless worker 无浏览器、worktree 无 .env.local;由 boss 合并后冒烟回填(deferred)|

**遗留(边界外)**:TMap 状态样式(选中/高亮)仅 zIndex 层序近似(前批遗留);
远程 logoUrl 经 GL 纹理的 CORS 表现待真机核实(前批遗留);物理点击隐藏 marker
由 SDK 侧杜绝(geometry 不在图层 + DOM 拾取元素已摘除),mock 无拾取层不可测。

## ws-b 回填:滚轮平滑(SDK 核实)+ 切回高德 POI 消失(2026-08-22,fix/tmap-wheel-switch)

> 背景:用户真机反馈 bug 2「鼠标中间滚动视角不丝滑」+ bug 4「从腾讯换回高德后
> 原本有的 poi 都消失了」。SDK 证据同样来自 v1.8.0.2 实包(/tmp/tmap-gljs.js)。

### bug 2:滚轮平滑 —— smoothWheelZoom 不存在,平滑是 SDK 内建

- **`smoothWheelZoom` 构造选项不存在**(SDK v1.8.0.2 全包 2.2MB 0 处命中);
  Leaflet 2D 适配层的 `scrollWheelZoom:!0 / wheelDebounceTime / wheelPxPerZoomLevel`
  (`zy.mergeOptions`)是另一地图路径(tmap2d-adapter),与 GL 无关;
- **滚轮平滑 = SDK 内建行为**:Map 选项 `scrollable`(MAP_3D/MAP_2D 默认均
  `true`,运行期 `setScrollable(bool)` 切换)启用滚轮处理器(构造时仅注入
  `mapZoomType`);输入分类:鼠标滚轮(`_type="wheel"`,deltaY 多档/快速滚动)
  → `zoomTo({duration:200, smoothEasing:!0, delayEndEvents:100})` 平滑动画;
  触控板/像素增量(`_type="trackpad"`)→ `duration:0` 即时应答(SDK 设计,
  与 mapbox 同源);手势间隔 >400ms 起步有 40ms 合并窗口;
- **修复**:Map 构造显式 `scrollable:true`(自文档化 + 防御 SDK 默认值漂移;
  测试断言构造选项含此键且**不含**不存在的 smoothWheelZoom);
- **遗留判断(留给 boss/真机)**:「不丝滑」剩余可能来源 —— ①触控板/像素增量
  输入被分类 trackpad → duration 0 即时应答(设计使然,与高德「有动画」体验
  有差);②bug 1 的 marker anchor 偏移在缩放中表现为 pin 漂移(ws-a 修复面);
  两者均非构造选项可解。

### bug 4:切回高德 POI 消失 —— 核查结论 + 修复 + 遗留

核查回放链(switch.ts replayController + usePOIMap applySync + map-shell
usePOIMap 接线):

- **replay 双向对称性:成立**。switch.ts 的 replay 链引擎无关、双向同代码路径
  (POI 集 → 可见集 → 选中 → 高亮,与 applySync 同口径);MapShell 主链路不传
  replay,usePOIMap 随 view 变化**显式重建**控制器(create effect deps
  [view, accentColor])——切换后新 view 上全量重放 pois/visible/selected/
  highlighted,不依赖隐式 setState 链;
- **可见性语义映射:不丢失**。AMap setVisible = show/hide(实例保留)、TMap
  setVisible = MultiMarker add/remove 摘挂(隐藏即不在图层)——两者均经
  MapMarker 契约 `setVisible` 收敛,回放层零感知;测试用摘挂语义 mock 断言
  双向回放后可见/隐藏/选中/高亮状态完全一致(work LOD 风格部分可见集);
- **work 视口加载器(use-work-viewport):原缺口,已修**。moveend/zoomend 监听
  原只随 mapReady 绑定一次 → 引擎切换后新 view 永远拿不到视口监听(旧 view
  已销毁、mapReady 恒 true 不重绑),domain 视口刷新与挂载对齐在切换后静默
  失效。修复:经引擎总线(subscribeEngineBus)订阅活跃 view,监听 effect 与
  挂载对齐判定按 view 实例重绑/重跑(无总线时退化为原一次性绑定);
- **⚠ 遗留(需 boss 裁决,map-shell.tsx 不在 ws-b 边界)**:work 模式
  zoom ≤ 8 的**城市聚合徽章**由 map-shell 的 cluster effect 创建,依赖
  [clusterState, mapReady, modeConfig.color] —— 三者引擎切换时均不变 →
  徽章随旧 view 销毁后**不重建**;同时聚合分支的 visiblePOIIds 只显示
  「无 city 的个体 pin」→ 城市公司全部不可见 =「切回高德后 POI 都消失了」
  (work 模式,全国视野)。domain 模式无聚合(clusterState=null → LOD 分支全
  显示),与 boss「domain 复现未果(1574 蓝像素正常)」吻合。修复建议:
  cluster effect 依赖加入 engineView(view 实例),切换后徽章在新 view 重建
  (一行 deps 改动,map-shell.tsx)。

### 测试

- `map-engine-switch.test.mjs` 追加 4 项:①TMap 构造 scrollable:true 全量断言
  (含不含 smoothWheelZoom);②A→T / T→A 双向回放对称性(相同回放 → 最终
  marker 状态一致);③无可见集回放双向不误藏;④use-work-viewport 按引擎视图
  重绑的源码契约断言(总线订阅 + effect 依赖);
- 相关回归:switch 18/18、hooks-contracts + tencent + lifecycle + mount +
  map-markers + marker-visibility 104/104。

## ws-c 回填:百度加载失败诊断 + 滚轮缩放 + 标记锚点(2026-08-22,fix/baidu-diagnostics)

> bug 3「百度为什么还是加载不了」:boss 环境 Playwright 实测百度正常(bmapPresent=true、
> canvas 渲染、无错误)——排除代码回归,指向用户环境。2026-08-22 boss 补充证据:
> 用户 console 抓到确切根因 `GET ...getscript... net::ERR_BLOCKED_BY_CLIENT`
> —— 请求被**浏览器客户端拦截**(广告拦截/隐私扩展),非服务器拒绝、非 key 问题。
> 本 ws 为引擎失败路径加分类诊断 + 可操作指引(console 结构化输出),核查/修复
> 脚本加载幂等性,并追加 bug 6(滚轮缩放)+ bug 7(标记锚点/样式)修复。

### 失败分类(baidu-engine.ts `failBaidu`,错误携带 code/stage/guidance)

| code | 阶段 | 判定依据 | 可操作指引(文案要点) |
|---|---|---|---|
| `not-configured` | load | NEXT_PUBLIC_BAIDU_AK 缺失 | 配置 .env.local + 重启 dev server |
| `script-load-failed` | load | script.onerror 且 Resource Timing **有**该 URL entry(网络/DNS/HTTP 4xx,含 referer 被拒) | 硬刷新(Cmd+Shift+R)清旧 bundle;确认访问地址为 localhost:3000;lbsyun referer 白名单;指引同时覆盖 ERR_BLOCKED_BY_CLIENT 分支 |
| `script-blocked-by-client` | load | script.onerror 且 Resource Timing **无**该 URL entry(请求未发出 = 被扩展/拦截器拦,console 报 ERR_BLOCKED_BY_CLIENT) | 将 api.map.baidu.com 加入拦截器白名单或禁用扩展后刷新;无痕窗口快速验证 |
| `namespace-not-ready` | load | 脚本已执行(HTTP 200)但 BMapGL.Map 2s 内未就绪(AK 无效/服务禁用/半载占位 BMapGL={} 永不补全) | 硬刷新;lbsyun 确认 AK 有效、JS 服务启用、referer 白名单 |
| `map-ready-timeout` | createView | Map 创建成功但 1.5s 无渲染信号(AK 被禁用/瓦片被拒) | 确认 AK 服务状态与 referer 白名单;非 localhost:3000 会被拒;看 console 厂商错误 |
| `unclassified` | 任一 | 兜底 | 看 console 厂商错误后重试,回报错误原文 |

- **ERR_BLOCKED_BY_CLIENT 探测的诚实局限**:浏览器不向 JS 暴露网络错误码 → 用
  Resource Timing 启发式(被拦请求从未发出 → 无 entry;网络失败有 entry 时长≈0);
  performance 被清空/不可用 → 保守归 `script-load-failed`(指引文本含拦截分支);
  同 URL 历史成功 entry 存在时可能误判为网络失败(保守方向);
- **无 toast/alert 共享基建**(已核查:account-panel toast 为局部 demo note,map-shell
  注明「后续可接 toast 提示、不新增 UI」)→ 按任务书「无则仅在 console 输出结构化
  错误」:`console.error('[map-engine] baidu 加载失败分类', {code, stage, detail,
  guidance, cause})` + use-map-engine 两个 catch(挂载/切换)补输出分类;不新增 UI 组件;
- message 保留原始细节文本(「命名空间未就绪」「BMapGL 地图就绪超时」等)——switch
  回滚契约与既有断言按子串匹配,不得改写。

### 加载幂等性核查结论 + 缺陷修复(script-loader + baidu load 路径)

- **URL 缓存幂等**:同 URL 并发/重复调用共享同一 promise,只注入一次;onerror 失败
  移除标签 + 清缓存可重试(script-loader 既有语义,核查通过);
- **命名空间短路**:`window.BMapGL` truthy → load 直接成功(切走再切回零注入,测试钉住);
- **就绪轮询有界**:waitForBaiduNamespace 40×50ms=2s 封顶后静默返回,由调用方抛
  「命名空间未就绪」——**不永久挂起**(既有测试钉住;「script 加载成功但 AK 拒绝」
  场景 = 有界 2s 后分类抛错,不卡轮询);
- **发现并修复的缺陷**:脚本加载成功(HTTP 200)但命名空间未就绪(AK 无效/半载)时
  —— loadScript 的 URL 缓存留下**已 resolve 的 promise** + 残缺/占位命名空间
  (`BMapGL={}` truthy)→ 下次 load 被「URL 缓存 + 命名空间 truthy」双重短路,
  **不再注入脚本**,每次切换白烧 2s 轮询后失败且永不恢复(直到整页刷新)。
  修复:模块级 `baiduScriptLoadBroken` 置位 → 下次 load 先恢复现场(删命名空间 +
  `resetScriptLoader()` 清 URL 缓存)再重注入——重试即重新探测 AK 有效性;
- 恢复路径复用 `resetScriptLoader()`(其注释标注「测试用」,本处为生产恢复场景的
  刻意复用,代码注释已显式说明;会清三家缓存,但仅在百度上次加载失败后触发,且
  各引擎 load 前有命名空间短路,重复注入窗口极小、无害);
- **不修复的边界**:createView 就绪超时后重试(命名空间健康,AK 问题在服务端)
  ——重试会再次 1.5s 超时并给出分类指引,属预期(有界、有指引,不挂起)。

### 用户端排查清单(bug 3 回填,boss 假设 + 证据逐条落地)

用户在「百度加载不了」时依次:

1. **看 console 该 getscript 请求**:若显示 `net::ERR_BLOCKED_BY_CLIENT` → 广告拦截/
   隐私扩展拦了脚本(boss 坐实的用户根因)→ api.map.baidu.com 加白名单或禁用扩展,
   无痕窗口快速验证;
2. **硬刷新**(Cmd+Shift+R):清旧 JS bundle(旧 bundle 无就绪修复);
3. **核对访问地址**:必须是 `http://localhost:3000`——127.0.0.1/局域网 IP/其他端口
   不在百度 referer 白名单内,瓦片/SDK 被拒;
4. **重启 dev server**:`.env.local` 改过 NEXT_PUBLIC_BAIDU_AK 后旧进程未加载新 key;
5. 仍失败 → console 应有 `[map-engine] baidu 加载失败分类 { code, stage, detail,
   guidance }` 结构化输出,按 code 对照上表操作;厂商自身错误(APP Referer校验失败等)
   一并回报。

### bug 6:滚轮缩放显式启用(2026-08-22 SDK v1.0 源码核实)

- Map config 默认 `enableWheelZoom: !H.apiVersionIsGL()` → **GL 恒 false**(经典 BMap
  恒 true);mouseWheel 处理器 `if(!mw.config.enableWheelZoom){return}` 静默忽略 →
  用户「百度无法中间滚动视角」根因;
- 修复:createView 构造后调 `map.enableScrollWheelZoom()`(置 config.enableWheelZoom=true;
  全景分支同名方法不影响 Map);API 缺失静默(旧 SDK 兼容,降级为不可用);
- 测试:FakeMap 记录调用 + 缺失不抛。

### bug 7:标记锚点/样式对齐(2026-08-22 SDK v1.0 源码核实:getscript 本体 +
marker/mapgl 模块,均为实包抓取)

- **Marker 构造 `offset` 选项不参与渲染定位**(仅 getPoint/infoWindow 数学用;
  marker 模块 `_getPixPos` 与 mapgl 纹理 quad 均不含它)→ 适配层不再传入;
- **定位公式**:GL 纹理 quad `imageTopLeft = 屏幕位 - icon.anchor`(lA 顶点
  (-aw, ah-h),mapgl 模块按 icon.anchor 建 quad);DOM content(msTarget)
  `= 屏幕位 + marker.offset - icon.anchor`(`_getPixPos`)→ 双路径一致要求
  **icon.anchor = -契约 offset**(imageTopLeft = 屏幕位 + offset,AMap 同款契约);
- **Icon 的 anchor === offset 构造选项**,默认 (w/2,h/2) = 图标中心(lA 构造源码);
- **GL 无内容纹理**:setContent 渲染进 msTarget DOM(innerHTML,marker 模块);内容
  标记必须配**透明 1×1 图标扛锚点**——否则默认红图钉纹理照渲 + anchor(10,25)
  偏置 → 用户「样式不对 + 偏移」症状;点击经 msTarget 子元素冒泡可达;
- 修复(仅 baidu-engine.ts createMarker):icon 路径 `new Icon(src, Size(w,h),
  {offset: Size(-ox,-oy)})`;content 路径同款透明 1×1 图标 + setContent;锚点缺省
  (0,0)(左上角,AMap 无 offset 语义一致)——图钉 [-16,-40]→anchor(16,40) 底尖、
  徽章 [-20,-20]→anchor(20,20) 中心、聚合 [-s/2,-s/2]→anchor(s/2,s/2) 中心,均与
  AMap/TMap 契约对齐;
- 测试:icon.anchor = -offset(含缺省 (0,0))、content 透明锚点图标、Icon 构造失败
  降级 warn 不抛;既有「Marker 构造 offset 透传」断言按 SDK 事实改为「不再传」。

## ws-d 回填:非 AMap 引擎用户定位蓝点(2026-08-22,fix/geolocation-blue-dot,bug 5)

> 真机反馈 bug 5「腾讯地图之类连用户定位点都消失了」:定位蓝点是 AMap 专属路径
> (amap-api Geolocation 控件蓝点+精度圈),腾讯/百度引擎只做了定位(改相机)没有
> 蓝点渲染(旧注释「无蓝点渲染,deferred」)。

### 实现(仅 map-shell.tsx 定位/蓝点段;引擎文件零改动)

- `syncUserBlueDot(view, lng, lat)`(组件级函数声明,createMap 与 handleLocate
  共用):非 AMap 引擎定位成功后经契约 `view.createMarker({ position, icon:
  USER_BLUE_DOT_ICON, zIndex: 200 })` 创建蓝点;已有则 `marker.setPosition` 跟随
  更新;卸载/切引擎经 createMap cleanup `remove()` + 置空 ref 清理。
- **蓝点 icon 走既有契约 icon 路径**(腾讯 MultiMarker MarkerStyle / 单点
  Marker setIcon / 百度 BMapGL Icon 均支持 src/size)——引擎适配层零改动,与
  ws-a/b 的引擎工作不相交。
- 蓝点 dataURL 内联 SVG(22x22):#007AFF 实心圆点 + 半透明精度晕圈 + 白心,
  对齐 AMap Geolocation 蓝点观感(仓库 map-constants 的 USER_LOCATION_ICONS
  是旧主题色 #4A90E2 且不在本 WS 边界,故内联生成,不引用)。
- **zIndex 200**:高于 POI marker(普通 10/20、高亮 80、选中 100)与聚合徽章
  (50),蓝点恒在最上。
- **AMap 路径零改动**:locateForMap amap 分支仍走 amap-api Geolocation 控件
  (蓝点+精度圈绑定原始实例);syncUserBlueDot 对 amap 直接早退。
- **与 POI 共存**:蓝点是独立 marker(view.createMarker 直建,只记入 blueDotRef),
  不进 POI 控制器 → LOD/聚合(zoom tier 摘挂、聚合摘单)不感知、不误删。

### 锚点说明(已知取舍)

- 蓝点不传 contract offset:各引擎 icon 锚点像素语义由引擎适配层负责
  (TMap anchor/MarkerStyle 归 ws-a 的 bug 1 域;BMapGL Icon 归 ws-b/c),
  契约层不跨引擎猜 offset,避免语义分歧。TMap 默认锚点(底边中点)下圆点
  中心约高于定位点 size/2 px —— 若需精确居中,后续由引擎锚点修复统一处理。

### 测试

- 新 `server/tests/map-shell-blue-dot.test.mjs`(6 项,源码契约风格,
  map-shell 为 TSX 无法 import,沿用 component-contracts 断言模式):
  蓝点图标资产(SVG dataURL 解码断言 #007AFF/晕圈/白心/22x22)、契约
  createMarker 调用形状(icon src=dataURL、zIndex 200 > POI 最高 100)、
  setPosition/remove 生命周期、挂载 settle 与 handleLocate 双接线、
  AMap 路径零变化(locateForMap 分派 + amap 早退无 createMarker)、
  与 POI 控制器隔离(map-markers 零处 blueDot)。

## ws-e 回填:WebGL 纹理 CORS 限制 + 图标预检降级(2026-08-22,fix/icon-cors-preflight,bug 1/7)

> boss 真机实测实锤:用户报「疯狂报错」+ bug 1/7(TMap POI 样式不对)。根因链:
> favicon.im 等公司 logo 候选**不返回 CORS 头**;TMap GL 是 WebGL 渲染,marker
> 图标作为 GPU 纹理加载,纹理必须 CORS-clean → 远程无 CORS 头的图标**恒加载
> 失败**,SDK 疯狂刷「Image加载失败」(单次引擎加载 179-190 errors,dev log 累计
> 10192 次)并降级 SDK 默认 marker →「POI 样式不对」直接成因。

### 机制:三引擎 icon 路径的 CORS 敏感度

| 引擎 | 公司 POI 渲染路径 | CORS 需求 | 结论 |
|---|---|---|---|
| AMap | DOM 渲染,`<img>` content 徽章 | 无需 | 不受影响 |
| TMap | **icon 路径**(MultiMarker MarkerStyle `src` → GPU 纹理) | **必须** | favicon.im 恒失败 |
| BMapGL | 公司 POI 走 content 路径(msTarget DOM 覆盖层) | 无需(当前) | 不受影响 |

- AMap/BMapGL content 的 HTML `<img>` 有内联 onerror 候选链(favicon.im →
  icon.horse);TMap 走 icon 路径,Sdk 自己的 onerror 处理失败,**候选链在
  TMap 上无机会执行** —— 这就是「问题特定于 TMap 的 icon 纹理路径」的原因。
- BMapGL 同为 WebGL(`new Icon(url)` 远程纹理同样需要 CORS),只是当前业务
  无人给它传远程 icon(公司 POI 走 content、蓝点/聚合徽章均为 dataURL),
  属防御性接入(见下)。

### 实现(ws-e,3 文件 + 测试)

**新模块 `server/src/lib/map-engine/icon-preflight.ts`**(纯模块,无 React 依赖):

- `remoteIconStatus(src)`:`'data'`(data: URI 本地恒安全)/ `'ok'`(已预检成功)/
  `'fail'`(已预检失败)/ `'unknown'`(未预检);
- `preflightRemoteIcon(src)`:幂等后台 CORS 预检 `fetch(src, { mode: 'cors' })`
  ——服务端无 ACAO 头时 fetch 直接 reject 即 CORS/网络失败;非 2xx 也记 fail;
  结果缓存于模块级 Map,**成功与失败均记忆化(同会话同 URL 不重复,失败不重试)**;
  pending 期间去重;data: URI 不预检;无全局 fetch 时 no-op(保持 unknown 降级);
- `isRemoteIconUrl(src)`:http(s) 闸(data:/相对路径/blob: 同源恒安全直通,
  避免对相对路径误触发 fetch);
- `resetIconPreflightCache()`:测试钩子(生产不调用)。

**`map-markers.ts` TMap icon 构造段(L539 起,engine 门控不变)**:远程未验证/
已失败 → 降级 `svgToDataUri(recruitmentBadgeSVG(...))`(白底蓝框 emoji 徽章,
纯本地 data URL,SDK 加载必成功 → **零报错、零 SDK 默认 marker**);data:/
已预检 ok → 真 src;未验证时触发后台预检,**预检成功后下次 LOD 重建/重渲染
自然升级**为真 logo(不做已渲染 marker 的原地升级——favicon.im 在 TMap 上
恒失败,升级路径是为未来 CORS 合规图源预留)。

**`baidu-engine.ts` icon 路径(核查性防御,零行为漂移)**:核查确认 BMapGL
`new Icon(src)` 存在接收远程 URL 的 icon 路径(WebGL 纹理同病)→ 同样接
`isRemoteIconUrl` + `remoteIconStatus` 闸:远程未验证/已失败 → 不构造远程
Icon,回退 content 锚点路径(透明 1×1 dataURL 图标,msTarget DOM 渲染,
`<img>` 无需 CORS);data:/相对路径/已 ok → 原样。现有 content 路径零改动,
相对路径 icon(测试既有 `'pin.svg'`)行为不变。

### 验收(真机标准)

TMap 下 favicon.im 加载失败 → console 零「Image加载失败」报错;失败公司
显示我们的 emoji 徽章(不是 SDK 默认样式);已预检成功的 URL 显示真 logo。

### 测试

- 新 `server/tests/icon-preflight.test.mjs`(13 项):data 直通 / unknown /
  2xx→ok / CORS 拒绝→fail / 404→fail / pending 去重 / fail·ok 记忆化 /
  data 不预检 / 无 fetch no-op / reset 钩子 / TMap icon 构造断言(未验证→
  徽章 dataURL + 预检触发;ok→真 src + 升级路径;fail→徽章不重试;data·缺
  logo 零预检;AMap 引擎零变化);
- `map-engine-baidu.test.mjs` 追加 2 项:远程未验证 → content 锚点回退 +
  后台预检;ok → 真 URL Icon / fail → 回退不重试(afterEach 加
  resetIconPreflightCache 防串扰)。

## ws-f 回填:预检噪音消除(fetch → Image + sessionStorage 失败记忆,2026-08-22,fix/icon-preflight-silent)

> ws-e 已除核心刷屏(SDK「Image加载失败」→ 本地徽章);剩余噪音:预检用
> `fetch(src, { mode: 'cors' })`,每个失败 favicon URL 在 console 报 2 行
> (CORS policy + net::ERR_FAILED),首次进 TMap 实测 ~94 URL × 2 ≈ 189 条
> 一次性报错(每次刷新/切引擎重复)。ws-f 两个小优化把噪音压到「首次会话一次」。

### 1. 预检改 `new Image()`(console 报错减半)

`preflightRemoteIcon` 不再 fetch,改为:

- `new Image()` + `img.crossOrigin = 'anonymous'` + `referrerPolicy = 'no-referrer'`;
- 语义与 WebGL 纹理加载**同源**:无 ACAO 头 / 网络失败 → onerror → fail;
  onload 表示图像可解码(2xx + 有效图像数据,纹理可用——比 fetch 的
  `res.ok` 更贴近「能否作纹理」的判定);
- 收益:失败只报 1 行 `Failed to load resource: net::ERR_FAILED`(fetch 报 2 行);
- **防 GC**:Image 对象持有在 `pending: Map<url, HTMLImageElement>` 中,直到
  onload/onerror 回调触发才删除——避免 Image 被回收导致回调永不触发;
- 无全局 `Image`(node / 异常环境)或构造异常 → no-op,保持 unknown 降级,不抛错。

### 2. 失败清单 sessionStorage 持久化(噪音只在首次会话)

- 预检失败的 URL 记入 sessionStorage(key `domain-map:icon-preflight-fail`,
  JSON 字符串数组);
- **防抖**:失败先入模块级缓冲,同一微任务批次合并为**一次** setItem
  (读改写合并既有清单,不逐 URL 一写);
- `remoteIconStatus` 内存未命中 → 回退 sessionStorage 失败清单(命中即
  'fail',并回写内存缓存);`preflightRemoteIcon` 对已知失败 URL 直接记
  fail 不再发起网络;
- 收益:同一会话内刷新(F5)/切引擎不再预检已知失败 URL → 噪音只在
  **首次会话**出现一次(新开标签页 = 新会话,会重新预检,符合预期);
- sessionStorage 读写全部 try/catch:隐私模式禁用 / 内容损坏(JSON 解析
  失败 / 非数组)→ 静默降级为「无记忆」,内存缓存照常,绝不抛错;
- data: URI 不经过预检与持久化。

### 测试与文档

- `server/tests/icon-preflight.test.mjs`:fetch mock → **Image mock** 重写
  (onload/onerror 异步触发,deferred 可控);断言 `crossOrigin='anonymous'` +
  `referrerPolicy='no-referrer'`;新增 sessionStorage 用例:失败持久化 +
  reset 后回退读回 fail、已知失败零新预检、多失败单次 setItem(防抖)、
  跨批次合并不覆盖、隐私模式(get/set throw)不抛、损坏内容按无记忆处理;
- `map-engine-baidu.test.mjs` 两项 ws-e 防御测试同步改 Image mock;
- 注意:Node ≥22 暴露实验性全局 sessionStorage,测试 beforeEach 需
  removeItem(FAIL_KEY) 隔离,否则上一用例的防抖写入会污染下一用例。

## ws-a 回填:BMapGL 底图常量核实 + 深色实现(2026-08-22,fix/baidu-style,bug 1「卫星/深色没实现」)

### 1. 常量核实结论(SDK 源码证据,getscript?type=webgl&v=1.0 本体 1.2MB 抓取 grep)

- 真实定义(逐字):
  `window.BMAP_NORMAL_MAP="B_NORMAL_MAP"; window.BMAPGL_NORMAL_MAP="B_NORMAL_MAP";
  window.BMAP_SATELLITE_MAP="B_SATELLITE_MAP"; window.BMAP_HYBRID_MAP="B_HYBRID_MAP"`
- **`BMAPGL_SATELLITE_MAP` 不存在**(全 SDK 0 命中)→ 旧 STYLE_CONSTANT
  `{ normal: 'BMAPGL_NORMAL_MAP', satellite: 'BMAPGL_SATELLITE_MAP' }` 卫星
  常量解析 undefined → `setMapType` 被静默跳过 → 卫星切换无效果(用户 bug 1
  「百度卫星没实现」根因);normal 靠 `BMAPGL_NORMAL_MAP` 别名侥幸可用。
- 修正:统一用 SDK 主名 `BMAP_NORMAL_MAP` / `BMAP_SATELLITE_MAP`;`setMapType`
  按常量字符串值解析 MapTypeId(ev()→kO 注册表,卫星注册
  `kY("B_SATELLITE_MAP","卫星","显示卫星影像",{compatType:"BMAP_SATELLITE_MAP"})`)。
- 验收:setStyle('satellite') 断言厂商收到 `"B_SATELLITE_MAP"`(测试 mock 只装
  SDK 真实常量名,不再装虚构的 BMAPGL_SATELLITE_MAP)。

### 2. 深色实现方式(SDK 核实)

- API 形态:`map.setMapStyleV2({styleJson: [...]})` —— SDK:
  `setMapStyleV2(e) → setOptions({style: e})`;`getStyleJson` 直接消费
  `styleJson` 数组(每项 `{featureType, elementType, stylers}`,
  `styleJson2styleStringV2` 映射 featureType→t/elementType→e/stylers 各键;
  elementType 词表 SDK 核实:geometry(.fill/.stroke/.sidefill/.topfill)/
  labels(.text/.text.fill/.text.stroke/.icon));`styleId`(服务端拉取)形态存在
  但不采用(网络依赖 + 无自定义可控性)。
- 深色 = `BAIDU_DARK_STYLE_JSON`(常量,15 条规则):基底深蓝黑(background/land),
  水系/绿地低饱和,道路逐级提亮(highway>arterial>local),标注文字亮色 +
  深色描边(暗底可读),行政边界中亮描边;featureType 词表按官方自定义样式
  文档(background/water/land/green/building/highway/arterial/local/railway/
  subway/boundary/label)。
- **离开深色必须显式复位**:自定义样式存于 `config.style`(对象),`setMapType`
  **不清理**(源码核实)→ 切回 normal/卫星先 `setMapStyleV2({styleJson: []})`
  (空数组 = 默认渲染)再 setMapType —— 与腾讯「切回标准/卫星:复位暗色
  setMapStyleId('DEFAULT')」同契约;WeakSet 状态追踪,无深色历史时不触发
  自定义样式管线(零多余网络加载)。
- 样式 id 语义:UI 图层面板「深色」= `whitesmoke`(`MapStyleId` 类型
  `'normal' | 'satellite' | 'whitesmoke'`,map-shell `["whitesmoke","dark"]`)→
  百度引擎 `setStyle('whitesmoke')` 即深色,不再 warn 回退 normal(与 AMap
  whitesmoke URL / 腾讯 DARK 语义一致)。setMapStyleV2 API 缺失(旧 SDK)→
  warn 降级 normal 不抛。

### 3. 测试与文档

- `map-engine-baidu.test.mjs`(+4 项):常量映射断言改真实常量值;whitesmoke →
  setMapStyleV2({styleJson}) 形状断言(每项 featureType/elementType/stylers +
  可读性 label 亮色);深色 → normal/卫星复位 + 状态追踪;setMapStyleV2 缺失
  → warn 降级;createView({style:'whitesmoke'}) 就绪后即应用深色;类型外样式
  回退 normal + warn。
- 全量:server 1377 pass / 2 skip / 0 fail(typecheck 通过,基线 1364)。

## ws-b 回填:百度 POI 单点级核查 + 定位真实化(2026-08-22,fix/baidu-poi-locate,bug 2 单点级 + bug 5)

> 用户 bug 2「百度的 poi 无法正确加载」:boss 实测聚合级别(zoom≤8,dataURL 图标路径)
> 渲染正常(30 蓝簇,无报错),**单点级别(zoom>8,公司徽章 content 路径)未验证**。
> 本 WS 读码 + 既有 SDK 源码核实结论 + 离线测试钉住;bug 5 百度定位真实化(IP → 浏览器 GPS)。

### POI 单点级(z>8)核查结论:content 路径三环节全部正确(无需代码改动)

- **渲染/位置**:公司 POI 走 `createMarker` content 路径 —— `setContent(徽章 HTML)` 进
  msTarget DOM + 透明 1×1 锚点图标(`icon.anchor = -契约 offset`,徽章 [-20,-20] →
  anchor (20,20))→ 徽章中心对齐点位。公式(ws-c bug 7 SDK 源码核实):msTarget
  `= 屏幕位 + marker.offset - icon.anchor`,marker 构造 offset 不参与渲染定位 →
  anchor (20,20) 恰好把 40px 徽章左上角放到 屏幕位 + (-20,-20),中心 = 点位;
- **点击**:marker 模块把 click 绑在 msTarget 上,徽章子元素(<img>/emoji span)事件
  冒泡可达;离线测试 `raw.trigger('click')` 断言 onClick 命中;
- **favicon.im 403 降级链**:BMapGL `setContent` 是 innerHTML(SDK 不覆写/不净化)→
  内联 `onerror` 属性原样保留;候选链逻辑(favicon.im 403 → icon.horse → 隐藏 img
  显示 emoji)逐字模拟执行验证正确(含空候选、多候选按序、候选耗尽三态)。
  **结论:单点级无需引擎代码改动** —— 前一轮 ws-c(bug 7 锚点)已修复根因,本轮以
  测试 + 文档钉住(此前零覆盖的 onerror 链语义)。

### 定位真实化(bug 5):浏览器高精度 GPS 优先,SDK Geolocation 降级为 fallback

- **根因**:`BMapGL.Geolocation.getCurrentPosition()` 默认走 **IP 定位**(城市级精度,
  不是真实位置);AMap 用 `AMap.Geolocation({enableHighAccuracy:true})`(浏览器 GPS),
  腾讯已改 browserPosition —— 百度对齐同一模式;
- **改造**(仅 `getCurrentPosition` 段):浏览器 `navigator.geolocation` 优先,
  `{ enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }`(GPS 高精度 +
  禁止缓存旧位;腾讯此前 `maximumAge: 60000` 缓存旧位为同类问题,ws-d 对齐);
- **坐标链(「蓝点落在真实位置」验收关键)**:浏览器输出 wgs84 → **wgs84→gcj02**
  (引擎契约输出 gcj02;蓝点/相机经 createMarker / setCenter 的 gcj02→bd09 落 bd09
  底图 = wgs84→gcj02→bd09,恰为百度官方 wgs84→bd09 两步式 → 蓝点落在真实位置)。
  ⚠️ 若此处直接输出 bd09,契约层会当 gcj02 再转一次 → 引入 ~700m 二次偏移;
- **SDK Geolocation 保留为 fallback**(浏览器定位失败/被拒/无 API 时;bd09→gcj02
  路径不变);浏览器定位不依赖 BMapGL 命名空间,引擎未加载也可用;
- **测试**(map-engine-baidu.test.mjs +5,64→69):浏览器优先 + 选项断言
  (enableHighAccuracy/maximumAge:0)+ wgs84→gcj02 偏移断言 + SDK 不构造;浏览器
  被拒/空结果/无 navigator → SDK fallback(bd09→gcj02);双通道失败 → null;
  node 的 navigator 是 getter-only 自有属性 → mock 用 defineProperty 覆盖 +
  描述符还原。

### 测试与文档

- `server/tests/map-engine-baidu.test.mjs` 新增第 8 节 5 项:单点级 content 徽章
  契约形状(原样进 msTarget + 锚点 (20,20) + 点击可达 + data-fb/onerror 属性完好)、
  onerror 链逐字模拟(favicon.im → icon.horse → emoji)、空候选/多候选三态、
  定位浏览器优先、定位 SDK fallback 与双失败;
- 遗留:真机浏览器验证(dev server + Playwright)留待 boss 收尾复验;聚合级
  content+icon 双形态同传(BMapGL 上 GL 纹理 + msTarget DOM 同位双渲染,DOM 覆盖
  GL,视觉重合)为已知无害冗余,零改动。
## ws-c 回填:腾讯 POI 锚点契约修正(anchor = -offset)+ TMap icon 候选链(2026-08-22,fix/tencent-poi-icon)

> 来源:批次 `20260822-boss-engine-polish-2` ws-c(bug 3「腾讯的 poi 会坐标偏移」+
> bug 4「腾讯的 poi 不带 icon」)。headless worker 无浏览器,核查为**读码 +
> 纯函数级断言**(SDK 渲染公式沿用 ws-a/ws-c-baidu 的实包源码核实结论)。

### 锚点公式修正(bug 3 根因实锤)

**契约 offset 语义**(AMap content 路径,多引擎对齐的基准):内容元素左上角置于
`屏幕位 + offset`。证据链:

- map-markers 的 content 补偿公式(负 margin 跨状态收回锚点)只在上左角锚定
  下成立;生产 AMap 图钉底尖/徽章中心钉点行为数月用户验证,与上左角语义吻合;
- 百度引擎 ws-c 段 SDK 源码核实:`icon.anchor = -契约 offset`(GL 纹理 quad
  imageTopLeft = 屏幕位 - anchor,DOM msTarget = 屏幕位 + offset - anchor,
  双路径一致要求 anchor = -offset),锚点缺省 (0,0) 上左角;
- TMap SDK(v1.8.0.2,ws-a 核实):imageTopLeft = 屏幕位 - anchor。

联立得 **TMap anchor = -offset**,与图标尺寸无关。**旧公式 (w/2-ox, h-oy) 错误**
(ws-a 曾按「底部中心 + 整图位移」推导,与 AMap 实际语义不符),三形态偏移量:

| 形态 | offset | 旧 anchor(错) | 新 anchor(对) | 几何效果 |
|---|---|---|---|---|
| 图钉 32×40 | [-16,-40] | (32,80) | **(16,40)** | 旧:底尖相对地理点上移左上 16/40px |
| 徽章 40×40 | [-20,-20] | (40,60) | **(20,20)** | 旧:中心上移左上 20/40px |
| 聚合 54×54 | [-27,-27] | (54,81) | **(27,27)** | 旧:中心上移左上 27/54px |

聚合徽章在 zoom≤8 城市视野下 27/54px 偏移肉眼可见 —— 即用户 bug 3 症状
(高德/腾讯同地理点,腾讯 marker 漂向左上)。修正后与 AMap/Baidu 逐像素一致。

**疑点逐项核查结论**:

- **a(聚合徽章 size/offset)**:buildOffset 恒 [-s/2,-s/2] 与 icon [s,s] 匹配;
  anchor = -offset 后恒 (s/2,s/2) 中心钉点,与尺寸无关(旧公式 s 越大偏越多);
- **b(content+icon 并存)**:TMap 只渲染 icon(content 不写 geometry);
  offset [-16,-40] + 32×40 图钉 icon → anchor (16,40) 底尖精确钉点;
- **c(状态尺寸 40/46/52)**:map-markers 的 TMap icon.size 恒 [40,40](状态
  视觉仅存在于 AMap content),且 anchor 与尺寸无关 → 选中/高亮态不生成新
  styleId、锚点零漂移。已知取舍:TMap 下状态视觉(放大/强调环)仍只体现为
  zIndex 层序,icon 尺寸不随状态变(ws-a 遗留,边界外)。

**Domain 图钉补 icon**(同段):TMap 下 Domain POI 此前 content-only → SDK
默认红色 pin(锚点错位 + 视觉与高德不一致);现补 dataURL 图钉 SVG icon
(32×40,与 AMap 同视觉),底尖经 anchor (16,40) 精确钉点,本地数据零 CORS 风险。

### icon 候选链(bug 4)

favicon.im 无 CORS 头 → TMap 纹理恒失败 → ws-e 降级 emoji 徽章(用户看为
「不带 icon」);icon.horse 实测 `access-control-allow-origin: *`(HTTP 200)
→ 可作 TMap 纹理。TMap icon 路径补**候选链**(AMap HTML 徽章已有内联
onerror fallbackUrls;TMap icon 路径此前只有单一 src,预检失败直接降级):

- 纯函数 `resolveTMapIconSrc(logoUrl, careerUrl, fallbackSrc)`(map-markers):
  logoUrl 本地/已 ok → 直通;失败 → 依次试 `faviconCandidatesFromUrl(careerUrl)`
  候选(跳过与 logoUrl 相同者,复用 company-logo.ts 候选生成,零重复实现);
  首个本地/已 ok 者作 icon.src;未预检候选返回 toPreflight 由调用方后台预检
  (失败记忆化,下次重建自然升级);全败/无 logoUrl → fallback emoji 徽章;
- 预检合并触发:logoUrl 与全部 unknown 候选一次预检(升级一次重建到位,
  不逐层等待);无 careerUrl 保持 ws-e 行为(缺 logo 不试候选,零预检)。

### 测试(map-engine-tencent.test.mjs,58→67)

- 纯函数:anchor=-offset 契约三形态落点、状态尺寸 40/46/52 零漂移、缩放无关
  (屏幕位+offset 恒等式,2 级缩放);resolveTMapIconSrc 本地直通/unknown 预检
  清单/候选去重;
- 候选链控制器级(假 tencent view + Image mock):fail→icon.horse 作 src、
  unknown→徽章+双预检+重建升级真 logo、ok 直通不试候选、全败记忆化不重试、
  无 careerUrl 保持 ws-e;
- Domain POI 图钉 icon(32×40 + [-16,-40])零预检;
- 控制器×引擎集成(真 TencentView + MockMultiMarker):徽章/图钉/聚合
  MarkerStyle anchor 钉死 (20,20)/(16,40)/(27,27)。

### 验收(离线)

| 项 | 结果 |
|---|---|
| map-engine-tencent.test.mjs | ✅ 67/67(58 + 9)|
| 全量 npm test | ✅ 1382 pass / 2 skip / 0 fail |
| typecheck / git diff --check | ✅ |
| make docs-check | 待跑 |

真机冒烟(boss 合并后):TMap 下公司 POI 显示 icon.horse 真 logo(favicon.im
公司)且 console 无 CORS 报错;缩放前后 marker 钉同一地理点(与高德对照)。

**遗留(边界外)**:TMap 状态视觉(选中/高亮)仅 zIndex 层序;距离圈手柄
(distanceHandle,map-shell,契约外 duck-type)在 TMap 下仍为 SDK 默认 pin
(内容不渲染,map-shell 不在本 WS 边界)。
## ws-d 回填:腾讯定位高精度对齐(2026-08-22,fix/tencent-locate,bug 5)

> 真机反馈 bug 5「用户定位不是真实位置」的腾讯侧根因:腾讯 `browserPosition()`
> 走浏览器定位(WGS84→gcj02 转换正确),但定位参数缺 `enableHighAccuracy`
> (部分浏览器回退 IP/基站级精度)+ `maximumAge: 60000`(60s 位置缓存——
> 用户移动后 60s 内重复定位返回旧位置)。ws-d 把参数对齐 AMap。

### 三引擎定位通道对照(2026-08-22 现状)

| 引擎 | 定位通道 | 参数/转换 | 备注 |
|---|---|---|---|
| AMap | `AMap.Geolocation` 控件(融合浏览器定位 / IP / SDK 辅助) | `enableHighAccuracy: true` + `timeout: 8000` + `maximumAge: 30000` + `convert: true` | 自带蓝点+精度圈(需 addControl 到地图);`amap-api.ts` |
| 腾讯 | 浏览器 `navigator.geolocation`(WGS84) | `enableHighAccuracy: true` + `timeout: 8000` + `maximumAge: 0` | 坐标经 `wgs84ToGcj02` 转 gcj02(境内偏移/境外零偏移);蓝点走 map-shell `syncUserBlueDot` 契约路径 |
| 百度 | `BMapGL.Geolocation`(**SDK IP 定位**,城市级,非真实 GPS) | 无高精度参数;bd09→gcj02 转换 | 定位精度差是 bug 5 百度侧根因 —— **由 ws-b(fix/baidu-poi-locate)改浏览器高精度** |

### 改动(仅 tencent-engine.ts `browserPosition` 段)

- `getCurrentPosition` 第三参 `{ timeout: 8000, maximumAge: 60000 }` →
  `{ enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }`:
  - `enableHighAccuracy: true` 对齐 AMap —— 请求 GPS 高精度,避免浏览器
    回退 IP/基站级粗定位;
  - `maximumAge: 0` 禁用位置缓存 —— 每次定位都重新请求,「定位 = 真实
    当前位置」;`timeout: 8000` 保留(与 AMap 一致);
- wgs84→gcj02 转换保留(腾讯底图 gcj02)。

### 测试

- `server/tests/map-engine-tencent.test.mjs` `getCurrentPosition(浏览器定位)`
  用例扩展:mock `navigator.geolocation.getCurrentPosition` 捕获第三参 opts,
  断言 `enableHighAccuracy === true` / `maximumAge === 0` / `timeout === 8000`;
  坐标转换断言保留(境内点位必须经 gcj02 偏移);失败/无 navigator → null 不变。

## ws-e 回填:百度单点级 content 渲染根因实锤 + 深色卫星组合 + 蓝点坐标一致性(2026-08-22,fix/baidu-round2)

> boss 真机实测三项(bug 2 单点级 0 徽章 / 深色+卫星不生效 / 蓝点 147px 偏差),
> 本 WS 以**真机 Chromium + 真实 SDK**(ak=test + 拦截 `qt=verify` 返回 error:0
> 绕过 AK 自毁,瓦片 403 不影响 marker/相机/样式机制)+ SDK 源码双向坐实。
> **ws-b 上一轮「content 路径三环节正确」结论作废**——以实测为准(见下)。

### 1. bug 2 单点级 POI 不渲染:真实 SDK Marker 根本没有 setContent

- **SDK 源码**:getscript v=1.0 本体 + marker 模块(`getmodules?mod=marker_crvckn`)
  核实 —— Marker 类(l4)原型与构造函数 `_config` **0 处 setContent / content**
  (仅 InfoWindow/Label 有 setContent);markerMouseTarget pane 的 `BMap_Marker`
  点击目标 DOM 恒创建、恒为空容器、尺寸=图标尺寸、位置=屏幕位+契约 offset。
- **真机 Chromium 坐实**:`typeof BMapGL.Marker.prototype.setContent === 'undefined'`;
  引擎旧路径 `raw.setContent?.(html)` 静默 no-op → zoom 17 DOM `.dm-badge` 0 个、
  无视觉、无点击反馈(与 boss 实测完全一致)。聚合级(z≤8)正常 = dataURL icon
  GL 纹理路径,与 content 无关。
- **修复**(baidu-engine.ts `scheduleMarkerContentInjection`):无 setContent 时把
  content HTML 注入厂商 marker 自带的点击目标 DOM(位置/点击/生命周期语义不变:
  子元素冒泡到 marker click;hide/show/remove 由厂商 DOM 管理;有界重试 20×50ms
  等待模块加载回调后 DOM 就绪)。真机验收:zoom 17 `.dm-badge` = 1、徽章 40×40
  完整渲染、真实 click 冒泡命中 marker。
- 聚合徽章(content+icon 双传)走 icon 纹理路径,注入兜底不介入(零行为变化)。

### 2. bug 1 深色 ← 卫星组合:深色自定义样式只对 vector 底图生效

- **实测**:卫星底图 + `setMapStyleV2` → `config.style` 已写入但 mapType 仍
  `B_SATELLITE_MAP`、瓦片无变化(与 boss「卫星→深色停在卫星」一致);标准→深色
  正常(boss 235→106)。
- **修复**:whitesmoke 分支先 `setMapType(BMAP_NORMAL_MAP)` 强制切回 vector,
  再应用 styleJson(顺序断言测试钉住);离开深色复位逻辑不变。

### 3. bug 5 蓝点与相机中心 147px 偏差:两路径坐标一致,未复现

- **真机复测**:`setCenter(gcj02 mock)` 与 `createMarker(同一 gcj02,蓝点 icon)`
  全场景(平视/俯仰 45°+旋转 30°/动画中断/蓝点先建)蓝点 DOM 均精确落在容器
  中心 (700,450);`map.getCenter()` 精确 = bd09(mock)(dlng≈1e-14)。
  相机与蓝点共用同一 gcj02→bd09 转换,引擎层不存在分叉。
- **判定**(按 boss 决策树):相机中心 = mock 位置且蓝点 = 相机中心 → 两路径
  一致,转换无错;147px 为测量状态伪差(疑似定位后 setCenter+setZoom 动画
  ~450ms 中间帧截图,或窗口中心≠容器中心帧)。测试钉住一致性;建议 boss 在
  动画结束后用容器 boundingRect 复测。
- 蓝点无契约 offset → anchor (0,0) 左上角(与 AMap/TMap 同款契约,不改)。

## ws-f r3 回填:百度「标记全部消失 + 渲染卡死」根因实锤 —— 自定义 Overlay 主路径在真实 SDK 静默失效(2026-08-22,fix/baidu-r3)

> boss 真机实测(ws-e 合并后):zoom 6-16 全级别 `.dm-badge` = 0、无 overlay 节点、
> 无聚合图标(聚合+单点都不渲染),截图持续超时(合成器卡住)/滚轮无响应。
> 本 WS 以**真机 Chromium + 真实 SDK + 引擎代码实跑**(dev server + Playwright,
> 拦截式 instrument)定位并修复,并推翻 ws-pinfix2 的「自定义 Overlay 主路径」。

### 1. 根因:Map.addOverlay 不挂载自定义 Overlay 的 initialize 返回值

- **SDK 源码**(getscript v=1.0 本体):`addOverlay=function(i){if(i&&cs(i._i)){
  ...; i._i(this); ...}}` —— 只调用 overlay 的**内部钩子 `_i(map)`**,不调用
  `initialize`、不做任何 DOM 挂载;
- **SDK 源码**(Overlay 基类 bb 的 `_i`):`this.domElement=this.initialize(mw)`
  后**无任何 appendChild**——经典 BMap「initialize 返回 div、SDK 自动加入覆盖物
  容器」契约在 GL v1.0 **不成立**(BMapGL 官方自定义 Overlay 需开发者在
  initialize 内自行 `map.getPanes().markerPane.appendChild(div)`);
- **真机坐实**:引擎 Overlay 子类(ws-pinfix2 形态)在真实 SDK 上 `initialize` 被
  调、div 已定位(left/top 正确),但 `parentNode` 恒 null → 0 徽章 + 0 聚合图标
  (boss「标记全部消失」实锤)。1049 个 addOverlay 全部静默失效,且 SDK 长期持有
  `overlay.domElement` 引用 → 无主 div + badge HTML(img dataURI)随会话膨胀
  (实测 JS heap 139→218MB),叠加合成器负载(低 zoom 截图 3.5-4.5s,接近超时)。
- ws-e 的「注入兜底」在 Overlay 主路径存在时**永远不会执行**(`BMapGL.Overlay`
  存在 → 走 Overlay 路径)→ 单点级修复也被吞掉。

### 2. 修复(baidu-engine.ts r3):主路径 = 厂商 Marker + 点击目标 DOM 注入

- `createContentMarker` 重写为**厂商 Marker 主路径**(删除 Overlay 路径):
  - 有 `setContent`(测试 mock / 未来 SDK 形态)→ 直调原契约路径;
  - 无 setContent(真实 SDK)→ content HTML 注入 `BMap_Marker` 点击目标 DOM;
    **addOverlay 同步创建该 DOM**(r3 实测 ms 级),位置 = 屏幕位 + 契约 offset
    (空白 1×1 锚点图标 anchor=-offset 数学驱动,与 AMap 逐像素同语义);
  - 点击:子元素冒泡到厂商 DOM → marker click(选中/卡片反馈真机验证);
  - content+icon 并存(聚合徽章)→ **icon 为渲染主机制、content 不注入**(dataURL
    icon 纹理即视觉,注入会双渲染;远程 icon 未预检先回落 content 注入,预检成功
    后下次重建升级);
- **零定时器**:ws-e 版 20×50ms `setInterval` 轮询(渲染卡死嫌疑)删除,改为
  **同步注入 + 微任务 4 轮 + rAF 5 帧**有界重试(实测同步就绪,重试纯防御);
- 无主 div 泄漏消除(domElement 由厂商管理,随 marker 生命周期释放)。

### 3. 真机验收(fix 后,dev server + Playwright,headed Chromium + 真实 AK)

- z13 单点级:1048 个 `.dm-badge` 全部可见;badge 真实点击 → POI 详情面板 +
  选中态;setContent(选中样式)重入更新
- z≤8 聚合级:135 个聚合 marker 可见(GL dataURL icon 纹理;个体 pin 由
  setVisible(false) 隐藏,互斥正确);z→13 个体 pin 恢复可见
- zoom 6→16 全级别:截图 0.1-0.5s(z9 峰值 0.88s,瓦片加载;修复前 3.5-4.5s);
  滚轮缩放全级别响应;console 零报错
- 样式切换:标准/卫星/深色/回标准全通过,深色(whitesmoke)真机变暗
  (rgb 230→110),切换后 1048 徽章仍在
- 内存:固定 zoom 下 marker 总数稳定,无增长循环;zoom 分桶切换的 addOverlay
  增量有界(≤135)

## ws-f r4 回填:注入重试窗口在重负载下失效(主树复验 136 警告 + 0 徽章)→ 定时器兜底(2026-08-22,fix/baidu-r4)

> r3 合并进 dev 后 boss 主树复验(dev server :3000,Playwright):console 136 条
> `[map-engine] BMapGL content 标记 DOM 注入超时` + `.dm-badge` = 0(徽章未渲染),
> 页面交互正常(无卡死)。本 WS 以**真机 Chromium + 真实 SDK**对比 r3/r4 定位。

### 根因:r3「零定时器」重试窗口太短且依赖 rAF 调度

- r3 注入链 = 同步 + 微任务 4 轮 + **rAF 5 帧**(≈80-350ms)。重负载/慢首帧下
  **rAF 帧回调停摆**(真机 8× CPU 节流 + 缓存目录重载坐实:addOverlay 后
  domElement 迟至 **1-10s** 才创建,期间 rAF 链静默悬挂——旧链既不注入也不
  告警;且 5 帧窗口对迟到的 domElement 恒失败);
- 主树复验为何 r3 单元/验收全绿却失败:常规时序 domElement 同步/数帧就绪
  (r3 实测依据),但**数据快(缓存目录)+ 渲染慢(MCP 长会话/重负载)**时 marker
  先于首帧渲染创建 → domElement 迟到 → 5 帧窗口耗尽 → 警告 + 徽章永久缺失;
  应用侧 setContent 重入(状态变化)只是偶然救援,状态不变时不触发;
- 结论:**注入必须不依赖 rAF 帧调度,且窗口必须覆盖「domElement 迟到」量级**。

### 修复(baidu-engine.ts r4):低频率自终止定时器兜底 + rAF 快路径保留

- 注入链 = 同步 + 微任务 4 轮 + **rAF 3 帧快路径** + **定时器兜底**(首 tick
  100ms,之后 250ms 步进,上限 80 tick ≈ 20s,自终止;每 marker 独立一条链,
  `injectMarkerContent` 内容不变不重写 → 零抖动);
- `pendingContentInjection` 登记表:注入成功 / marker 摘除(wrapper.remove)/
  链耗尽即摘除,重试链先查登记再注入(已摘除 marker 不得写入);
- 超时警告降为 20s 全失败后**一次性**输出(正常时序零噪音;r3 的 5 帧短窗口
  + 依赖 rAF 的机制删除);
- 定时器频率远低于 ws-e 版(50ms→250ms),且无 Overlay 无主 DOM 拖累(r3 已
  消除)→ 不构成渲染负担(主树 r3 已无卡死,boss 复验「页面交互正常」佐证)。

### 真机验收(fix 后,dev server + Playwright)

- 主树同条件复测(r3→r4 同环境):全新会话 1048 徽章、缓存重载 400 徽章、
  8×/12× CPU 节流重载徽章全渲染、注入超时警告 **0** 条;domElement 迟至
  1-10s 的 marker 由定时器兜底注入成功(单元测试无 rAF 环境坐实:node 无
  requestAnimationFrame → 定时器链 100ms 首 tick 命中)
- 回归(与 r3 验收同矩阵):z≤8 聚合徽章可见、z>8 单点 1048 徽章可见、badge
  点击 → POI 详情 + 选中态、滚轮缩放响应、标准/卫星/深色切换正常、console
  零报错、截图 0.1s 级
- 测试:`map-engine-baidu.test.mjs` +3(定时器兜底注入 / rAF 快路径 / remove
  终止注入链),85/85 通过;`npm test` 1419 通过 / 0 失败 / 2 skip

## 加载超时契约与挂载错误态回填(2026-08-22,fix/amap-load-timeout + fix/mount-retry + fix/loading-error-ui)

> 来源:批次 `20260822-boss-loading-hang`(首访卡死修复,症状/根因/验证全链见
> `tech/16-bug-fixes.md` 对应条目)。本批把引擎加载/挂载链补成**有界 + 有出口**。
> 超时先例与既有 tencent 1.5s 就绪超时(ws-7)/ baidu 1.5s 就绪 + 2s 命名空间
> (ws-7 / ws-c)并列,本批新增 amap 8s 加载超时 + 挂载链 25s watchdog 两层上界。

### loadAMap 8s 超时契约(amap-api.ts)

- **`AMAP_LOAD_TIMEOUT_MS = 8_000`**(amap-api.ts:45):主脚本(含插件)加载上界。
  此前 `loadAMap()` 是全链路唯一无超时 await——CDN/DNS 卡死则 Promise 永不
  落定,map-shell 首屏永久 "Loading map..."(刷新即好)。
- **超时/onerror 同语义**:清 `loadPromise` + 移除 `SCRIPT_ID` 标签 + reject
  (超时错误 `code: 'AMAP_LOAD_TIMEOUT'`,:104-107);移除标签是关键——否则下次
  走「复用 existing」分支给已死标签挂监听,Promise 永不落定。
- **`settled` 竞态守卫**(:82-100):超时/error 后迟到的 onload/onerror 一律无效
  (不二次 settle,成功路径 clearTimeout),重试由调用方经新注入标签恢复。
- **与既有先例的并列关系**:tencent createView 就绪超时 1.5s / baidu 就绪超时
  1.5s + 命名空间轮询 2s(均为「等待厂商渲染信号」上界);amap 8s 是「主脚本
  网络加载」上界——AMap 脚本含插件必须等真实网络链路,8s 为安全上界(代码
  注释原文)。四者合流:引擎加载/就绪全链无永久 await。

### useMapEngine mountError/retryMount 错误态契约(ws-2,use-map-engine.ts)

- **`runMount` 挂载链统一**(use-map-engine.ts:337):首挂载 effect 与 `retryMount`
  共用同一挂载链(resolveEngine → setEngine/setActiveSearchProvider →
  `mountEngineView` + watchdog),不复制第二份;可重入,每次调用递增挂载代际
  `mountSeqRef`。
- **`mountError`**(:85-92,:199):挂载链(含引擎回退)全部失败后非 null
  `{ engine, code?, message }`;重新开始挂载时立即清 null。engine = 失败引擎 id
  (`mount.ts` 在最终错误上携带 `engineId`,mount.ts:96-101;watchdog 超时无
  engineId → 偏好引擎 resolved.id)。此前失败仅 `console.warn`,无任何出口。
- **`retryMount()`**(:438-441):重新执行完整挂载链;挂载进行中(`mountRunningRef`)
  或已有活 view(`viewRef`)时 no-op(幂等);成功后走与首挂载相同的 .then 落地
  (viewRef/setView/setEngine 不变)。
- **25s watchdog `MOUNT_TIMEOUT_MS = 25_000`**(:167):整条挂载链
  withTimeout 上界(与 amap-api.withTimeout 同款语义,超时错误
  `code: 'MOUNT_TIMEOUT'`);单引擎各有界(ws-1 loadAMap 8s 超时 reject),此上界
  防未来新增无界引擎/钻缝;超时进入错误态并作废在飞挂载链——后台链恢复后经
  `isCancelled`(代际比较)销毁已建视图,不泄漏(单线程保证:超时触发时链必然
  parked 在 await 上,catch 先于其恢复)。
- **消费方契约**:引擎总线载荷含 `mountError`/`retryMount`(:119-126),面板侧
  不用即可;map-shell 覆盖层按「加载中 / 失败态(i18n mapLoadFailed 系 +
  重试按钮走 retryMount)/ 配置缺失」三态渲染(ws-3,map-shell.tsx:2290-2311)。

### 验收(离线)

| 项 | 结果 |
|---|---|
| loadAMap 超时/迟到 onload/onerror 重试(amap-api.test.mjs +3)| ✅ 6/6 |
| mount 错误态/重试幂等/watchdog(map-engine-mount.test.mjs +7)| ✅ 13/13 |
| 覆盖层失败态 + 重试接线(component-contracts +1)| ✅ |
| 首访逐页超时/止损(viewport-search.test.mjs +3)| ✅ |
| 合并后全量 npm test | ✅ 1443 tests / 1441 pass / 2 skip / 0 fail |
| typecheck / make docs-check / git diff --check | ✅ |

**遗留(边界外)**:首访全量加载失败的缺口由「mapReady 后视口加载增量语义」
自然补齐,不做整轮重试;挂载回退成功是否改写引擎偏好仍为 ws-8 遗留决策项。

## ws-g r5 回填:注入后「徽章全部定位屏幕外」根因实锤 —— SDK fixPosition 反绕 + 修复(2026-08-22,fix/baidu-r5)

> r4 合并进 dev 后 boss 主树复验:注入成功(400 个 .dm-badge,0 警告)但
> `getBoundingClientRect()` 全在屏幕外(rect x≈±125 万 px 量级,实测样本
> 5,009,397 ≈ 4×worldSize(z15)),截图视觉零徽章 —— 用户仍看不到百度 POI。
> 本 WS 真机 Chromium + 真实 SDK(v1.0 getscript 本体)定位根因并修复。

### 根因:marker 模块 `_getPixPos` 恒传 `fixPosition: true`,视口外像素被整世界反绕

- SDK v1.0 源码(真机 `Marker.prototype._getPixPos.toString()` 坐实):
  `mu={zoom:T,center:i,fixPosition:true}; C=this.map.pointToOverlayPixelIn(e,mu)`;
- `pointToOverlayPixelIn` 的 fixPosition 分支(`pointToOverlayPixelIn.toString()` 坐实):
  `if(C.x>mu.width){C.x-=Math.ceil((C.x-mu.width)/i)*i}else if(C.x<0){C.x+=Math.ceil((0-C.x)/i)*i}`
  (i = `worldSize(T.zoom)`;z13 ≈ 1,252,358px,z15 ≈ 5,009,432px);
- 效果:任何**视口外** marker 的屏幕 x 被按整世界尺寸反绕到 ±worldSize
  (z13 ±125 万 px,z15 ±500 万 px,缩放逐级翻倍)——注入成功但 DOM 全错乱、
  视觉零徽章(boss 主树复验);
- 真机观察补充:marker DOM 在**构造/addOverlay 与每次相机变化**都被 SDK 重写
  (实例属性 hook 坐实每帧 4.4×10^5 次投影调用);视口内 marker 不受反绕影响
  (x∈[0,width] 不触发分支)→ 与 r3/r4「视口内徽章可见、点击可达」验收不冲突,
  boss 的「400 全部屏幕外」= 相机/zoom 下视口内无 POI 时全量反绕的极端形态。

### 修复(baidu-engine.ts r5):实例级遮蔽强制 fixPosition:false + 相机事件校准

1. **实例级同名遮蔽**(view 构造时):`map.pointToOverlayPixelIn` 换为包装器,
   强制 `fixPosition:false` —— SDK 与引擎经属性查找的**全部**投影调用都拿到
   未反绕视口像素(内部数学不变:`(point−centerPoint)/zoomUnits+width/2`,与
   SDK 反绕前中间值字节级等同);own property 优先于原型,SDK 捕获的模块引用
   路径外的调用全被遮蔽;
2. **注入成功即校准 + 相机事件重算**(moveend/zoomend/tilesloaded 懒注册监听,
   首个 content marker 时绑定,空视图零监听残留):`repositionContentMarkerDom`
   以 `pointToOverlayPixelIn(getPositionIn(), {zoom, fixPosition:false})` 覆写
   DOM left/top(减锚点分量 anchor=-契约 offset,与 SDK `C.x+=mw.width-mv.width`
   逐像素同语义)——对绕开属性查找的路径兜底;remove 摘除即注销,零写入;
3. 反绕语义取舍:fixPosition 只为 ±180° 反经纬线「就近副本」服务(本产品中国区
   POI 恒不触及),其副作用(视口外 POI 被迫迁到世界对面、缩放逐级翻倍)正是
   被修复的威胁。

### 真机验收(fix 后,dev server :3100 + Playwright,1048 单点徽章)

- 注入 0 警告、console 零报错;z13 视口内 32 徽章可见(与修复前一致,位置正确);
- **±worldSize 爆炸消除**:marker DOM left 分布 = 视口内 50 + 视口外近距
  (≤±1.5 万 px,Hangzhou 域 POI)+ 远距真值(拉萨/乌鲁木齐/新加坡/旧金山等
  全国+国际数据,±10 万~±100 万 px 与地理距离严格对应,zip 核对逐点成立);
- 相机跟随:z13→z12→z11→z10→z9 可见数 32→39→133→150→375(数据密度随距离
  衰减,亚线性增长符合预期);z15 视口内 13 徽章、pan 后新中心 3 徽章;
  z13 停 7s 位置零漂移;
- 聚合 z≤8:+270 聚合 marker(addOverlay 计数 1048→1318),54×54 簇徽章
  DOM/GL 纹理均可见;z10/z13 切回单点正常;
- badge 点击 → `.dm-badge-selected` + POI 详情面板(点击命中保持);
- 测试:`map-engine-baidu.test.mjs` +5(注入即校准 / 相机事件重算 / remove
  注销 / destroy 解绑 / 旧 SDK 缺 API 静默跳过),90/90 通过;
  `npm test` 1432 通过 / 0 失败 / 2 skip;typecheck / docs-check / diff-check 通过。

## ws-h 回填:腾讯 POI 堆叠根因实锤 —— DOM overlay 分派收窄 + 定位 API 实测修正(2026-08-22,fix/tmap-content-scope)

> 来源:批次 `20260822-boss-engine-polish-2` ws-h。用户报「来回切换底图导致 POI
> 各种奇怪 bug」;boss 真机实测:腾讯引擎 `.dm-badge` 100 个全部堆叠在 (0,900)
> 一个点(unique=1,xRange=[0,0])。

### 1. 堆叠根因(prompt 前提澄清 + 真机实锤)

ws-pinfix2(f2e4f60)曾令**全部 content marker 走 DOM overlay**——动机是修
「content+offset 无 icon 的 agent 蓝点被 MultiMarker 拒绝」,但副作用是
**公司 POI 徽章(content+icon 并存)也改走 DOM overlay** → 依赖假定 API
`lngLatToContainerPoint` —— **真机 Chromium + 真实 SDK 实测该 API 不存在**:

- `typeof map.lngLatToContainerPoint === 'undefined'`(v1.8.0.2 Map 原型导出面:
  `projectToContainer` / `unprojectFromContainer` / `projectToWorldPlane` /
  `projectToCenterLocalPlane` / `glLatLngToPosition` 等,**无 lngLatToContainerPoint**);
- 引擎 `project()` 判空 → 一次性 warn + 返回 null → `redraw` 不写 left/top →
  全部 overlay div 停在静态位置 → **100 徽章全堆叠(用户 bug 终端形态)**;
- 结论:ws-pinfix2 的定位 API 假设(官方命名)不成立,不是「API 存在但定位错」,
  而是 **API 不存在 + DOM overlay 分派过宽** 双因叠加。

### 2. 修复 A(主修复):createMarker 分派收窄

`tencent-engine.ts` `createMarker` 按 ws-c 语义回归:

- **content 存在且无 icon** → `createContentOverlay`(保留,ws-pinfix2 目标场景:
  agent 蓝点等无 icon 的 HTML 形态);
- **content+icon 并存(公司 POI 徽章/聚合徽章)/ 仅 icon** → 既有 icon 路径
  (MultiMarker 纹理 + ws-c 修正锚点 anchor = -contract offset)——公司 POI
  恢复;content 不写 geometry 不渲染(HTML 与 icon 纹理双渲染会叠印);
- 无 content 无 icon → 单点 / MultiMarker 路径不变;
- `createMultiMarker` / `resolveMultiStyle` 注释同步(icon 主机制语义回归)。

### 3. 修复 B(双保险):DOM overlay 定位 API 双路径

`createContentOverlay.project()`:

- 优先 `lngLatToContainerPoint`(测试双面/未来 SDK 兼容);
- **兜底 `projectToContainer(latLng)`**(真实 SDK v1.8.0.2 实测适配:返回
  `TMap.Point {x,y}` 容器像素——center → 精确容器中心 (640,400)/1280×800,
  geo 偏移 (lat+0.02,lng+0.02) → (757,265) 方向量级正确;+2 zoom 后同点
  像素间距精确 ×4);
- 两者皆无 → 一次性 warn + 跳过定位(不抛错)。

### 4. 真机验收(dev server :3100 + Playwright Chromium + 真实 AK)

- **腾讯不堆叠**:`.dm-badge` DOM 0 个(GL 纹理路径);MultiMarker 单实例
  400 geometry / 177 唯一坐标 / 11 样式;截图 ~14-18 徽章分踞正确地理点
  (截图 `.playwright-mcp/ws-h-10-tmap-final.png` 等);
- **点击命中**:点击 `projectToContainer` 定位到的 dm-mk-1(640,400)→
  「高频杭州」POI 详情卡片弹出(ws-h-16-after-click.png);
- **缩放跟随**:+2 zoom 后同 geo 偏移像素距离精确 ×4(698,333 → 873,130,
  相对中心 4.02×),视觉徽章尖点钉地理点(ws-h-17-after-zoom.png);
- **agent 蓝点(无 icon content)不回归**:分派仍走 DOM overlay,定位链
  projectToContainer 兜底(单元 74/74 钉住);
- **百度/高德零回归**:amap 回切 400 DOM 徽章(63 唯一可见点)、baidu
  400 徽章(177 唯一),截图正常,console 零报错(ws-h-08/11/12)。

### 5. 测试(map-engine-tencent.test.mjs 73→74)

- 重写 ws-pinfix2「content+icon → content 主机制」测试:改断言 icon 主机制
  (MultiMarker + styleId + anchor (27,27) + 零 DOM overlay + content 不写
  geometry + content-only 仍 DOM overlay);
- 新增:projectToContainer 兜底定位(left/top = proj - offset、LatLng 纬度
  在前、双 API 缺失一次性 warn 不抛、no-DOM 回退不受影响)。

### 6. 遗留

- DOM overlay 仅服务无 icon content(agent 蓝点/距离手柄);蓝点生产场景
  (ws-d 用户定位)本就走 icon 路径,未受影响;
- 未触发保底方案(用户「只用高德」授权):方案 A/B 验收通过,未启用。

## ws-i 回填:腾讯 POI 徽章层级修复(构造后 setMap 挂图)+ icon 预检链式推进(2026-08-23,fix/tmap-badge-overlap)

> 来源:批次 `20260822-boss-engine-polish-2` ws-i。用户报「腾讯底图的公司 poi
> 有问题,渲染很奇怪」;boss 真机实测(全新 reload):徽章主体 15 个完整 40×40
> 正常、点击弹卡、MultiMarker hook 无双渲染/无 default styleId;但存在 3 个
> 「幽灵元素」(34×14 扁平,白上蓝内,地图锚定、点击无响应、不在 DOM、非
> MultiMarker geometry);OCR 实证:TMap 底图矢量瓦片自带海量 POI 文字标注
> (「18号級」等),「18号級」(638,393)-(672,403) 与混合块 (656,399) 精确
> 重叠 → **混合块 = 徽章被底图文字标注遮挡(文字白底盖住徽章上部,只露下半)**。
> AMap 徽章是 DOM 元素画在 canvas 之上不受影响 → 腾讯独有。

### 1. 根因:MultiMarker 构造期挂图 → 图层 level 落标注层之下

- TMap GL MultiMarker(GeometryOverlay 派生)的图层 level 在 `_createLayer()`
  时按 `_layerType` 决定(子类 `_setGeometryType()` 设置 `_layerType="MARKER"`);
- **构造 options 传 `map`** → GeometryOverlay 基类构造器在子类
  `_setGeometryType()` 执行**之前**调 `setMap(map)` → `_createLayer()` 读
  `_layerType` 仍 undefined → 图层 level 落 **OVERLAY_AA(4)**,低于底图文字
  标注层 TEXT(6);overlay 排序 rank = 10000·level + zIndex(层内 zIndex 上限
  9999,无法跨级)→ 文字标注盖住徽章;
- **构造后显式 `setMap(map)`** → `_setGeometryType()` 已执行 → 图层
  type="MARKER" → level **OVERLAY_NAA(7,标注之上)** → 徽章完整不被遮挡;
- 修复(tencent-engine.ts `createMultiMarker`):构造 options **不传 map**,
  构造后立即 `raw.setMap(this.raw)`(SDK v1.8.0.2 实包源码核实:GeometryOverlay
  恒有 setMap,destroy 路径本就依赖 `setMap(null)`,同款可用性;极老形态缺失
  → 一次性 warn 降级不抛)。zIndex 语义不变(level 内偏移)。

### 2. 预检刷屏根因 + 修复:resolveTMapIconSrc 链式推进

- 症状:首会话 console 370-740 行 favicon.im CORS 错误(185 唯一 URL × 2 行);
- 根因:`resolveTMapIconSrc` 把**全部 unknown 候选都 push 进 toPreflight**
  (每 POI 候选链 ~8 个 URL)→ 调用方全量预检 → 24 POI × ~8 ≈ 192 个失败
  请求;ws-e/ws-f 的记忆化本身正常(每 URL 只报 1 次),问题在「一次性预检
  全部候选」而非「链式推进」;
- 修复(map-markers.ts):只 push 候选链中**第一个 unknown**(logoUrl 优先,
  其次候选链顺序);失败记忆化后下次重建自然试下一个候选 → 每 POI 最多 1
  个预检请求,渐进收敛;纯函数契约(返回 {src, toPreflight})与调用方
  `for (url of toPreflight) preflightRemoteIcon(url)` 不变。

### 3. 测试

- `map-engine-tencent.test.mjs`:
  - 构造顺序:MultiMarker 构造 options 无 `map` + 构造后 setMap 挂图
    (raw.map === view.raw);
  - 无 setMap(极老 SDK)→ 一次性 warn 降级不抛,实例不挂图;
  - `resolveTMapIconSrc` 纯函数:toPreflight 只含链中第一个 unknown
    (favicon.im),icon.horse 不预检;
  - 控制器级链式推进:首预检 favicon.im → 失败记忆化 → 重建预检
    icon.horse → 成功 → 再次重建升级真 logo;全程零重复预检。

### 4. 验收状态与遗留

- 单元/门禁:1461 通过 / 0 失败 / 2 skip;typecheck / docs-check /
  git diff --check 通过;
- **真机复验(boss 轮后)**:混合块消失(该位置徽章完整 40×40)、15+ 徽章
  全部完整、点击弹卡、缩放/pan 后仍完整、AMap/Baidu 零回归;首会话 console
  errors ≤50 行、第二会话(记忆化)0 行。若混合块仍在 → 二分:禁 icon.horse
  候选(全 dataURL)是否消失;禁 `setStyles` 全量替换(改增量)是否消失;
  LOD 摘挂(1100 次 add 观测)是否相关。
