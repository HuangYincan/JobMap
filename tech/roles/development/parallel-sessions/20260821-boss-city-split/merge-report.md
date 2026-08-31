# 合并报告(2026-08-21)

## 结果总览
- 成功合并: w1 x 1(feat/city-split-sites)
- 失败/遗留: 无

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| w1 | feat/city-split-sites | 成功(--no-ff,eaa9d0c) | npm test 648 pass/0 fail/2 skip(typecheck/docs-check/diff --check 全通过) | 无冲突 |

## 冲突解决清单
- 无。分支基于 7121f30,dev 已含 map-engine 合入(5fcb8a6),ort 策略干净合并,无冲突。

## 遗留问题
- Env-only 步骤留给用户:合并后需 `npm run import:seed:apply` 同步 Postgres,再验证 885 POI 可见 + 搜索可查(manifest「合并后」节)。
- 岗位无 `position.city` 字段(4 目录 12410 条),真实数据岗位重挂 0;后续岗位带城市字段时重跑 split-city-sites.mjs 即可改挂。

## 最终 dev 状态
- HEAD: eaa9d0c(merge commit,parent 5fcb8a6 + ce78c14)
- 已 push origin/dev(5fcb8a6..eaa9d0c)
- worktree /Users/acccan/dm-wt-csplit 已 remove;分支 feat/city-split-sites 已删除
- 主树无残留(仅批次目录 untracked,属预期)

门禁: ALL_GREEN
结论: MERGED_ALL
