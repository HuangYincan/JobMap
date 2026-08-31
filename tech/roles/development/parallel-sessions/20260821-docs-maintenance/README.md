# Batch Manifest — 20260821-docs-maintenance

## 目标
文档维护：自主增、删、改、补，维持 agent 和人类可读性，不丢重要内容。纯文档变更，无代码/UI/Env-only。
用户已拍板归档策略：**全保留 + 导航补齐**（24 个批次目录全部入库，新增索引与遗留账本）。

## 前置（boss 已执行）
- 5 个未跟踪批次入库 commit（`chore: 批次入库(…)`，20260820-boss-bugfix/optimize/rail-prefetch/rail-settle + 20260821-boss-geocode-count）
- 20260821-boss-qqdoc-official **in-flight**（reports/ 空、无 merge-report）：不入库、不编辑，索引标注 in-flight
- 删除 parallel-sessions/.DS_Store

## Workstreams
| ws | 主题 | 分支 | worktree | report |
|---|---|---|---|---|
| ws1 | 根契约文档修正（README/CHANGELOG/CONTRIBUTING/agent.md/CLAUDE.md） | fix/contract-docs | /Users/acccan/dm-wt-ws1 | reports/ws1.md |
| ws2 | tech/ 顶层编号文档修正（01-22 + 00-* 合并） | fix/tech-docs | /Users/acccan/dm-wt-ws2 | reports/ws2.md |
| ws3 | roles/ 归档导航（批次索引 + 遗留账本 + 链接修复 + 状态回填） | fix/roles-archive | /Users/acccan/dm-wt-ws3 | reports/ws3.md |

## 合并顺序
1. ws1 → 2. ws2 → 3. ws3（文件互不相交，按序 --no-ff）

## 门禁（每 WS）
- `make docs-check` + `git diff --check`（worktree 根）
- 各自 grep 一致性验证（见 prompt）
- ws3 额外：相对链接扫描 0 破损、deferred-ledger 覆盖核对

## 合并后（boss/merger）
- 全部绿 → 派 merger → push origin/dev
- 本批次目录自身 commit 入库（既有模式）
