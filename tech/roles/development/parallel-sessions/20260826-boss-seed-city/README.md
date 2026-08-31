# 批次 Manifest — 20260826-boss-seed-city(zoom 小时 seed 站不聚合进城市徽章)

## 用户发现

「bug: zoom 小时部分站不能聚合进城市徽章。」

## 根因(boss 已验证)

`INTERNSHIP_SEED`(server/src/lib/seed-data.ts,50 家公司骨架)的 site **全部缺 `city` 字段**
(只有 id/name/location/careerUrl/logoUrl)。读路径 `poiCity()`(city-cluster.ts:53-57)
取 `sites[0].city` → undefined → 「无 city 不聚合」→ zoom ≤ 8 时这些公司以个体 pin 散落,
不进「杭州」徽章。最终目录受影响的 11 个:
alibaba-xixi / netease-hangzhou / bytedance-hangzhou / antgroup-hangzhou / didi-hangzhou /
deepseek / hithink-hangzhou / h3c-hangzhou / betta-hangzhou / xiaomi-hangzhou / zhejiang-lab。

boss 已核验:50 个 seed site 坐标 100% 落在杭州参考框(spatial-query.ts CITY_REFERENCE_BOXES
杭州 west118.3/south29.05/east120.8/north30.75)内 → 统一补 `"city": "杭州市"` 安全。

## Workstream(1 个)

| ws | 分支 | worktree | 合并顺序 |
|---|---|---|---|
| sc-seed-city | fix/seed-site-city | /Users/acccan/dm-wt-sc-seed-city | 1 |

门禁:`cd server && npm test` + `npm run typecheck` + `make docs-check` + `git diff --check`。
回报:reports/sc-seed-city.md。不 merge、不 push、不碰主树。
