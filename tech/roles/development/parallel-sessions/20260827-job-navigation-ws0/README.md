# 求职导航 Agent WS0 — 开发批次（2026-08-27）

## 目标

在不接入真实路线供应商、不新增产品事件存储、不修改前端的前提下，冻结 P5 的导航意图、
路线摘要、错误语义、隐私边界和离线评测骨架，为后续 WS1 路线核心提供可执行契约。

## 基线

- base branch: `dev`
- planning baseline: `3d8e83a`
- authoritative plan: `tech/31-job-navigation-agent-plan.md`
- executor model: `gpt-5.6-luna`
- reviewer/merger: 主 Agent（逐行审查、复跑门禁后决定是否合并）

## 范围冻结

- 本批只执行 WS0；WS1–WS3 在本批审查通过并合回 `dev` 后顺序启动。
- 路线供应商顺序未获用户批准。本批只做官方资料审查和 provider-neutral 契约，不注册或调用
  高德、腾讯、百度路线 API。
- 产品事件持久化与留存未获用户批准。本批采取保守默认：不落库，只提交无敏感字段的离线
  评测 fixture；不得复用 `audit_events`。
- `tech/31` 第 8 节布局尚未获用户批准，不得修改任何前端代码、样式或交互。
- `server/src/lib/commute.ts` 保持现状并继续明确表示直线估算；不得输出可信道路几何。

## Workstream

| WS | 分支 | worktree | 主题 | prompt | 汇报 | 明确不碰 |
|---|---|---|---|---|---|---|
| ws0-contracts | `feature/job-navigation-ws0-contracts` | `/Users/acccan/Repos/huangyincan/domain-map-wt-job-navigation-ws0-contracts` | 导航契约、验证、来源/隐私 ADR、40 条评测骨架 | `prompts/ws0-contracts.md` | `reports/ws0-contracts.md` | 前端、API route、Agent 动作、DB/migration、真实供应商调用 |

## 合并顺序

本批只有一个分支：`ws0-contracts`。Luna 完成后不 merge；主 Agent 按以下顺序收尾：

1. 审查完整 diff 与提交历史。
2. 复跑专项测试、完整 `npm test`、`npm run typecheck`、`make docs-check`、`git diff --check`。
3. 核对官方来源审查没有推测性结论，文档没有把规划写成已实现能力。
4. 通过后 merge 回 `dev`；任一门禁失败则返修，不带病合并。

## 后续依赖

- WS1：消费本批冻结的类型、验证和错误契约，实现 estimate provider、artifact store 与 API。
- WS2：在 WS1 后接入 Work 域工具和 `showRoute` 受控动作。
- WS3：在 WS2 后实现事件 sink、离线 runner 和 SQL/Python 报告。
- WS4：持续 blocked，直到用户明确批准 `tech/31` 第 8 节布局。
