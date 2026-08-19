# ws2 汇报(2026-08-19)

## 失同步根因定位

浏览器症状(杭州↔上海往返后 2 个 HZ marker 残留,`getAllOverlays('marker')` 9 > catalog 7,
且残留 marker 不在控制器内部 markers Map 中)→ 三条失同步路径:

1. **已销毁地图上仍创建 marker(实锤,契约测试复现)**:`isReady()` 只查
   `destroyed && map && amap`,不查 `map.isDestroyed()`。map-shell unmount 时序中
   地图先于控制器销毁(地图创建 effect 注册早于 usePOIMap,cleanup 先跑),
   控制器对已销毁实例继续 flush → marker 注册进无人清理的 overlay 注册表,
   计数永久 > catalog。修前契约测试 `2 !== 0` 实锤。
2. **「marker 已注册、簿记丢失」泄漏类(与浏览器证据形态一致)**:`addMarker` 用
   `map:` 选项构造——`new AMap.Marker(markerOpts)` 一成功即注册到地图,而内部
   簿记(`markers.set`)在其后;构造后任一步抛错/簿记丢失 → setPOIs 差分无能力
   移除、destroy 的 clear() 只遍历内部表 → 永久残留,且任何活控制器都不认识它。
3. **异步 amap ready 竞态(use-poi-map.ts:127-171 时序)**:loadAMap pending 期间
   destroy/重建,`destroyed` 守卫已拦截(usePOIMap 生命周期审计为正确,未改);
   但「flush 落在已销毁地图」正是路径 1 的入口。mock 缺全局 `document` 导致
   非 immediate 路径 loadAMap 静默 reject,异步竞态用例全部假阳性——修复后
   才真正走到 flush,验证了重建竞态零泄漏。

## 实际改动

- `server/src/lib/map-markers.ts`(fix,commit 783f8d8)
  - `isReady()` 增加 `map.isDestroyed()` 守卫:已销毁地图上不再创建 marker
  - 新增 `placed` 兜底账:marker 一构造成功即入账;`destroy()` → `sweepPlaced()`
    凭 placed 摘除全部登记过的 overlay——即使内部 markers 表簿记丢失,不变式
    「销毁后地图无该控制器管理过的 overlay」仍成立
  - `addMarker` 异常安全:构造即失败直接返回不登记;绑定/样式异常立即摘除,
    消除「已注册但无簿记」的永久泄漏路径
  - `removeMarker`/`sweepPlaced` 统一走 `detachFromMap`(try/catch):
    单个 marker 摘除异常(如地图已销毁)不中断清扫循环
- `server/tests/fixtures/amap-mock.mjs` + `server/tests/marker-leak.test.mjs`
  (test,commit 8a07cf0;沿用中断前骨架,仅修复+补用例)
  - fixture 修复:documentMock 挂到 `globalThis.document`(amap-api 引用全局
    document),否则非 immediate 路径 ReferenceError 被 .catch 吞掉 → 异步
    竞态用例假阳性;uninstall 恢复
  - 新增契约用例:「簿记丢失兜底」(破坏内部 markers 表后 destroy 仍清零,
    复刻 9>7 残留形态)、「地图先销毁」(已注册 marker 由控制器 destroy
    摘除、已销毁地图拒收新 marker);移除重建竞态用例的 DEBUG log
- `server/src/components/map-shell.tsx`、`server/src/hooks/use-poi-map.ts`:
  **零改动**——审计后 marker 渲染调用点与控制器生命周期(127-171)正确,
  usePOIMap 的 `[map, accentColor]` deps + cleanup destroy + destroyed 守卫
  已覆盖重建竞态;泄漏全部收敛到控制器层,由上述修复关闭。

## 复现验证结果(契约断言,等价浏览器 getAllOverlays)

- marker-leak.test.mjs 9/9 通过:往返 diff 计数恒等(2→7→2→0)、destroy 清零、
  destroy 后重建零残留、异步 ready 竞态(销毁在就绪前/重建)+ 簿记丢失兜底
  清零 + 已销毁地图拒收/清零 + 往返×5 中途重建计数恒等 + 空列表清零
- repro-marker-leak.mjs(S1–S6 全部 6 个竞态场景,11 断言)ALL PASS:
  含 flush 竞态(S2/S4)、重建设色(S3)、已销毁 map(S5)、往返×5 中途重建(S6)
- 浏览器 Playwright 实机验证**未执行**:本 worker 会话无浏览器/Playwright
  工具可用(仅文件/终端);按续作附录「可依赖 marker-leak.test.mjs 断言」执行,
  由 mock 契约测试承载相同不变式(计数恒等于 catalog、销毁后无残留)。
  如需实机截图留档,建议 boss 派带浏览器工具的会话补跑
  (dev server :3000,杭州↔上海往返 ×2 后断言 marker 计数 == catalog 数)。

## 门禁结果

- npm test: **377 通过 / 0 失败 / 2 跳过**(修前 marker-leak 2 失败:重建竞态
  假阳性 + 已销毁地图守卫缺失;修后全绿)
- typecheck: 通过(tsc --noEmit 无错误)
- make docs-check: 通过
- git diff --check: 通过

## 遇到的问题

- 中断前骨架的 mock 非 immediate 路径从未真正触发(全局 document 缺失 →
  loadAMap 静默 reject)→ 修复 fixture 后才暴露/验证异步竞态路径;
  已处理,不影响既有测试
- 浏览器实机验证不可行(本会话无浏览器工具)→ 按附录降级为 mock 契约
  断言,报告已注明;需 boss 裁决是否另行补拍
- `tests/repro-marker-leak.mjs` 保持未跟踪(中断前状态,勿删),未纳入提交

## 证据

- `npm exec -- node --test tests/marker-leak.test.mjs` → tests 9, pass 9, fail 0
- `npm exec -- node tests/repro-marker-leak.mjs` → S1–S6 全部 PASS,ALL PASS
- 全量 `npm test` → tests 377, pass 375, fail 0, skipped 2
- commits: `783f8d8` fix(marker-leak) 控制器加固;`8a07cf0` test(marker-leak)
  契约测试 + mock 修复(分支 fix/marker-leak,未 merge 未 push)

门禁: PASSED
结论: OK
