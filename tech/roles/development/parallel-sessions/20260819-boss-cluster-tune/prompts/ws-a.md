# ws-a — Bug1 跨城 POI 串味(数据层)

## 背景

用户「缩放后杭州附近出现了深圳、成都等」。Explore 已定位**真实、确定性根因**:

**DB `company_sites` 存在「城市标签与坐标矛盾」的行**:`city='深圳市'/'成都市'/'北京市'/'上海市'`
等,但其 `lng/lat`(及 `geom`)却是**杭州坐标**。实测(本地 Postgres):
- 非杭州城市 label 但坐标落在杭州 bbox(118.3,29.1,120.8,30.7)内有 **147 条**
  (深圳 22 + 成都 18 + 北京 25 + 上海 30 + 广州 9 + 武汉 4),涉及 **76 家公司**;
- 这些行背后有 **914 个 open 岗位** → alive-join 不会滤掉;
- 典型:`TP-LINK city=深圳市,address=滨江区聚才路…(杭州地址),lng=120.20,lat=30.18`;
  `安克创新` 同一杭州地址/坐标被盖在 city=`深圳市`/`北京市` 两行上。

**为什么能通过服务端查询** `recruitment-store.ts:114-120`(`loadWorkCatalogFromDb`):
site SQL 唯一空间裁剪是 `s.geom && ST_MakeEnvelope(bounds)`(`spatial-query.ts:79-84`),
**从不校验 `city` 与 bounds 是否一致**——一个 city=深圳 但其 geom 在杭州的行,在杭州视口查询
里是合法命中。city 过滤(`spatial-query.ts:117-123`)只在用户显式选城市 filter 时生效,视口
加载从不带,是惰性的。

**为什么能渲染** `search.ts:818-864`(`runPOIPipeline`)只有 关键词/筛选/距离/排序,
**没有 inBounds 裁剪**;`map-shell.tsx:1333-1341` `pois = runPOIPipeline(catalog,…)` 不夹带
bounds;`mapPois = mergeMapPois(pois,…)`,全程无 bounds 过滤。

## 根因分类

这是**数据质量问题**(geocode/import 把一公司某杭州办公室坐标盖到所有城市行上),叠加
**查询层缺 city↔bounds 一致性校验**。技术可修,自动派发。

## 修复方向(worker 自选技术路线,保持交互语义)

1. **查询层主修**(推荐,最小、即时生效、无需数据重灌):`recruitment-store.ts:114-120`
   `loadWorkCatalogFromDb` 当 clip.bounds 存在时,向 site SQL 追加一条小区块一致性条件,
   剔除「坐标在城市范围附近但 city 却不在该范围的城市」的串味行。具体做法(二选一,worker
   定夺并说明):
   - 方案 A(bounds-内统一口径):`bounds` 存在时,仅保留 `city` 与坐标不矛盾的行——
     例如浙江 bbox 内只留 `province ~ '浙江'` 或 `city ~ '杭州'` 或 `city IS NULL` 的行;
     全国视野(zoom ≤ 8,bounds 极宽)时不做此裁剪,保留真实跨城(深圳公司该在深圳)。
     注意:全国视野仍需能画出深圳/成都徽章,所以**这个一致性裁剪只在 bbox 明显是单一
     城市区域(如杭州 bbox 内)时才启用**,且后文方案 B 是更本质的修法。
   - 方案 B(city 一致性,更通用):对落在当前 bbox 内的行,若 `city` 有值且 city 的
     「参考坐标」不在 bbox 内 → 丢弃该行。需要一个 city→参考坐标的静态表(可复用 ws-b
     的 `city-centers.ts`,但 ws-b 是另一 worker;若冲突就先内部定义一个小表避免跨 worker
     依赖,或等 ws-b 合后引用)。
2. **数据层**(Env-only,不自动跑)记入 deferred:修正 geocode/import 的「多城市公司把
   一公司杭州坐标盖到所有城市行」的 provenance bug + 重跑 geocode(`plan-site-geocode`)。
   记 deferred-notes。
