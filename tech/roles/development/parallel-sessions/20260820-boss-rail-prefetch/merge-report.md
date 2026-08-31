# 合并报告(2026-08-20)

## 结果总览
- 成功合并: w1 x 1(fix/rail-first-click-refresh)
- 失败/遗留: 无

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| w1 | fix/rail-first-click-refresh | d61e720 `--no-ff`,clean(ort 策略,0 冲突) | npm test 500 pass / 0 fail / 2 skip;typecheck 通过;docs-check 通过;git diff --check 干净 | 无冲突 |

## 冲突解决清单
(无 —— 单分支合并,无冲突)

## 遗留问题
- 主工作树有未跟踪文件(不影响合并,未动):`rail-pre-before-click`(boss VERIFY 阶段的 Playwright a11y snapshot 残留,建议后续清理);`tech/roles/development/parallel-sessions/20260820-boss-{bugfix,optimize,rail-prefetch}/`(批次元数据)。
- Env-only 步骤(迁移 apply / import:seed:apply / AMap geocode)未做,按约定留给用户。

## 最终 dev 状态
- dev HEAD: `d61e720`(Merge commit),已 `git push origin dev`(5e436c4..d61e720)
- w1 汇报门禁与 boss 端到端验证(Playwright 冷启动首点不刷新)已二次确认;merger 复跑全部门禁全绿。
- 主工作树 `git status` 无已跟踪文件残留;worktree `/Users/acccan/dm-wt-w1` 已移除;分支 `fix/rail-first-click-refresh` 已删除。

门禁: ALL_GREEN
结论: MERGED_ALL
