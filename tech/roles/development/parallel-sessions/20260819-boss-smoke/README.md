# 20260819-boss-smoke — Boss Agent 端到端 smoke 批次

> **创建**:2026-08-19(boss-agent smoke)
> **目的**:验证 `spawn-worker.sh → 汇报 token → spawn-merger.sh → 合并 → merge-report` 全链路。
> **Env-only**:无。

## Workstream 表

| WS | 分支 | 主题 | prompt | 汇报 | 不碰 |
|---|---|---|---|---|---|
| w1 | docs/boss-smoke | CHANGELOG 追加 boss-agent smoke 条目 | prompts/w1.md | reports/w1.md | server/、db/、tech/ 其余文件 |

## 合并顺序

1. **w1**(独立,唯一)

## 角色分配

- 开发:`boss-worker`(headless,`spawn-worker.sh w1 …`)
- 收尾:`boss-merger`(headless,`spawn-merger.sh …`)
