# ws-a — Bug1 卡片选中也置 hasInteractedRef(补全竞态盲区)

## 背景

用户「首次点击 poi 还是回到用户所在位置」复测。上一批已修地图 pin 竞态(onMarkerClick 置位 + geolocation 门控),但 Explore 确认**门控有个竞态盲区**:

**`hasInteractedRef` 由 onMarkerClick / 地图 click / dragstart / zoomstart 置 true,但「卡片/列表选中公司」这条路径不置位。**
- 桌面列表 onSelect=`handleSelect`(map-shell.tsx:2108 → 1404):只 setSelectedId,不置 hasInteractedRef。
- 移动端抽屉 onSelect(map-shell.tsx:2632-2639):handleSelect + setDetailPoi + `flyToLocation(公同)`——**也不置 hasInteractedRef**。
- geolocation(getCurrentPosition,amap-api.ts:567)真异步数秒才 resolve;若用户首次交互是点卡片(而非点地图 pin),ref 仍 false → geolocation 晚 resolve 时 map-shell.tsx:510 的门控不生效 → `map.setCenter(userLocation)` + `setZoom(15)` 把相机从被点公司拽回用户位置。移动端还叠加 `flyToLocation(公同)` 恰被这次的 setCenter 覆盖。
- 上一批修的 onMarkerClick 置位(map-shell.tsx:1381)只覆盖「点地图上的 pin」,没覆盖「点列表卡片」。

## 修复(最小改动,保持交互语义)

**让「首次交互」的所有入口都置 `hasInteractedRef=true`**,与地图 pin 同口径:
1. `handleSelect`(map-shell.tsx:1404)开头置 `hasInteractedRef.current = true`(卡片/建议选中都走它)。
2. `handleSelectSuggestion`(map-shell.tsx:1517)同样置 true(搜索建议点击也会 flyTo)。
3. 其它 flyTo 入口(handleRefreshHere 落地 1327、已保存落地 1295/1299、附近落地 1779/1781、卡片落地 2151、建议键盘 2311)凡用户在 geolocation resolve 前点触发相机移动的,也都置 true——worker 逐一检查 map-shell.tsx 所有 `flyToLocation(` 调用点,凡属「用户主动选择/落地」都在点前置位。
4. 保持 `hasInteractedRef` 置位不在 hooks 里(触碰 useWorkViewport/usePOIMap 属越界),全在 map-shell 侧。

> 语义不变:geolocation 只作为数据原点(蓝点/userLocation/searchOrigin),用户尚未交互才自动移相机;现在「点卡片/建议选择」也算交互。

## 测试(必做)

`server/tests/component-contracts.test.mjs` 补/更新契约:断言 handleSelect / handleSelectSuggestion 内 `hasInteractedRef.current = true`;既有 Bug3 门控用例(510 行结构)保持。typecheck 全绿。

## 文件边界(绝对路径;worktree = /Users/acccan/dm-wt-wsA)

- 只动:`server/src/components/map-shell.tsx`、`server/tests/component-contracts.test.mjs`
- **不碰**:`server/src/hooks/*`(qa6 抽的 hook)、`server/src/lib/viewport-search.ts`/`server/src/lib/mode-cache.ts`(ws-v)、`server/src/components/poi-list.tsx`/`account-panel.tsx`(ws-u)、`server/src/lib/*`(qa 批次已绿)

## 门禁(全绿)

```bash
cd /Users/acccan/dm-wt-wsA/server && npm test && npm run typecheck
cd /Users/acccan/dm-wt-wsA && make docs-check && git diff --check
```

## 回报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260819-boss-viewport-profile/reports/ws-a.md`:
改动文件 + 根因简述 + 实现 + 测试 + 遇到的问题。末两行:
```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```

worktree 已预建,boss 统一合并。**不 merge / 不 push / 不切分支**。小步 commit(Conventional Commits)。预算纪律:先 commit 再验证。

## 续作附录(boss 2026-08-19,预算超限中断后收尾)

已 commit:`6bebd9d`(hasInteractedRef 卡片/建议选中置位,Bug1 核心修复)。未提交:`server/src/components/map-shell.tsx` 有 8+/0- 小改动(可能是测试或补充)。开工 `git status` + `git diff` 对账。剩余:
1. 检查未提交的 8 行是什么——若是实现补全则确认并 **先 commit**(若已属 6bebd9d 应含内容则合并说明;若需单测断言则补测试后 commit)。
2. 补/更新 component-contracts 契约(Bug1 卡片/建议选中置位断言),commit。
3. 完整门禁(npm test + typecheck + docs-check + diff-check)+ 写报告。
4. 预算纪律:先 commit 再验证。
