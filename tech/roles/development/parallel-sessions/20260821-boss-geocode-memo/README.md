# Batch Manifest — 20260821-boss-geocode-memo

## 目标
AMap 地点检索(place-text,100 次/天)配额利用率优化:同 query+region 的公司名检索结果缓存,同城多站点复用。

## 背景
配额审计:place-text 是 geocode 全量落地瓶颈;脚本无缓存,同公司同城市多 office(安克创新 38 站点、元气森林 71 站点)重复消耗。memo 后一次查询服务多个站点。

## Workstreams
| ws | 主题 | 分支 | worktree | report | status |
|---|---|---|---|---|---|
| w1 | place-text 结果缓存 | fix/geocode-place-memo | /Users/acccan/dm-wt-geo-memo | reports/w1.md | DONE(门禁 PASSED / 结论 OK) |

## 合并顺序
1. w1(单分支;基于 dev 83fc6d0,含配额短路)

## 合并后
- 验证:server npm test 530 pass/2 skip(基线 520 + 新增 10)
- push origin/dev;清理 worktree/分支
