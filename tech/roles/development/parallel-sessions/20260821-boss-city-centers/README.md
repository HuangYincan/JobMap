# Batch Manifest — 20260821-boss-city-centers

## 目标
「前端看不到」残余修复:CITY_CENTERS 补全(31→86 城含海外)+ 省前缀归一(广西柳州→柳州),有岗位公司全部上地图。

## 结果(w1)
- city-centers 31→86 城(大陆 41 + 海外 14);省前缀剥离归一
- 重跑拆分:16 文件 95 补点 + 1 拆分;东风柳汽获坐标 109.41/24.32 可进 POI
- 门禁:npm test 661 pass/2 skip(基线 648 + 13)

## Workstreams
| ws | 主题 | 分支 | worktree | report | status |
|---|---|---|---|---|---|
| w1 | 城市中心补全 + 省前缀归一 | fix/city-centers-extend | /Users/acccan/domain-map/dm-wt-cc | reports/w1.md | DONE(门禁 PASSED / 结论 OK) |

## 合并后
- import:seed:apply(Env,boss 执行)→ 验证东风柳汽搜索可见
- push origin/dev;清理 worktree/分支
