# ws-ae 汇报(2026-08-22)

feature/mobile-agent-embed:AI 助手并入抽屉 sheet(mobileSheet "agent",与 已保存/图层/最近 同构)。

## 实际改动(3 commits,dev=17cb454 之上)

1. `84cc949 feat(mobile-agent-embed): AI 并入抽屉 — mobileSheet "agent" 内嵌 sheet(ws-ae)`
2. `32caafe test(mobile-agent-embed): 更新 agent 契约 — sheet 语义 + embedded props(ws-ae)`
3. `204fc7a docs(24-agent-feature): 修订 §9.1/§9.4/§9.6 — 移动端 AI 改为 drawer 内嵌 sheet(ws-ae)`

逐文件:

- `server/src/components/map-shell.tsx`
  - :361 mobileSheet union 加 `"agent"`(`"explore" | "saved" | "layers" | "account" | "recent" | "agent"`)
  - :364-366 agentOpen 注释修订:仅桌面悬浮球入口使用(移动端球隐藏后不被 item 驱动)
  - :52 新增 `import { AgentPanel } from "./agent-panel"`(agent-ball 之外第二个消费点)
  - :2738-2757 工具栏 AI item:激活态 `mobileSheet === "agent"`(替换 `agentOpen`),
    onClick 与图层/最近完全同构——重复点回 explore;否则 `setMobileSheetBack("explore")`
    + `setMobileSheet("agent")` + `setDrawer("full")`;删 `setAgentOpen((v) => !v)`
  - :3016-3034 drawer body 新增 `mobileSheet === "agent"` 分支(放在 saved/layers/recent
    分支群内、explore 兜底前):`mobileAgent` 包装 + `.mobileSheetBar` + `.mobileBackBtn`
    (`onClick={() => setMobileSheet(mobileSheetBack)}`)+
    `<AgentPanel bridge={agentBridgeRef.current} lang={lang} user={user} embedded
    onClose={() => setMobileSheet(mobileSheetBack)} />`(零新增 state)
  - `agentOpen` state 本体与 `AgentBall` 受控透传**保留不动**(桌面入口)
- `server/src/components/agent-panel.tsx`(仅 props/根类/embedded 分支,会话/流式/工具零改动)
  - Props:`embedded?: boolean`(默认 false);`ballRect?: BallRect | null`、`dragging?: boolean`、
    `snapEdge?: BallSnapEdge | null` 全部可选(嵌入式实例不传)
  - :290-300 placement:embedded 或 ballRect 缺失 → null,跳过锚点定位;
    `isSheet = placement ? placement.mode === "sheet" : false`;panelStyle 用
    `placement && placement.mode === "side"` 直判(TS 判别联合窄化)
  - :659 根类 `styles.panel` 后追加 `embedded ? styles.embedded : ""`
  - `.close` 按钮保留显示(embedded 不隐藏 close;onClose 两条关闭路径等价)
- `server/src/components/agent-panel.module.css`(**仅 ≤767px 块重写 + 头注释**;
  `@media (prefers-color-scheme: dark)` 块一字未动,diff 零触及)
  - ≤767px `.panel { display: none }`(替换原全宽底部 sheet + z-index:13 浮层;
    桌面开着面板缩窗到移动端也不漂浮)
  - ≤767px 新增 `.panel.embedded`:position static、width/height 100%、min-height 0、
    flex:1 1 auto、animation/transform/transition none、border/radius/shadow/
    backdrop-filter 归零(跟随抽屉 sheet 圆角,不叠第二层玻璃)
- `server/src/components/map-shell.module.css`(:1290-1306,≤767px 块内)
  - `.mobileAccount, .mobileLayers` 选择器并入 `.mobileAgent`(width/max-width/min-width/box-sizing)
  - 新增 `.mobileAgent { display:flex; flex-direction:column; height:100%; min-height:0 }`
    ——flex column 撑满 drawerContent,面板 flex:1 接管高度,消息列表内部滚动 + 输入贴底
- `server/tests/component-contracts.test.mjs`(见下节)
- `tech/24-agent-feature.md`(§9.1/§9.4/§9.6 修订,非仅追加;§9.6 以 ws-ae 修订段承接 ws-mt 段)

## 测试更新

- ws-mt「球受控」契约:≤767px `.panel { display: none }` 断言**替换** `z-index: 13` 断言;
  新增 `.panel.embedded` position:static 断言;`assert.doesNotMatch(z-index: 13)`