3. **客户端兜底(可选)**:`map-shell.tsx:1333-1341` 给 `pois` 补 inBounds 裁剪——但注意
   work 全国视野需要保留跨城,所以 bounding 裁剪只对「zoom > CLUSTER_MAX_ZOOM」个体模式
   生效。若方案 A 已完全解决,客户端兜底可不做。

## 多城市公司涟漪(务必考虑)

`recruitment-import.ts:332-345` 已记录同类事故(得物/米哈游 city=北京市 坐标却在上海)。
本 WS **不重灌数据**(Env-only),只做查询层防御 + 为后续数据修正打底。修复后:
- 杭州视口不应再出现 city=深圳/成都/北京/上海 的 pin;
- 全国视野(zoom ≤ 8)仍要能按真实坐标画出 深圳/成都 徽章(它们真正的深圳/成都 office——
  若某公司只有错误杭州坐标,则在数据修正前会缺,这是可接受的、由 deferred 数据项覆盖)。

## 测试(必做)

- `server/tests/*`:给 `loadWorkCatalogFromDb` 的查询层新增「跨城串味行被滤除」用例。
  因 loadWorkCatalogFromDb 依赖真实 PG,优先在纯函数层测试:把「一致性裁剪」抽成可单测的
  SQL-fragment 纯函数(参考 `spatial-query.ts` 的 `companySitesSpatialSql` 模式),
  一个取 clip(含 bounds)返回追加 WHERE 片段的函数,单测其杭州 bbox 时剔除 city=深圳 行、
  全国 bbox 时保留。
- 既有 `spatial-query.test.mjs` / `viewport-search.test.mjs` 全绿。

## 文件边界(绝对路径;worktree = /Users/acccan/dm-wt-wsA)

- 只动:`server/src/lib/recruitment-store.ts`(loadWorkCatalogFromDb 查询层)、
  `server/src/lib/spatial-query.ts`(如抽新纯函数)、`server/tests/*`(相关单测)
- **不碰**:`server/src/components/map-shell.tsx`、`server/src/lib/city-cluster.ts`、
  `server/src/lib/map-markers.ts`、`server/src/lib/mode-cache.ts`(ws-b/ws-c 区域)
- 数据重灌/geocode = Env-only,记 deferred 不跑

## 门禁(全绿)

```bash
cd /Users/acccan/dm-wt-wsA/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-wsA && make docs-check && git diff --check
```

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-cluster-tune/reports/ws-a.md`:
改动文件 + 根因简述 + 修复实现 + 测试 + 遇到的问题。末两行:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

worktree 已预建(可自建),boss 统一合并。**不 merge / 不 push / 不切分支**。小步 commit(Conventional Commits)。

## 续作附录(boss 2026-08-19,预算超限中断后续作)

已做(未提交):`server/src/lib/spatial-query.ts` 新增 93 行一致性裁剪纯函数:
`CITY_REFERENCE_BOXES`(杭/深/广/蓉/京/沪/汉 7 城参考框)、`CITY_VIEW_MAX_AREA_SQ_DEG`、
`singleCityReference(bounds)`(单一城市视野判定)、`cityBoundsConsistencySql(bounds,start)`
(返回 `AND (s.city IS NULL OR province ILIKE %..% OR city ILIKE %..%)` 片段)。
开工先 `git status` + `git diff --stat` 确认,不重做。剩余任务:
1. **先 commit 未提交改动**:`git add server/src/lib/spatial-query.ts && git commit -m "fix(spatial): 城市↔坐标一致性裁剪纯函数(跨城串味防御)"`
2. **接线 `recruitment-store.ts:114-120`**:`loadWorkCatalogFromDb` 的 site SQL 在
   `spatial.sql` 之后追加 `cityBoundsConsistencySql(clip?.bounds)` 片段(注意占位符参数
   合并——companySitesSpatialSql 已有 params,把一致性 params push 进同一数组,`$` 编号
   从 companySitesSpatialSql 的 i 继续)。
3. **单测**(必做):spatial-query 一致性函数单测——杭州 bbox 时剔除 city=深圳 行、全国
   大 bbox(> CITY_VIEW_MAX_AREA_SQ_DEG)不裁剪、多参考框命中(null)、无 city 放行。
4. 门禁全绿 + 写报告。
5. 预算纪律:先 commit 再验证。
