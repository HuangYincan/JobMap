# 合并报告(2026-08-21)

## 结果总览

- 成功合并: w1 / w2 / w3 共 3 个 WS,按 manifest 依赖序 1→2→3 串行合并,全部门禁绿后逐次 push dev
- 失败/遗留: 无
- w2/w3 分支上自测 typecheck 红(4 处契约依赖报错)已在 w1 合入后复验全绿,与 manifest「merger 必读」预期一致

## 逐分支明细

| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| w1 | feature/i18n-option-labels-foundation | 1d131c3,无冲突 | 1009 pass/2 skip ✓ / typecheck 0 错 ✓ / 无 .md 改动 ✓ / diff-check ✓ | 无冲突 |
| w2 | feature/i18n-option-labels-renderers | 2fec31b,无冲突 | 1009 pass/2 skip ✓ / typecheck 0 错 ✓(分支上 4 错均为 w1 契约缺失,w1 合入后全绿) / 无 .md 改动 ✓ / diff-check ✓ | 无冲突 |
| w3 | feature/i18n-option-labels-prefs | 2e79614,无冲突 | 1009 pass/2 skip ✓ / typecheck 0 错 ✓(同上契约依赖,复验全绿) / 无 .md 改动 ✓ / diff-check ✓ | 无冲突 |

## 冲突解决清单

- 无任何合并冲突(三分支文件边界不重叠:lib/* ↔ components/filter-panel, sort-selector ↔ components/account-panel, mode-switcher, secondary-sidebar, map-shell)。未触发任何「不碰」取舍。

## 遗留问题

- **docs-check 说明**:`make docs-check`(grep 全仓 `*.md`)在仓库根命中 2 个文件,均为**其他批次**(20260821-resend-otp、20260821-candcat-list)未入库的 merge-report.md——其内容复述了 grep 正则本身造成自匹配(该两文件已自行注明此现象)。本批次三处 merge 的 diff 均不含任何 `.md` 改动,无文档漂移;worker 在各自 worktree 内跑 docs-check 均通过。属并行批次文件相互干扰,非本批次缺陷。
- **push 连带**:合并开始时本地 dev 领先 origin/dev 5 个提交(20260821-resend-otp 批次的已合并未推送提交,该批次 merger 同主工作树并发推进,随后其 push 完成)。本批次 push dev 时一并携带;`origin/dev` 与本地 `dev` 已一致,无重复/丢提交。
- **并发批次**:写报告时 dev tip 为 38e2a66(fix/map-engine-ux2 批次 merger 并发合入),本批次 3 个 merge 提交(1d131c3 / 2fec31b / 2e79614)均在 history 中,均已 push。
- Env-only 步骤(迁移 apply / import:seed:apply / AMap geocode)未做,留给用户。

## 最终 dev 状态

- dev tip: 38e2a66(含本批次 1d131c3 → 2fec31b → 2e79614 三个 merge 提交)
- origin/dev == 本地 dev(已 push 同步)
- 本批次 3 个 worktree 已 remove、3 个分支已 `git branch -d` 清理
- 未 push main、未 force-push

门禁: ALL_GREEN
结论: MERGED_ALL
