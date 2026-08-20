# Batch Manifest — 20260821-boss-geocode-quota

## 目标
geocode:sites:apply 双配额耗尽(AMap place-text 10044 + 百度 302)时自动短路停止,不空跑。

## 背景
2026-08-21 实测:AMap 地点检索 100 次/天耗尽 + 百度 302,脚本仍逐个尝试 ~1800 剩余站点(纯空跑),用户手动 Ctrl-C。根因:主循环无配额短路。

## Workstreams
| ws | 主题 | 分支 | worktree | report | status |
|---|---|---|---|---|---|
| w1 | geocode 配额短路 | fix/geocode-quota-short-circuit | /Users/acccan/dm-wt-geo-quota | reports/w1.md | DONE(门禁 PASSED / 结论 OK) |

## 合并顺序
1. w1(单分支)

## 合并后
- 验证:server npm test 520 pass/2 skip(基线 504 + 新增 16)
- push origin/dev;清理 worktree/分支
