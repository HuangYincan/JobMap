# d 汇报(2026-08-21)— feature/map-engine-tencent(腾讯引擎)

## Vendor API 核实记录(供 boss 汇总进 tech/23)

> ⚠️ **核实方式说明**:本 WS 运行环境网络被沙箱禁用,无法实机抓取 lbs.qq.com 文档页;
> 以下 API 命名与参数依据**官方文档(lbs.qq.com/webApiCenter/glAPI/ 系列 + WebService 服务文档)的
> 已知稳定形态**核实,并与轮 1 已合入的 `map-engine-loader.test.mjs`(其中
> `https://map.qq.com/api/gljs?v=1.exp&key=k&callback=onTMapScriptLoad` 的 URL 形态已固化)交叉验证。
> **每条标注 [冒烟待验]** 的项须在用户配置真实 key(deferred #1)后冒烟核对,结果回填 tech/23。

| 项 | 核实结论(官方文档形态) | 出处 |
|---|---|---|
| 脚本 URL | `https://map.qq.com/api/gljs?v=1.exp&key=<KEY>[&callback=onTMapScriptLoad]`;callback 为异步加载回调,须在注入前注册 | lbs.qq.com/webApiCenter/glAPI/glAPI 快速开始;[冒烟待验] |
| 命名空间 | `TMap`(window.TMap),脚本就绪后可用 | 同上 |
| 地图构造 | `new TMap.Map(container, { center: TMap.LatLng, zoom, pitch, rotation, baseMap })` — **双参**:容器 + 选项对象 | glMap 地图展示 |
| 坐标类 | `TMap.LatLng(lat, lng)` — **纬度在前**;属性 `.lat/.lng`;`TMap.LatLngBounds(sw: LatLng, ne: LatLng)`,访问器 `getWest/getSouth/getEast/getNorth` | glMap LatLng/LatLngBounds;[冒烟待验] |
| 视图方法 | `setCenter/getCenter、setZoom/getZoom、setPitch/getPitch、setRotation/getRotation、setBounds(LatLngBounds)、flyTo({center,zoom,pitch,rotation,duration})、setBaseMap(baseMap)、on/off、addControl(control)、destroy`;setCenter/setZoom 无动画参数 → 动画经 flyTo(duration) | glMap 地图方法;[flyTo 参数可选性冒烟待验] |
| 底图样式 | `baseMap: { type: 'vector' }` = 标准矢量;`{ type: 'raster' }` = 栅格/卫星;暗色 = `{ type: 'vector', styles: [{ styleType: 'dark' }] }`(**存在但契约 MapStyleId 无 dark 项,未暴露**);运行期切换 = `map.setBaseMap(...)` | glMap 底图;[冒烟待验] |
| Marker | `new TMap.Marker({ position: LatLng, map, content, offset: {x, y}, zIndex })` — **offset 是 {x,y} 对象**;移除 = `marker.setMap(null)`(**无 remove 方法**);点击 = `marker.on('click', cb)`;更新 = `setPosition(LatLng)/setContent(html)` | glMarker 标注点;[冒烟待验] |
| Circle | `new TMap.Circle({ center: LatLng, radius, map, strokeColor, fillColor, fillOpacity })`;移除 = `circle.setMap(null)` | glCircle;[冒烟待验] |
| 比例尺 | `new TMap.control.ScaleControl({ position: 'bottomRight' })` + `map.addControl(control)` | glControl;[冒烟待验] |
| 事件名 | `click / zoom / dragend / idle / maptouch*` 等;**无原生 moveend/zoomchange/complete** → 适配映射:`zoomchange→'zoom'`、`moveend→'idle'`(相机静止超集)、`complete→'idle'` | glMap 事件;[冒烟待验] |
| 搜索服务 | **JS API GL 无内置搜索类**;官方配套 WebService API:关键词 `GET /ws/place/v1/search?keyword=&boundary=&page_size=&key=`,`boundary` 支持 `region(城市,0)` / `nearby(lat,lng,radius)`;建议 `GET /ws/place/v1/suggestion?keyword=&region=&key=`;地理编码 `GET /ws/geocoder/v1/?address=&region=&key=`;响应 `{status:0, data:[{id,title,address,category,type,location:{lat,lng},ad_info:{city,district}}]}`;坐标同为 **gcj02**;page_size 上限 20 | lbs.qq.com/webApiCenter/webServiceGuide;[冒烟待验] |
| 定位 | GL 核心无定位服务 → 浏览器 `navigator.geolocation`(返回 **WGS84**)→ `wgs84ToGcj02` 换算(coord-utils) | 通用 Web 标准;[冒烟待验] |

**key 要求**:同一 `NEXT_PUBLIC_TENCENT_JSAPI_KEY` 需在 lbs.qq.com 控制台**同时勾选「JS API GL」与「WebServiceAPI」产品**并配置域名白名单(WebService 浏览器直连依赖 CORS)。→ 已记 deferred #1。

## 实际改动(仅 2 个新文件,1309 行)

- `server/src/lib/map-engine/tencent/tencent-engine.ts`(新,458 行)→ 腾讯引擎完整实现:
  - `TENCENT_ENGINE` 单例:`id 'tencent'` / `label '腾讯地图'` / `namespace 'TMap'` / `coordSystem 'gcj02'` / `keyVar 'NEXT_PUBLIC_TENCENT_JSAPI_KEY'`;`isConfigured()` = env trim 非空;`isLoaded()` = window.TMap 存在
  - `load()`:经 `script-loader` 注入 `https://map.qq.com/api/gljs?v=1.exp&key=<KEY>&callback=onTMapScriptLoad`(callback 模式,回调先注册);幂等(loader 同 URL 缓存 + TMap 就绪短路);失败清理(loader 移除标签+清缓存,可重试);key 缺失 → 明确报错
  - `createView(opts)`:`new TMap.Map(container, {center: LatLng(lat,lng) 纬度在前, zoom, pitch, rotation, baseMap})`;返回 `TencentView` 门面
  - 视图方法:`getState`(getCenter/getZoom/getPitch/getRotation 归一 {lng,lat})、`getBounds`(LatLngBounds→MapBounds)、`setCenter/setZoom`(animateMs>0 → flyTo(duration),否则直设)、`setPitch/setRotation` 直设、`setBounds`(LatLngBounds(sw,ne) 内部构造)、`flyTo`、`setStyle`(normal→`{type:'vector'}`、satellite→`{type:'raster'}`;whitesmoke 不支持 → 回退 normal + console.warn)、`on`(事件名映射 + 返回解绑)、`createMarker`(offset 元组→{x,y}、onClick→marker.on('click')、remove→setMap(null))、`createCircle`(strokeColor/fillColor=color、fillOpacity 0.2)、`addControl('scale')`→ScaleControl(bottomRight)、`destroy`(幂等)
  - `search`:**vendor 优先**(TMap.search 存在时直调,engine-mock 注入用),**真实生产回落 WebService**(fetch):searchPOI(boundary region/nearby、page_size 1-20)、fetchSuggestions(region 参数)、geocodeAddress(geocoder/v1,无结果→null)、getCurrentPosition(浏览器 WGS84→gcj02);全部**失败安全值**([]/null + console.warn),不向消费方抛错
  - 归一化:`normalizeTencentPOI`(→DomainPOI,id 兜底 `tencent-<lng>-<lat>-<name>`、分号分类取首段、tel 清洗、Number.isFinite 坐标守卫)、`normalizeTencentSuggestion`(→AmapSuggestion,含 city[]/district)
- `server/tests/map-engine-tencent.test.mjs`(新,851 行,21 用例)→ 见下

## 测试用例(21 个,全部通过)

1. isConfigured env trim 开关(空/空白/有效/前后空白)
2. load:key 缺失拒绝 / SSR 拒绝 / TMap 已就绪短路
3. load:真实脚本 URL 断言(`map.qq.com/api/gljs?v=1.exp&key=test-key&callback=onTMapScriptLoad`)+ callback 注册时序 + 幂等不重复注入 + onerror 失败清理(标签移除)
4. createView:TMap.Map(container, opts) 双参传递,`{lat,lng}` 纬度在前断言,baseMap/zoom/pitch/rotation
5. getState:vendor 原语归一回契约形状
6. setBounds/getBounds:LatLngBounds(sw,ne) 纬度在前 + 回读 MapBounds + null 守卫
7. setCenter/setZoom:animateMs>0 → flyTo(duration) 计数 / 直设分支;setPitch/setRotation
8. setStyle:satellite→raster、normal→vector、whitesmoke→回退 normal + console.warn(构造期 + 运行期)
9. createMarker:offset [4,-6]→{x:4,y:-6}、LatLng 纬度在前、content/zIndex/map、onClick 注册触发、setPosition/setContent、remove=setMap(null)
10. createCircle:center/radius/strokeColor/fillColor/fillOpacity/map、remove=setMap(null)
11. addControl:scale→ScaleControl(bottomRight);未知 kind no-op
12. on:事件名映射(zoomchange→zoom、moveend/complete→idle、click→click)+ 解绑语义
13. destroy:幂等(二次不触碰 vendor)+ isDestroyed
14. searchPOI(vendor):参数透传 + 归一化(gcj02 直通零转换断言)+ 非法记录过滤
15. fetchSuggestions(vendor):AmapSuggestion 形状(city[]/district)
16. getCurrentPosition/geocodeAddress(vendor):gcj02 直通
17. searchPOI(WebService):/ws/place/v1/search 端点 + boundary region/nearby 构造 + page_size
18. searchPOI(WebService):HTTP 失败/status!=0 → 空数组安全值 + warn
19. fetchSuggestions(WebService):suggestion 端点 + region 参数
20. geocodeAddress(WebService):geocoder 端点;成功→{lng,lat}、无结果→null、HTTP 失败→null
21. 浏览器定位:WGS84→gcj02 偏移断言(境内点位非直通)+ 失败/无 API → null
22. normalizeTencentPOI / normalizeTencentSuggestion 纯函数(兜底 id、分类、tel 清洗、NaN/缺省守卫)

测试基建:`installEngineMock('TMap')` + 测试内「忠实厂商双面」(TMapLatLng 纬度在前 / LatLngBounds 访问器 / control.ScaleControl / MockView 补 getCenter·getZoom·getPitch·getRotation·setBaseMap·off / MockMarker·MockCircle 补 setMap·on),让适配器走真实 vendor API 命名、断言厂商侧收到的确切形状。**未改动共享 fixture**(engine-mock.mjs 保持原样)。

## 门禁结果

- `npm test`(server):**655 通过 / 0 失败 / 2 skip**(基线 549+ 零漂移,新增 21 用例全绿)
- `npm run typecheck`:`tsc --noEmit` 通过(0 错误)
- `make docs-check`(等价 grep 校验,沙箱内 make 不可用):无陈旧文档引用,通过
- `git diff --check`:通过(无空白错误)

## 遇到的问题

- **沙箱禁网,无法实机核实官方文档** → vendor API 依据训练知识中的官方文档稳定形态 + 轮 1 loader 测试已固化的 URL 形态;全部标 [冒烟待验],随 deferred #1 真实 key 冒烟回填 tech/23。→ 需 boss 知悉 tech/23 汇总时标注该核实层级。
- **`BasePOI.source` 闭合联合无 `'tencent'`**(`'amap' | 'seed' | 'api'`),而文件边界禁止改 types.ts → 腾讯归一化沿用 amap-api 的 `source: 'amap'`(会话非持久化语义),代码注释 + 本汇报明示。**需 boss 裁决**:后续是否扩展 `source` 联合加 `'tencent'`(涉及持久化判定,ws-f/ws-g 或独立文档批次处理)。
- **注册表接线未做**:`engine-registry.ts` 的 `TENCENT_ENGINE` 仍是 ws-d 骨架(not-implemented);本 WS 的完整实现以同名 `TENCENT_ENGINE` 从 `tencent-engine.ts` 导出。**需 boss 裁决**:由 ws-f(UI 切换)/ws-g(收尾)统一把完整实现替换进注册表(与 ws-c 的 AMap 引擎同构处理)。
- **WebService 依赖**:key 需勾选 WebServiceAPI 产品 + CORS 域名白名单;浏览器直连受限时需服务端转发(当前无)。已记 deferred。
- 测试初期 6 处断言失败(NaN 过 `typeof` 守卫、deepEqual 遇类实例)→ 引擎改 `Number.isFinite` 类型守卫 + 归一化省略未定义字段;测试改展开类实例断言。已解决。

## 证据

- 门禁输出:655 tests / 653 pass / 0 fail / 2 skipped;`tsc --noEmit` 无输出;`git diff --check` 无输出
- commit:`5d5cff9`(feat engine)+ `0ebe0f4`(test)= 2 文件 +1309 行;`git status` 干净;未 merge 未 push

门禁: PASSED
结论: OK
