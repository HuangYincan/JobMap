# 批次 Manifest — 20260825-poi-marker-resilience

目标:修复 POI marker 生命周期 bug 批次(用户指定):
- 核心:POI marker 有「显式重建」,但没有「检测删除后自动补回」(厂商 overlay 被删后自动 re-add;聚合徽章切引擎后不重建)
- 附带 5 项:① Domain 视口替换旧 marker 永久累积;② 视口请求无取消/代际校验;③ DB 故障伪装成成功空结果;④ priceDesc 无价格 POI 排最前;⑤ /api/suggest 缓存 key 漏 center

## 根因(Explore 结论,2026-08-25)

- 核心:POIMarkerController(map-markers.ts:673)是「只增不删」登记簿(markers/placed 双簿记,removeMarker 仅 clear/destroy);`setPOIs` 非空仅 add+setPosition(:978-995);全 src 无厂商侧删除被动检测(无 remove 事件监听、无 getMap 检查)。usePOIMap(use-poi-map.ts:82-107)随 `[view, accentColor]` 重建控制器(显式重建存在);switch.ts replayController(:103)存在但 MapShell 主链路不传(tech/23:736-740 已注明设计如此)。聚合徽章 effect(map-shell.tsx:1455-1491)依赖 `[clusterState, mapReady, modeConfig.color]` + `mapInstance.current`(ref),切引擎三者不变 → 徽章不重建(tech/23:750-758 已记录遗留)。
- ①:use-work-viewport.ts:203 `existing: []` + :216 catalog 整体替换 → map-shell markerPois(domain=mergeMapPois(pois, overlayPois, saved))→ usePOIMap → setPOIs 只增不删,旧视口 marker 只被隐藏、永久累积。
- ②:use-work-viewport.ts:189 viewportEpochRef 递增但 :208 onBatch 只查 mode 不查 epoch;createViewportLoader.dispose(viewport-search.ts:594-599)只清 timer/pending,不能取消在飞 load(全库无 AbortController,取消只有协作式 `signal?: {cancelled}`)。
- ③:hz-poi-store.ts:174-177 出错返回 null → domain-local/route.ts:86-99 把 null 抹平成 200 `{total:0,results:[]}` → poi-service.ts:263 `res.ok` 放行 → 浏览路径 :200-207 `local ?? existing` 中 local 恒非 null(mergePoisById(existing,[],cap)===existing)→ 高德回退与错误信号全部失效。
- ④:search.ts:668-671 priceSortValue 缺失 priceLevel → Number.MAX_SAFE_INTEGER;:733-752 priceDesc 反置 → 缺失项排最前。
- ⑤:suggest/route.ts:54 cache key `['suggest', mode, q]`,不含 center,但 :75/:90/:119 distance 按 center 算。

## Workstream(5 个,文件不相交)

| ws | 分支 | worktree | 主题 | 依赖 | 合并顺序 |
|---|---|---|---|---|---|
| a-marker-core | fix/poi-marker-autorestore | /Users/acccan/dm-wt-a-marker-core | 控制器:setPOIs replace+retainIds、sync() 完整性补回、MapMarker.isAttached 契约+三引擎适配 | — | 1 |
| b-marker-wiring | fix/poi-marker-wiring | /Users/acccan/dm-wt-b-marker-wiring | usePOIMap 接线(replace/sync 触发)、聚合徽章 engineView 依赖、tech/23 遗留更新 | a | 2 |
| c-viewport-guard | fix/viewport-epoch-guard | /Users/acccan/dm-wt-c-viewport-guard | 视口 epoch 代际校验 + loader 在飞取消(signal) | — | 3 |
| d-local-fallback | fix/local-poi-db-fallback | /Users/acccan/dm-wt-d-local-fallback | domain-local null → 502,前端回退链生效 | — | 4 |
| e-search-suggest | fix/price-suggest-fixes | /Users/acccan/dm-wt-e-search-suggest | priceDesc 缺失置末 + suggest cache key 加 center | — | 5 |

契约:a-marker-core 定义 `setPOIs(pois, opts?: {replace?, retainIds?})` 与 `sync()` 与新契约字段 `isAttached?()`;b-marker-wiring 消费(不得另起名)。

## 不做(Deferred,见 deferred-notes.md)

- 价格排序/筛选口径不一致(priceSortValue 只看 priceLevel,筛选优先 cost)— 口径观察
- 客户端 suggestStore(key 不含 center)— 客户端重算距离,无实际影响
- switchMapEngine replayController 主链路接回 — 现状设计(usePOIMap 已覆盖),不改

门禁:`cd server && npm test` 全绿 + `npm run typecheck` + `make docs-check` + `git diff --check`。
回报:reports/<ws>.md,末两行 token。Worker 不 merge、不 push、不碰主树,worktree 已预建。
