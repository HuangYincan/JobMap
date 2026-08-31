# Workstream 4 — 合并后校准 (fix/docs-reconcile)

## 背景

文档维护批次第 2 轮（续作）。round 1（ws1-3）已合并进 dev。你校准两个已知漂移 + 复验：
1. ws2 实测 import plan 688/1959/11602 基于旧基线（**不含 qqdoc 源**）；dev 已并入 qqdoc-official（142 家）与可能的 qqdoc-jobs 批 → 需复测更新 tech/15-deploy.md
2. ws3 建索引时 qqdoc-official 批是 in-flight，实际已合并 → 索引行需修正

你是 headless worker：**worktree 已预建**（/Users/acccan/dm-wt-ws4，分支 fix/docs-reconcile，从 origin/dev 切出），只改 worktree 内文件，**不要 merge/push/切分支**。提交用 Conventional Commits。

## 任务

### 1. 同步最新 dev
- `git merge origin/dev`（worktree 内；若已同步则跳过）

### 2. import plan 复测 → 更新 tech/15-deploy.md
- 跑 `npm run import:seed`（**plan 模式，无 DB 副作用**；node_modules 已 symlink）拿权威计数
- 与 tech/15-deploy.md 现有数字（688 companies / 1959 sites / 11602 positions）比对；**不同则更新**，并在 15-deploy 记录测量日期与方法
- 若相同则不动，回报里注明

### 3. parallel-sessions/README.md 索引修正
- `20260821-boss-qqdoc-official` 行：in-flight → **DONE**（142 家腾讯文档源，2026-08-21 入库，merge-report 存在）
- 检查 `20260821-boss-qqdoc-jobs/` 是否已入库/完成（有无 merge-report）：已入库 → 补一行 DONE；未完成 → 保持现状或标注 in-flight（以磁盘与 git 实际状态为准）
- 若 qqdoc 批有 deferred-notes 且含 open 项 → 登记进 deferred-ledger.md

### 4. 根文档测试计数复验
- `cd server && npm test` 实测（worktree 内 = 合并后 dev 状态）
- 若与 CLAUDE.md/agent.md/README.md/CONTRIBUTING.md/CHANGELOG.md 中任一写的计数不符 → 统一修正（预期 568：566 pass / 2 skip；以实测为准）

### 5. 门禁
1. `make docs-check`（worktree 根）→ 通过
2. `git diff --check` → 无空白错误
3. 一致性 grep：根 5 文档计数一致；tech/15-deploy 计数 = import plan 实测

## 文件边界
- 可改：`tech/15-deploy.md`、`tech/roles/development/parallel-sessions/README.md`、`tech/roles/development/deferred-ledger.md`、根 5 文档（CLAUDE.md/agent.md/README.md/CONTRIBUTING.md/CHANGELOG.md，仅当计数不符时）
- 不碰：其余任何文件

## 回报
写 `/Users/acccan/domain-map/tech/roles/development/parallel-sessions/20260821-docs-maintenance/reports/ws4.md`：
- 实测 import plan JSON、npm test 结果、改了什么（每文件一句）
- 遇到的问题段（如有）
- 末两行精确 token：
```
门禁: PASSED
结论: OK
```
（失败则 `门禁: FAILED` + `结论: BLOCKED: <一句话>`）
