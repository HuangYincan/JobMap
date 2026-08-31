# ws-d 汇报(2026-08-22)

## 实际改动(分支 fix/geolocation-blue-dot,基线 f9cdd1c,3 commits)

### commit 1 `528629b` fix(geolocation): 非 AMap 引擎经契约 createMarker 自绘用户定位蓝点

- `server/src/components/map-shell.tsx`(仅定位/蓝点段):
  - 新增 `USER_BLUE_DOT_ICON`:内联 SVG dataURL(22x22,`#007AFF` 实心圆点 +
    半透明精度晕圈 + 白心,对齐 AMap Geolocation 蓝点观感);`USER_BLUE_DOT_Z_INDEX
    = 200`(高于 POI marker 普通 10/20、高亮 80、选中 100,聚合徽章 50)
  - 新增 `syncUserBlueDot(view, lng, lat)`:非 AMap 引擎定位成功后经契约
    `view.createMarker({ position, icon: USER_BLUE_DOT_ICON, zIndex })` 创建蓝点;
    已有则 `marker.setPosition` 跟随更新;`view.engine.id === "amap"` 早退
    (AMap 蓝点仍由 amap-api Geolocation 控件渲染,零改动);视图已销毁门控
  - `createMap` 挂载定位 `.then` 内 `setUserLocation` 后调用 syncUserBlueDot;
    `createMap` cleanup 增加 `blueDotRef.current?.remove?.()` + 置空 ref
    (卸载/切引擎清理)
  - 更新三处 stale 注释(「无蓝点渲染,deferred」→ 自绘蓝点)
- `server/tests/map-shell-blue-dot.test.mjs`(新增,6 项源码契约断言,详见下)

### commit 2 `89dcf03` docs(geolocation): tech/23 回填(仅追加一节)

- `tech/23-map-engines.md` 追加「ws-d 回填:非 AMap 引擎用户定位蓝点」:
  实现(仅 map-shell 定位/蓝点段,引擎零改动)/锚点已知取舍/测试

### commit 3 `7c8032a` fix(geolocation): handleLocate 保持 locateForMap(mapInstance.current) 契约调用形

- `handleLocate` 蓝点同步与相机同源取 `mapInstance.current`(初版捕获局部 view
  破坏了既有 Bug3 契约测试 component-contracts 的
  `locateForMap(mapInstance.current)` 断言——调用点一律传当前视图,杜绝 amap
  控件塞给非 amap raw map 的崩溃根因)。门禁红 → 修正后全绿。

## 蓝点实现方案

- **dataURL 生成**:内联 SVG → dataURL(不新增素材文件);视觉与 AMap 蓝点一致
  (#007AFF 系圆点 + 精度晕圈 + 白心)。仓库 map-constants 的
  `USER_LOCATION_ICONS` 是旧主题色 #4A90E2 且不在本 WS 文件边界,故内联生成。
- **生命周期**:定位成功(挂载 settle / 定位按钮)→ createMarker 或 setPosition;
  卸载/切引擎 → createMap cleanup remove() + 置空 ref;StrictMode double-invoke
  与切引擎竞态经 `view.isDestroyed?.()` 门控不建点。
- **与 POI 共存**:蓝点是独立 marker(view.createMarker 直建,只记入 blueDotRef),
  不进 POI 控制器 → LOD zoom tier 摘挂/聚合摘单不感知、不误删(测试断言
  map-markers 零处 blueDot)。
- **锚点取舍**:不传 contract offset——各引擎 icon 锚点像素语义由引擎适配层负责
  (TMap 锚点归 ws-a 的 bug 1 域),契约层不跨引擎猜 offset。TMap 默认锚点
  (底边中点)下圆点中心约高于定位点 size/2 px,已记入 tech/23 作为已知取舍。

## 门禁结果

- npm test: **1275 总计 / 1273 通过 / 0 失败**(2 skip;基线 1267 通过零漂移 +
  新增 6 项)
- typecheck: 通过
- docs-check: 通过;git diff --check: 通过

## 测试(新增 6 项,map-shell 为 TSX 无法 import → 沿用仓库源码契约断言风格,
等价 mock 断言)

1. 蓝点图标资产:解码 dataURL 断言 SVG 结构(#007AFF 圆点/晕圈/白心/22x22,
   非旧 #4A90E2)
2. 契约调用:createMarker(position + icon: USER_BLUE_DOT_ICON + zIndex 200)在
   amap 门控之后;zIndex 200 > POI 最高 100(mock 断言「非 AMap 定位后创建蓝点
   marker,icon src 为 dataURL」)
3. 生命周期:已有蓝点 setPosition;cleanup remove + 置空 ref;已销毁视图不建点
4. 接线:挂载 settle 与 handleLocate 都同步蓝点(先蓝点后移相机)
5. AMap 路径零变化:locateForMap 分派不变(getCurrentPosition(view.raw) 唯一)、
   amap 早退前无 createMarker、amap-api.ts 仍为 Geolocation 控件路径
6. 共存隔离:syncUserBlueDot 不经 POI 控制器(无 usePOIMap/addMarker);
   map-markers.ts 零处 blueDot(LOD/聚合不误删)

## 遇到的问题

1. **既有契约测试冲突**:初版 handleLocate 捕获局部 view 调 locateForMap(view),
   component-contracts「map shell Bug3 locate」断言 `locateForMap(mapInstance.current)`
   失败 → 改为与相机同源取 mapInstance.current,契约保持,门禁全绿。
2. **锚点偏移无法在本 WS 消除**:TMap 默认 icon 锚点(底边中点)使圆点中心略高于
   定位点(约 size/2 px)。引擎锚点语义归 ws-a(腾讯)引擎层修复域,契约层不猜
   offset;已记入 tech/23 取舍,如需精确居中由 ws-a 锚点修复统一处理。

## 证据

- `node --test tests/map-shell-blue-dot.test.mjs` → 6/6 通过
- 全量 `npm test` → 1273 pass / 0 fail
- 未改动文件验证:`git diff f9cdd1c..HEAD --stat` 仅 3 个拥有文件
  (map-shell.tsx / map-shell-blue-dot.test.mjs / tech/23-map-engines.md)

门禁: PASSED
结论: OK
