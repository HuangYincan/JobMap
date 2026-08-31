# 合并报告(2026-08-22)

## 结果总览
- 成功合并: ws-1 x 1(`fix/saved-layer-mutex`)
- 失败/遗留: 无

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws-1 | fix/saved-layer-mutex | 成功(no-ff,merge commit 3dd619a) | 1149 pass / 2 skip / 0 fail;tsc 0 错误;docs-check passed;diff-check green | 无冲突(ort 自动合并;component-contracts.test.mjs 自动合并) |

## 冲突解决清单
- 无手动冲突解决。`server/tests/component-contracts.test.mjs` 触发 auto-merge(dev 与分支对该文件改动不相交,git 自动并合)。
- 主树豁免处理(按 boss 裁决):`server/data/recruitment/official-career/蔚来.json`(Env-only geocode 产物)全程未触碰、未并入任何 commit、保留原样;`server/next-env.d.ts`(Next.js 生成噪音)已 `git checkout --` 还原。分支改动 8 文件与该两文件零重叠,未触发 merge 拒绝。

## 遗留问题
- 无。Env-only 步骤(迁移 apply / import:seed:apply / AMap geocode)按规则留给用户。

## 最终 dev 状态
- `git push origin dev` 完成:c5dd6fd..3dd619a。
- worktree `../dm-wt-saved-mutex` 已 remove;分支 `fix/saved-layer-mutex` 已删除(20380b9)。
- 未 push main、未 force-push。

门禁: ALL_GREEN
结论: MERGED_ALL
