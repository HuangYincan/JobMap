# Workstream ae — feature/mobile-agent-embed(AI 助手并入抽屉 sheet)

## 你的身份

boss 派发的 headless 开发 worker。**只在本 worktree(`/Users/acccan/dm-wt-ae`)内开发,
不 merge、不 push、不碰主树。** 汇报写入
`/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-mobile-agent-embed/reports/ws-ae.md`
(末两行 token,见文末)。

## 背景(boss 侦察,2026-08-22)

**轮 2(用户反馈)**:上轮(20260822-mobile-toolbar,f5ec089 已在 dev)移动端 AI 是
工具栏 item 点击 `setAgentOpen(v=>!v)` → `AgentPanel` 以**独立全宽底部浮层 sheet**
打开(盖在 drawer 上)。**用户要求:AI 并入抽屉里,不要额外作为一个抽屉** ——
与 已保存/图层/最近 同构:AI = drawer 内 sheet(`mobileSheet === "agent"`),
AgentPanel **内嵌**在抽屉里渲染,带 sheet bar + 返回,撤销独立浮层。

现状锚点(dev=17cb454,读码核实):
- `map-shell.tsx` mobileToolbar AI item:`onClick={() => setAgentOpen((v) => !v)}`,
  激活态 `agentOpen`(上轮 ws-mt 合入);`agentOpen` state(:364 附近,受控传 AgentBall)。
- `agent-panel.tsx:170` `export function AgentPanel({ bridge, lang, user, ballRect, dragging, snapEdge, onClose })`;
  `.close` 按钮(:688,`t("agentClose")`);`ballRect/dragging/snapEdge` 仅桌面锚球定位用。
- `agent-panel.module.css` **≤767px 块(725-749 附近)**:`.panel` 全宽底部 sheet
  (bottom:0 / height:min(72svh,560px) / transform:none / **z-index:13**)—— 整块重写。
  **块下方 `@media (prefers-color-scheme: dark)`(ws-dark 合入,memoryPanel/input/
  bubbleAssistant 深色覆盖)必须一字不动保留。**
- 内嵌先例:`RecentPanel embedded?: boolean`(`recent-panel.tsx:20,33,37-38` →
  `styles.embed` + `styles.sheet`);skill 文档:「Embedded Profile / Recent keep a
  visible close(do not hide `styles.close` when embedded)」。
- 抽屉 sheet body 先例:`mobileSheet === "saved"/"layers"/"recent"` 分支
  (:2840-2990 附近):包装 div + `.mobileSheetBar` + `.mobileBackBtn`
  (`onClick={() => setMobileSheet(mobileSheetBack)}`)。
- `mobileSheet` union(:359 附近):`"explore" | "saved" | "layers" | "account" | "recent"`。

## 布局图(设计定稿)

