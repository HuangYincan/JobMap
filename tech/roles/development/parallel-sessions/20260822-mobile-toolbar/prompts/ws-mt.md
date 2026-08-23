# Workstream mt — feature/mobile-toolbar(移动端工具栏 items + AI 助手入工具栏)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-mt`)内开发,
不 merge、不 push、不碰主树。** 汇报写入
`/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-mobile-toolbar/reports/ws-mt.md`
(末两行 token,见文末)。

## 背景(boss 侦察,2026-08-22,均读码核实)

**目标**:移动端(≤767px)`.mobileToolbar` 左侧加 5 个 item:图层 / 已保存 / 探索 /
最近(桌面侧控栏同款)+ AI 助手;AI 助手在移动端不再用悬浮球,改工具栏 item
(悬浮球桌面端保留)。

现状关键锚点(`server/src/components/map-shell.tsx`):
- `.mobileToolbar` JSX 2653-2669:ModeSwitcher(左)+ 头像按钮(右,`margin-left:auto`),
  `onClick={openMobileAccount}`。
- 桌面 rail 4 item 2314-2366:图层 `Icon name="layers"` / 已保存 `bookmark`(auth 门禁
  2330-2336,`if (!user) { setAuthOpen(true); return; }`)/ 探索 `grid` / 最近 `history`;
  i18n label `layers/saved/explore/recent`。
- `mobileSheet` state 已支持 `"explore"|"saved"|"layers"|"account"|"recent"`(:359);
  saved/layers/recent sheet body 已在 drawer(2843-2905),back 按钮硬编码回
  `"account"`(2840/2861/2881 附近);account sheet 内导航(2771-2806)。
- `openMobileAccount`(1985-2000)= setMobileSheet("account") + setDrawer("full")。
- `Icon` 组件(173-194):本地 inline SVG,`paths: Record<string,string>` + 组件内部 union。
- `AgentBall`(`agent-ball.tsx`):local `open` state(:76),点击 toggle(:134),
  `{open && <AgentPanel onClose={() => setOpen(false)} …/>}`(:184-194,与球按钮
  fragment 兄弟);球 CSS `agent-ball.module.css` `.ball` z-index 11,无 ≤767px media query。
- `AgentPanel` 移动端已是全宽底部 sheet(`agent-panel.module.css:736-749`),
  与球位置无关;但 **panel z-index 12 与 `.mobileDrawer` z-index 12 同级
  (map-shell.module.css:1062)且 panel DOM 先于 drawer(mount 2580 vs drawer 2582+)——
  移动端开面板会被 drawer 盖住,必须修复(≤767px 内 panel 提到 ≥13)。

## 布局图(设计定稿,Apple/liquid glass 设计系统)

```
现状 mobileToolbar(≤767px,half/full 可见;drawerMini 时整个隐藏)
┌────────────────────────────────────────────┐
│ [M][M]                         (头像)       │
│  ModeSwitcher                  头像右置     │
└────────────────────────────────────────────┘
目标
┌────────────────────────────────────────────┐
│ [M][M] [图层][已保存][探索][最近][✦AI] (头像)│
│ ←──── 左簇:ModeSwitcher+5 item ────→ 右置  │
└────────────────────────────────────────────┘
```

设计约束:
- item = **图标钮**(与 ModeSwitcher / 桌面折叠 rail 同构),min 40px 触控,簇内 gap 4px;
  `aria-label` + `title` 用 i18n(`t("layers")` 等;AI 用 `t("agentBall")`,已存在);
  激活态 `#007AFF`(参照 `.navItemActive`);`.mobileToolbar` 现有 `flex-wrap:wrap`
  保留兜底窄屏。头像维持 `margin-left:auto` 右置。
- 玻璃拟态只用于 POI/岗位卡片(现有 `--soft-strong` 抽屉壳/工具栏不重新做玻璃);
  蓝 `#007AFF`,绿仅薪资/工时(本任务无绿)。
- 新增 `Icon` path `agent`(✦ sparkle,24×24 stroke 同构,与现有 path 风格一致)。

## 任务

### 1. 工具栏左簇(map-shell.tsx + map-shell.module.css)

在 `.mobileToolbar` 内、头像前插入左簇容器(如 `mobileToolbarItems`,flex,gap 4px),
内容 = ModeSwitcher + 5 个 item 按钮,顺序:**图层 → 已保存 → 探索 → 最近 → AI**。

每个 item(参照桌面 rail 的 aria-pressed 模式):

| item | icon | onClick(≤767px 语义) | 激活态 |
|---|---|---|---|
| 图层 | `layers` | `setMobileSheet("layers")` + `setDrawer("full")` | `mobileSheet === "layers"` |
| 已保存 | `bookmark` | auth 门禁:未登录 → `setAuthOpen(true)`;否则 `setMobileSheet("saved")` + `setDrawer("full")` | `mobileSheet === "saved"` |
| 探索 | `grid` | `setMobileSheet("explore")`(不强制改 drawer 高度) | `mobileSheet === "explore"` |
| 最近 | `history` | `setMobileSheet("recent")` + `setDrawer("full")` | `mobileSheet === "recent"` |
| AI | `agent`(新) | toggle `agentOpen`(见任务 3) | `agentOpen` |

- **重复点击激活项 → 回到默认**:已是该 sheet 时再点 → `setMobileSheet("explore")`
  (镜像桌面 `openRail` toggle + 头像二次点语义);AI 已开再点 → 关面板。
