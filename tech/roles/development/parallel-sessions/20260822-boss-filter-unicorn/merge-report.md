# 合并报告(2026-08-22)

## 结果总览
- 成功合并: ws-1 x 1
- 失败/遗留: 无

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| ws-1 | fix/filter-unicorn | ✅ 无冲突(ort,merge commit f9cdd1c) | 1267 pass / 0 fail / 2 skip;typecheck ✅;docs-check ✅;diff-check ✅ | 无冲突 |

## 冲突解决清单
无(合并为纯快进式三方合并,5 文件 370+/14-,无 conflict)。

## 遗留问题
- ws-1 汇报中的已知残留(非本次症状):取消勾选后 F5 还原的 catalog 池仍是 load 时刻服务端按旧 filters 过滤的子集(unicorn 公司仍在池中,客户端 pipeline 按 `{}` 过滤后可见)——「池 = 抓取时刻服务端过滤结果」的既有行为,若需池级自愈(筛选变更重拉全量池)另开 workstream。deferred-notes 未记录,建议 boss 视需要追加。
- 主工作树 `server/next-env.d.ts` 为 Next.js 自动生成文件,合并前曾出现本地自动改写噪音(`.next/dev/types` → `.next/types`),已 `git checkout --` 还原,非分支改动。

## 最终 dev 状态
- `dev` @ f9cdd1c(merge commit),已 `git push origin dev`(cda385f..f9cdd1c)。
- worktree `/Users/acccan/dm-wt-filter-unicorn` 已 remove;分支 `fix/filter-unicorn` 已删除。
- 未 push main、未 force-push;Env-only 步骤(迁移 apply / import:seed:apply / AMap geocode)未做,留给用户。

门禁: ALL_GREEN
结论: MERGED_ALL
