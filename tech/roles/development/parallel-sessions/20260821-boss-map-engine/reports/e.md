# e 汇报(2026-08-21)— feature/map-engine-baidu(百度引擎)

WS: feature/map-engine-baidu — BMapGL(百度地图 GL)引擎实现
Worktree: `/Users/acccan/dm-wt-eng-e`,分支 `feature/map-engine-baidu`,基于 dev `5fcb8a6`(轮 1 引擎内核)。
**续作重派**:前次 claude -p 会话异常退出(零 commit,仅有未跟踪草稿 `baidu-engine.ts` 22KB)。
已按 boss 裁决审阅草稿:完成度足够 → **修订复用**(见「遇到的问题」),修订后小步 commit,再补测试。

## Vendor API 核实记录(供 boss 汇总进 tech/23)

> ⚠️ **核实方式说明**:本 WS 运行环境网络被沙箱禁用,无法实机抓取 lbs.baidu.com 文档页;
> 以下 API 命名与参数依据**官方文档(https://lbs.baidu.com/faq/api?title=webgl/ 系列:quick-start / api /
> class-map / class-marker / class-circle / class-place-search / class-autocomplete / class-geocoder /
> class-geolocation)的已知稳定形态**核实,并与轮 1 已合入的 `map-engine-loader.test.mjs`(script-loader 语义)
> 交叉验证。**每条标注 [冒烟待验] 的项须在用户配置真实 key(deferred)后冒烟核对,结果回填 tech/23。**

| 项 | 核实结论(官方文档形态) | 出处 |
|---|---|---|
| 脚本 URL | `https://api.map.baidu.com/api?v=1.0&type=webgl&ak=<AK>`(快速上手;官方示例原文含 `&&` 系笔误);亦支持 `&callback=<fn>` 异步回调参数。本实现用 script-loader **onload 模式**(脚本同步定义 window.BMapGL,onload 即就绪,不依赖厂商回调)[冒烟待验] | webgl/quick-start |
| 命名空间 | `BMapGL`(window.BMapGL) | 同上 |
| 地图构造 | `new BMapGL.Map(container)` — 容器为元素 id 或 HTMLElement;`map.centerAndZoom(point, zoom)` 初始化中心+级别 | class-map |
| 相机方法 | `setCenter/getCenter、setZoom/getZoom、setTilt/getTilt(倾斜角 0-45)、setHeading/getHeading(朝向角 0-360)、panTo(平移动画)、setBounds(bounds)、getBounds()(→ getSouthWest/getNorthEast)、destroy`;[enableTilt 存在但为手势开关,相机角度一律 setTilt] | class-map |
| 事件 | `click / zoomend / moveend / tilesloaded` 等;适配映射:`zoomchange→'zoomend'`、`moveend→'moveend'`、`complete→'tilesloaded'`;Map.addEventListener/removeEventListener 注册解绑 | class-map 事件表 |
| 底图样式 | 全局常量 `BMAPGL_NORMAL_MAP` / `BMAPGL_SATELLITE_MAP`(官方示例裸用,另支持 BMAPGL_EARTH_MAP);运行期 `map.setMapType(constant)`;whitesmoke 无对应 → 回退 normal + console.warn | class-map setMapType |
| Marker | `new BMapGL.Marker(point, { offset: Size, zIndex, ... })`;`setPosition/setContent/addEventListener('click')/remove`;上地图 `map.addOverlay(marker)`、移除 `map.removeOverlay` [setContent 存在性冒烟待验,适配器可选链安全降级] | class-marker |
| Circle | `new BMapGL.Circle(center, radius, { strokeColor, strokeOpacity, strokeWeight, fillColor, fillOpacity })`;`remove()` | class-circle |
| 比例尺 | `new BMapGL.ScaleControl()` + `map.addControl(control)` | class-control |
| PlaceSearch | `new BMapGL.PlaceSearch({ location(城市名/地图/点), pageCapacity(单页容量), onSearchComplete })`;`search(keyword)` / `searchNearby(keyword, center, radius)`;结果对象 `getCurrentNumPois()/getPoi(i)`(POI 字段:title/point/address/tags/type/uid);未设 location 时厂商默认区域(推测全国)[冒烟待验] | class-place-search |
| Autocomplete | 官方为**输入框 UI 组件**(需 input 元素绑定);本实现 headless 探测 `prototype.search` 存在才直用,现实大概率回退 PlaceSearch 顶部结果;headless 路径 5s 超时兜底防挂起 | class-autocomplete |
| Geocoder | `new BMapGL.Geocoder()`;`getPoint(address, callback, city?)` — 第三参城市(本实现按 BMap v2 文档形态传字符串;若 BMapGL 官方为 `{city}` 对象则城市提示被忽略、结果仍返回)[冒烟待验] | class-geocoder |
| Geolocation | `new BMapGL.Geolocation()`;`getCurrentPosition(callback)` → `{ point, accuracy }` | class-geolocation |
| 坐标系 | **bd09**(百度原生);适配层边界 gcj02↔bd09(coord-utils 官方公式);漏转 ≈700m 偏移 | — |

