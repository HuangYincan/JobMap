# Batch Manifest — 20260823-boss-poi-datasource

## 目标
完善公司岗位 POI 数据源:让城市中心假坐标站(尤其上海 344 站)落真实办公坐标,并扩展数据源覆盖(海外站)。核心是让 Env-only 的 r5 geocode + import 变成「正确、快、可多日执行」。

## 根因与现状(2026-08-23 boss 实测)

1. **JSON drops 中心钉点 1330 站**(sitesTotal 2410):上海 344 / 北京 293 / 深圳 212 / 广州 117 / 成都 116。构成:
   - needsRerun **1076**(cityList 929「北京/上海/深圳」占位串 / 真实街道 134 / 其他 13)→ r5 公司名检索可解
   - stayCenter 249(城市名占位地址,语义留中心)
   - noAddress 5(qqdoc-jobs)
2. **r5 apply 从未执行**:前置代码(grader 放宽 fix/grader-seq-relax)已在 dev HEAD dda9555;`--cities/--only/dry-run` 已支持;三 key(AMAP_WEB_KEY / BAIDU_MAP_AK / TENCENT_MAP_KEY)与 DATABASE_URL 均已配置(只查存在性)。
3. **配额事实**(2026-08-23 查证):AMap place-text ~100 次/日、百度 Web 服务地点检索 100 次/日、腾讯 WebService 地点搜索 ~100 次/日(个人开发者);三 provider 合计日吞吐 ~300 站 → r5 全量(1076 站)约 **4 天**;高德 regeo 5000/日、百度逆地理 300/日(需平衡)。
4. **DB 更旧**:DB company_sites 实测 1556 站钉中心(> JSON 1330)→ 用户 UI 所见即 DB;r4/r5 数据从未 import(Env-only,deferred)。
5. **已知缺口(§3.1,tech/29)**:6 站(metapp×2/万物云×3/中电福富×1)的多城市占位串含「厦门」——「门」∈ STREET_RE → siteHasStreetAddress 误判 true → 走地址检索分支而非公司名检索。
6. **海外站**:全部有 location 但部分钉中心(如悉尼);AMap/百度/腾讯不支持海外地址检索;OSM Nominatim 未集成。
7. 用户手动探索了搜索引擎地址源(`.address-work/`,百度/搜狗/360/必应,未入库)——审查结论写入 ws-d 文档,不直接抓取(合规红线)。

## Workstreams

| ws | 主题 | 分支 | worktree | report |
|---|---|---|---|---|
| a | 「/」多城市列表串 → 强制公司名检索分支(修 6 站「门」误判 + 防同类) | fix/poi-citylist-branch | /Users/acccan/dm-wt-pds-a | reports/ws-a.md |
| b | OSM Nominatim 海外站数据源(第四 provider,海外钉中心站落真实坐标) | feat/poi-nominatim | /Users/acccan/dm-wt-pds-b | reports/ws-b.md |
| c | r5 多日执行体验:跨日进度持久化 + daily 封装 + 按城排程 + 配额事实注释 | feat/poi-daily-run | /Users/acccan/dm-wt-pds-c | reports/ws-c.md |
| d | tech/29 刷新为 r5 runbook + etl 来源审查(海外 Nominatim / 搜索引擎源结论) | docs/poi-r5-runbook | /Users/acccan/dm-wt-pds-d | reports/ws-d.md |

## 合并顺序(依赖序)
1. ws-a(判定基础)→ 2. ws-b(海外路由复用 a 的判定)→ 3. ws-c(进度记录,独立)→ 4. ws-d(文档,收全部事实,最后)

## Env-only(记 deferred-notes,用户执行)
- `npm run geocode:sites:apply`(r5 全量,~4 天,每天一次跑至 QUOTA_EXHAUSTED 短路)
- `npm run import:seed:apply`(r5 后;DB 对齐 JSON,1556→~1330→r5 后更低)
- UI 验证 + MODE_CACHE_VERSION bump(import 后)
- Nominatim 海外站实际执行(r5 跑完后按 runbook)
