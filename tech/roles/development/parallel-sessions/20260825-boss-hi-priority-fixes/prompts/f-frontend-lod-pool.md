# Workstream f-frontend-lod-pool — 工作 LOD 取消 + Domain 池/可见集拆分 + setPOIs 空守卫(fix 4/5/6)

## 角色

你是 boss 派发的 headless 开发 worker。worktree 已由 boss 预建(`/Users/acccan/dm-wt-f-frontend-lod-pool`,分支 `fix/work-lod-marker-pool`,从 dev 切出)。**不要 merge、不要 push、不要碰主树**。先看 `git log --oneline -3` 确认起点。

## 背景(boss 已验证,dev HEAD 3d40a31,marker-resilience 批次 fd45824 已合入)

三个用户发现全部落在 marker 池/可见性语义上,须在一个 WS 内处理(map-shell 是共享文件,拆多个 WS 必冲突):

**发现 4 — 聚合下钻与 LOD tier 冲突:**
- `server/src/lib/city-cluster.ts:30` `CLUSTER_DRILL_ZOOM = 11`;聚合触发 `zoom <= 8`(`CLUSTER_MAX_ZOOM`),徽章点击 flyTo zoom 11。
- `server/src/components/map-shell.tsx:1509-1526` `visiblePOIIds` memo 末段:`(p.company?.tier ?? TIER_DEFAULT) <= maxTier`(`maxTierForZoom(zoom)`),`TIER_DEFAULT = 12`(lod.ts:20)——下钻到 11 后未打标公司(tier 12)被客户端过滤隐藏 → 点城市徽章后一批公司消失。
- work 主加载已是全量无 bounds/maxTier(map-shell:1001-1005,`loadWorkViewport` 不传 maxTier;viewport-search.ts:385 的 maxTier 仅在 query.maxTier 存在时并入,filters 状态不带 → 服务端 tier 子句在当前 UI 路径不触发)。服务端 `/api/pois` 的 maxTier 参数**保留**(API 契约,其它消费者/测试在用)。
- **用户裁定:取消工作模式「按缩放层级隐藏公司标记」——所有公司全量展示;zoom ≤ 8 城市聚合保留。** 意味着 fix 4 ≈ 客户端过滤删除 + 注释/文档同步,不动服务端。

**发现 5 — Domain replace 销毁被筛选过滤掉的 marker:**
- map-shell:1423-1429:domain 分支 `markerPois = mergeMapPois(pois, overlayPois, savedOverlay && Boolean(user))`,其中 `pois` = pipeline(catalog) 结果(管线已应用 query/filters/sort,见 :1394-1419 work 分支同款)。
- map-shell:1700-1711 `usePOIMap` 调用:domain → `replacePOIsOnSync: true, retainPOIIds: lastOverlayIdsRef.current`。
- use-poi-map.ts:58-77 `applySync`:`setPOIs(pois, {replace, retainIds})` → `setVisiblePOIs` → select/highlight → `sync()`;map-markers.ts:1013-1021 replace 销毁「不在新列表、也不在 retainIds」的 id。
- 结果:minRating/price/category 等纯客户端筛选变化改变 pipeline 输出 → pois 变 → replace 销毁筛选出的 marker(真正移除而非隐藏);筛选恢复/空批次瞬态 → 「整批不回来」。
- **用户裁定:Domain 也保持「目录全量 = marker 池,筛选只算 visiblePOIIds」;只有真正换视口/换目录(catalog 引用变化)才 replace。**(work 分支已是池=目录管线全量?——不,:1394 的 workMarkerPois **也是** pipeline(catalog) 的输出;但 work 不传 replace(只增不删)→ 过滤出的 id 留在池内隐藏,恢复时补回,work 无此 bug。**Domain 修复 = 把 pool 与管线过滤解耦**,具体见任务 B。)

**发现 6 — `setPOIs([])` 仍等于清空全部 marker:**
- map-markers.ts:980-987:`pois.length === 0 → this.clear()`(b2 保留语义「刷新/重置路径」)。
- use-poi-map applySync 恒 `setPOIs(...)`;markerPois 在「刷新此处(setCatalog([]))、加载中 catalog 空、clip 空」等瞬态为 `[]` → 清空全部实例 → 加载完成后才重建(实例抖动),且 replace 语义下空批次还销毁池外 id。
- 用户裁定:marker 层加「空过滤 ≠ 清空池」守卫——空列表 = 保留实例,可见性由 `setVisiblePOIs([])` 负责;显式清空只发生在 `controller.clear()`/destroy 路径。

## 任务(仅本 WS 范围)

### A. fix 4 — 工作模式取消 LOD 隐藏(`map-shell.tsx` 为主)

- visiblePOIIds memo(`:1509-1526`)末段删除 tier 条件——工作公司恒显示(与 overlay/domain pin 恒显一致);`clusterState` 分支(聚合:只显示无 city 个体 pin)与 `mutexVisibleIds` 分支(收藏互斥)**不动**。
- 清理不再使用的 `maxTier` / `maxTierForZoom` / `TIER_DEFAULT` 引用与 import(map-shell);确认 `lod.ts` 导出保留(服务端/其它模块在用),只更新其顶部注释:工作地图客户端不再按 zoom 过滤 tier,但 `maxTierForZoom`/`TIER_DEFAULT` 仍为(可能的)其它消费方与 API 契约保留。
- `city-cluster.ts` `CLUSTER_DRILL_ZOOM` 注释更新(下钻后个体 pin 全量出现,不再被 LOD 隐藏);值不变。
- 验证聚合链路不回归:zoom ≤ 8 徽章聚合、点徽章 flyTo 11 → 全量个体 pin 出现(含 tier 12)。

