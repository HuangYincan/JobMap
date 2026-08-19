# ws-poi-vanish2 汇报(2026-08-20)

第三轮修复:createMap 初始相机改用 state(remount 恢复视野)+ settle 默认位置门控(不抢恢复镜头)。分支 `fix/map-remount-camera`,从 `1c4ab6d`(批次入库)切出,2 个 commit,未 merge 未 push。

## 实际改动

### commit c74ef17 — fix(map-shell): createMap 初始相机用 state,remount 恢复视野不回默认
- **server/src/lib/camera-center.ts(新增)** — 相机常量 + 纯函数单源:
  - `DEFAULT_MAP_CENTER = { lng: 120.15, lat: 30.27 } as const`、`DEFAULT_MAP_ZOOM = 13`、`DEFAULT_CENTER_NEAR_DEG = 0.1`
  - `isNearDefaultCenter(center)`:`|Δlng| < 0.1 && |Δlat| < 0.1`(≈11km);null/undefined → false
- **server/src/components/map-shell.tsx**:
  - :13 引入 `@/lib/camera-center`
  - :191 `const [zoom, setZoom] = useState(DEFAULT_MAP_ZOOM);`(原字面量 13)
  - :205 `const [mapCenter, setMapCenter] = useState<{ lng: number; lat: number }>({ ...DEFAULT_MAP_CENTER });`(原字面量 `{ lng: 120.15, lat: 30.27 }`)
  - :474 `mapCleanup = createMap(mapCenter, zoom);`(原 `createMap([120.15, 30.27], 13)`,带 remount 语义注释)
  - :477 createMap 签名 `center: { lng: number; lat: number }`(原 `[number, number]` tuple)
  - :486 AMap 构造 `center: [center.lng, center.lat]`(tuple 转换内聚到构造点)
- **server/tests/camera-center.test.mjs(新增)** — `isNearDefaultCenter` 纯函数单测:默认中心/半阈值偏移 → true;北京/上海/两倍阈值 → false;null/undefined → false

### commit 3cab133 — fix(map-shell): settle 仅默认位置时飞用户位置,不抢恢复镜头
- **server/src/components/map-shell.tsx :517-521** — settle 分支条件改写:
  `if (!userMovedMapRef.current)` → `if (!userMovedMapRef.current && isNearDefaultCenter(readLngLat(map.getCenter())))`
  - 判据取**实时相机中心**(`readLngLat` 归一 AMap LngLat),非闭包 state——「相机仍处默认位置」语义最贴切,且 geolocation 异步 resolve 期间不受 state 同步时序影响
- **server/tests/component-contracts.test.mjs** — Bug3 契约两条正则随新条件改写(:444-456);新增 settle 门控契约测试(:485-497)
- **server/tests/pending-fly-to.test.mjs :59-63** — settle 出口契约正则随新条件改写

## 阈值与实现方式说明
- 阈值 `DEFAULT_CENTER_NEAR_DEG = 0.1` 度(≈11km),常量 + 纯函数放 `server/src/lib/camera-center.ts`(独立单测文件可 import `.ts` 直测)。
- 语义矩阵:首载(相机=默认)→ settle 仍飞用户位置(原行为不变);remount 恢复的用户视野(非默认)→ settle 不抢镜头;手动移图(userMovedMapRef=true)→ 不飞(原语义,短路在距离判定**前**,上轮契约零改动)。
- 双门控顺序 `!userMovedMapRef.current && isNearDefaultCenter(...)`:ref 判定在前,与「只在 dragstart/zoomstart/flyTo 入口置位」契约完全兼容。

## 契约测试新增断言
- **createMap 不再字面量**:断言 `mapCleanup = createMap(mapCenter, zoom);`;`doesNotMatch /createMap\(\[120\.15, 30\.27\], 13\)/`;state 默认走常量(`useState(DEFAULT_MAP_ZOOM)`、`useState<{lng,lat}>({ ...DEFAULT_MAP_CENTER })`);签名收 `{ lng, lat }` 且 AMap 构造转 tuple。
- **settle 门控含距离条件**:断言 `!userMovedMapRef.current && isNearDefaultCenter(readLngLat(map.getCenter()))` + lib 中 `DEFAULT_MAP_CENTER`/`DEFAULT_MAP_ZOOM`/`DEFAULT_CENTER_NEAR_DEG`/`isNearDefaultCenter`/阈值比较式存在。
- **上轮契约保持**(未改断言,全量回归绿):userMovedMapRef 只在 dragstart/zoomstart/flyTo 入口置位(click/onMarkerClick 不置位、无 `= false`);handleLocate 失败块无 120.15/setZoom(13);distance 定位前剥离 effectiveFilters 且两处 pipeline 调用点都吃它。

## 遇到的问题
1. **createMap 闭包取值(任务点名验证)— 无坑,已确认**。effect `deps=[]` 但 fast refresh 时模块代码被替换 → 组件以新代码重渲染(hook state 保留)→ effect 以**新渲染的闭包**重放(根因实测的「createMap 重跑」正是这次重放)→ 闭包内 `mapCenter`/`zoom` = 当次渲染值 = 用户上次视野,首载与 remount 均成立。真正会踩坑的是「effect 因 deps 重跑但引用旧渲染闭包」的模式,此处不存在。settle 门控读 ref + 实时相机中心,同样无闭包过期问题。
2. **契约正则第一版笔误**:新契约断言 `useState<{...}>({ ...DEFAULT_MAP_CENTER })` 漏写 `>` 与 `{` 之间的 `(`(写成 `>{ {`),首跑挂 1 条断言;修正为 `>\(` 后全绿。属测试书写问题,非实现问题。
3. 测试数:基线 495(493/2)→ 本轮 +5(3 单测 + 2 契约)= node 报告 **502 tests / 500 pass / 0 fail / 2 skipped**(基数含合并批次带入的增量)。

## 证据
- commits:`c74ef17`(createMap 用 state)、`3cab133`(settle 门控);分支 `fix/map-remount-camera`,`git status` 干净,未 merge 未 push
- `npm test`:502 / 500 pass / 0 fail / 2 skipped;`npm run typecheck`、`make docs-check`、`git diff --check` 全过
- 修复语义复现序列(移动端):首点 pin → 详情按需编译 → fast refresh remount → `createMap(mapCenter, zoom)` 以保留 state 恢复相机(不回杭州默认)→ geolocation resolve → 相机非默认 → settle 不 setCenter/setZoom(15) → 镜头与 POI 不再消失

门禁: PASSED
结论: OK