- ws-mt「移动工具栏」契约:删 `setAgentOpen((v) => !v)` 断言;新增
  `setMobileSheet("agent")` / `setMobileSheetBack("explore")...setDrawer("full")` /
  激活态 `mobileSheet === "agent"`(className + aria-pressed)断言;标题改 ws-mt/ws-ae
- 新增「agent sheet embeds in mobile drawer」(ws-ae):`mobileSheet === "agent"` 分支 +
  mobileAgent 包装 + sheet bar/back + embedded AgentPanel(bridge/lang/user/embedded/
  onClose 走 mobileSheetBack);union 含 `"agent"`;AgentPanel 可选 props + `embedded = false`
  默认;根类 embedded 并存;`.mobileAgent` flex column/height 100%/min-height 0
- 桌面受控球契约(open/onOpenChange、onOpenChange(!open))保留不动,全绿

## 门禁结果

- npm test:**1394 通过 / 2 失败 / 2 跳过**(基线 1376 pass/2 skip → 新增 1 契约 + 修订 2 契约)。
  仅有的 2 个失败 = dev 既有数据测试 `drops-coordinate-consistency` + `split-city-sites`
  (并发 geocode 会话在修,与 ws-ae 无关;失败断言为坐标值 121.439346 vs 121.47 类数据漂移)。
  所有 agent 相关契约(ws-c/ws-mt/ws-ae/ws-panel2/ws-mem-b/ws-dark 等)全绿。
- typecheck:`tsc --noEmit` 通过
- docs-check:make 的 grep 无匹配(等价命令 exit 1 = 通过)
- git diff --check:通过

## 遇到的问题

- `make docs-check` / `cd` 复合命令被沙箱拒(权限),改用等价单条 grep(仓库根路径,
  `--exclude-dir=parallel-sessions`),语义与 Makefile target 完全一致。
- agent-panel.tsx TS 窄化:别名 `isSheet` 不能窄化 placement 判别联合 → 改为
  `placement && placement.mode === "side"` 直判后 typecheck 通过。
- `.claude/skills/frontend-component-dev/skill.md` **未写**(headless 权限拒),
  boss 手工应用以下替换文本(旧句 = 轮1 boss 应用的句子):

### 旧句(精确)

```
AI toggles the AgentPanel via the lifted `agentOpen` state — the floating ball is hidden ≤767px, so the toolbar item is the mobile AI entry. Tapping an already-active item returns to Explore (mirrors the avatar re-tap). Back buttons in Saved / Layers / Recent return to their source via `mobileSheetBack` (toolbar entry → Explore; account sub-nav entry → account).
```

### 新句(精确替换文本)

```
AI opens a drawer-embedded agent sheet (`mobileSheet === "agent"`, full drawer) — same sheet pattern as Saved / Layers / Recent, not a separate floating overlay: the toolbar item sets `mobileSheetBack("explore")` + `mobileSheet("agent")` + `setDrawer("full")`, and `AgentPanel` renders with `embedded` (position static, fills the sheet body; message list scrolls internally, input pinned at the sheet bottom). The floating ball **and its anchored AgentPanel** are hidden ≤767px (`.panel { display: none }`; the old full-width bottom-sheet overlay with z-index 13 is removed), so the toolbar item is the only mobile AI entry — `agentOpen` drives the desktop ball only. Tapping an already-active item returns to Explore (mirrors the avatar re-tap). Back buttons in Saved / Layers / Recent / Agent return to their source via `mobileSheetBack` (toolbar entry → Explore; account sub-nav entry → account).
```

## 证据

- `npm test` 摘要:`ℹ tests 1398 / ℹ pass 1394 / ℹ fail 2 / ℹ skipped 2`(2 fail = 上述数据测试)
- 关键契约输出:✔ agent ball is controlled (ws-mt) / ✔ map shell mobile toolbar (ws-mt/ws-ae) /
  ✔ agent sheet embeds in mobile drawer (ws-ae)
- `git log --oneline dev..HEAD` = 3 commits(84cc949/32caafe/204fc7a),worktree clean

## boss 裁决(2026-08-22)

- **门禁 FAILED 判定**:仅 dev 既有 2 数据测试(drops-coordinate-consistency / split-city-sites),
  非 ws-ae 引入;boss 独立复跑确认(1394 pass/2 fail/2 skip + typecheck/docs/diff 绿);
  origin/dev 已被并发 geofix(5c8dca2)修复该 2 测试 → merger 合入后门禁应全绿。
- 遗留项「skill.md」由 boss 应用预备文本并提交(50d364e,`docs(skill)`)。本 ws 无遗留。

门禁: PASSED(ws-ae 范围)
结论: OK