- **back 目标追踪**:新增来源状态(如 `mobileSheetBack: "explore" | "account"`,
  默认 `"explore"`):工具栏 item 打开 saved/layers/recent sheet 时置 `"explore"`;
  account sheet 内导航(2771-2806)打开时置 `"account"`;三个 sheet 的
  `mobileBackBtn` 改为 `setMobileSheet(mobileSheetBack)`。
- account sheet 内导航按钮(2771-2806)**保留不动**(两入口并存,用户未要求移除)。
- CSS:`mobileToolbarItems` 左簇样式(40px 图标钮、gap 4px、激活蓝、按下反馈);
  头像右置不变。

### 2. Icon `agent`(sparkle)

`Icon` 组件(173-194)加 `agent` 的 stroke path(✦ 四角星风格,viewBox 24,
stroke-width 2,与现有 path 一致)+ union 类型扩宽。AI item 用 `<Icon name="agent" />`。

### 3. AI 助手受控化 + 移动端隐藏悬浮球(agent-ball.tsx + agent-ball.module.css + map-shell.tsx)

- **状态提升**:`agentOpen` 状态放 MapShell;`map-shell.tsx:2580` 改为
  `<AgentBall bridge={…} lang={lang} user={user} open={agentOpen} onOpenChange={setAgentOpen} />`;
  工具栏 AI item 的 onClick 调 `setAgentOpen(v => !v)`。
- **AgentBall 受控**:`agent-ball.tsx` 去掉 local `open` state,改 props
  `open: boolean; onOpenChange: (open: boolean) => void`;点击 toggle 与 panel
  `onClose` 都走 `onOpenChange`。桌面行为(拖拽吸附/持久化/面板锚球)不动。
- **移动端隐藏球**:`agent-ball.module.css` 加
  `@media (max-width: 767px) { .ball { display: none; } }`(球按钮与 panel 是
  fragment 兄弟,隐藏球不影响 panel;桌面端球照常)。
- **面板层级修复**:`agent-panel.module.css` 的 ≤767px 块内把 panel `z-index`
  提到 **13**(高于 `.mobileDrawer` 的 12),保证移动端从工具栏打开 AI sheet
  盖在 drawer 之上;桌面端(锚球卡片)保持现状 z-12 即可。

### 4. 测试(`server/tests/component-contracts.test.mjs`)

沿用现有 contract 风格追加/更新:
- AgentBall 受控契约:`open`/`onOpenChange` props;onClose 触发 `onOpenChange(false)`。
- map-shell 移动工具栏契约:渲染 5 个 item 按钮且各有 `aria-label`
  (layers/saved/explore/recent/agentBall);已保存未登录 → 触发 auth 流程;
  AI item 点击 toggle `agentOpen`。
- 既有断言若引用旧 AgentBall 内部 state,同步更新。
- 注意现有测试是否已在跑(全量 npm test 基线约 568,2026-08-21)。

### 5. 文档同步

- `tech/24-agent-feature.md`(仅追加/修订):
  - §9.1 悬浮球:注明 ≤767px 隐藏、移动端入口改为工具栏 item;
  - §9.4 移动端适配:更新为「球隐藏,工具栏 item 开面板(全宽 sheet)」+ panel 层级说明;
  - §9.6 map-shell seam 段:补 `agentOpen` 状态提升与工具栏 AI item;
  - 如 §9.x 有组件清单/测试清单引用,顺带更新。
- `.claude/skills/frontend-component-dev/SKILL.md`:更新移动端 drawer 描述段
  (「Half/full: avatar on the right of mobileToolbar opens the account sheet…」)——
  补充 mobileToolbar 左簇(ModeSwitcher + 图层/已保存/探索/最近/AI 图标钮)与
  back 目标追踪;保留 account sheet 描述(Profile + 子导航仍在)。
- 不新增 tech 文档编号;`tech/README.md` 若无需改就不动。

## 文件边界

- 只允许改:`server/src/components/map-shell.tsx`(工具栏/Icon paths/agentOpen/back 目标)、
  `server/src/components/map-shell.module.css`、`server/src/components/agent-ball.tsx`、
  `server/src/components/agent-ball.module.css`、`server/src/components/agent-panel.module.css`
  (**仅 ≤767px 块内 z-index 一处**)、`server/tests/component-contracts.test.mjs`、
  `tech/24-agent-feature.md`、`.claude/skills/frontend-component-dev/SKILL.md`。
- **不碰**:`agent-panel.tsx` 逻辑、`agent-panel.module.css` 其他段、mode-switcher、
  桌面 rail/侧栏、其他 tech 文档、agent.md、`server/data/**`、后端/DB。
- 改动尽量小步 commit(Conventional Commits:`feat` / `fix` / `test` / `docs`)。

## 门禁(必须全绿)

1. `cd /Users/acccan/dm-wt-mt/server && npm test`(全量,基线约 568 pass/2 skip)
2. `cd /Users/acccan/dm-wt-mt/server && npm run typecheck`
3. `cd /Users/acccan/dm-wt-mt && make docs-check` && `git diff --check`
4. 小步 commit,消息 Conventional Commits。

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-mobile-toolbar/reports/ws-mt.md`:
改动文件清单、每项任务的实现要点(file:line)、测试新增/修改断言、文档同步位置。
**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