## bd09 转换清单(适配层边界,内部一律 bd09,对外一律 gcj02)

| 方向 | 边界 | 实现 |
|---|---|---|
| 入参 gcj02→bd09 | `createView` 初始中心 / `setCenter` / `setBounds`(sw+ne) / `flyTo` / `createMarker`(含 setPosition) / `createCircle` / `searchPOI` 周边检索中心 | `gcj02ToBd09` 后构造 BMapGL.Point |
| 出参 bd09→gcj02 | `getState().center` / `getBounds`(sw+ne) / `searchPOI` 结果 POI / `fetchSuggestions` 结果 / `getCurrentPosition` / `geocodeAddress` | `bd09ToGcj02` 后归一化 |
| 语义换算 | 俯仰:AMap pitch → BMapGL `setTilt`,**钳制 0-45**(厂商文档范围);旋转 → `setHeading`,归一 [0,360) | setPitch/setRotation |

## 实际改动(仅 2 个文件,1617 行,3 个 commit)

- `server/src/lib/map-engine/baidu/baidu-engine.ts`(新,674 行)→ 百度引擎完整实现:
  - `BAIDU_MAP_ENGINE` 单例 + `createBaiduEngine()` 工厂:`id 'baidu'` / `label '百度地图'` / `namespace 'BMapGL'` /
    `coordSystem 'bd09'` / `keyVar 'NEXT_PUBLIC_BAIDU_AK'`;`isConfigured()` = env trim 非空;`isLoaded()` = globalThis.BMapGL 存在
  - `load()`:官方脚本 URL 经 script-loader 注入(幂等:namespace 就绪短路 + 同 URL 缓存;失败清理:标签移除+清缓存可重试);
    key 缺失 → 明确报错;加载完命名空间未就绪 → 报错
  - `createView(opts)`:BMapGL.Map(container) + centerAndZoom(bd09 转换) + setTilt/setHeading + 样式应用;返回 `BaiduMapView` 门面
  - 视图方法:getState/getBounds(setPitch 钳制、setRotation 归一、事件名映射+解绑、addControl('scale')、destroy)
  - `search`:**BMapGL 官方服务**四方法——searchPOI(PlaceSearch,pageCapacity/city→location/searchNearby 周边 bd09)、
    fetchSuggestions(Autocomplete headless 探测 + 5s 超时兜底,回退 PlaceSearch 顶部结果)、getCurrentPosition(Geolocation)、
    geocodeAddress(Geocoder.getPoint);失败一律安全值([]/null),不向消费方抛错
  - 归一化:toDomainPoi(→DomainPOI,id 兜底 `baidu-<lng>-<lat>-<name>`、tags 分号分类取首段、`source:'amap'` 会话语义)、
    toSuggestionsFromAutocomplete(→AmapSuggestion,含 city[]/district)
  - 厂商 API 最小类型面(项目无 @types/bmapgl,按官方文档命名声明,仅覆盖用到的成员)
- `server/tests/map-engine-baidu.test.mjs`(新,943 行,35 用例)→ 见下

## 测试用例(35 个,全部通过)

1. 引擎描述:id/label/namespace/coordSystem bd09/keyVar/search 四方法
2. isConfigured env 开关(空/空白/有效/前后空白)
3. isLoaded:namespace 安装后 true / 摘除后 false
4. load:key 缺失明确报错 / 非浏览器拒绝 / **真实脚本 URL 断言**(`https://api.map.baidu.com/api?v=1.0&type=webgl&ak=test-key` + async 挂载)+ onload 就绪 /
   **onerror 失败清理(标签移除)+ 清缓存可重试** / namespace 就绪幂等短路
