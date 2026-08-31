# ws-b — Bug:工作 POI 不随视角改变(用户确认首批修复未解决)

## 背景

用户「工作 poi 依然不随视角改变而改变」。Explore 已通过 playing clean context 复现并定位
**真实、确定性根因**(环境干扰已排除,两次完整 reload 无地图实例重建):

核心:**服务端已返回并缓存当前视口内的公司,但客户端 `runPOIPipeline` 用陈旧的圆心
(挂载时一次性 geolocation 的 `userLocation`)重新做 distance 裁剪,把列表与 marker 一起裁空**。

触发条件:**work 模式 distance 过滤器开启 + userLocation 圆心陈旧**。distance filter 持久化在
`sessionStorage['domain-map:mode-cache:v1:work'].filters`,跨会话还原——所以可能随时复活。

## 根因证据链(file:line)

1. `server/src/components/map-shell.tsx:1191`:
   `const distanceOrigin = userLocation ?? mapCenter;`
   - `userLocation` 只在挂载时 `getCurrentPosition` 设置(map-shell.tsx:557),此后拖动/缩放**从不更新**。
   - `mapCenter` 随 `moveend` 实时更新(map-shell.tsx:695)。
2. `map-shell.tsx:1326-1334`: `pois = runPOIPipeline(catalog, { center: distanceOrigin, filters })`,
   依赖陈旧的 `distanceOrigin`。
3. `server/src/lib/search.ts:840-856`: step 4 当 `filters.distance` 存在时
   `result.filter(poi => poi.distance <= maxDistM)`,圆心 = 陈旧 userLocation(距视口 37km)、
   半径 10km → **视口内所有公司被裁掉 → pois=[]**。
4. `mode-cache.ts`: distance 持久化在 `ModeCacheEntry.filters`,跨会话还原
   (map-shell.tsx:1623-1633 `setFilters(cached.filters)`)。
5. 服务端 `public-search.ts:68-98` 用 `boundsCenter(bounds)` 算距离,不夹带陈旧圆心——
   矛盾完全来自客户端 pipeline 的陈旧 `distanceOrigin`。

## 修复方向(boss 拍板:方案 1 为主,最小改动,保持交互语义)

**圆心实时化(pipeline 圆心跟随地图当前中心),并同步清理被 pipeline 裁空的 marker。**

1. **`map-shell.tsx:1191`** 距离圆心改为实时 `mapCenter`(而非挂载时一次性 userLocation):
   - `mapCenter` 已随 `moveend` 实时更新,`pois` useMemo 依赖 `distanceOrigin`,
     moveend 会触发重算 → 与视口/服务端 `boundsCenter` 口径对齐。
   - distance 筛选语义从「离我最近」→「离当前视野中心最近」(与视口加载语义一致)。
   - `userLocation` 保留用于初次定位/其他用途;distance 圆心不再永远钉在挂载点。
2. **`map-shell.tsx` 空批次三态/替换段(1058-1064 及同构 domain 分支)**:补「非真空但
   pipeline 裁空」的处理——若 `catalogRef.current` 非空、但 pipeline 计算后 `pois` 为空
   且 `catalogCoversView` 断言也不成立 → 显式清空 markers(避免 AMap 把旧 marker DOM
   重定位到视口外残留,`usePOIMap` setPOIs([]) 会按 id 差分移除——确保这层生效)。
   **保持现有空批次三态语义不变(真空清空/保留/失败保留),只在现有语义内补 pipeline 裁空这层**。
3. **测试**:
   - `server/tests/viewport-search.test.mjs` 或既有契约测试:新增「distance filter + 圆心
     跟随 mapCenter 时,视口内公司不被 pipeline 裁掉」用例(可注入 pipeline 断言)。
   - 契约测试覆盖 `distanceOrigin` 取 `mapCenter` 的静态断言。
4. **缓存**:distance filter 照旧持久化;圆心语义修正由 `mapCenter` 实时计算承载,
   **不必 bump MODE_CACHE_VERSION**(filters 结构不变)。如实现中确有缓存结构变化,再按
   tech/16 数据修正流程 bump 并在汇报说明。

## 文件边界(绝对路径,worktree = /Users/acccan/dm-wt-wsB)

- 只动:`server/src/components/map-shell.tsx`(distanceOrigin 取用 + 空批次三态 pipeline
  裁空层)、`server/src/lib/search.ts`(如需,尽量不动)、`server/tests/*`(相关契约/单测)
- **不碰**:`server/src/lib/city-cluster.ts`、`server/src/lib/map-markers.ts` 的聚合徽章
  新增导出(ws-a 区域,另一 worker 在改)、`server/src/hooks/use-poi-map.ts`(如需最小,
  但 map-shell 侧空批次已能清 markers;避免与 ws-a 冲突)、`server/src/lib/mode-cache.ts`、
  `server/src/components/account-panel.tsx`、`tech/21-city-clustering.md`(ws-a)

## 门禁(全绿)

```bash
cd /Users/acccan/dm-wt-wsB/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-wsB && make docs-check && git diff --check
```

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-cluster-viewport/reports/ws-b.md`:
改动文件 + 修复实现简述 + 测试 + 遇到的问题。末两行:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

worktree 已预建,boss 统一合并。**不 merge / 不 push / 不切分支**。小步 commit(Conventional Commits)。
## 续作附录(boss 2026-08-19,预算超限中断后重派)

已做(未提交,继续在其上做,勿丢弃):`server/src/components/map-shell.tsx` 的
`distanceOrigin` 已改为 `const distanceOrigin = mapCenter;`(附完整注释)。其余未动。
开工先 `git diff --stat server/src/components/map-shell.tsx` + `git status` 确认现状,不重做。

剩余任务(按原 prompt 顺序):
1. **先 commit 未提交改动**:`git add server/src/components/map-shell.tsx && git commit -m "fix(viewport): distance 圆心实时化 mapCenter(修复移动后 POI 整批裁空)"`
2. **空批次三态补 pipeline 裁空清理层**(原 prompt 第 2 条):找 map-shell.tsx 空批次三态/
   替换段(1058-1064 及同构 domain 分支)——若 `catalogRef.current` 非空、pipeline 后 pois
   为空、且 catalogCoversView 不成立 → 显式清 markers(确保 `usePOIMap` setPOIs([]) 生效,
   避免 AMap 把旧 marker DOM 重定位到视口外残留)。保持现有三态语义不变。
3. **契约测试**(原 prompt 第 3 条):`server/tests/viewport-search.test.mjs` 或既有契约测试
   补「distance filter + 圆心跟随 mapCenter 时,视口内公司不被 pipeline 裁掉」用例;
   distanceOrigin 取 mapCenter 的静态断言。
4. 门禁全绿(npm test / typecheck / docs-check / diff-check)+ 写报告。
5. 预算纪律:先 commit 再验证,避免再次中断丢成果。
