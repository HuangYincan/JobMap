# z-cluster 汇报(2026-08-26)

## 实际改动

- `server/src/components/map-shell.tsx` → 新增 `realZoom` state(初值 `DEFAULT_MAP_ZOOM=13`);
  `zoomchange` 时 `setRealZoom(currentZoom)` 保存真实(未取整)zoom;`clusterZoom` 由
  `clusterZoomForZoom(realZoom)` 计算(原先 `clusterZoomForZoom(zoom)` 用的是 round 后的
  `zoom` state)。`zoom` state 保持 round 不变(仍供 UI 显示 `<span>{zoom}</span>` 与
  `liveView()` 相机快照回退)。
- `server/src/lib/map-markers.ts` → `clusterZoomForZoom` 的 JSDoc 明确「输入必须是真实
  (未取整)zoom」,并记录传入 round 值会误判 8.4 为聚合的根因(实现逻辑未改,本就支持
  float:`zoom <= 8 ? floor : +1`)。
- `server/tests/marker-visibility.test.mjs` → 在既有「clusterZoomForZoom 分桶」用例上补
  边界回归:`clusterZoomForZoom(8.4)` 必须返回 9(个体),并新增 `8.6 → 9`、`0 → 0` 取值。
- `tech/21-city-clustering.md` → 规则 1 补「边界用真实 zoom 判定(2026-08-26
  fix/zoom-cluster-boundary),缩放 8.1~8.5 保持个体,不被取整误判聚合;容器 resize
  (点 marker 开面板)引起的 zoom 微降不触发聚合切换」。

## 根因与修复

- 根因:`map-shell` 把 `Math.round(currentZoom)` 的 **round 后 state** 传给
  `clusterZoomForZoom`。聚合边界语义是「真实 zoom ≤ 8 聚合、> 8 个体」,但 real 8.4(个体)
  被 round 成 8 → `8 <= 8` 误判聚合。点 marker 开 detail/explore 面板 → 地图容器宽度变化 →
  AMap 自适应 zoout → 真实 zoom 8.6→8.4 → round `9→8` → clusterState 个体切聚合 → 一批个体
  POI 变城市聚合徽章,即「点击 poi 后 poi 消失」。
- 修复:`zoomchange` 额外保存真实 `realZoom`,`clusterState`/可见性 memo 的依赖键
  `clusterZoom` 改用 `clusterZoomForZoom(realZoom)`。resize 后真实 8.4 仍 >8 → 保持个体,
  不再误切聚合。分桶记忆化不受影响:同桶内 realZoom 变化时 `clusterZoom` 整数值恒定
  (如 8.1~8.9 恒 9),useMemo 依赖不变,零重建。

## maxTier 审查(未改动,确认无影响)

- 工作模式走 `loadWorkViewport`(全量加载,**不传** bounds/maxTier,见 map-shell 1000-1007)。
- domain 模式走 `fetchPOIsForMode`,传 `zoom: view.zoom`(live 相机快照,**非** `zoom` state);
  `FetchPOIOptions` 不含 `maxTier` 字段。
- `lod.ts` 的 `maxTierForZoom` 仅保留供服务端 `/api/pois` API 契约/其它消费者/测试用,
  map-shell 的 `zoom` state 并未喂给它。故加 `realZoom` 不改 `zoom` state 语义(保持 round),
  maxTier 消费点零受影响,无需同步 lod.ts。

## 门禁结果

- npm test: **1686 通过 / 0 失败 / 3 skip / 1689 total**(exit 0)
- typecheck: 通过(`tsc --noEmit`)
- docs-check: 通过(Documentation policy check passed)
- git diff --check: 通过(无 whitespace 错误)

## 边界测试结果(重点 8.4 个体)

`clusterZoomForZoom` 输入真实 zoom(ws z-cluster 边界回归):
- `clusterZoomForZoom(8.0)` → 8(聚合)
- `clusterZoomForZoom(8.1)` → 9(个体)
- `clusterZoomForZoom(8.4)` → **9(个体,>8,不被取整误判聚合)** ← 本 bug 核心断言 ✓
- `clusterZoomForZoom(8.6)` → 9(个体)
- `clusterZoomForZoom(7.9)` → 7(聚合分桶 floor)
- `clusterZoomForZoom(0)` → 0
- 分桶序列 `[7.1,7.9,8.0,8.1,8.4,8.9,9.0,9.1,12.5]` → `[7,7,8,9,9,9,9,9,9]`(8→9 一次切换)

## 遇到的问题

- 无阻塞。原以为 `clusterZoomForZoom` 本身返回 8(聚合),审代码后确认该函数本就正确
  处理 float:`8.4 > 8 → 返回 9`;真正的 bug 在调用方 map-shell 传入了 round 后的 state。
  故修复落在 map-shell(传 realZoom),函数仅补注释、测试补边界回归断言。

## 证据

- 全量 `npm test` 摘要:`tests 1689 / pass 1686 / fail 0 / skipped 3 / duration 7.75s`,
  含通过项 `✔ clusterZoomForZoom 分桶:zoom 微调不重建,聚合↔个体只切换一次`。
- 提交(仅本 WS 分支 `fix/zoom-cluster-boundary`):
  - `cc6c718` fix(map-shell): 聚合/个体边界用真实 zoom 判定 — 点 marker 容器 resize 不再误切聚合
  - `0e11f24` test(cluster): 8.4 边界保持个体回归用例

门禁: PASSED
结论: OK
