# 求职导航 Agent WS2 — Agent 域工具批次（2026-08-28）

## 目标

在 WS1 路线核心已合入 `dev` 的基础上，把项目自己的岗位 catalog 与路线 module
接入 Agent：五个域工具、求职导航系统提示、`showRoute` 受控动作、工具预算，以及
与 WS1 相同的独立 navigation session。生产仍无 live provider，因此路线结果必须是
显式 `estimate`；LLM 不得接触 geometry。

## 基线

- base branch: `dev`
- base commit: `01e3c32`
- authoritative plan: `tech/31-job-navigation-agent-plan.md` §5.5 / §9 WS2
- predecessor: `tech/roles/development/parallel-sessions/20260828-job-navigation-ws1/`
- owner: boss-agent

## 范围冻结

- 不注册、配置或调用真实路线供应商；不新增 provider key/env。
- 不持久化产品分析事件，不复用 `audit_events`。
- 不修改现有 UI 设计/布局/CSS/地图 overlay。允许且仅允许为 `showRoute` 做类型收口：
  客户端校验可接受格式合法的 `routeId`，执行器必须 no-op（不画线、不改面板结构）。
- `tech/31` §8 仍未获用户批准，WS4 继续 blocked。
- 不执行 Env-only 命令。

## Workstream

| WS | 分支 | worktree | 主题 | prompt | 汇报 | 明确不碰 |
|---|---|---|---|---|---|---|
| ws2-agent-tools | `feature/job-navigation-ws2-agent-tools` | `/Users/acccan/dm-wt-job-navigation-ws2-agent-tools` | 五个域工具、prompt、`showRoute`、session 注入、预算、测试与文档 | `prompts/ws2-agent-tools.md` | `reports/ws2-agent-tools.md` | 现有 UI 布局/CSS/overlay、DB/migration、live provider、analytics persistence、WS0 fixture 40 条内容 |

## 合并顺序

1. `ws2-agent-tools`

## 后续依赖

- WS3：离线 runner、事件 sink 契约、SQL/Python 报告。
- WS4：继续 blocked，直到用户明确批准 `tech/31` §8。
