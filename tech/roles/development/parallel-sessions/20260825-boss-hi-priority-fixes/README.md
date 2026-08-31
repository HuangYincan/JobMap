# 批次 Manifest — 20260825-boss-hi-priority-fixes

目标:用户指定的 6 项高优先级发现修复(读路径中心钉/缓存版本/裁剪语义 + 数据补全 + 工作 LOD/标记池语义)。

## 发现与修复映射

| # | 发现 | 修复 | workstream |
|---|---|---|---|
| 1 | 读路径无差别剔除城市中心钉,误伤大量有岗位站点(深圳被隐藏站点绝大多数为「城市占位地址」,甚至含"深圳市南山区学府路63号"这类有街道地址未 re-geocode 的站点) | 数据补全:地址烂(城市占位)/无地址 → 地点检索(公司名+城市);有地址无坐标/坐标=中心钉 → 地理编码(前者为本次新增,后者 r5 已有)。**apply 执行 = Env-only,延后** | d-data-completion |
| 2 | 数据语义变了(读路径排除中心钉:目录 1046→617),但 `MODE_CACHE_VERSION=17` 未 bump——旧 sessionStorage 缓存与新目录切换表现为「点某物后一批 POI 消失」 | bump 至 18 + 版本历史注释 | s-server-semantics |
| 3 | `recruitment-store.ts:141` `located.length===0 → return null`;`server-catalog.ts:82` 把 null 当「无 DB/失败」回退离线目录 → 带 bounds/city/maxTier 请求违反「裁剪未命中应为空」 | 裁剪空 = `[]`(DB 健康);`null` 仅表无 DB/查询失败 | s-server-semantics |
| 4 | 聚合下钻 `CLUSTER_DRILL_ZOOM=11` 与默认 `TIER_DEFAULT=12` 冲突:点城市徽章后未打标公司被 LOD 隐藏 | 取消工作模式「按缩放层级隐藏公司标记」——所有公司全量展示;zoom ≤ 8 城市聚合保留 | f-frontend-lod-pool |
| 5 | Domain 的 replace 语义销毁「被客户端筛选过滤掉」的 marker(minRating/price/category 等纯客户端筛选变化 → 真正移除而非隐藏,恢复/空批次瞬态时「整批不回来」) | Domain 也按「目录全量 = marker 池,筛选只算 visiblePOIIds」;仅真换视口/换目录才 replace | f-frontend-lod-pool |
| 6 | `setPOIs([])` 仍等于清空全部 marker(map-markers.ts:984);空批次瞬态(loading 间隙)销毁全部实例 | marker 层加「空过滤 ≠ 清空池」守卫;显式清空仅 clear()/destroy | f-frontend-lod-pool |

## 现状核实(boss 逐项验证,2026-08-25,dev HEAD 3d40a31)

- marker-resilience 批次(fd45824)已合入:`setPOIs` replace/retainIds、`sync()`、`isAttached` 契约均在(marker 层现状 = 批后状态)。
- fix 2:`server/src/lib/mode-cache.ts:49` = 17。
- fix 3:`server/src/lib/recruitment-store.ts:141` `if (located.length === 0) return null;`(:132 已有 `clipped && rows===0 → []`, 只有 JS 侧过滤后为空漏了);`server/src/lib/server-catalog.ts:78-87` 契约注释已写「Clip miss must stay empty」但 null 破坏该契约。
- fix 4:work 主加载已是全量无 bounds/maxTier(map-shell:1001);残留 LOD = map-shell:1509-1526 客户端 tier 过滤(:1523 `(p.company?.tier ?? TIER_DEFAULT) <= maxTier`);viewport-search 的 maxTier 仅在 query.maxTier 存在时并入(filters 状态不带,maxTier 已不下发)。见 tech/18 §2.2、tech/19。
- fix 5:map-shell:1423-1429 domain markerPois = `mergeMapPois(pois, overlay, saved)`(`pois` = pipeline(catalog),管线含 query/filters/sort);:1709-1711 domain → `replacePOIsOnSync: true` + `retainPOIIds`。
- fix 6:map-markers.ts:980-987 `pois.length === 0 → this.clear()`(b2 保留语义);use-poi-map.ts:58-77 applySync 恒 setPOIs。
- fix 1:工具链已有 `scripts/plan-site-geocode.mjs`(dry-run 不调 REST)/`scripts/geocode-sites-apply.mjs`(r5 apply)/`scripts/audit-city-center-pins.mjs`(只读,分类 needsRerun/stayCenter/noAddress)+ `server/src/lib/site-geocode.ts`(siteNeedsGeocode/matchesCityCenter/planSiteGeocode/listImportedSitesNeedingGeocode + provider 注册表含配额切换)。缺口 = 城市占位/无地址类(stayCenter/noAddress)的地点检索补全。city-centers.ts:169-185 `CITY_CENTER_EPS=0.0005`(~55m)isCityCenterPin。

## Workstream(3 个,文件不相交)

| ws | 分支 | worktree | 主题 | 依赖 | 合并顺序 |
|---|---|---|---|---|---|
| s-server-semantics | fix/server-catalog-semantics | /Users/acccan/dm-wt-s-server-semantics | MODE_CACHE_VERSION bump + DB 裁剪空语义(null/[] 契约) | — | 1 |
| d-data-completion | fix/site-place-search | /Users/acccan/dm-wt-d-data-completion | 地址烂/无地址 → 地点检索补全工具链(只实现+dry-run+测试,不执行 apply) | — | 2 |
| f-frontend-lod-pool | fix/work-lod-marker-pool | /Users/acccan/dm-wt-f-frontend-lod-pool | 工作 LOD 取消 + Domain 池/可见集拆分 + setPOIs 空守卫 | — | 3 |

契约:无跨 ws 契约(文件不相交)。共享文件按段切分集中在 f-frontend-lod-pool 内部处理(map-shell 三个改动点同 ws,避免并发冲突)。

## 不做(Deferred,见 deferred-notes.md)

- fix 1 的 apply 执行(AMap 地点检索/地理编码实际调用 + 写回站点数据)— Env-only(需 AMAP_WEB_KEY 等 + DB)。
- 读路径 `isCityCenterPin` 过滤保持不变(用户选择「数据补全」路线而非放宽读路径)。
- 服务端 `/api/pois` 的 maxTier 参数保留(API 契约;仅工作地图客户端不再使用)。

## 环境与纪律

- Env-only 步骤不自动跑;worker 禁 git push / worktree / 分支切换 / `npm run import:*` / `npm run geocode:*` / `npx` / 主树写入。
- 门禁(worker):`cd server && npm test` + `npm run typecheck` + `make docs-check` + `git diff --check`。
- 提交 Conventional Commits,小步高频。
- worker 不 merge、不 push、不碰主树;worktree 由 boss 预建,boss 统一合并。
