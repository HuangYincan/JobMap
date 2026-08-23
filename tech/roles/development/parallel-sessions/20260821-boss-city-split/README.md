# Batch Manifest — 20260821-boss-city-split

## 目标
用户反馈「前端看不到」新公司。根因:无坐标站点被 POI 过滤(server-catalog.ts:53)。多城市字符串拆分 + 单城市补 cityCenter 中心点,让有岗位的公司全部上地图。

## 结果(w1)
- 650 个 drop 数据:13 家多城市拆分 +39 城市站点,1485 单城市补中心点,0 岗位重挂(数据无 position.city)
- **离线 catalog 可见 POI:106 → 885**
- 门禁:npm test 609 pass/2 skip(基线 591 + 18)
- 金华中心落在杭州参考框 → 坐标一致性守卫豁免(cityCenter 等值,事故坐标无法命中)

## Workstreams
| ws | 主题 | 分支 | worktree | report | status |
|---|---|---|---|---|---|
| w1 | 多城市拆分 + 城市中心坐标 | feat/city-split-sites | /Users/acccan/dm-wt-csplit | reports/w1.md | DONE(门禁 PASSED / 结论 OK) |

## 合并后
- import:seed:apply(Env,boss 执行)→ 验证 885 POI 可见 + 搜索可查
- push origin/dev;清理 worktree/分支
