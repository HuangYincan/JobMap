# Batch Manifest — 20260821-boss-address-first

## 目标
「只有城市没地址的 POI」优先上网寻找其地址(一般网上都有的):对缺坐标且无地址的公司站点,
把网络检索当首要通道,提高拿到「地址+坐标」的命中率;地址回填到 location.address,
不再积压 unresolved。

## 背景(2026-08-21 探索结论)
- 「只有城市没地址的 POI」= `company_sites`(DB)/ drop JSON 中 site 有 `city`/`province`
  但 `location` 缺失(无 address 无坐标)。源:radar(1363 缺坐标站)+ official-career(420)。
- 现有链路 `geocode-sites-apply.mjs` 对无地址站点只做一次「公司名」place-text 检索
  (主循环 L288/L334,`cleanCompanySearchName(company.name)`),命中 POI 带 address 则回填
  (L390-395,含区名前缀);unresolved 主因 `no-pois` / 低置信 / regeo 拒。
- 已知精度缺口:检索 query 不含站点名(`geocodeQueryForSite` 是含站点名的,但 apply 主循环
  用的是裸公司名);同公司同城多 office 靠 `(query,province,city)` memo 共享同一命中。
- 配额:AMap place-text 100 次/天(有短路)、地址正向 geocode 5000 次/天、百度/腾讯兜底链。

## Workstreams
| ws | 主题 | 分支 | worktree | report | status |
|---|---|---|---|---|---|
| w1 | 无地址站点网络检索增强(站点名变体 + 地址缺失补查 + 回填保障) | fix/geocode-address-first | /Users/acccan/dm-wt-addr | reports/w1.md | MERGED(acc51c6) |
| w2 | 342 站地址回填 + 203 city 修正 + canary 更新 | fix/address-backfill | /Users/acccan/dm-wt-backfill | reports/w2.md | MERGED(790682e) |
| w3 | geocode apply 覆盖 5 源(qqdoc/embodied)+ 4 测试 | fix/geocode-qqdoc-embodied | /Users/acccan/dm-wt-geo-ext | reports/w3.md | MERGED(86db7dd) |
| w4 | 二轮再查 18 站回填 + 快照 45/2 | fix/address-backfill-r2 | /Users/acccan/dm-wt-backfill-r2 | reports/w4.md | MERGED(93cd40a) |
| w5 | embodied 形态契约允许 geocode 坐标 | fix/embodied-loc-contract | /Users/acccan/dm-wt-testfix | reports/w5.md | MERGED(eb394c4) |
| w6 | plan-seed-import.mjs 加载 .env.local(修 no-database) | fix/seed-import-env | /Users/acccan/dm-wt-seed-env | reports/w6.md | MERGED(db97861) |
| w7 | site.province 空时从 city 推断省 + 3 测试 | fix/geocode-province-infer | /Users/acccan/dm-wt-prov | reports/w7.md | MERGED(4000bcf) |
| w9 | 城市中心假坐标站(有街道地址)重新 geocode 判定 | fix/geocode-citycenter-rerun | /Users/acccan/dm-wt-center | reports/w9.md | MERGED(5f29134) |
| w10 | office POI 名称匹配放宽(复合限定词,解 831 no-result) | fix/geocode-grader-relax | /Users/acccan/dm-wt-grader | reports/w10.md | DONE(fafaf9b,待合并) |

## 合并顺序
1. w1 → 2. w2 → 3. w3 → 4. w4 → 5. w5 → 6. w6 → 7. w7 → 8. w9 → 9. w10(全部已合并并入 origin/dev)

## 合并后(Env-only,记 deferred-notes)
- 用户跑 `npm run geocode:sites:apply`(需 AMAP_WEB_KEY / 百度 / 腾讯 key)落地地址+坐标;
- 需同步 DB 时 `npm run import:seed:apply`(需 DATABASE_URL)。
