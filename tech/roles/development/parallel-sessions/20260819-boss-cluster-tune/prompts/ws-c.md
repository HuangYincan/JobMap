# ws-c — Bug3 第一次点公司 pin 回到用户位置

## 背景

用户「第一次点击公司poi总是会回到用户所在位置」。Explore 已确认根因(用户机器上的
实际时序是 H3 竞态为主):

**挂载时异步的 geolocation 回调太晚落地,和用户第一次点 pin 撞上,把相机甩回用户位置。**
- `map-shell.tsx:549-562` 挂载即调 `getCurrentPosition(map)`.then:成功则
  `map.setCenter([lng,lat])` + `setZoom(15)` + `setMapCenter` + `setUserLocation` +
  `setSearchOrigin` + `setGeoSettled(true)`。
- `getCurrentPosition`(`amap-api.ts:567-...`)是**真异步、可能很慢**:`await loadAMap()`
  + `waitForPlugin(Geolocation)`,再 `AMap.Geolocation.getCurrentPosition(callback)`,
  `enableHighAccuracy:true` + `timeout:8000` + 浏览器权限弹窗。**可达数秒甚至更久**。
- 会话缓存(`map-shell.tsx:481-497`)在挂载即同步恢复 catalog,cached/seed/overlay 的
  company pin 立即可见可点(不等 geoSettled)。所以用户能在 geolocation 仍在飞时点到
  **第一个** pin。
- 用户点下第一个 pin(设置 selectedId/detailPoi,`onMarkerClick` **本身绝不移相机**——
  无 setCenter/flyTo)→ 后台 geolocation 回调此刻落地,执行 `map.setCenter(userLocation)`,
  相机从被点的公司被拽回用户所在位置。
- geolocation 只 resolve 一次(挂载调一次),`geoSettled` 此后为 true → **只有第一次**点击
  会碰到这个未决 promise,之后没有 pending 回调可再拽。
- 排除了挂载对齐 effect(`map-shell.tsx:1181-1191`)直接 setCenter(它只 schedule 一次
  viewport 加载,不改相机);也排除了 onMarkerClick/handleSelect 内的任何 fly
  (`map-markers.ts:602-614` select 只重绘样式;`handleSelect` `map-shell.tsx:1622` 在
  !geoSettled 时直接 return)。唯一在首次交互竞态里往 userLocation setCenter 的是
  `map-shell.tsx:556` 这处挂载 geolocation 回调。

## 修复方向(boss 拍板:最小改动,保持交互语义)

**挂载 geolocation 不要无条件用 `map.setCenter` 抢占/拽走相机;定位只作为数据原点
(userLocation/searchOrigin)与蓝点,不动相机;若用户尚未交互则可移,已交互则不再拽。**

具体(worker 自选实现,保持「用户自己点『定位』按钮仍会移过去」的原语义):
1. `map-shell.tsx:549-562` 挂载 geolocation 成功回调里,**不再无条件 `map.setCenter` +
   `setZoom(15)`**。改为:
   - 记录 `userLocation`/`setSearchOrigin`/`setGeoSettled`(定位数据照常,蓝点由 addControl
     照常显示);
   - 相机移动改为**只在用户尚未与地图交互过**(如 `hasInteractedRef` 为 false,首次
     `map.on('click'/'dragstart'/'zoomstart')` 置 true)时,才 `map.setCenter`+`setZoom`。
     用户已在 geolocation 落地前点过公司 pin → `hasInteractedRef` 已 true → 不再拽相机。
2. 保持 `handleLocate`(`map-shell.tsx:1908-1930`,按钮)点击时仍 `setCenter`+`setZoom`(原义)。
3. `setUserLocation`/`setSearchOrigin` 照常填,不破坏 距离/distance 圆心(session 还原仍用
   它们的语义)。
4. 加一个「用户是否已交互」的 ref(`hasInteractedRef`),在 `map-shell.tsx:715`(map click)、
   或 `map.on('dragstart')`/`zoomstart`、或 onMarkerClick 处置 true。确保首次点 pin 前若
   geolocation 已落地就正常移动(无竞态);首次点 pin 后 geolocation 落地也不再拽。

> 说明:这是「修 bug 但保持现有交互语义」(定位按钮仍能用),正常派发,不是改 UI 设计。

## 测试(必做)

`server/src/components/map-shell.tsx` 是 React 组件,node 单测难直接触发 AMap 竞态。
优先:
- 抽出可单测纯函数:`shouldAutoLocateCamera({ hasInteracted, geoSettled, … })` 之类判定,
  单测断言「未交互→true」「已交互→false」;
- `server/tests/component-contracts.test.mjs` 或新 test 文件补该纯函数契约;
- 浏览器验收(boss 实机)会复验证:首次加载(缓存有公司)立即点公司 pin → 相机不应被拽回。

## 文件边界(绝对路径;worktree = /Users/acccan/dm-wt-wsC)

- 只动:`server/src/components/map-shell.tsx`(挂载 geolocation 段 + hasInteractedRef)、
  `server/tests/*`(相关契约单测)
- **不碰**:`server/src/lib/city-cluster.ts`(ws-b)、`server/src/lib/recruitment-store.ts`
  (ws-a)、`server/src/hooks/use-poi-map.ts`、`server/src/lib/map-markers.ts`、
  `server/src/lib/mode-cache.ts`
  - 如需在 onMarkerClick 里也内置「已交互」flag,注意 usePOIMap 是共享 hook,
    marker 点击走 `map-shell.tsx:1599`——在 map-shell 侧置 flag 即可,不动 hook。

## 门禁(全绿)

```bash
cd /Users/acccan/dm-wt-wsC/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-wsC && make docs-check && git diff --check
```

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-cluster-tune/reports/ws-c.md`:
改动文件 + 根因简述 + 实现 + 测试 + 遇到的问题。末两行:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

worktree 已预建,boss 统一合并。**不 merge / 不 push / 不切分支**。小步 commit(Conventional Commits)。

## 续作附录(boss 2026-08-19,预算超限中断后续作)

已做(未提交):`server/src/components/map-shell.tsx` 的 Bug3 修复已完整写好(23 行):
`hasInteractedRef` + 挂载 geolocation 回调里 `if (!hasInteractedRef.current) { setCenter;
setZoom }` + dragstart/zoomstart/click/onMarkerClick 置 true。开工先 `git status` 确认,
不重做。剩余任务:
1. **先 commit**:`git add server/src/components/map-shell.tsx && git commit -m "fix(locate): 挂载定位不抢占已交互相机(首次点 pin 不再被拽回)"`
2. **测试**(必做):抽/补可单测判定——如把「未交互→允许移相机、已交互→不移」的判定
   写成纯函数或组件契约测试(可加在 `server/tests/component-contracts.test.mjs` 或新文件);
   至少保证 门禁绿。
3. 门禁全绿 + 写报告。
4. 预算纪律:先 commit 再验证。
