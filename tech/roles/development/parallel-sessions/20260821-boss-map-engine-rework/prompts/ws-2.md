# Workstream 2 — feature/poi-controller(map-markers 控制器引擎无关化)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-rw2`)内开发,不 merge、不 push、不碰主树。** 汇报写入 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine-rework/reports/ws-2.md`(末两行 token,见文末)。

## 背景(轮 1 已合并:MapMarker 契约已扩展 setZIndex/setVisible/on/off + icon)

`server/src/lib/map-markers.ts`(706 行)控制器是「非高德 POI 消失/泄漏」的元凶:
- `addMarker`(L460-467)把 `view.createMarker()` 返回的 **MapMarker 契约包装丢弃**,存 `wrapper.raw`(厂商裸实例)
- 此后所有变更以 **AMap 方法名**打裸实例(L473 `.on('click')`、L478/L525 `setzIndex` 小写、L480/L521 `setIcon`、L524 `setOffset(new Pixel)`、L537-561 `buildIcon` 用 `new this.amap.Icon/Size`、L592 `setPosition([lng,lat])` 数组、L617-619 `show()/hide()`、L432 `detachFromMap` 用 `setMap(null)`)
- 非 AMap 下 TypeError 被吞 → marker 不落图(TMap)/脱管泄漏(Baidu)

## 任务(核心:控制器全程持契约包装,禁碰 `raw`)

1. **`addMarker`(L460-467)**:存 `wrapper`(MapMarker 包装)进 `markers` Map / `placed` Set,**不再取 `wrapper.raw`**;`wrapper.raw` 仅保留给 `getMarkerByPOIId` 探针(如测试依赖,查证后定)。
2. **事件绑定(L473)**:改走契约——`wrapper.on?.('click', cb)`(轮 1 契约已加 on/off;若包装创建时已传 onClick 也可,以现状为准统一)。
3. **`applyStyle`(L506-527)**:全契约化——
   - `setzIndex` → `wrapper.setZIndex?.(z)`
   - `setIcon/buildIcon`(L480/L521/L537-561)→ 删除 `new this.amap.Icon/Size/Pixel` 全部构造;改经 `icon` 规格(`wrapper.raw` 的 icon 由创建时 `markerOpts.icon` 传入,`buildIcon` 改为产出 `{ src: dataUri, size: [w,h] }` 规格对象)——创建时传 icon 规格、选中/高亮换 icon 用 `wrapper.setIcon?.(规格)`(若契约有)或 setContent 语义,以轮 1 契约为准
   - `setOffset(new Pixel)` → **删除**(offset 已在创建时经 `markerOpts.offset` 传适配层;applyStyle 不再改 offset,或契约化 `wrapper.setOffset?.(...)`——以轮 1 契约现状为准)
   - `setContent` → `wrapper.setContent?.(...)`
4. **`detachFromMap`(L432)**:改 `marker.remove()`(三引擎都已实现;不再用 `setMap(null)`)
5. **`setPosition`(L592)**:`wrapper.setPosition({ lng, lat })` 对象形态(契约签名;不再传数组)
6. **`show()/hide()`(L617-619)**:`wrapper.setVisible?.(true/false)`
7. **`this.amap` 逃生舱**:删除(`resolveVendorNamespace` 消费方清空;确认无其他使用点)
8. **控制器簿记**:`markers` Map 存包装后,`getMarkerByPOIId` 等所有读取点同步(测试探针查证)
9. **测试同步**:`tests/map-markers.test.mjs`、`marker-leak.test.mjs`、`marker-visibility.test.mjs`、`pending-fly-to` 等——mock 的 view 返回包装形态;新增断言:控制器对三引擎语义一致(用 engine-mock 断言 setZIndex/setVisible/remove 被正确调用,不出现 AMap 专属方法名)

## 文件边界

- 只允许改:`server/src/lib/map-markers.ts`、`server/tests/map-markers.test.mjs`、`server/tests/marker-leak.test.mjs`、`server/tests/marker-visibility.test.mjs`、`server/tests/pending-fly-to.test.mjs`、`server/tests/fixtures/amap-mock.mjs`(view 包装形态,如需要)
- **不碰**:`map-shell.tsx`、三引擎实现、`types.ts`(轮 1 已定,只读)、`switch.ts`、`use-map-engine.ts`、`poi-service.ts`、`amap-api.ts`、`tech/`、`server/docs/`、数据文件

## 门禁

1. `cd /Users/acccan/dm-wt-rw2/server && npm test`(基线 1034 零漂移 + 新增)
2. `cd /Users/acccan/dm-wt-rw2/server && npm run typecheck`
3. `cd /Users/acccan/dm-wt-rw2 && make docs-check`(基线红如实报告)、`git diff --check`
4. 契约:grep 断言 map-markers.ts 不得出现 `wrapper.raw` 直操/AMap 专属 API(`setzIndex`/`setIcon(`/`new this.amap`/`\.show()|\.hide()` 直调裸实例/`setMap(null)`)——汇报给出 grep 证据
5. 小步 commit(Conventional Commits)

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-boss-map-engine-rework/reports/ws-2.md`:重构明细(改前→改后)、grep 契约证据、测试适配说明、门禁结果、commit 列表。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```