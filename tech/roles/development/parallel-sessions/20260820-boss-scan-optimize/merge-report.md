# 合并报告(2026-08-20)

## 结果总览
- 成功合并: ws-docs / ws-api / ws-data / ws-frontend 共 4 分支,全部按 manifest 顺序串行 merge 回 `dev`,门禁全绿,每次 merge 后已 `git push origin dev`。
- 失败/遗留: 无。ws-hygiene 按 manifest 跳过(分支无 commit,tip=933f972;scan #13 已由 boss 在主树完成并提交 dev b8d5fc1)。

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws-docs | fix/docs-sync-20260820 | 80e9bd6(no-ff,干净) | 488 pass / 0 fail / 2 skip;typecheck ✓;docs-check ✓;diff ✓ | 无冲突 |
| ws-api | fix/poi-id-route | 0efa878(no-ff,干净) | 488 pass / 0 fail / 2 skip;typecheck ✓;docs-check ✓;diff ✓ | 无冲突 |
| ws-data | fix/radar-double-https | 32fadaf(no-ff,干净) | 491 pass / 0 fail / 2 skip;typecheck ✓;docs-check ✓;diff ✓ | 无冲突 |
| ws-hygiene | chore/repo-hygiene | 跳过(无 commit) | —(boss 主树已处理,dev b8d5fc1) | — |
| ws-frontend | refactor/map-shell-hooks | 19139bd(no-ff,干净) | 493 pass / 0 fail / 2 skip;typecheck ✓;docs-check ✓;diff ✓ | 无冲突 |

## 冲突解决清单
无冲突。四个分支与 dev 基点的分叉仅含 boss 主树 hygiene 提交 b8d5fc1(只动 tech/roles/development/parallel-sessions/20260819-* 与 .gitignore),与各分支文件不相交,ort 策略全部自动干净合入。

## 遗留问题
- 无合并遗留。ws-hygiene 的 chore/repo-hygiene 空分支与 worktree 已清理(无 commit,删除无损失)。
- 遗留 worktree `domain-map-wt-poi-fix`(fix/poi-zoom-full-load,已并入 dev 933f972)属前一批次,未在本批范围处理。
- 主树未跟踪的 20260820-boss-* 批次目录 + quality-scans/20260820-all 为本 boss 会话工作文件,由 boss 决定入库时机。
- Deferred(用户决策 / Env-only,见 deferred-notes.md):scan #3 同公司 slug 合并、#5 改名、#8 robots 失败策略、#14 串味行 DB 数据修正、#4 的 import apply。均未执行,符合铁律。

## 最终 dev 状态
- tip:`19139bd merge: refactor/map-shell-hooks(…)`;`git status --short` 仅 boss 会话未跟踪目录,主树干净。
- 4 次 push 均成功:80e9bd6 → 0efa878 → 32fadaf → 19139bd(origin/dev = 本地 dev)。
- 未 push main、未 force-push;无 Env-only 步骤执行。

门禁: ALL_GREEN
结论: MERGED_ALL
