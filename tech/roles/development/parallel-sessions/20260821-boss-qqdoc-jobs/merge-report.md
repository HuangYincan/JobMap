# 合并报告(2026-08-21)

## 结果总览
- 成功合并: w1 x 1(feat/qqdoc-jobs-source)
- 失败/遗留: 无

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| w1 | feat/qqdoc-jobs-source | a6079cc(--no-ff, ort 自动合并) | ALL_GREEN:591 pass / 2 skip / 0 fail;typecheck 通过;docs-check 通过;diff --check 通过 | 无冲突 |

## 冲突解决清单
无冲突(ort 策略自动合并,0 unmerged paths)。

## 遗留清理(幂等恢复)
主树发现上次中断运行残留,按幂等恢复规则清理:
- `server/data/recruitment/qqdoc-jobs/`(163 个未跟踪文件)—— 与分支版本逐字节一致(抽样 3 个 SAME),为提取脚本残留;移出到 `/tmp/qqdoc-jobs-leftover`(未删除),合并已从分支恢复同内容入库,可删除该临时目录。
- `tech/roles/data/etl/qqdoc-official.md` 未提交 +8 行文档注记(「补充提取 2026-08-21」)—— 内容与批次 README / reports/w1.md 重复,按规则 `git checkout --` 丢弃(如需入库可另行提交)。
- `qq-doc-official-tabs.png`(仓库根目录截图,违反 .playwright-mcp 产物约定)—— 移至 `/tmp/qq-doc-official-tabs.png`(未删除)。

## 遗留问题
- 无代码/门禁遗留。
- Env-only 步骤留给用户:`npm run import:seed:apply`(岗位入库验证 + 徽章)。

## 最终 dev 状态
- HEAD `a6079cc`(merge commit: feat/qqdoc-jobs-source → dev),已 `git push origin dev`(6c7582d..a6079cc)。
- worktree `/Users/acccan/dm-wt-qqj` 已移除;分支 `feat/qqdoc-jobs-source` 已删除。

门禁: ALL_GREEN
结论: MERGED_ALL
