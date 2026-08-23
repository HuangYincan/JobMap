# Batch — 20260822-mobile-toolbar(移动端工具栏 items + AI 助手入工具栏)

## 目标

移动端适配:把桌面端侧控栏的 **图层 / 已保存 / 探索 / 最近** 4 个 item 移入
`map-shell` 的 `.mobileToolbar` **左侧**(与 ModeSwitcher 同簇);**AI 助手也作为
一个 item** 进工具栏,移动端不再沿用悬浮球(悬浮球保留桌面端)。

## boss 侦察情报(2026-08-22,已读码核实 file:line)

### 现状

- **`.mobileToolbar`**(`server/src/components/map-shell.tsx:2653-2669`):`.mobileDrawer`
  内首行,当前只有 ModeSwitcher(左)+ 头像按钮(右,`margin-left:auto`)。CSS
  `map-shell.module.css:1318-1325`(`flex; space-between; gap:8px; flex-wrap:wrap; padding:0 0 8px`),
  全部在 `@media (max-width:767px)` 块内(1130 起);`.drawerMini .mobileToolbar {display:none}`
  在 1266-1268。工具栏仅当无 POI detail 时渲染。
- **桌面侧控栏 4 item**(`map-shell.tsx:2314-2366`):图 layers / 已保存 bookmark /
  探索 grid / 最近 history;语义——`openRail(panel)`(567-574,同 panel 再点=关闭);
  **已保存有 auth 门禁**(`if (!user) { setAuthOpen(true); return; }`,2330-2336);
  label 走 i18n `layers/saved/explore/recent`(i18n.ts:9/17/21/25)。
- **移动 sheet 状态已就绪**:`mobileSheet: "explore"|"saved"|"layers"|"account"|"recent"`
  (`map-shell.tsx:359`);saved/layers/recent 的 sheet body 已在 drawer 内
  (2843-2905),现在只能经 头像→account sheet 的导航(2771-2806)到达;
  explore 是默认 sheet(search stack 2670+)。`openMobileAccount`
  (1985-2000):setMobileSheet("account") + drawer full;已在 account sheet 再点→回 explore。
- **AI 助手**:`AgentBall`(`server/src/components/agent-ball.tsx`)44px 圆形玻璃球,
  **全视口渲染**(`map-shell.tsx:2580`),local state `open`(76 行),点击 toggle(134 行),
  `open` 时渲染 `AgentPanel`(184-194 行)。球 CSS `position:fixed; z-index:11`
  (`agent-ball.module.css:16,25`),无移动端 media query(48 行只有 dark)。
  `AgentPanel`(`agent-panel.tsx`):桌面 360×70vh 卡片锚球;≤767px 全宽底部 sheet
  (`agent-panel.module.css:736-749`,`transform:none; bottom:0`),与球位置无关。
  i18n `agentBall`="AI 助手" 已存在(tech/24 §9.5)。

### 关键坑(z-index 实测)

- `.mobileDrawer` z-index **12**(map-shell.module.css:1062);`AgentPanel` z-index **12**
  (agent-panel.module.css:22)但 panel 在 DOM 中先于 drawer 渲染
  (`map-shell.tsx:2580` vs 2582+)——**同 z 时 DOM 后出现者在上,drawe 会盖住 panel**。
  移动端从工具栏打开 AI sheet 必须把 panel 抬到 drawer 之上
  (≤767px media query 内 `z-index` 提到 ≥13;桌面保持现状)。

### 决策(boss 定,已按设计系统)

- 工具栏左簇 = **ModeSwitcher + 图层 + 已保存 + 探索 + 最近 + AI**,头像仍在右
  (`margin-left:auto` 保持)。
- item 全部**图标钮**(与 ModeSwitcher/桌面折叠 rail 一致),40px 触控,gap 4px;
  `aria-label` + `title` 走 i18n(`layers/saved/explore/recent/agentBall`);
  **激活态 `#007AFF`**(navItemActive 同款);`flex-wrap:wrap` 兜底窄屏。
- 交互:图层/已保存/最近 → `setMobileSheet(<item>)` + `setDrawer("full")`(与
  openMobileAccount 一致);**已保存保留 auth 门禁**(未登录 → AuthModal);
  探索 → `setMobileSheet("explore")`(不强制改 drawer 高度,默认 sheet);
  AI → toggle 面板;**重复点击激活项 → 回 explore 默认 sheet / 关面板**
  (镜像桌面 openRail toggle + 头像二次点语义)。
- **back 目标追踪**:saved/layers/recent sheet 的 `mobileBackBtn` 现在硬编码
  `setMobileSheet("account")`(2840/2861/2881 附近)。工具栏进入的 sheet,back 应回
  **explore**;account sheet 导航进入的,back 回 **account**。加一个来源状态
  (`mobileSheetBack: "explore" | "account"`),入口处设置,back 用它。
- **account sheet 内导航按钮(2771-2806)保留不动**(用户未要求移除;两入口并存)。
- **AI 状态提升**:`agentOpen` 提到 MapShell,`<AgentBall open onOpenChange …/>`
  受控;球在 ≤767px 隐藏(`agent-ball.module.css` 加 media query `.ball{display:none}`,
  panel 是 fragment 兄弟节点不受影响);桌面球/拖拽/锚定/持久化全部不动。
- 面板 z 修复见「关键坑」。

## Workstream 表

| ws | 分支 | worktree | 主题 | 文件边界 |
|---|---|---|---|---|
| mt | feature/mobile-toolbar | ../dm-wt-mt | 工具栏左簇 5 items + AI 受控化 + 球移动端隐藏 + 面板层级 | `map-shell.tsx`(工具栏/图标/agentOpen/back 目标)、`map-shell.module.css`、`agent-ball.tsx(+module.css)`、`tests/component-contracts.test.mjs`、`tech/24-agent-feature.md`(回填)、`.claude/skills/frontend-component-dev/SKILL.md`(mobileToolbar 描述同步) |

## 合并顺序

1. ws-mt(单 ws,直接合)→ 门禁绿 → push origin/dev。Env-only 步骤不做。

## 布局图(设计定稿,见 prompts/ws-mt.md)

```
现状 mobileToolbar(≤767px,half/full 可见)
┌────────────────────────────────────────────┐
│ [M][M]                         (头像)       │
└────────────────────────────────────────────┘
目标
┌────────────────────────────────────────────┐
│ [M][M] [图层][已保存][探索][最近][✦AI] (头像) │
│ ←──── 左簇(40px 图标钮,gap 4px)────→ 右置   │
└────────────────────────────────────────────┘
```
