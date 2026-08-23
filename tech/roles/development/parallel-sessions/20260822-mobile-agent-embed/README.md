# Batch — 20260822-mobile-agent-embed(AI 助手并入抽屉 sheet,撤销独立浮层)

## 目标(用户反馈,轮 2)

上轮(20260822-mobile-toolbar,已合入 dev=f5ec089)把移动端 AI 做成工具栏 item,
点击后 `agentOpen` 打开**独立全宽底部浮层 sheet**(盖在 drawer 之上)。
**用户反馈:AI 助手应并入抽屉里,不要额外作为一个抽屉** —— 即与 已保存/图层/最近
同构:AI 是 drawer 内的一个 sheet(`mobileSheet === "agent"`),工具栏 AI item 打开它,
带 sheet bar + 返回,AgentPanel **内嵌**在抽屉里渲染,不再有独立浮层。

## boss 侦察(2026-08-22,读码核实,dev=17cb454 含 f5ec089)

- **现状**:AI item(`map-shell.tsx` mobileToolbarItems)onClick `setAgentOpen(v=>!v)`,
  激活态 `agentOpen`;AgentBall 受控(`open={agentOpen}`)在 MapShell 渲染
  `{open && <AgentPanel …/>}`(fragment 兄弟,桌面锚球卡片 / 移动端独立 sheet)。
- **agent-panel.module.css ≤767px 块**(725-749 附近):`.panel` 全宽底部 sheet
  (bottom:0、height:min(72svh,560px)、z-index:13)—— 整块将被替换。
  **下方 `@media (prefers-color-scheme: dark)` 块(ws-dark 合入)必须原样保留。**
- **AgentPanel props**(`agent-panel.tsx:82,170`):`bridge/lang/user/ballRect/dragging/
  snapEdge/onClose`;自带 `.close` 按钮(:688,`t("agentClose")`)。`ballRect/dragging/
  snapEdge` 仅用于桌面锚球定位。
- **内嵌先例**:`RecentPanel` `embedded?: boolean` prop(`recent-panel.tsx:20,33,37-38`
  → `styles.embed` 容器 + `styles.sheet`);skill 文档:「Embedded Profile / Recent keep
  a visible close(do not hide `styles.close` when embedded)」。
- **抽屉 sheet body 先例**:`mobileSheet === "saved"/"layers"/"recent"` 分支
  (`map-shell.tsx` 2840-2990 附近):`.mobileAccount`/`.mobileLayers` 包装 +
  `.mobileSheetBar` + `.mobileBackBtn`(onClick `setMobileSheet(mobileSheetBack)`)。
- `mobileSheet` union(:359 附近):`"explore" | "saved" | "layers" | "account" | "recent"`。

## Workstream 表

| ws | 分支 | worktree | 主题 | 文件边界 |
|---|---|---|---|---|
| ae | feature/mobile-agent-embed | ../dm-wt-ae | AI 并入 drawer sheet(embedded AgentPanel)+ 撤销独立浮层 | `map-shell.tsx`(mobileSheet+"agent"/AI item/sheet body)、`map-shell.module.css`、`agent-panel.tsx`(embedded prop)、`agent-panel.module.css`(≤767px 块重写,保留 dark 块)、`tests/component-contracts.test.mjs`、`tech/24-agent-feature.md`(修订)、`.claude/skills/frontend-component-dev/skill.md`(文本由 boss 应用,见「汇报」) |

## 合并顺序

1. ws-ae(单 ws)→ 门禁绿 → push origin/dev(若 dev 数据测试仍红,按上轮结论:非本批引入,红停由 boss 裁决)

## 布局图(设计定稿)

```
现状(轮1 交付,用户不满足):AI 点击 → 独立全宽浮层 sheet 盖在 drawer 上
目标:AI = drawer 内 sheet(与 已保存/图层/最近 同构)
┌─ drawer full ───────────────────────────────┐
│ [M][图层][已保存][探索][最近][✦AI]     (头像)│ ← AI 激活蓝
│ ┌────────────────────────────────────────┐  │
│ │ ‹ 返回                        (✕ 面板) │  │ ← sheet bar(back→mobileSheetBack)
│ │ ┌────────────────────────────────────┐ │  │
│ │ │ 消息列表(内部滚动)                  │ │  │
│ │ │ …                                  │ │  │
│ │ │ [输入框…] [发送/停止/撤销]           │ │  │ ← 输入固定在 sheet 底部
│ │ └────────────────────────────────────┘ │  │
│ └────────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

设计约束:抽屉壳 `--soft-strong` 不变;蓝 `#007AFF` 激活;玻璃拟态仅卡片级(消息气泡
原有样式不动);内嵌遵循 RecentPanel `embedded` 先例 + skill 文档(embedded 保留
面板自身 close)。