```
目标:AI = drawer 内 sheet(与 已保存/图层/最近 同构)
┌─ drawer full ───────────────────────────────┐
│ [M][图层][已保存][探索][最近][✦AI]     (头像)│ ← AI 激活蓝(mobileSheet==="agent")
│ ┌────────────────────────────────────────┐  │
│ │ ‹ 返回                        (✕ 面板) │  │ ← sheet bar(back→mobileSheetBack)
│ │ ┌────────────────────────────────────┐ │  │
│ │ │ 消息列表(内部滚动)                  │ │  │
│ │ │ …                                  │ │  │
│ │ │ [输入框…] [发送/停止/撤销]           │ │  │ ← 输入固定 sheet 底部
│ │ └────────────────────────────────────┘ │  │
│ └────────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

## 任务

### 1. map-shell.tsx — AI item 改 sheet 语义 + agent sheet body

- `mobileSheet` union 加 `"agent"`。
- 工具栏 AI item:
  - 激活态:`mobileSheet === "agent"`(不再用 `agentOpen`)。
  - onClick:`if (mobileSheet === "agent") { setMobileSheet("explore"); return; }` →
    `setMobileSheetBack("explore"); setMobileSheet("agent"); setDrawer("full");`
    (与图层/最近完全同构)。
- `agentOpen` **保留不动**(桌面悬浮球入口用;移动端球已隐藏,agentOpen 移动端不再被
  item 驱动——桌面开面板后缩窗到移动端,浮层 `display:none`,见任务 3)。
- 抽屉 body 新增 `mobileSheet === "agent"` 分支(放在 saved/layers/recent 分支群内,
  样式同构):包装 div(如 `mobileAgent`)+ `.mobileSheetBar` + `.mobileBackBtn`
  (`onClick={() => setMobileSheet(mobileSheetBack)}`)+ 内嵌面板:
  ```tsx
  <AgentPanel
    bridge={agentBridgeRef.current}
    lang={lang}
    user={user}
    embedded
    onClose={() => setMobileSheet(mobileSheetBack)}
  />
  ```
  (`agentBridgeRef`/`lang`/`user` 均在 MapShell 作用域,无需新增)。
  account sheet 内导航**不加** AI 入口(用户未要求)。

### 2. agent-panel.tsx — embedded prop(遵循 RecentPanel 先例)

- props 加 `embedded?: boolean`(默认 false)。
- `ballRect/dragging/snapEdge` 改为可选(`ballRect?: BallRect | null` 等)或 embedded
  时不消费——嵌入式实例不传这些;桌面浮动实例照旧传。
- 根元素类:嵌入式加修饰类(如 `styles.embedded`),与 `styles.panel` 并存。
- **`.close` 按钮保留显示**(skill 文档:embedded 不隐藏 close;onClose 由 MapShell
  传 `() => setMobileSheet(mobileSheetBack)`,两条关闭路径等价)。
- 其余逻辑(会话/流式/工具/建议卡)零改动。

### 3. agent-panel.module.css — ≤767px 块重写(浮层 → 内嵌)

- **原 ≤767px 全宽 sheet 块(含 z-index:13)整体替换**:
  - `.panel`(桌面浮动实例,移动端球已隐藏 → 该实例移动端永不交互;若桌面开着面板
    缩窗到移动端也不得出现漂浮 sheet):`@media (max-width: 767px) { .panel { display: none; } }`
  - 内嵌样式(如 `.panel.embedded` 或独立类):position: static(在抽屉流内)、
    width: 100%、height: 100%(填满 sheet body,`min-height: 0`)、无
    fixed/transform/border-radius 覆盖(跟随抽屉 sheet 圆角)或按需微调;
    **消息列表内部滚动 + 输入框贴底**沿用面板现有 flex 结构。
  - 新增样式与 `.mobileAgent` 包装配合:sheet body 用 flex column 撑满
    (`height: 100%; min-height: 0`),面板 `flex: 1`。
- **`@media (prefers-color-scheme: dark)` 块一字不动。**

### 4. map-shell.module.css

- `.mobileAgent` 等新包装类(≤767px 块内):flex column、height 撑满、与
  saved/layers sheet 同构的间距;内嵌面板高度接管(必要时
  `.mobileAgent .embeddedPanel { height: 100%; min-height: 0 }`)。

### 5. 测试(server/tests/component-contracts.test.mjs)

更新 ws-mt 的两个契约块 + 新增/调整:
- AI item:`setMobileSheet("agent")` + `setDrawer("full")` + back 追踪
  (`setMobileSheetBack("explore")`)+ 激活态 `mobileSheet === "agent"`(删
  `setAgentOpen((v) => !v)` 断言)。
- AgentPanel:`embedded?: boolean` prop;map-shell 抽屉渲染 embedded AgentPanel
  (bridge/lang/user/embedded/onClose);≤767px 浮层 `.panel` `display: none`
  (**替换 z-index: 13 断言**);内嵌类存在。
- 桌面受控球契约(open/onOpenChange、onOpenChange(!open))保留不动。

### 6. 文档

- `tech/24-agent-feature.md` 修订(非追加):
  - §9.1 悬浮球/§9.4 移动端适配:移动端 AI 入口 = 工具栏 item → **drawer 内嵌
    agent sheet**(`mobileSheet === "agent"`,非独立浮层);浮层面板 ≤767px
    `display:none`(替换「panel z-index 13」描述)。
  - §9.6 seam 段:`agentOpen` 仅桌面球;移动端走 mobileSheet "agent"。
- `.claude/skills/frontend-component-dev/skill.md` **不要尝试写**(headless 权限拒)——
  在汇报「遇到的问题」段给出**精确的旧句→新句替换文本**(旧句 = 轮1 boss 应用的
  句子:「…AI toggles the AgentPanel via the lifted `agentOpen` state — the floating
  ball is hidden ≤767px, so the toolbar item is the mobile AI entry. Tapping an
  already-active item returns to Explore (mirrors the avatar re-tap). Back buttons
  in Saved / Layers / Recent return to their source via `mobileSheetBack` (toolbar
  entry → Explore; account sub-nav entry → account).」),boss 手工应用。
  - 新句要点:AI item 打开 drawer 内嵌 agent sheet(mobileSheet "agent"、full
    drawer、back 走 mobileSheetBack);悬浮球**及其锚定面板**≤767px 隐藏;
    back 按钮清单含 Agent sheet。

## 文件边界

- 只允许改:`server/src/components/map-shell.tsx`(AI item/mobileSheet union/agent
  sheet body)、`server/src/components/map-shell.module.css`、`server/src/components/agent-panel.tsx`
  (**仅 props/根类/embedded 分支**)、`server/src/components/agent-panel.module.css`
  (**仅 ≤767px 块重写;dark 块不动**)、`server/tests/component-contracts.test.mjs`、
  `tech/24-agent-feature.md`。
- **不碰**:`agent-ball.tsx`(+css,桌面入口保持)、agent-panel.tsx 的会话/流式/工具逻辑、
  `agent-panel.module.css` 的 dark 块与桌面卡片样式、mode-switcher、桌面 rail、
  其他 tech 文档、agent.md、`server/data/**`、后端/DB。
- 小步 commit(Conventional Commits)。注意:并发会话(agent-clearfix 等)可能同时改
  agent-panel.tsx——只改自己的段,不重排他人结构。

## 门禁(必须全绿)

1. `cd /Users/acccan/dm-wt-ae/server && npm test`(全量,当前基线 1376 pass/2 skip;
   **注意 dev 现有 2 个数据测试红**(drops-coordinate-consistency/split-city-sites,
   并发 geocode 会话在修)——若你的全量跑仍红,确认仅这 2 个数据测试失败且非本 ws
   引入即可,在汇报中说明)
2. `cd /Users/acccan/dm-wt-ae/server && npm run typecheck`
3. `cd /Users/acccan/dm-wt-ae && make docs-check` && `git diff --check`

## 汇报

写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260822-mobile-agent-embed/reports/ws-ae.md`:
改动文件清单、实现要点(file:line)、测试更新、skill.md 的精确替换文本。
**末两行必须精确**:

```
门禁: PASSED | FAILED
结论: OK | BLOCKED: <一句话问题>
```