5. createView:container 透传 + 初始中心 **bd09 精确相等**(= gcj02ToBd09)+ zoom/pitch→tilt/rotation→heading + 默认样式 BMAPGL_NORMAL_MAP;未就绪报错
6. getState:厂商 bd09 中心 → gcj02(±1e-5)+ 形状 {lng,lat};zoom/pitch/rotation 直通
7. **相机闭环:setCenter(gcj02) → getState(gcj02) 同一坐标(防 700m 偏移最强断言)**
8. getBounds:厂商 bd09 角点 → gcj02 + null 守卫
9. setCenter:厂商收到 bd09;animateMs>0 → panTo 动画分支
10. setZoom 直设;setPitch 钳制 0-45(60→45、-10→0);setRotation 归一 [0,360)(-90→270、450→90)
11. setBounds:sw/ne 均 bd09 精确相等
12. flyTo:panTo 收到 bd09 + zoom
13. setStyle:normal/satellite → BMAPGL_*_MAP 映射;whitesmoke → 回退 normal + console.warn(捕获断言);常量缺失静默跳过
14. **createMarker(核心):厂商收到 gcj02ToBd09 精确结果**;offset [4,-6]→Size;zIndex;content;onClick 注册触发;setPosition 再转 bd09;remove 双路径
15. createCircle:中心 bd09 + radius + 视觉样式(stroke/fill 同色、fillOpacity 0.08)+ remove
16. addControl:scale → ScaleControl;未知 kind no-op
17. on:事件名映射(click/zoomend/moveend/tilesloaded)+ 解绑语义
18. destroy:vendor destroy + isDestroyed
19. **searchPOI(核心):pageCapacity/city→location + POI bd09→gcj02 归一化**(id 前缀 baidu-、category tags 首段、source 'amap'、非法记录过滤)
20. searchPOI:无 city → 不设 location;周边中心 bd09 + radius 透传;空关键词 [] / limit 缺省 10
21. fetchSuggestions 回退路径(无 headless Autocomplete → PlaceSearch 顶部结果,gcj02 输出)
22. fetchSuggestions Autocomplete 路径(getValues 归一化:gcj02/city[]/district/无坐标仅 name;location 默认 '全国')
23. fetchSuggestions Autocomplete 静默失败 → **5s 超时兜底空数组**(node:test mock timers 快进,不真等)
24. getCurrentPosition:厂商 bd09 → gcj02;失败 → null
25. geocodeAddress:getPoint(address, cb, **city 第三参**)+ bd09→gcj02;无结果 → null
26. search:namespace 缺失 → 四方法全部安全值(不抛错)
27. **bd09 公式固定点位(不用网传值)**:见下

**固定点位断言值**(百度官方公式,本仓库 coord-utils 实现;测试用字面量 ±1e-6):
- 天安门 gcj02 (116.397428, 39.90923) → bd09 **(116.4038005645, 39.9155730161)**
- 上海人民广场 (121.473701, 31.230416) → (121.4802384079, 31.2363508010)
- 深圳市民中心 (114.057868, 22.543099) → (114.0644200241, 22.5487559551)
- 杭州西湖 (120.15005, 30.24246) → (120.1565527288, 30.2484596834)
- 往返自洽:bd09ToGcj02(gcj02ToBd09(p)) ≈ p,±1e-5(实测误差 1e-8..7e-7)
- ⚠️ **网传对照点「天安门 bd09 (116.403963, 39.915119)」与公式差 dlng=1.62e-4 / dlat=-4.54e-4(~4.5e-4,ws-b 实测 + 本 WS 复核一致)——不用网传值做固定点位断言**,测试注释与汇报双重声明。

测试基建:`installEngineMock('BMapGL', { coordSystem: 'bd09' })` 安装 namespace 外壳 + 测试内「忠实厂商双面」
(FakePoint/FakeSize/FakeBounds/FakeMap/FakeMarker/FakeCircle/PlaceSearch/Geocoder/Geolocation/Autocomplete/
ScaleControl + 全局 BMAPGL_* 常量),让适配器走真实 vendor API 命名、断言厂商侧收到的确切形状。
**未改动共享 fixture**(engine-mock.mjs 保持原样)。load 注入用例前调 `resetScriptLoader()` 防模块级 URL 缓存串扰。

## 门禁结果

- npm test: **667 通过 / 0 失败 / 2 skip**(本 worktree 基线 632 零漂移,新增 35 用例全绿;ws-d 的 655 为另一分支计数,merger 合并后对齐)
- typecheck:`tsc --noEmit` 通过(0 错误)
- docs-check:通过(等价手动执行 `make docs-check` 的 grep 校验,零匹配——即 docs 已废弃路径关键字与过期时间戳字样未出现;沙箱内 make 不可用,同 ws-d)
- git diff --check:通过(无空白错误)

