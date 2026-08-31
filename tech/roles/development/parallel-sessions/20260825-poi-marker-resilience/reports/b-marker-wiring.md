# b-marker-wiring 汇报(2026-08-25)

## 实际改动

- `server/src/hooks/use-poi-map.ts`
  - `UsePOIMapOptions` 新增 `replacePOIsOnSync?: boolean`(默认 false)、`retainPOIIds?: Iterable<string> | null`(默认 null);
  - `applySync` 改为一次带 opts 调用 `controller.setPOIs(pois, { replace: opts.replacePOIsOnSync ?? false, retainIds: opts.retainPOIIds ?? [] })`;顺序保持 setPOIs → setVisiblePOIs → select/deselect → highlight/unhighlight;
  - `applySync` 末尾追加 `controller.sync()`(每次同步顺带完整性补回,幂等 O(n));
  - 创建控制器的 effect 内挂 view 契约事件触发:`view.on('moveend'/'zoomchange') → controller.sync()`(无状态变化时的自动补回);cleanup 先解绑再 destroy,销毁后不再触发。
- `server/src/components/map-shell.tsx`
  - cluster effect 依赖 `[clusterState, mapReady, modeConfig.color]` → 追加 `engineView`(bug 4 修复:切引擎后徽章在新 view 重建);effect body 保持 `mapInstance.current`(视图接线 effect 同 commit 声明序先行,已销毁视图置 null 跳过,行为一致);
  - `usePOIMap` 调用点:domain 模式传 `replacePOIsOnSync: true` + `retainPOIIds: lastOverlayIdsRef.current`(视口替换语义:池外 id 销毁,旧视口不累积);work 模式不传(默认 false,workMarkerPois 语义不变);
  - 新增 `lastOverlayIdsRef`(useRef<string[]>)记录**最近一次已知收藏 overlay id**:savedOverlay 关闭/未登录时仍保留,收藏层 marker 实例在 replace 下不销毁(「秒恢复零重查」语义保持,:1500/:1509-1510);
  - 可见性注释更新:池外 id 在 replace 语义下销毁,retainIds(收藏 overlay)除外;LOD/聚合/个体 pin 仍在池内不受影响;visiblePOIIds/mutexVisibleIds 只切 show/hide,与 replace 组合无回归。
- `tech/23-map-engines.md`
  - bug 4 小节「⚠ 遗留(需 boss 裁决)」→「✅ 已修复(2026-08-25 ws-b)」:cluster effect 依赖加 engineView,切引擎后徽章在新 view 重建;保留「MapShell 主链路不传 replayController(usePOIMap 随 view 重建 + applySync 末尾 sync() 补回覆盖)」现状说明;小节标题去除「遗留」字样。
- `server/tests/hooks-contracts.test.mjs`(+2 例)
  - applySync 内含 `setPOIs(pois, { replace, retainIds })` 一次带 opts 调用(replace 键默认 false / retainIds 键默认 []);选项契约声明 `replacePOIsOnSync?: boolean` / `retainPOIIds?: Iterable<string> | null`;
  - 顺序断言:setPOIs → setVisiblePOIs → … → sync(末尾);视图事件 `view.on('moveend'/'zoomchange')` 触发 sync + cleanup `offMove()/offZoom()/controller.destroy()`;
  - map-shell domain 接线断言:`...(canonicalMode(mode) === "domain" ? { replacePOIsOnSync: true, retainPOIIds: lastOverlayIdsRef.current } : {})` + `lastOverlayIdsRef` 声明与更新行。
- `server/tests/component-contracts.test.mjs`(+1 例)
  - cluster effect 依赖数组含 engineView 断言 + effect body 读 mapInstance.current 断言。

## 门禁结果

- `npm test`(server 全量):**1614 tests / 1612 pass / 0 fail / 2 skip**(基线 1610/1608,+4 新例,2 skip 为既有预置)
- `npm run typecheck`(server):**失败** —— 4 个错误,全部为 a-marker-core 契约符号(见「遇到的问题」1):
  - `use-poi-map.ts(66,28)`: Expected 1 arguments, but got 2(`setPOIs(pois, {…opts})` 二参调用)
  - `use-poi-map.ts(76/151/154,14/18)`: Property 'sync' does not exist on type 'POIMarkerController'(applySync 末尾 + moveend/zoomchange 两处触发)
- `make docs-check`:通过(Documentation policy check passed)
- `git diff --check`:通过(零 whitespace 错误)
- 契约核对(只读,未碰 a 侧文件):a 的实际提交 `6b82479`(`git diff 3021da3..fix/poi-marker-autorestore`)中接口与类签名 = `setPOIs(pois: POI[], opts?: { replace?: boolean; retainIds?: Iterable<string> }): void` + 公有 `sync(): void` —— 与本分支消费方调用**逐字一致**;a 自身门禁全绿(1621 tests pass / typecheck / docs-check)。

## 遇到的问题

1. **typecheck 红 = a-marker-core 未合并,非本分支缺陷**(boss prompt 预授权路径:「未合并则按上述契约签名实现(消费方写法不变)」)。a 的 3 笔提交(4026819/1518cf8/6b82479)已存在于共享仓库分支 `fix/poi-marker-autorestore`(dev 未前进,仍 3021da3),我按既定契约实现并逐签名核对无误。**建议 boss**:合并 a→dev 后,对 b 分支 `git merge dev` 再跑 typecheck 即转绿(两 WS 文件零交集,无冲突预期)。
2. **a 侧裁决点 2 与本 WS 的交互**:a 报告指出 TMap MultiMarker 场景 setVisible(false) = 摘脱 → isAttached=false → sync() 会给「控制器自己隐藏的」marker 重建(重建后按当前 visibleIds 立即重新隐藏,状态保持,代价是重复重建开销)。本 WS 的视图事件触发(moveend/zoomchange)会周期性调 sync,在 TMap + LOD 隐藏 marker 场景有额外重建开销(AMap 隐藏=show/hide,isAttached 恒真,sync 零重建)。属已知权衡,未在消费侧另加过滤(需改 map-markers.ts,a 侧「隐藏中的 marker 不重建」优化留待后续决策,boss 知悉即可)。
3. 无其他阻塞。

## 证据

- 全量测试:`ℹ tests 1614 / ℹ pass 1612 / ℹ fail 0 / ℹ cancelled 0 / ℹ skipped 2`(两次运行一致)
- typecheck 4 错全文见上(每错均指向 a 侧契约符号)
- 本分支提交 6 笔(worktree `/Users/acccan/dm-wt-b-marker-wiring`,分支 fix/poi-marker-wiring,未 merge/未 push):
  - `837e9a9 feat(poi-map): applySync 带 replace/retainIds opts + 末尾 sync() 完整性补回`
  - `7db836b feat(map-shell): cluster effect 依赖加 engineView + domain replace 接线`
  - `cda6f04 test(poi-map): applySync replace/retainIds/sync 契约断言 + cluster effect engineView 依赖`
  - `1f9bc64 docs(map-engines): bug 4 遗留(聚合徽章切引擎不重建)标记已修复`
  - `8dbf3ca docs(map-engines): bug 4 小节标题去除已修复的「遗留」字样`
  - `83155b9 docs(map-shell): cluster 注释去除硬编码行号引用`

门禁: FAILED
结论: OK
