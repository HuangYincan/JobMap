# 合并报告(2026-08-21)

## 结果总览
- 成功合并: w1 x 1 (feat/qqdoc-official-source)
- 失败/遗留: 无

## 逐分支明细
| WS | 分支 | merge | 门禁(npm test/typecheck/docs-check/diff) | 冲突解决 |
|---|---|---|---|---|
| w1 | feat/qqdoc-official-source | `--no-ff` | npm test 566 pass/2 skip / typecheck OK / docs-check OK / diff-check OK | 无冲突 |

## 冲突解决清单
无(单分支,合并无冲突)。

## 遗留问题
- **Env-only(留给用户/boss)**:`import:seed:apply` 落库验证 142 家 qqdoc-official 入库(boss 执行);AMap/腾讯 geocode 由用户在 Run 流程触发。
- 合并前主树 `server/data/recruitment/qqdoc-official/` 存在 142 个**过时 untracked 文件**(已由 dev 分支 HEAD 中的同名 tracked 文件覆盖,内容一致上游)。旧副本已备份至 `/tmp/qqdoc-main-tree-stale/qqdoc-official` 以防误删。
- `qq-doc-official-tabs.png` 与 `tech/roles/data/etl/qqdoc-official.md` 在主线为 untracked,未纳入本次分支合并,留待主 Agent/用户处置(不在本分支范围内)。其余 worktree(dm-wt-ws1/2/3)属其他批次,未动。
- 50 家 `city_pending` 待后续官网地址提取/用户补全。

## 最终 dev 状态
- HEAD: `1ec3fff` (merge: feat/qqdoc-official-source)
- 已 push origin/dev;worktree /Users/acccan/dm-wt-qqdoc 与分支 feat/qqdoc-official-source 已清理。
门禁: ALL_GREEN
结论: MERGED_ALL
