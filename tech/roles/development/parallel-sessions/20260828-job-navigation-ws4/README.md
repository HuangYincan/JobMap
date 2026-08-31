# 求职导航 Agent WS4 — 前端体验批次（2026-08-28）

## 目标

用户已于 2026-08-28 明确批准 `tech/31` §8 ASCII 布局。本批把通勤筛选、岗位/
对比/行程状态、路线来源条，以及 `showRoute` 的可信 overlay 接到现有 Work
地图壳上，遵循 Apple + liquid glass（卡片）+ 霜面面板。生产仍无 live
provider：真实折线只在 GET artifact 成功时绘制；否则只显示直线估算标签和
外部导航入口，不得伪装成道路路线。

## 基线

- base branch: `dev`
- base commit: `673502d`
- authoritative plan: `tech/31-job-navigation-agent-plan.md` §5.3、§8（已批准）、§9 WS4
- design: `tech/07-frontend-design-system.md`、`.claude/skills/liquid-glass-components/skill.md`、
  `.claude/skills/frontend-component-dev/skill.md`
- predecessor: `tech/roles/development/parallel-sessions/20260828-job-navigation-ws3/`
- owner: boss-agent
- layout approval: 用户 2026-08-28「同意」针对 §8 布局；**不是** live provider / 事件落库 / 用户访谈

## 范围冻结

- 不注册、配置或调用真实路线供应商；不新增 provider key/env。
- 不持久化产品分析，不复用 `audit_events`。
- 不执行 Env-only 命令。
- 不把 L2 Explore / L3 JD / Profile 霜面改成高透玻璃板；液态玻璃只用在岗位卡片与列表 hover。
- 绿只用于薪资/工时；chrome 一律 `#007AFF`（12px 霜面字用 `--blue-ink`）。
- 不引入 shadcn / Tailwind / framer / virtuoso / zustand / react-icons。
- 移动端不新增第 6 个底部工具栏图标；§8 的「岗位|对比|行程|AI」是抽屉**内页签**，
  AI 仍走现有工具栏 `mobileSheet === "agent"`。

## Workstream

| WS | 分支 | worktree | 主题 | prompt | 汇报 | 明确不碰 |
|---|---|---|---|---|---|---|
| ws4-frontend | `feature/job-navigation-ws4-frontend` | `/Users/acccan/dm-wt-job-navigation-ws4-frontend` | overlay + 通勤 chrome + 移动内页签 + 状态清单 | `prompts/ws4-frontend.md` | `reports/ws4-frontend.md` | live provider、DB/migration、analytics persistence、40 条 fixture 契约内容 |

## 合并顺序

1. `ws4-frontend`

## 后续依赖

- WS5：会话内主动建议与三场景演示闭环（本批之后）。