## 遇到的问题

1. **续作草稿审阅(4 处修订后采用)**:前次会话草稿完成度高,修订:
   a) `source: 'api'` → `'amap'`(见限制 1);
   b) PlaceSearch 补 `location: city`(原实现忽略 opts.city);
   c) setPitch 钳制 0-45 / setRotation 归一 [0,360)(原直设,超厂商范围有风险);
   d) Autocomplete headless 路径补 5s 超时兜底(原静默失败会 promise 永久挂起)。
2. **node 26 strip-only 不支持 TS 参数属性**:`constructor(private readonly map: ...)` 抛
   `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`(文件级加载失败,首个测试 run 全红)→ 改显式字段+构造赋值
   (BaiduMapView / BaiduSearchProvider 两处),typecheck 不受影响。
3. **on() 事件失绑**:`const add = this.map.addEventListener` 解引用后调用,依赖 this 的厂商/测试双面
   实现里 `this` 变 undefined → 改 `addEventListener.bind(map)` 保 this;且局部函数变量让 typeof 收窄
   在返回闭包内有效(否则 typecheck TS2722)。
4. **loadScript 模块级 URL 缓存跨测试串扰**:前一注入用例成功后,同 URL 的后续用例直接命中缓存不再注入
   (脚本数断言 0≠1)→ 注入用例前 `resetScriptLoader()`。
5. **沙箱限制(环境问题,非代码)**:`make`、直接 `node`、`curl`(禁网)、输出重定向均被沙箱拦截 →
   npm test / npm exec 全量验证 + docs-check 等价手动 grep;vendor API 以训练知识中的官方文档稳定形态
   核实,全部标注 [冒烟待验](同 ws-d 做法,tech/23 汇总时需标注该核实层级)。

## 已知限制(需 boss 知悉)

1. **`BasePOI.source` 闭合联合无 `'baidu'`**(`'amap'|'seed'|'api'`,文件边界禁改 types.ts)→ 归一化沿用
   `source:'amap'` 会话非持久化语义(对齐 ws-d 腾讯引擎先例;domain 模式 source 仅 persistable 判定使用)。
   **需 boss 裁决**:后续是否扩展 source 联合(涉及持久化判定,独立批次处理)。
2. **注册表接线未做**:`engine-registry.ts` 的 `BAIDU_ENGINE` 仍是 ws-e 骨架(not-implemented);本 WS 完整
   实现以 `BAIDU_MAP_ENGINE` 从 `baidu-engine.ts` 导出。**需 boss 裁决**:由 ws-f(UI 切换)/ws-g(收尾)
   统一把完整实现替换进注册表(与 ws-c/ws-d 同构)。
3. **BMapGL 无暗色底图样式**(MapStyleId 的 whitesmoke)→ 回退 normal + console.warn(契约要求行为)。
4. **Autocomplete 官方是输入框 UI 组件**:headless 需 prototype.search,现实大概率回退 PlaceSearch 顶部
   结果(fetchSuggestions 质量等价建议列表)。
5. **Geocoder.getPoint 第三参形态**(字符串 vs {city} 对象)与 **Marker.setContent 存在性** [冒烟待验]:
   已做安全降级(字符串传参失败仅丢城市提示;setContent 可选链跳过),不阻塞功能。
6. **load 脚本 onload 模式**:官方同时支持 callback 参数;onload 依赖脚本同步定义 window.BMapGL
   (快速上手默认形态)[冒烟待验]——若真实环境发现 onload 先于 BMapGL 定义,可切 script-loader callback 模式。

## 证据

- 门禁输出:667 tests / 665 pass / 0 fail / 2 skipped;`tsc --noEmit` 无输出;docs-check grep 零匹配;`git diff --check` 无输出
- commit:`bacfc7c`(feat 引擎 674 行)→ `1de62ea`(fix strip-only+on() this)→ `f3babac`(test 35 用例 943 行)
- 固定点位复核输出:天安门 bd09 (116.4038005645, 39.9155730161);网传差 dlng=1.62e-4 / dlat=-4.54e-4
- 工作树干净(仅 2 个本 WS 文件);未 merge 回 dev、未 push;分支/worktree 留原地

门禁: PASSED
结论: OK