### B. fix 5 — Domain 池/可见集拆分(`map-shell.tsx`、`use-poi-map.ts` 视需要)

- 目标语义:domain marker 池 = **目录全量**(catalog 原始,不经过 query/filters/sort 管线)+ overlayPois + savedOverlay;客户端筛选/排序/搜索文本只影响**可见集**(visiblePOIIds → setVisiblePOIs,实例 show/hide);仅当 catalog 真正更换(新视口/新搜索/模式切换换目录)才触发 replace(池外 id 销毁)。
- 实现建议(以你读代码为准,保持现有 memo 结构风格):新增/改造 memo——`domainMarkerPool`(catalog 原始 + overlay + saved)与 `domainVisibleIds`(pipeline(catalog) 的 id 集 + overlay/saved id,即现 :1511-1524 的恒显集合逻辑);`markerPois` memo 的 domain 分支改用池;**列表 `pois`(明细/卡片/详情查找/滚动列表)保持 pipeline 口径不变**(它在别处被消费,勿动).
- 保持:overlay 恒显、savedOverlay 互斥(mutexVisibleIds)、`lastOverlayIdsRef`/`retainPOIIds`、`onMarkerClick` 的 `poisRef.current` 查找逻辑;work 分支行为不变(fix 4 之外).
- 验证:domain 筛选变化 → 池 id 不销毁(引用相同,仅 visible 变);domain 搜索/换视口 → catalog 变 → replace 销毁池外(旧视口不累积——回归上一批 b-marker-core 的「视口替换」修复);空目录瞬态 → 池保留 + 可见集空。

### C. fix 6 — `setPOIs([])` 空守卫(`map-markers.ts` 为主)

- `setPOIs` 移除 `pois.length === 0 → this.clear()` 分支:空列表 = 不触碰实例(现有实例保持挂载;需要隐藏时由调用方 `setVisiblePOIs([])` 负责)。显式清空 = `controller.clear()` / destroy 路径。
- **审计所有调用面,确保没有路径依赖「setPOIs([]) = 清空」:**
  - use-poi-map.ts applySync(恒 setPOIs,pois 来自 markerPois);
  - map-engine/switch.ts:107-108 已 guard(保持);
  - map-shell 模式切换(domain↔work)/刷新此处(`setCatalog([])` + `catalogRef.current = []`)/加载瞬态——模式切换后实例不跨模式泄漏:work→domain 由 replace 处理;domain→work 无 replace——若切换后池内残留另一模式实例且无显式清空,补显式 `clear()`(或等价机制)并**写测试**;若现状已有清空路径,验证其不依赖空列表语义。
- 更新既有测试:`map-markers.test.mjs` / `marker-leak.test.mjs` / `marker-visibility.test.mjs` 中「空列表 = 清空」用例 → 新语义(空列表保留实例;`setVisiblePOIs([])` 隐藏;`clear()` 显式清空仍有效);保留 batch b/6b82479 的 replace/sync/isAttached 用例语义。
- 确认 replace + `[]` 行为:目录更换为空(domain 搜索空结果)→ 池保留、可见空;不销毁保留 id。

### D. 测试与文档

- 新测试(风格跟随现有 marker 测试文件):tier 12 公司在 zoom 11 可见(若该逻辑可抽出纯函数则直接测,否则按现有组件级测试风格);domain 筛选变化 → 池 id 集合不变;空批次保留实例;模式切换不泄漏。
- 文档同步:`tech/18-national-scale-plan.md`(§2.2 LOD)、`tech/19`、`tech/21`(聚合/drill 注释)、`tech/23`(如需)与 `agent.md`(如描述 marker/LOD 契约)——「工作地图不再按 zoom 隐藏公司;筛选只影响可见集;空批次不再清池」。`make docs-check` 必须过。

## 文件边界

**拥有**:`server/src/components/map-shell.tsx`、`server/src/hooks/use-poi-map.ts`、`server/src/lib/map-markers.ts`、`server/src/lib/lod.ts`(注释)、`server/src/lib/city-cluster.ts`(注释)、`server/tests/{map-markers,marker-visibility,marker-leak,hooks-contracts,component-contracts}.test.mjs`(按需)、相关 tech 文档。

**不碰**:`server/src/lib/{recruitment-store,server-catalog,mode-cache,site-geocode,search,viewport-search}.ts`、`server/src/app/**`、`scripts/**`、`server/.env*`、主树。**不改服务端任何 route 的 maxTier 处理**(API 契约保留)。

## 门禁(必须真跑,全绿才算)

```bash
cd /Users/acccan/dm-wt-f-frontend-lod-pool/server && npm test
cd /Users/acccan/dm-wt-f-frontend-lod-pool/server && npm run typecheck
cd /Users/acccan/dm-wt-f-frontend-lod-pool && make docs-check && git diff --check
```

## 提交

小步高频,Conventional Commits(`fix(map-shell): 工作模式取消 LOD tier 隐藏 — 全量公司展示,聚合保留`、`fix(map-shell): domain 池=目录全量,筛选只算可见集`、`fix(map-markers): setPOIs 空列表不再清池 — 保留实例,显式 clear 才清`、`test(marker): …`)。

## 回报

写入 `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260825-boss-hi-priority-fixes/reports/f-frontend-lod-pool.md`,含改动摘要(三个 fix 各一段)、门禁结果、遇到的问题、结论。**末两行必须精确**:

```
门禁: PASSED
结论: OK
```

阻塞时:`结论: BLOCKED: <一句话问题>`。
