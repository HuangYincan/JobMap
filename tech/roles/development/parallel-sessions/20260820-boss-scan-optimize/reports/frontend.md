# ws-frontend 汇报(2026-08-20)

## 实际改动

- `server/src/hooks/use-saved-layer.ts`(新增,109 行)→ 收藏图层 Hook(QA scan #6):
  - `savedOverlay` 状态 + 挂载读回持久化偏好(`readSavedOverlayPref(true)`)
  - `overlayPois` 派生(`savedPlacesToOverlay`,与原 memo 依赖一致)
  - `toggle`:登录门控(未登录 → `onRequireAuth` 回调开登录弹窗)→ 写 pref + 翻转 → 开视口刷新抑制窗口(`VIEWPORT_SUPPRESS_MS`,ref 由 map-shell 传入与 useWorkViewport 共享)→ `map.setBounds` / `setCenter` fallback(顺序与原实现逐行一致)
  - `hide`:登出时重置状态 + 持久化关闭(`writeSavedOverlayPref(false)`)
  - `onRequireAuth` 经 ref 调用,toggle 的 useCallback 依赖保持 `[user, savedOverlay, overlayPois] + 稳定 refs`,identity 行为与重构前一致
- `server/src/components/map-shell.tsx`(2769 → 2746 行,净 -23)→ 只留接线:
  - 删除 `savedOverlay` state、mount effect 中的 pref 读回、`overlayPois` memo、`handleToggleSavedOverlay`、logout 分支两行直写
  - 解构 `useSavedLayer({ user, savedPlaces, compareCatalog, mode, mapInstance, suppressViewportRefreshUntilRef, onRequireAuth })`;marker 池合并(workMarkerPois/markerPois)、LOD 恒显示、fly 解析等消费点零改动(同名变量)
  - 清理 4 个不再使用的导入(`overlayBounds`/`readSavedOverlayPref`/`savedPlacesToOverlay`/`writeSavedOverlayPref`、`VIEWPORT_SUPPRESS_MS`);一处注释去掉失效的常量名
- `server/tests/component-contracts.test.mjs` + `server/tests/hooks-contracts.test.mjs` → 契约断言迁移 + 新增:
  - saved-overlay-wipe 抑制顺序断言(suppress < setBounds < setCenter)从 map-shell 迁入 use-saved-layer
  - logout 断言改为 `hideSavedOverlay()` 接线 + hook 内 hide 逻辑
  - 新增 useSavedLayer 存在性/签名(hooks-contracts)+ 接线与内部逻辑断言(component-contracts):`savedPlacesToOverlay` 派生、`readSavedOverlayPref(true)` 初始化、未登录走 `onRequireAuthRef`、`writeSavedOverlayPref(next)` 翻转、marker 池合并与 LOD 恒显示消费 hook 返回值、shell 不再直接持有状态/派生/toggle

## 门禁结果

- npm test: 488 通过 / 0 失败(2 skip,基线即 skip)
- typecheck: 通过
- docs-check: 通过
- git diff --check: 通过

## 遇到的问题

无阻塞。中途发现 `hooks-contracts.test.mjs` 62 行也断言了 map-shell 内的抑制写入(初始 grep 只覆盖了 component-contracts),测试跑红后定位并同步迁移——契约测试已全绿。

## 后续建议(map-shell 剩余 2746 行,未在本批扩展)

- 最高价值:抽屉/详情状态(useDetailDrawer)——`setDetailPoi` 在 18 处散布调用,且与 drawer/mobileJd/selectedId/railPanel 联动,抽离需同时处理联动组,风险高于本批;建议拆成「详情状态 + 抽屉三态」两步走,先抽纯状态组再抽手势
- 搜索交互已由 useSearchState 覆盖,无需重复
- 账户/收藏数据获取(refreshAccount/refreshHistory/refreshSaved/refreshApplications)可考虑合并为 useAccountData,但涉及跨组件 setState 传递,需先列清读写矩阵

## 证据

- 提交:`cf7479f refactor(map-shell): 收藏图层抽 useSavedLayer hook`(128+/42-,含新 hook)、`b2f396c test(map-shell): 契约断言随 useSavedLayer 迁移 + 新增 hook 契约`
- 测试输出:`tests 490 / pass 488 / fail 0 / skipped 2`,`tsc --noEmit` 无输出
- 分支 tip 两个 commit,工作树干净;未 merge 回 dev、未 push

门禁: PASSED
结论: OK
