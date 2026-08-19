# WS: ws-poi-vanish — 首点点击后定位相机不被抑制 + handleLocate 失败不回默认中心

## 背景(用户报告 bug,Explore 根因已定位)

**症状**:第一次点击公司 POI → 地图先回默认初始化位置(杭州 [120.15,30.27],非用户定位位置)→ 所有 POI 消失。

**根因(带 file:line,均为 /Users/acccan/dm-wt-poi-vanish 内)**:

1. **主根因**:geolocation settle 的相机移动受 `hasInteractedRef` 门控(map-shell.tsx:512 附近)。首点 pin 点击置 `hasInteractedRef.current = true`(onMarkerClick,1471 附近;map 空白点击 682 附近也置位)→ geolocation 8s 超时窗口内 settle 时 `if (!hasInteractedRef.current)` 为 false → `map.setCenter(用户位置)+setZoom(15)`(513-514)被跳过 → **相机永久停在 createMap 默认中心 [120.15,30.27] zoom 13**(467 附近)。
2. **POI 消失**:`distanceOrigin = mapCenter`(985 附近,mapCenter 初始 state = 杭州 202 附近);若会话缓存(use-mode-cache-restore 还原 filters)带 distance 筛选,`runPOIPipeline(catalog, {center: distanceOrigin, filters})`(1170-1183)以杭州为圆心重滤 → 用户区域 pin 掉出 visiblePOIIds(1276-1289)→ usePOIMap 的 [visiblePOIs] effect → `marker.hide()`(map-markers.ts:617-632)→ 所有 POI 隐藏。
3. **次要**:`handleLocate`(定位按钮)定位失败兜底 `setCenter([120.15,30.27])+setZoom(13)`(1696-1697、1707-1708)→ 相机被精确拉回默认位置。用户点「pin」落在覆盖地图的定位按钮上时触发。

**目标行为**:
- 首点点击 pin **不应**抑制 geolocation settle 后的相机跟随(用户点击选择公司 ≠ 放弃定位;只有用户手动操作相机后才不应被拉走)。
- handleLocate 失败时**保持当前视野**,不跳回杭州默认中心(失败 = 不打扰,顶多 toast/提示)。
- distance 筛选的圆心在 geolocation 未 settle 前不落在错误的杭州默认中心上(跟随用户位置或暂缓生效),保证 POI 池不因圆心错误而消失。

## 任务(绝对路径,worktree: /Users/acccan/dm-wt-poi-vanish)

1. **修主根因(map-shell.tsx)**:重新设计 geolocation settle 相机移动的门控——首点 pin 点击/列表点击不再置「抑制定位」位;只有**用户手动移动/缩放相机**(map 的拖拽/滚轮/手势,或明确的相机操作路径)才置位。具体:
   - 排查 `hasInteractedRef` 的所有读写点,确认它的其他用途(勿破坏选中高亮、ignoreNextMapClick 等既有语义);若它同时承担「抑制定位」与「区分首次交互」两种职责,拆成两个标志(如 `hasInteractedRef` 保留交互语义 + 新增 `userMovedMapRef` 仅由相机手势置位)。
   - geolocation settle 分支的门控改为:未手动移动过相机 → 飞用户位置;手动移动过 → 不飞。
   - 若用户刷新后从未交互、geolocation 先 settle——行为不变(飞用户位置)。
2. **修 handleLocate 失败兜底**:定位失败/超时时**不再** setCenter/setZoom 回杭州;保持当前视野,可选提示(不新增 UI,注释说明即可,或复用现有 toast 通道——若无则只保持不动)。
3. **修 distance 圆心(map-shell.tsx)**:`distanceOrigin`/distance 筛选生效时机——geolocation 未 settle 且 mapCenter 还是默认值时,带 distance 的缓存恢复不应以杭州为圆心把全池过滤掉。合理方案任选(worker 自裁):
   - geolocation settle 前 distance 筛选不生效(视同无 distance),settle 后以用户位置为圆心;或
   - distanceOrigin 跟随最新已知用户位置而非 mapCenter 初始值。
   - 要求:修复后刷新 + 带 distance 缓存 + 首点场景下,用户区域 POI 可见。
4. **契约测试**(server/tests/ 下现有文件风格,静态正则 + 纯函数优先):
   - 锁定「geolocation settle 相机移动不再被 pin 点击抑制」(门控条件里无 hasInteractedRef,或用户移动标志只在相机手势路径置位)
   - 锁定「handleLocate 失败分支不再 setCenter([120.15,30.27])/setZoom(13)」
   - 锁定 distance 圆心修复的关键分支
   - 现有测试(基线 495/493/2)不许 fail。
5. **不改**:UI 设计/视觉、聚合徽章行为、城市中心数据、其他文件无谓重构。若发现根因分析有误(比如 hasInteractedRef 还有关键用途使上述方案不可行),报告里说明并给出替代方案,不要硬改。

## 文件边界
server/src/components/map-shell.tsx(主)、server/src/lib/amap-api.ts(仅当 getCurrentPosition 需配合)、server/tests/*(契约测试)。
**不碰**:use-saved-layer、use-work-viewport、city-cluster、路由/API、文档(除非门禁要求)。

## 门禁(必须全绿)
```bash
cd /Users/acccan/dm-wt-poi-vanish && make docs-check
cd /Users/acccan/dm-wt-poi-vanish/server && npm test
cd /Users/acccan/dm-wt-poi-vanish/server && npm run typecheck
cd /Users/acccan/dm-wt-poi-vanish && git diff --check
```

## 提交
小步 Conventional Commits,如 `fix(map-shell): 首点点击不再抑制 geolocation 相机跟随` / `fix(map-shell): handleLocate 失败保持视野不回默认中心` / `fix(map-shell): distance 圆心在定位前不落杭州默认值`。

## 回报
写 /Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260820-boss-poi-vanish/reports/ws-poi-vanish.md:
- 每个 commit 摘要 + 改动点(file:line)
- hasInteractedRef 排查结论(是否拆分标志)
- 契约测试新增断言
- 遇到的问题(如有)
末两行必须精确:
```
门禁: PASSED
结论: OK
```
