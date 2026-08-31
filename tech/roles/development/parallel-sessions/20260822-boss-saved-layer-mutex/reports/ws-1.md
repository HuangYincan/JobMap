# ws-1 汇报(2026-08-22)

## 实际改动

- `server/src/lib/saved-overlay.ts` → 头注释由「叠加层只给地图」改为互斥语义(池/可见性分工);
  `mergeMapPois` 注释改为「marker 池构建」(catalog 全量保留,池只增不删);新增纯函数
  `mutexVisibleIds(pool, overlayIds, enabled)`——开时只返回收藏点 id,关时 null。
- `server/src/components/map-shell.tsx` → 新增 `savedLayerEnabled = savedOverlay && Boolean(user)`;
  `visiblePOIIds` 互斥优先(mutexVisibleIds,普通 POI 按 id 排除);`clusterState` 互斥开时按
  `overlayPois` 聚合(徽章不混入 catalog 公司);桌面 SecondarySidebar 接 `savedMode/savedItems/
  onPickSaved/onRemoveSaved/savedCatalog/savedOrigin`;移动抽屉 Explore sheet 互斥开时切 SavedList。
- `server/src/components/secondary-sidebar.tsx` → 新增 `savedMode` 等 6 个可选 prop;列表区互斥开时
  渲染 `SavedList`(「我的收藏」视图,行点击走 `onPickSaved`、行移除走 `onRemoveSaved`),关时恢复
  筛选面板+结果标题+POIList;顶部契约注释同步。
- `server/src/hooks/use-saved-layer.ts` → 仅头注释追加互斥消费说明,逻辑零改动(状态/派生/toggle 不变)。
- `server/tests/saved-layer-mutex.test.mjs`(新增)→ 11 个回归测试:mutexVisibleIds 语义(开=只含收藏/
  关=null/无收藏空地图/池∩overlay)、mergeMapPois 池只增不删、完整互斥流(开→关,派生零重查)、
  源码契约(桌面/移动列表切换、聚合互斥、契约注释修正)。
- `server/tests/component-contracts.test.mjs` → useSavedLayer 接线断言由「行为不变」更新为互斥语义
  (池不变 + 可见性互斥 + 列表切换)。
- `tech/16-bug-fixes.md` → 新增 2026-08-22「收藏图层互斥语义」节(症状/决策/目标语义/实现/验证)。
- `tech/11-phase2-plan.md` → Phase 4 起步段追加 ⚠️ 修订注(历史文字保留,仅追加修正)。

## 地图互斥实现方式 + 关时恢复机制

- **池/可见性分工**:`markerPois` 池照旧由 `mergeMapPois(pipeline, overlayPois, enabled)` 构建——
  catalog 结果全量保留(复用 6bf2092「空批次不置空 catalog」),开时仅把 catalog 未命中的收藏点
  快照补入池。**互斥在可见性层落地**:`visiblePOIIds` 开时 = `mutexVisibleIds` 只含收藏点 id,
  普通 POI 全部排除;关时返回 null 走原 LOD/聚合逻辑。
- **为何不触发重查/秒恢复**:`usePOIMap` 的 `setPOIs` 只增不删(实例保留),`setVisiblePOIs` 是
  show/hide 切换——开时 catalog marker 只是隐藏(实例全程存活),关时可见集恢复即全部秒回,
  toggle 本身不触发任何 fetch(派生只读内存态 pipeline/overlay)。
- **聚合互斥**:work zoom ≤ 8 时 `clusterState` 互斥开按 `overlayPois` 聚合,徽章计数/个体 pin
  不混入 catalog 公司;互斥分支可见集 = clusterState.individual ∩ 池(天然只含收藏)。

## 列表互斥实现方式(组件 + 数据流)

- 桌面:`SecondarySidebar` 新增 `savedMode` 接线(map-shell 传 `savedLayerEnabled`);列表区互斥开时
  渲染 `SavedList`(saved-panel 复用,动态 import,与现有懒加载同源路径),关时恢复筛选面板+
  结果标题+POIList。行点击走 `handlePickSaved`(沿用现有 saved pin 点击行为:overlay/compare/catalog
  活数据命中 → 侧栏详情),行移除走 `handleRemoveSaved`,`savedCatalog/savedOrigin` 与 SavedPanel
  同口径(对比表可用)。
- 移动:抽屉 Explore sheet 互斥开时同样切 `SavedList`(onPick 后回 explore sheet),关时恢复
  移动 actions/筛选/POIList。
- 空态:已登录无收藏 → SavedList 显示 savedEmpty(列表空态),地图可见集 [] = 空地图,与
  「允许开」语义一致;未登录门控不变(toggle 弹登录窗)。

## 契约文档更新清单

- `saved-overlay.ts` 头注释 + `mergeMapPois` 注释(叠加 → 互斥,含 mutexVisibleIds 说明)。
- `secondary-sidebar.tsx` 头注释(新增互斥段落)。
- `map-shell.tsx` marker 可见性注释段(b2 + 互斥)。
- `use-saved-layer.ts` 头注释(互斥在消费方落地,本 hook 只做状态/派生/toggle)。
- `component-contracts.test.mjs` useSavedLayer 接线断言(注释 + 新增互斥断言)。
- `tech/11-phase2-plan.md` Phase 4 起步段 ⚠️ 修订注(仅追加)。
- `tech/16-bug-fixes.md` 新增 2026-08-22 节(行为日志)。

## 遇到的问题

- 无阻塞问题。唯一返工:自测用例「池中不存在的 overlay id」误用 `mergeMapPois` 建池(开时会把
  overlay 快照补入池,导致用例前提错误)——改为直接以 raw 池调用 mutexVisibleIds,断言「可见集 =
  池 ∩ overlay」,语义更准。
- 边界裁决(实现细节):互斥开 + work zoom ≤ 8 时聚合按收藏点聚合(徽章只计收藏),而非跳过聚合——
  保持聚合渲染层行为一致,且互斥语义严格成立(仅收藏数据出现在徽章/个体)。

## 证据

- 门禁输出摘要:
  - `npm test`:1138 tests / **1136 pass / 2 skip / 0 fail**(含新增 saved-layer-mutex 11 项全过)
  - `npm run typecheck`:`tsc --noEmit` 0 错误
  - `make docs-check`:Documentation policy check passed
  - `git diff --check`:green(提交后工作树干净)
- 提交(3 个小步,分支 `fix/saved-layer-mutex`):
  - `ef83967` fix(saved-layer): 收藏图层互斥语义——开=地图只留收藏+列表切收藏,关=恢复管线
  - `9d04384` test(saved-layer): 互斥语义回归测试——可见性/池只增不删/接线契约
  - `20380b9` docs(saved-layer): 互斥语义契约修订——tech/16 行为日志 + tech/11 修正注

门禁: PASSED
结论: OK
