# ws-b 汇报(2026-08-19)

## 实际改动

- `server/src/components/map-shell.tsx`(+2)→ `handleAuthAction` 登出分支(map-shell.tsx:1708-1719)在 `setUser(null)` / `setSavedPlaces([])` 旁并排新增 `setSavedOverlay(false)` + `writeSavedOverlayPref(false)`,登出时状态与持久化 pref 同步重置。
- `server/tests/component-contracts.test.mjs`(+10)→ 新增契约用例「logout resets saved overlay state and pref alongside saved places」:截取 `handleAuthAction` 块,断言登出分支含 `setUser(null)`、`setSavedPlaces([])`、`setSavedOverlay(false)`、`writeSavedOverlayPref(false)`。

## 根因(Layout vs Data 区分)

- **Layout(主因,非 bug)**:移动端 `openMobileAccount`(map-shell.tsx:1691)→ `setDrawer("full")` 全屏抽屉(z-index:5)覆盖 `.mapCanvas`(z-index 低层),POI pin 被视觉遮蔽。切回 explore 后 drawer 回落、marker 复用、poi 恢复——数据从未清空。属抽屉全屏设计。
- **Data(次因,已修)**:登出只清 user/savedPlaces,`savedOverlay` pref 保持 true;而 `mapPois = mergeMapPois(..., savedOverlay && Boolean(user), ...)`(map-shell.tsx:1139)以 user 为门,user 为 null 时 overlay 部分被丢弃 → 收藏 pin 静默消失、pref 与真实状态脱钩,再登录时 layer 仍"以为"开着。修复后状态与 pref 登出即重置,无脱钩窗口。

## 实现

1. 登出分支 `setSavedOverlay(false)` + `writeSavedOverlayPref(false)`(与清 savedPlaces 并排,同一次 `.then()` 内)。
2. `readSavedOverlayPref` 检查:仅挂载时调用(map-shell.tsx:242),非 user 感知;但渲染门 `savedOverlay && Boolean(user)`(行 1139)已兜底 guest 场景,且登出重置后状态与 pref 一致,无需额外改动。

## 测试

- 契约测试:新增用例通过(包含在 446 pass 内)。
- 门禁全绿,见下。

## 遇到的问题

- **移动抽屉覆盖(任务项 3)——不改,记 deferred**:检查 `.mobileDrawer` 全开态 CSS(map-shell.module.css:1119-1139),`max-height: calc(100svh - max(12px, env(safe-area-inset-top)) - 20px)`(行 1132,注释「顶边=指南针中心」)——**并非全屏无任何露出**,顶部已留 ~32px 地图条带,「poi 消失」误解已有设计缓解。任务条件是"若全屏无任何露出"才加 60px;强行改到 60px 会破坏既有设计语义(顶边与指南针中心对齐、handle 溢出、`overflow: visible` 布局),按「改动只会破坏移动端布局则跳过」跳过,记 deferred,留待 boss 裁决是否做视觉改善。

## 证据

- `git log --oneline -1`:`4506e6a fix(map-shell): reset saved overlay state and pref on logout`
- npm test 输出尾部:`ℹ tests 448 / ℹ pass 446 / ℹ fail 0 / ℹ cancelled 0 / ℹ skipped 2`(duration ~1907ms)
- typecheck:`tsc --noEmit` 无输出(通过)
- docs-check:`Documentation policy check passed.`
- `git diff --check`:无输出(通过);`git status --short` 干净

门禁: PASSED
结论: OK
