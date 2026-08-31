# Deferred Notes — 20260825-poi-marker-resilience

> 需用户决策/口径问题,不随本批处理。任务完成后统一告知。

1. **类型:口径** — 价格排序/筛选口径不一致:排序 `priceSortValue`(search.ts:668-671)只认 `priceLevel`,筛选 `matchFilter case 'price'`(search.ts:523-531)优先 `cost`(无 cost 才退回 priceLevel 档位中点)。有真实 cost 但无 priceLevel 的 POI 筛选能中、排序却当「缺价格」。本次只修 priceDesc 缺失置末,**不**改这一口径一致性(改动影响排序语义面更广,待用户确认期望口径)。
2. **类型:口径(低风险)** — 客户端 suggest LRU(suggestStore,public-cache.ts:135-149)key 同样不含 center:客户端按实时 origin 重算 distance,无实际影响;如未来服务端 distance 被客户端直用,需一并处理。
3. **类型:设计(不改)** — switchMapEngine 的 replayController(switch.ts:103)在 MapShell 主链路不传:usePOIMap 随 `[view, accentColor]` 显式重建 + 本批新增 `sync()` 完整性补回已覆盖,replay 保留给无 usePOIMap 的调用方。tech/23-map-engines.md:736-740 已有说明。
4. **类型:观察** — 备注:TMap/共享 MultiMarker 场景与 BMapGL webgl overlay 管理器(相机动画隐藏/恢复)是「外部删除 marker」的高发场景,isAttached 探测对它们最为关键;如后续真实环境仍出现「消失不补回」,优先复查这两处适配层的 isAttached 判定。
5. **类型:观察(TMap 性能)** — a-marker-core 知悉:Sync 会给「控制器自己隐藏(TMap setVisible false → geometry 摘除 → multiAttached 移除)」的 marker 也重建再隐藏,语义正确、有重复重建开销。当前 TMap 被禁用不触发;恢复多引擎时复查是否加「visibleIds 中的隐藏 marker 跳过重建」优化(需保证后续 show 时状态仍正确)。
