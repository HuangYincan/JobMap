# ws-poi-vanish 汇报(2026-08-20)

分支:`fix/poi-first-click-camera`(worktree /Users/acccan/dm-wt-poi-vanish,未 merge、未 push)。

## 实际改动(3 个小步 commit,每个独立可回退)

### commit 1 `c0c95f3 fix(map-shell): 首点点击不再抑制 geolocation 相机跟随`
- `server/src/components/map-shell.tsx`
  - L177:`hasInteractedRef` **改名 `userMovedMapRef`**(唯一读点就是 settle 门控,排查结论见下)
  - L514:geolocation settle 相机门控改为 `if (!userMovedMapRef.current)`(未手动移图 → `map.setCenter(用户位置)+setZoom(15)+setMapCenter`;已移图 → 不飞、圆心不甩)
  - L679/682:仅 `dragstart`/`zoomstart`(相机手势)置位
  - **L686(原 682)map 空白点击:删掉置位**(空白点击不动相机)
  - **L1492(原 1471)onMarkerClick:删掉置位**(主根因——首点 pin 点击不再抑制 settle 相机跟随)
  - **L1512(原 1497)handleSelect 卡片/列表选中:删掉置位**(选择公司 ≠ 放弃定位)
  - 5 个 flyTo 入口保留置位(会动相机):handlePickSaved(L1386)、handleOpenApplication(L1413)、handleSelectSuggestion(L1602)、handlePickRecent→openDetail(L1858)、onOpenDetail(L2234)
- `server/tests/component-contracts.test.mjs` + `server/tests/pending-fly-to.test.mjs`:Bug3/Bug1 契约测试改写为新语义(门控无 hasInteractedRef、marker/空白点击不置位、flyTo 入口置位、set-once-never-reset)

### commit 2 `f555d97 fix(map-shell): handleLocate 失败保持视野不回默认中心`
- `server/src/components/map-shell.tsx` L1695-1724:`!loc` 与 `.catch` 分支**不再** `setCenter([120.15,30.27])+setZoom(13)`;保持当前视野,仅 `console.warn` 说明(失败 = 不打扰;未新增 UI,注释注明可接 toast)。成功分支 `setCenter([lng,lat])+setZoom(15)` 不变
- `server/tests/component-contracts.test.mjs`:Bug3 测试补 `locateBlock` 无 `120.15`/`setZoom(13)` 断言 + 新增独立测试「handleLocate 失败保持视野:不回杭州默认中心」

### commit 3 `1760395 fix(map-shell): distance 圆心在定位前不落杭州默认值`
- `server/src/components/map-shell.tsx`
  - L995:`distanceRadius = userLocation ? distanceFilterMeters(filters) : 0` —— 定位成功前视同无 distance(圆圈 overlay 也不画)
  - L997-1000:新增 `effectiveFilters` —— 定位前把 pipeline 入参里的 `distance` 键剥离(防止 runPOIPipeline 以杭州默认圆心裁池)
  - L1146/1190:pois(列表)与 workMarkerPois(marker 池)两个 pipeline 调用点改吃 `effectiveFilters`;两个 useMemo deps 同步(定位落地后 userLocation 变化会重跑管线,以用户位置/真实视野中心为圆心)
- `server/tests/component-contracts.test.mjs`:新增「distance 圆心:定位落地前 distance 筛选不生效」契约(半径 gating + 剥离键 + 两处调用点 ≥2)

## hasInteractedRef 排查结论(是否拆分标志)

- 全仓库 grep:11 处写、**仅 1 处读**(map-shell.tsx settle 门控 L512)。它**没有**承担「区分首次交互」的第二职责(那是已删除的 pendingFlyToRef 时代遗留)——不存在需要拆分的双职责。
- 但写点语义过宽(pin/卡片/空白点击都算「交互」),且旧名已误导。结论:**单标志改名 `userMovedMapRef` + 收窄写点**(相机手势 + flyTo 操作),不新增第二个 ref。既有的 `ignoreNextMapClick`(marker 点击后吞 map click)与选中高亮逻辑零改动。
- 附带验证:geolocation settle 里 `map.setZoom(15)` 触发 zoomstart 置位发生在门控判断**之后**,不影响本次 settle(每次挂载只有一次 settle),无自锁问题。

## 契约测试新增/改写断言

1. `if (!userMovedMapRef.current) {…setCenter…setZoom(15)…setMapCenter}` 门控(settle 相机移动不再被 pin 点击抑制)
2. `map.on("click")` / `onMarkerClick` **不**含 `userMovedMapRef.current = true`(改锁新语义,原断言锁定旧 bug 行为)
3. dragstart/zoomstart 与 5 个 flyTo 入口置位
4. locateBlock 无 `120.15`、无 `setZoom(13)`(handleLocate 失败不回杭州);成功分支 `setCenter([lng,lat])+setZoom(15)` 保留
5. `distanceRadius = userLocation ? distanceFilterMeters(filters) : 0`;`effectiveFilters` 定位前剥离 distance 键;两处 pipeline 调用点吃 effectiveFilters

## 遇到的问题

- `FilterState` 索引签名不允许 `distance: undefined`(TS2322)→ 改为 `Object.fromEntries(Object.entries(filters).filter(k => k !== "distance"))` 剥离键,语义等价且类型干净。
- 门禁命令 `make docs-check` 在本会话 cwd(server/)无 Makefile → 用等价 grep 直接验证(make 目标本身就是 `! grep …`),无匹配通过。
- 现有契约测试(component-contracts Bug3/Bug1、pending-fly-to 共 8 处断言)**锁定的正是旧 bug 行为**(如「onMarkerClick 置 hasInteractedRef」、handleLocate 无条件 setCenter 回杭州)——按任务意图改写为锁新行为,属本 WS 契约测试职责;其余 487 条测试零改动零失败。

## 门禁结果(最终态)
- npm test:**495 通过 / 0 失败 / 2 skip**(基线 493 + 新增 2 条)
- typecheck:通过
- docs-check(等价 grep):通过
- git diff --check:通过(工作树干净)

## 证据
- `git log --oneline -3`:`1760395` / `f555d97` / `c0c95f3` 三个 fix commit,工作树 clean
- npm test 输出摘要:`ℹ pass 495 / ℹ fail 0 / ℹ skipped 2`
- 静态契约断言全文见 `server/tests/component-contracts.test.mjs`(Bug3/Bug1/两个 ws-poi-vanish 新测试)与 `server/tests/pending-fly-to.test.mjs`

门禁: PASSED
结论: OK
