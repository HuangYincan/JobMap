# a-marker-core 汇报(2026-08-25)

## 实际改动

- `server/src/lib/map-engine/types.ts` → MapMarker 接口新增可选字段 `isAttached?(): boolean`(注释:厂商侧是否仍挂在地图/共享层上,被外部删除时 false;不支持探测的适配层可省略)。
- `server/src/lib/map-engine/amap/amap-engine.ts` → createMarker 包装新增 `isAttached`:探测走 `marker.getMap() != null`(AMap.Marker.getMap 语义);老 SDK 无 getMap 时省略该方法(探测不支持 → 控制器 sync 跳过)。
- `server/src/lib/map-engine/tencent/tencent-engine.ts` → 三路径:
  - createContentOverlay:直接暴露适配层既有 attached 标志(`isAttached: () => attached`,与 647 行 getMap 包装同源);
  - createSingleMarker:有 `raw.getMap` 时按厂商语义探测,否则省略;
  - createMultiMarker:`isAttached: () => this.multiAttached.has(id)`(共享 MultiMarker 场景适配层可判定的挂载状态)。
- `server/src/lib/map-engine/baidu/baidu-engine.ts` → BMarker 接口补 `getMap?()`;BaiduMapView 新增 `mountedMarkers` 挂载簿记(addOverlay 登记 / wrapper.remove 摘除);两条 createMarker 路径的包装新增 `isAttached`:厂商 getMap 可用则优先,否则回退挂载簿记。
- `server/src/lib/map-markers.ts` →
  - `setPOIs(pois, opts?: { replace?: boolean; retainIds?: Iterable<string> })`:默认行为(不传 opts)完全不变;`replace: true` 在 add/update 遍历完成后逐个 `removeMarker` 销毁「不在新列表、也不在 retainIds」的 id(removeMarker 同路径清理 markers/placed/poiById/markerStates/markerIconKinds 五簿记);retainIds 保留实例,隐藏与否由 setVisiblePOIs 决定。
  - 新增公有 `sync()`:单遍遍历 `markers`(含 placed 孤儿清理),凡 `marker.isAttached?.() === false` 按 poiById 原状态重建(addMarker 全量还原图标/位置/click/visibleIds/selected/highlighted);undefined(不支持探测)跳过;幂等、O(n)、isReady 门拒收地图销毁等场景静默返回;placed 中已脱挂的孤儿(簿记丢失场景)摘除失效引用。
  - 接口 POIMarkerController 同步加签名(带 JSDoc)。
- `server/tests/fixtures/amap-mock.mjs` → MockMarker 补 `mockDetach()`(模拟厂商侧外部移除:getMap → null);MockMap.createMarker 包装补 `isAttached: () => marker.getMap() !== null`。
- `server/tests/map-markers.test.mjs` → 新增:isAttached 契约在 mock 上的行为(挂载 true → mockDetach 后 false);isAttached 缺失(undefined)→ sync 跳过。契约门禁(.raw = 2 / 无 AMap 专属 API)保持通过。
- `server/tests/marker-visibility.test.mjs` → 新增 replace 模式 4 例:池外销毁、retainIds 保留(实例可再 show)、存量/选中/高亮状态保持(存量实例不重建)、默认 patch 模式不变(只增不删守卫)。
- `server/tests/marker-leak.test.mjs` → 新增 sync 4 例:外部移除(mockDetach)→ 重建且状态(位置/徽章/选中/可见集/click 回调)保持;幂等(全挂载零重建);placed 孤儿清理;已销毁地图/控制器上静默 no-op。既有「往返计数单调不减」等默认模式用例保持绿(未改一行既有用例)。

## 门禁结果

- `npm test`(server,全量):**1621 tests / 1619 pass / 0 fail / 2 skip**(2 skip 为既有预置;含本 WS 新增 11 例)
- `npm run typecheck`(server):通过(tsc --noEmit 零错误)
- `make docs-check`:通过(Documentation policy check passed)
- `git diff --check`:通过(零 whitespace 错误)

## 遇到的问题

- 无阻塞问题。三点实现裁决,供 boss 知悉:
  1. **isAttached 签名**:接口按 prompt 定为 `isAttached?(): boolean`;「探测失败 → undefined → sync 跳过」经**省略方法**实现(适配层无法探测时干脆不定义该方法,`marker.isAttached?.()` 天然 undefined),不引入 `boolean | undefined` 返回型,保持 prompt 签名原样。
  2. **TMap MultiMarker hidden ≠ detached 的语义边界**:MultiMarker 场景 `setVisible(false)` 走 setVisible 摘单 geometry → `multiAttached` 同步删除 → isAttached 为 false。sync() 会给「控制器自己隐藏的」marker 也重建(重建后按当前 visibleIds 立即重新隐藏,状态保持,语义正确),代价是 TMap 下隐藏 marker 的重复重建开销。属已知权衡,代码注释已说明;若消费方对 sync 高频调用可再加「隐藏中的 marker 不重建」优化(需 b-wiring 决策)。
  3. **Baidu 探测双路径**:优先厂商 `getMap`(有则用),无则回退适配层挂载簿记(mountedMarkers)。外部直碰裸 map.removeOverlay 的场景簿记不知情,属 best-effort(与 prompt「适配层自身可判定的挂载状态」一致)。

## 证据

- 定向测试:map-markers / marker-visibility / marker-leak 三文件 41 例全绿(node --test --test-reporter=dot,零 X)。
- 引擎回归:map-engine-{amap,tencent,baidu,lifecycle,selection,switch,coord} + city-cluster + icon-preflight 全绿。
- 全量门禁输出末尾:`ℹ tests 1621 / ℹ pass 1619 / ℹ fail 0 / ℹ cancelled 0 / ℹ skipped 2`。
- 契约门禁(源码)通过:map-markers.ts `.raw` 出现次数 = 2(未新增),无 AMap 专属 API 直调。
- 本 WS 提交 3 笔(分支 fix/poi-marker-autorestore,未 merge/push):
  - `4026819 feat(map-engine): MapMarker.isAttached mount probe (amap/tencent/baidu adapters)`
  - `1518cf8 feat(marker): setPOIs replace mode + retainIds; sync() integrity auto-restore`
  - `6b82479 test(marker): replace/sync heal cases + isAttached mock contract`

门禁: PASSED
结论: OK
