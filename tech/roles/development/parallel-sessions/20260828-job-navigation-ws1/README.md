# 求职导航 Agent WS1 — 路线核心批次（2026-08-28）

## 目标

在 WS0 契约已经合入 `dev` 的基础上，实现 provider-neutral 路线核心、显式直线估算降级、
进程内有界且会话隔离的路线产物存储，以及两个服务端 navigation route handler。当前批次
不得选择、注册、配置或调用任何真实路线供应商。

## 基线

- base branch: `dev`
- base commit: `b093ea3`
- authoritative plan: `tech/31-job-navigation-agent-plan.md`
- predecessor: `tech/roles/development/parallel-sessions/20260827-job-navigation-ws0/`
- owner: boss-agent

## 范围冻结

- 生产默认只有显式 `estimate` adapter；真实 provider 只允许通过依赖注入的测试 fake 验证
  provider-neutral seam，不得读取 provider key 或新增 provider 环境变量。
- `RoutePlan` 不暴露 geometry；只有同一匿名/登录浏览器会话可通过 route artifact 端点读取
  服务端签发且未过期的可信 geometry。
- route ID 必须由服务端 CSPRNG 生成并满足 WS0 格式；provider、客户端和 LLM 均不得指定。
- 位置、路线、原始 provider 响应和产品分析事件均不落库；不得复用 `audit_events`。
- 不修改任何前端代码、样式或交互；`tech/31` §8 仍未获用户批准。
- 不执行 Env-only 命令，不调用 live provider，不打印或读取密钥值。

## Workstream

| WS | 分支 | worktree | 主题 | prompt | 汇报 | 明确不碰 |
|---|---|---|---|---|---|---|
| ws1-route-core | `feature/job-navigation-ws1-route-core` | `/Users/acccan/dm-wt-job-navigation-ws1-route-core` | provider seam、estimate adapter、route module、artifact store、navigation route handlers、测试与文档 | `prompts/ws1-route-core.md` | `reports/ws1-route-core.md` | 前端、Agent tools/actions/prompt、DB/migration、真实 provider adapter/config、analytics persistence |

## 合并顺序

本批只有一个分支：

1. `ws1-route-core`

合并前由 boss 二次审查完整 diff，复跑专项测试和完整门禁；红则返修，不带病合并。

## 后续依赖

- WS2：消费本批的路线 module，接入 Work/Navigation Agent 域工具和 `showRoute` 受控动作。
- WS3：在 WS2 后实现离线 runner、事件 sink 契约和 SQL/Python 报告。
- WS4：继续 blocked，直到用户明确批准 `tech/31` §8 布局。
