# 求职导航 Agent WS3 — 评测与事件批次（2026-08-28）

## 目标

在 WS2 域工具已合入 `dev` 的基础上，建立可复现的产品判断闭环：可替换事件
sink 契约、离线 eval runner、SQL/Python 报告，以及一份带样本量与偏差说明的
基线结论。本批不持久化产品分析、不复用 `audit_events`、不调用 LLM、不画
前端 overlay。

## 基线

- base branch: `dev`
- base commit: `718c3f2`
- authoritative plan: `tech/31-job-navigation-agent-plan.md` §7 / §9 WS3
- predecessor: `tech/roles/development/parallel-sessions/20260828-job-navigation-ws2/`
- owner: boss-agent

## 范围冻结

- 不注册、配置或调用真实路线供应商；不新增 provider key/env。
- 不持久化产品分析事件，不新建 analytics 表，不复用 `audit_events`。
- 不修改现有 UI 设计/布局/CSS/地图 overlay。
- `tech/31` §8 仍未获用户批准，WS4 继续 blocked。
- 不执行 Env-only 命令。
- 不把 40 条 fixture 的 utterance/candidate/expected 契约结果改写成另一套故事；
  工具序列用 sidecar playbook。
- 指标口径是确定性策略 + 契约校验，不是线上 LLM 准确率。

## Workstream

| WS | 分支 | worktree | 主题 | prompt | 汇报 | 明确不碰 |
|---|---|---|---|---|---|---|
| ws3-eval-events | `feature/job-navigation-ws3-eval-events` | `/Users/acccan/dm-wt-job-navigation-ws3-eval-events` | 事件 sink、离线 runner、SQL/Python 报告、基线结论 | `prompts/ws3-eval-events.md` | `reports/ws3-eval-events.md` | 前端 overlay/布局/CSS、DB/migration/`audit_events`、live provider、analytics persistence、40 条 fixture 契约内容 |

## 合并顺序

1. `ws3-eval-events`

## 后续依赖

- WS4：继续 blocked，直到用户明确批准 `tech/31` §8。
- WS5：依赖 WS4。
