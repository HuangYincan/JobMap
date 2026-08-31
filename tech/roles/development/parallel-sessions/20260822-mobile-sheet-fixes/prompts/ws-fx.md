# Workstream fx — fix/mobile-sheet-fixes(AI sheet 填满抽屉 + 收藏图层按钮)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-fx`)内开发,
不 merge、不 push、不碰主树。** 汇报写入
`/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-mobile-sheet-fixes/reports/ws-fx.md`
(末两行 token,见文末)。

## 背景(boss 侦察,2026-08-22,读码核实)

### bug 1:AI 助手下方空缺太大,输入框没贴底

**根因**:`.drawerContent`(`map-shell.module.css:1278-1291`)是 auto 高度 block
(`overflow:auto`),不是 drawer flex column 的可伸缩子项 → `.mobileAgent { height:100% }`
与 `.panel.embedded { height:100% }`(均 ws-ae 合入)的百分比高度链断裂 → 面板取自然
高度,抽屉下半段留白。面板内部结构本身正确(`.panel` base 是 flex column,
`.list { flex:1 1 auto; overflow-y:auto }`,`agent-panel.module.css:472-477`,输入行在尾
部)——**只要面板拿到确定高度,列表内部滚动、输入框自然贴底**。

**修复**:`.drawerContent` 加 `flex: 1 1 auto; min-height: 0`(`.mobileDrawer` 已是
`display:flex; flex-direction:column`,:1163-1164)。效果:
- drawerContent 获得确定高度 → `.mobileAgent { height:100% }` 链生效 →
  `.panel.embedded { flex:1 1 auto; min-height:0 }` 填满剩余 → 输入框贴 drawer 底。
- explore/saved/layers/recent 均为 auto 内容块,**行为不变**(短内容时留白与现状一致,
  长内容照旧经 drawerContent overflow:auto 滚动)。mini 态 drawerContent 本就 display:none。

### 需求 2:收藏图层按钮太窄

- 移动 layers sheet toggle(`map-shell.tsx` 2876-2883 附近):
  `{t("savedOverlay", lang)} {overlayPois.length}`,`aria-pressed={savedOverlay}`。
- 桌面 `layers-panel.tsx:115-116` 把 `savedOverlay` 当**区块标题**用,不动。
- `.mobileFilterBtn`(:1415-1425):`height:32px` pill → 调高到 40px(该 sheet 内
  标准/卫星/深色/地图源按钮共用此类,统一变高)。

## 布局图

```
bug1 目标(390×844):输入框贴 drawer 底,无留白
┌─ drawer full ─────────────────────────────┐
│ [M][图层][已保存][探索][最近][✦AI]   (头像) │
│ ‹ 返回                                    │
│ ✦ AI 助手          💬会话 🧠记忆 ✕        │
│ 消息列表(内部滚动,撑满)                    │
│ [输入框…] [发送/停止/撤销] ← 贴底           │
└───────────────────────────────────────────┘

需求2:[仅展示收藏图层 12](关) / [取消展示收藏图层 12](开);pill 32 → 40px
```

## 任务

### 1. map-shell.module.css

- `.drawerContent`(:1278 块)加 `flex: 1 1 auto; min-height: 0`(保持 overflow:auto)。
- `.mobileFilterBtn` `height: 32px` → `height: 40px`。
- 不要动其他任何样式(尤其 ws-mt/ws-ae 的工具栏簇与 `.panel.embedded` 已在位,
  flex 链只需 drawerContent 一环)。

### 2. lib/i18n.ts

新增两个键(zh/en,与现有键风格一致):
- `savedOverlayShow`:zh「仅展示收藏图层」/ en「Show saved places only」
- `savedOverlayHide`:zh「取消展示收藏图层」/ en「Hide saved places only」
- 旧 `savedOverlay`(收藏图层)保留不动(桌面 layers-panel 区块标题用)。

### 3. map-shell.tsx(仅 layers sheet toggle)

`:2876-2883` 附近按钮文案改为按态取键,保留计数:
```tsx
{savedOverlay ? t("savedOverlayHide", lang) : t("savedOverlayShow", lang)} {overlayPois.length}
```
`aria-pressed={savedOverlay}` 不动。

### 4. 测试(server/tests/component-contracts.test.mjs)

追加一个契约块(如「mobile sheets: agent fills drawer + saved-layer toggle copy (ws-fx)」):
- drawerContent `flex: 1 1 auto` + `min-height: 0` 断言(css);
- `.mobileFilterBtn` `height: 40px` 断言(css);
- i18n `savedOverlayShow`/`savedOverlayHide` 键存在(zh/en 文案断言);
- toggle 文案按态取键(`savedOverlay \? t\("savedOverlayHide"` 与
  `: t\("savedOverlayShow"` 正则);
- 旧 `savedOverlay` 键保留(桌面标题用)。

### 5. 文档

- `tech/24-agent-feature.md` §9.4 补一行:内嵌高度链 = `.drawerContent { flex:1 1 auto;
  min-height:0 }`(drawer flex column 可伸缩子项)撑起 `.mobileAgent`/`.panel.embedded`,
  输入框贴底。
- skill.md 若无相关描述则不动(轮1/2 句子已覆盖工具栏与 AI sheet;本批不引入新 UI 描述)。

### 6. 验证(重要)

- `cd /Users/acccan/dm-wt-fx/server && npm test`、`npm run typecheck`;
- `cd /Users/acccan/dm-wt-fx && make docs-check`、`git diff --check`;
- 若全量跑出现非本批数据测试失败(dev 数据测试已由并发 geofix 修复,理论上无),
  以「是否仅既有失败」为准并在汇报说明。

## 文件边界

- 只允许改:`server/src/components/map-shell.module.css`(仅 drawerContent flex 行 +
  mobileFilterBtn height)、`server/src/components/map-shell.tsx`(仅 layers toggle 文案)、
  `server/src/lib/i18n.ts`(仅追加 2 键)、`server/tests/component-contracts.test.mjs`、
  `tech/24-agent-feature.md`(§9.4 一行)。
- **不碰**:agent-panel.*、agent-ball.*、工具栏簇、其他 sheet body、桌面 rail/layers-panel、
  其他 tech 文档、agent.md、`server/data/**`、后端/DB。
- 小步 commit(Conventional Commits:`fix` / `test` / `docs`)。

## 门禁(必须全绿)

1. `cd /Users/acccan/dm-wt-fx/server && npm test`(全量,基线 1415 pass/0 fail/2 skip)
2. `cd /Users/acccan/dm-wt-fx/server && npm run typecheck`
3. `cd /Users/acccan/dm-wt-fx && make docs-check` && `git diff --check`

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-mobile-sheet-fixes/reports/ws-fx.md`:
改动文件、实现要点(file:line)、测试断言、高度链修复说明。**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
