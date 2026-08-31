# Batch Manifest — 20260821-boss-geocode-count

## 目标
修正 geocode 配额短路时的计数误导:「Sites needing a point: 5」实为短路前累计,真实全量 1783。预扫统计真实 planTotal,短路输出 `1783 (attempted: 5)`,剩余按真实差值。

## Workstreams
| ws | 主题 | 分支 | worktree | report | status |
|---|---|---|---|---|---|
| w1 | 全量计数输出修正 | fix/geocode-plan-count | /Users/acccan/dm-wt-geo-count | reports/w1.md | DONE(门禁 PASSED / 结论 OK) |

## 合并顺序
1. w1(单分支;基于 dev 82045dd)

## 合并后
- 验证:server npm test 536 pass/2 skip(基线 530 + 6)
- push origin/dev;清理 worktree/分支
