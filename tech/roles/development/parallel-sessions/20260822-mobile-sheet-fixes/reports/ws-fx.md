# ws-fx 汇报(2026-08-22)

## 实际改动

分支 `fix/mobile-sheet-fixes`(worktree `/Users/acccan/dm-wt-fx`),4 个 commit,树干净:

1. `f0dc4da fix(fx)` — `server/src/components/map-shell.module.css`
   - `.drawerContent`(:1284-1285)补 `flex: 1 1 auto; min-height: 0`(保持 `overflow: auto`)。drawerContent 由此成为 `.mobileDrawer`(display:flex; flex-direction:column)的可伸缩子项 → 获得确定高度 → `.mobileAgent { height:100% }` 链生效 → `.panel.embedded { flex:1 1 auto; min-height:0 }` 填满剩余 → 消息列表内部滚动、输入框贴 drawer 底。explore/saved/layers/recent 为 auto 内容块,行为不变;mini 态 drawerContent 本就 display:none。
   - `.mobileFilterBtn`(:1422)`height: 32px` → `40px`(该 sheet 内标准/卫星/深色/地图源按钮共用此类,统一变高)。
2. `e3476e6 fix(fx)` — `server/src/lib/i18n.ts` + `server/src/components/map-shell.tsx`
   - i18n.ts 追加 `savedOverlayShow`(:16-19,zh「仅展示收藏图层」/ en「Show saved places only」)与 `savedOverlayHide`(:20-23,zh「取消展示收藏图层」/ en「Hide saved places only」);旧 `savedOverlay` 键保留(桌面 `layers-panel.tsx:115-116` 区块标题用,未动)。
   - map-shell.tsx layers sheet toggle(:2992)文案改为按态取键、保留计数:`{savedOverlay ? t("savedOverlayHide", lang) : t("savedOverlayShow", lang)} {overlayPois.length}`;`aria-pressed={savedOverlay}` 不动。
3. `3e70ce1 test(fx)` — `server/tests/component-contracts.test.mjs`(:1431-1463)新增契约块「mobile sheets: agent fills drawer + saved-layer toggle copy (ws-fx)」,断言:
   - drawerContent 块含 `flex: 1 1 auto` + `min-height: 0` + 保持 `overflow: auto`;
   - `.mobileFilterBtn` 块 `height: 40px`;
   - i18n `savedOverlayShow`/`savedOverlayHide` 键 zh/en 文案精确匹配,旧 `savedOverlay` 键仍存在;
   - toggle 按态取键(`savedOverlay \? t\("savedOverlayHide"` / `: t\("savedOverlayShow"`)、计数保留、`aria-pressed` 保留。
4. `84e7021 docs(fx)` — `tech/24-agent-feature.md` §9.4(:387-389)补一行:内嵌高度链 = `.drawerContent { flex: 1 1 auto; min-height: 0 }`(drawer flex column 可伸缩子项)撑起 `.mobileAgent`/`.panel.embedded`,消息列表内部滚动、输入框贴 drawer 底。

## 门禁结果

- npm test: **1420 通过 / 0 失败 / 2 skip**(基线 1415 + 并发 dev 合入新增测试;全绿)
- typecheck: 通过
- docs-check: 通过;`git diff --check`: 无输出(干净)

## 遇到的问题

- 无。任务给出的 CSS 行号(:1278/:1415)与 dev 合入后实际行号(:1283/:1415 附近)略有偏移,已按选择器定位核实后修改;断言按选择器块切片,不受行号漂移影响。
- 测试单跑 `node --test tests/component-contracts.test.mjs` 被沙箱拦截,改走全量 `npm test`(同一断言已随全量跑绿)。

## 证据

- `npm test` 尾部: `ℹ tests 1422 ℹ pass 1420 ℹ fail 0 ℹ skipped 2`
- `npm run typecheck`(tsc --noEmit): 无输出,退出码 0
- `make docs-check`: "Documentation policy check passed."
- `git log`: f0dc4da / e3476e6 / 3e70ce1 / 84e7021 四连 commit;`git status --short` 空
- 未 merge、未 push;worktree/分支留原地

门禁: PASSED
结论: OK
