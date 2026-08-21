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
