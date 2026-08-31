# f-frontend-lod-pool 汇报(2026-08-25)

> worktree `/Users/acccan/dm-wt-f-frontend-lod-pool`,分支 `fix/work-lod-marker-pool`(起点 dev HEAD 3d40a31)。开工时发现上次中断留下的未提交成果(三个 fix 的主体实现),按幂等协议验证后补齐缺陷、测试与文档,4 个 commit 完成。

## 实际改动

### fix 4 — 工作模式取消 LOD 隐藏(用户裁定:所有公司全量展示,zoom ≤ 8 聚合保留)
- `server/src/components/map-shell.tsx` → `visiblePOIIds` 工作分支改为全量 `markerPois`(删除 `tier <= maxTier` 过滤与 `maxTier`/`TIER_DEFAULT` import);`clusterState`(聚合)与 `mutexVisibleIds`(收藏互斥)分支不动;相关注释更新。
- `server/src/lib/lod.ts` → 仅注释:模块导出(`maxTierForZoom`/`TIER_DEFAULT`)与服务端 `/api/pois` maxTier 契约保留;`lod.test.mjs` 锁定行为不删。
- `server/src/lib/city-cluster.ts` → 仅注释:`CLUSTER_DRILL_ZOOM = 11` 值不变,更新下钻后全量个体 pin 出现(含 tier 12)注释。
- 服务端零改动(maxTier API 契约原样保留)。

### fix 5 — Domain 池/可见集拆分
- `map-shell.tsx` → 新增 `domainMarkerPool` memo(catalog 原始 + overlay + saved overlay,不经 query/filters/sort 管线,依赖 `[mode, catalog, overlayPois, savedOverlay, user]`);`markerPois` 的 domain 分支改用池;`visiblePOIIds` domain 分支 = 管线结果(pois)id ∪ overlay id;列表 `pois`(明细/卡片消费)口径不变。
- 效果:纯客户端筛选/排序/搜索文本变化不改 catalog → 池引用不变 → 零 setPOIs(筛选过的实例 show/hide,不销毁);仅 catalog 真正更换(新视口/新搜索/模式切换)才 replace 销毁池外 id(旧视口不累积,b-marker-core 修复保留)。

### fix 6 — `setPOIs([])` 空守卫
- `server/src/lib/map-markers.ts` → 移除 `pois.length === 0 → this.clear()` 分支:空列表 = 不触碰实例(空过滤 ≠ 清空池),可见性由 `setVisiblePOIs([])` 负责;replace + 空列表(目录更换为空)同样不销毁任何 id;显式清空只发生在 `clear()`/`destroy()`。
- `server/src/hooks/use-poi-map.ts` → 新增 `resetKey` 选项(可选):变化时显式 `controller.clear()` 后重放新池——setPOIs 空列表不再清场后,domain→work(无 replace)旧模式实例不再跨模式泄漏;**修正了上次会话遗留的首运行缺陷**(原实现 resetKey 有值时首次挂载会 clear 刚回放的实例;改为 `prev !== undefined && resetKey !== prev`,首运行不清)。
- `map-shell.tsx` → `resetKey: canonicalMode(mode)` 接线。
- 审计:map-engine/switch.ts:107-108 已有 `length > 0` guard,零影响;刷新此处/加载瞬态路径 = 池保留 + 可见集空,新批次到达后 replace 旧视口销毁。

### 测试
- `marker-leak.test.mjs` → 「空列表 = 清空」改为「保留实例(同一性不变)+ setVisiblePOIs([]) 隐藏 + clear() 显式清空」;新增「setPOIs 空列表 + replace 不销毁任何实例」用例。
- `marker-visibility.test.mjs` → 旧「setPOIs([]) 清空后可见集重置」用例改为「空列表保留实例且不重置可见集;clear() 才算清空 + 复位」。
- `hooks-contracts.test.mjs` → 新增 fix 4/5/6 三个源码契约测试(工作分支无 tier 过滤、domainMarkerPool 依赖不含 query/filters/sort、resetKey 接线 + 首运行不清 + map-markers 空守卫)。
- `component-contracts.test.mjs` / `saved-layer-mutex.test.mjs` → 旧 `mergeMapPois(pois, …)` 断言更新为 catalog 接线。

### 文档
- `tech/18-national-scale-plan.md` §2.2 → 客户端 LOD 退役修订块,表格标「历史模型」,里程碑验收项改「公司全量展示」。
- `tech/19-company-labeling.md` §1 → tier 降级为数据标注字段;maxTier SQL 下推/lod.ts 导出/lod.test 保留;注明 tier 21 全量展示影响(黑名单语义应另立字段)。
- `tech/21-city-clustering.md` → 规则 5/7 + §5:个体层也无 tier 过滤,下钻后个体 pin 数与徽章 N 同口径(全量);「问题」段注记历史动机。
- `agent.md` → tier 语义引用改 2026-08-25 口径。
- 代码注释同步:`use-poi-map.ts`、`saved-overlay.ts`、`map-markers.ts`、`map-shell.tsx` 中「LOD/zoom tier 过滤」表述更新为「全量/控制器可见性切换」。

## 门禁结果
- npm test: **1650 通过 / 0 失败 / 2 skip**(改动前基线 1610;新增 3 测试 + 若干用例)
- typecheck(tsc --noEmit): 通过
- make docs-check: 通过
- git diff --check: 通过

## 遇到的问题
- (上一会话遗留)use-poi-map.ts resetKey 首运行缺陷:首次挂载 clear 刚回放的实例 → 已修(prev 未初始化不清)+ hooks-contracts 断言锁定。
- (上一会话遗留)marker-leak.test.mjs 注释笔误「空过滤 ◁ 清空」→ 校正为「≠」。
- 两处旧测试(component-contracts/saved-layer-mutex)断言旧 domain 池接线 `mergeMapPois(pois, …)` → 更新为 catalog 接线。
- **需 boss 知悉(非阻塞)**:tier 21(旧「永不显示」标记)公司现随全量展示出现;本次未另立字段,已在 tech/19 修订块注明。如产品意图是「黑名单隐藏」,应另立字段而非绑定 zoom。

## 证据
- 提交记录(worktree 内):`ac89ab0 fix(map-shell): 工作模式取消 LOD tier 隐藏 + domain 池/可见集拆分` → `fd8edc0 fix(map-markers): setPOIs 空列表不再清池` → `f5af72b test(marker): 空列表=保留实例 / …` → `2bfe648 docs(tech): …`
- 测试输出摘要:`ℹ pass 1648 / ℹ fail 0 / ℹ skipped 2`(`node --test tests/*.test.mjs` 全量)
- 契约断言:fix 4(工作分支 `return markerPois.map((p) => p.id)` 且 shell 无 `maxTierForZoom|TIER_DEFAULT`)、fix 5(`domainMarkerPool` 依赖 `[mode, catalog, overlayPois, savedOverlay, user]`)、fix 6(`if (pois.length === 0) return;` + `const reset = prev !== undefined && resetKey !== prev;`)——均注释于 hooks-contracts.test.mjs:253-310。

门禁: PASSED
结论: OK
