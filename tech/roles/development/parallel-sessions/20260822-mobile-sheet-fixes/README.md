# Batch — 20260822-mobile-sheet-fixes(轮3:AI sheet 填满抽屉 + 收藏图层按钮文案/高度)

## 目标(用户反馈,轮3)

1. **BUG:AI 助手下方空缺太大** —— 内嵌 agent sheet 面板不填满抽屉,输入框没有贴底。
2. **收藏图层按钮太窄** —— 文案改为「仅展示收藏图层」/「取消展示收藏图层」(按开关态),
   按钮高度调高一点。

## boss 侦察(2026-08-22,读码核实,dev=9ef8106+ 并发 dbf9c91)

### bug 1 根因(实锤)

- `.mobileDrawer`(`map-shell.module.css:1163-1164`)**已是 `display:flex; flex-direction:column`**,
  有确定高度(mini 96 / half 42svh / full calc(100svh-…))。
- `.drawerContent`(:1278-1291):`overflow:auto; width:100%`,**auto 高度 block** —— 不是 flex item,
  无确定高度。
- `.mobileAgent { height:100% }`(ws-ae 加)与 `.panel.embedded { height:100% }`(ws-ae 加)的
  **百分比高度链断裂**(父级 auto → 百分比解析为 auto)→ 面板取自然高度(标题+消息+输入行),
  抽屉下半段留白 = 用户所见「下方空缺太大」。
- 面板内部结构本身正确:`agent-panel.module.css` `.panel` base 已是
  `display:flex; flex-direction:column`,`.list { flex:1 1 auto; overflow-y:auto }`(:472-477),
  `.inputRow` 在尾部 —— **只要面板拿到确定高度,列表内部滚动、输入框自然贴底**。

**修复方案**:`.drawerContent` 加 `flex: 1 1 auto; min-height: 0`(成为 drawer flex column 的
可伸缩子项,获得确定高度)→ `.mobileAgent { height:100% }` 链即生效 →
`.panel.embedded { flex:1 1 auto; min-height:0 }` 填满 → 输入框贴 drawer 底。
explore/saved/layers/recent 均为 auto 内容块,行为不变(短内容时下方留白与现状一致)。

### 需求 2 现状

- 移动端 layers sheet toggle(`map-shell.tsx` 2876-2883 附近):
  `{t("savedOverlay", lang)} {overlayPois.length}`,`aria-pressed={savedOverlay}`。
- i18n `savedOverlay`(`i18n.ts:12-15`):zh「收藏图层」/ en「Saved layer」——
  **桌面 layers-panel.tsx 仍把它当区块标题用(:115-116),不动**;移动 toggle 改用新键。
- `.mobileFilterBtn`(`map-shell.module.css:1415-1425`):`height:32px; border-radius:99px`,
  pill 太扁 → 调高到 **40px**(同 sheet 的标准/卫星/深色/地图源按钮共用此类,统一变高,
  视觉一致)。

## Workstream 表

| ws | 分支 | worktree | 主题 | 文件边界 |
|---|---|---|---|---|
| fx | fix/mobile-sheet-fixes | ../dm-wt-fx | drawerContent 高度链修复 + 收藏图层按钮文案/高度 | `map-shell.module.css`(drawerContent flex:1/min-height:0;mobileFilterBtn height 40)、`map-shell.tsx`(layers sheet toggle 文案)、`lib/i18n.ts`(2 新键)、`tests/component-contracts.test.mjs`(追加契约)、`tech/24-agent-feature.md`(§9.4 补一行) |

## 合并顺序

1. ws-fx(单 ws)→ 门禁绿 → push origin/dev

## 布局图

```
bug1 目标(390×844):
┌─ drawer full ─────────────────────────────┐
│ [M][图层][已保存][探索][最近][✦AI]   (头像) │
│ ‹ 返回                                    │
│ ┌──────────────────────────────────────┐  │
│ │ ✦ AI 助手        💬会话 🧠记忆 ✕     │  │
│ │ 消息列表(内部滚动,撑满)               │  │
│ │ [输入框…] [发送/停止/撤销]            │  │ ← 贴 drawer 底(不再留白)
│ └──────────────────────────────────────┘  │
└───────────────────────────────────────────┘

需求2:
[仅展示收藏图层 12]  ← 关(点击开)
[取消展示收藏图层 12] ← 开(点击关)
pill 高度 32 → 40px
```
