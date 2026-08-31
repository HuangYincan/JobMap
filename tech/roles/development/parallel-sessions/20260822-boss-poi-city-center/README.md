# Batch Manifest — 20260822-boss-poi-city-center

## 目标
修复「仍有大量 POI 位于城市中心」bug:让城市中心假坐标站点落真实办公坐标。

## 根因(2026-08-22 探索 + 实测,dev HEAD 17cb454)

三层问题叠加,用户 UI 上看到的即是第三层:

1. **JSON drops 数据**:中心钉点 **1346 站** = 待重跑 1092 + 留中心(城市名占位)249 + 无地址 5。
   分布:radar 1232 / official-career 106 / qqdoc-jobs 8;Top:上海 347 / 北京 296 / 深圳 217 /
   广州 117 / 成都 116 / 武汉 59 / 南京 47 / 西安 41。产生链路:`split-city-sites.mjs`
   (:149-157/:114-125)给无坐标站补 `cityCenter()` 坐标;`geocode-sites-apply.mjs` 失败只记
   unresolved 不写假坐标。
2. **geocode r5 从未执行**:r4(3e6deb3)只修 288 站(上海 376→347,−29);r5 apply
   (多城市占位站公司名检索重试)在 20260821-boss-address-first boss-state next_plan 中但
   未执行。**前置代码缺口**:`officeNameMatchStrength` 的 matches() 只认单个限定词 token,
   「百度研发大厦」= 研发+大厦 复合序列被拒 → 831 站 no-result(w10 prompt 已写明根因,
   但 w10 从未开发,分支 fix/geocode-grader-relax 只有测试 commit、无功能代码)。
3. **DB 未同步(用户所见)**:DB `company_sites` 实测 **1556 站**坐标钉城市中心(±0.0005:
   上海 332 / 北京 564 / 深圳 210 / 广州 114 / 成都 113 / 武汉 58 / 南京 46 / 西安 41),
   比 JSON 的 1346 更多 → DB 是 r4 前的旧导入。`/api/pois` 读 Postgres(历史教训 9d609ec
   同款:geocode 修正不 import:seed:apply 不生效)。r4 数据(3e6deb3, 2026-08-22 06:29)之后
   无 import 记录。

## Workstreams

| ws | 主题 | 分支 | worktree | report | status |
|---|---|---|---|---|---|
| a | officeNameMatchStrength 限定词 token 序列放宽(解 831 no-result,r5 前置) | fix/grader-seq-relax | /Users/acccan/dm-wt-pcc-a | reports/ws-a.md | PENDING |
| b | r4 数据契约测试对齐(参考 fix/geocode-r4-tests、fix/geocode-grader-relax 未合并测试 commit)+ zz-w9 重命名 | fix/data-contract-r4-sync | /Users/acccan/dm-wt-pcc-b | reports/ws-b.md | PENDING |
| c | r5 就绪核查 + 基线诊断 + tech 文档(geocode r5 操作清单与现状) | fix/geocode-r5-readiness | /Users/acccan/dm-wt-pcc-c | reports/ws-c.md | PENDING |

## 合并顺序
1. ws-a(grader 放宽,独立)→ 2. ws-b(测试契约,独立)→ 3. ws-c(文档,最后)

## 关键证据(file:line)
- `server/src/lib/city-centers.ts:42-121` CITY_CENTERS 静态表;`:159-161` cityCenter()
- `server/src/lib/site-geocode.ts:85` CITY_CENTER_EPS=0.0005;`:88-101` matchesCityCenter;
  `:126-145` isCityNameAddress;`:33-47` siteNeedsGeocode;`:262-272` cityCenterSqlCondition
- `server/scripts/split-city-sites.mjs:149-157` 单城市无坐标站补中心坐标;`:114-125` 拆分站坐标
- `server/scripts/geocode-sites-apply.mjs:331` 裸公司名 place-text 检索;`:199` memo 命中;
  `:392-396` 失败记 unresolved 不写假坐标
- `server/scripts/plan-site-geocode.mjs` dry-run 只读(实测 drops: companies 916 /
  alreadyLocated 962 / needs 1248 / skippedNoAddress 0)

## 合并后(Env-only,记 deferred-notes)
- 用户跑 `npm run geocode:sites:apply`(r5;ws-a 落地后;AMap place-text 日配额 100 次 +
  百度/腾讯兜底,可分多日)
- 用户跑 `npm run import:seed:apply`(r5 后;需 DATABASE_URL)
- 之后 UI 验证地图堆叠下降 + bump MODE_CACHE_VERSION(数据变化)
