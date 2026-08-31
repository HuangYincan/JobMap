# 29 — geocode r5 状态与操作清单(城市中心假坐标修复链)

**文档版本:** 2.2
**创建日期:** 2026-08-22
**更新日期:** 2026-08-26
**状态:** r5 runbook——**主波次已执行(2026-08-26)**:用户 Env-only apply 后 `313fc61` 落地 135 站真实办公点(中心钉点 1330→941),缓存已 bump v19(§4.5);残余站点按 §4.2 增量续跑,import 落库(§4.4)与 Nominatim 海外执行(§7)仍待用户。历史基线数字来自 2026-08-23 boss 实测(批次 `20260823-boss-poi-datasource` manifest)与 2026-08-22 基线(worktree `fix/geocode-r5-readiness` 复算)
**相关:** `tech/16-bug-fixes.md`(坐标 bug 记录)、`tech/21-city-clustering.md`、`tech/23-map-engines.md`、批次 `tech/roles/development/parallel-sessions/20260822-boss-poi-city-center/`(根因/基线)与 `20260823-boss-poi-datasource/`(r5 执行能力批次:ws-a 列表串判定 / ws-b Nominatim 海外源 / ws-c daily 进度封装 / ws-d 本文档)、`20260825-boss-hi-priority-fixes/`(ws-d-data-completion:占位地址地点检索补全)、r4 commit `3e6deb3`、v17 bump commit `9e693a9`、`server/src/lib/site-geocode.ts`、`server/scripts/geocode-sites-apply.mjs`、`server/scripts/plan-site-geocode.mjs`、`server/scripts/audit-city-center-pins.mjs`

---

## 1. 背景:为什么地图上堆了一堆城市中心 POI

三层问题叠加(2026-08-22 探索 + 实测,详见批次 manifest 根因段):

1. **JSON drops 中心钉点 1346 站**:城市拆分时代 `split-city-sites.mjs`(:149-157/:114-125)给无坐标站补 `cityCenter()` 静态中心坐标(`server/src/lib/city-centers.ts`)。这是占位,不是真实办公点。
2. **geocode r5 从未执行**:r4(`3e6deb3`, 2026-08-22)只修 288 站;r5(多城市占位站公司名检索重试)在 `20260821-boss-address-first` 批次 next_plan 中但未落地——前置代码缺口:grader `officeNameMatchStrength` 拒绝复合限定词(「百度研发大厦」= 研发+大厦 两个 token),831 站 no-result。该缺口由 ws-a `fix/grader-seq-relax` 修复(2026-08-22 批次,已合并)。
3. **DB 未同步**:DB `company_sites` 实测 1556 站钉城市中心(比 JSON 更多)→ DB 是 r4 前的旧导入;`/api/pois` 读 Postgres,geocode 修正不 `import:seed:apply` 不生效(历史教训 `9d609ec` 同款)。

## 2. 现状(2026-08-23 实测基线)

### 2.1 中心钉点构成(口径:CITY_CENTERS ± 0.0005,即 `site-geocode.ts` CITY_CENTER_EPS)

2026-08-23 boss 实测(`20260823-boss-poi-datasource` README manifest);合并后可随时用 `node scripts/audit-city-center-pins.mjs` 复算:

| 指标 | 2026-08-23 实测 | 2026-08-22 基线 | 说明 |
|---|---|---|---|
| sitesTotal | **2410** | — | JSON drops 站点总数(全部有 location) |
| 中心钉点合计 | **1330** | 1346 | 坐标恰等于某静态城市中心 ±0.0005 |
| needsRerun | **1076** | 1092 | 地址非「仅城市名」→ r5 将重跑 |
| — cityList(「/」多城市占位串) | 929 | 941 | 走公司名 place-text 检索分支 |
| — 真实街道地址 | 134 | 134 | 走地址检索分支 |
| — 海外·其他 | 13 | 17 | 走公司名检索分支(海外站另见 ws-b Nominatim) |
| stayCenter | **249** | 249 | 地址是城市名占位(「北京」「北京市」「浙江省杭州市」)→ r5 语义:留在中心 |
| noAddress | **5** | 5 | 中心钉点但无地址(qqdoc-jobs 5 站) |

**与 2026-08-22 基线(1346)的差异说明**:总量 1346→1330、needsRerun 1092→1076(cityList 941→929、海外·其他 17→13)、stayCenter 249 / noAddress 5 不变。差异来源为**数据源更新**(radar 等源快照刷新,站点集合与地址文本变化;期间未跑过任何 geocode apply——apply 全程 Env-only,无执行),不是 geocode 行为变化。

**2026-08-25 分类口径更新(fix/site-place-search)**:上表 2026-08-23 实测时分类只有 needsRerun / stayCenter / noAddress(后者「留中心」)。用户发现问题:读路径无差别剔除城市中心钉后,stayCenter(城市名占位地址)+ noAddress(无地址)中的**带真实岗位**站点被一并隐藏;裁定修复 = **数据补全**(读路径 `isCityCenterPin` 过滤不变)。2026-08-25 起 audit 分类表新增 `needsPlaceSearch`(地址为城市名占位/无地址,且站点有真实岗位)——原 stayCenter/noAddress 中带岗位的站转入该分类,进「公司名+城市」地点检索补全(`siteNeedsPlaceSearch` / `pickPlaceSearchPoi`,纯函数 + plan/audit/apply 共用;**修正后坐标离开中心钉 → 读路径自然可见**;无有效候选 → 留中心钉待跟进)。以此口径复算:2026-08-23 的 stayCenter 249 + noAddress 5 中,实际带岗位的站点全在 needsPlaceSearch(数字以当前 audit 输出为准)。

Top 城市(中心钉点数,2026-08-23 实测):

| 城市 | centerPins(08-23) | centerPins(08-22) | needsRerun(08-22) | stayCenter(08-22) |
|---|---|---|---|---|
| 上海 | **344** | 347 | 272 | 75 |
| 北京 | **293** | 296 | 249 | 45 |
| 深圳 | **212** | 217 | 187 | 29 |
| 广州 | **117** | 117 | 98 | 19 |
| 成都 | **116** | 116 | 109 | 7 |

(其余城市合计 ~70 站——2026-08-22 口径含武汉 59 / 南京 47 / 西安 41 / 杭州 29 / 重庆 7 等;2026-08-23 城市级 needsRerun/stayCenter 细分以 audit 脚本输出为准,批次合并后可复算。)

来源分布(2026-08-22 口径):radar 1232 / official-career 106 / qqdoc-jobs 8——2026-08-23 未单独复测,以 audit 脚本输出为准。

### 2.2 r5 前 plan dry-run 基线(只读,`npm run geocode:sites`)

| 指标 | 实测值(2026-08-22) |
|---|---|
| companies | 916 |
| alreadyLocated | 962 |
| needs(缺坐标/待重跑) | 1248 |
| skippedNoAddress | 0 |

r5 执行前以**当次** dry-run 输出为准(数据源更新后数字会漂移)。2026-08-25 起
plan 输出字段改名/新增:地址可 geocode 站 = `needsGeocode`(旧 `needs`),
占位/无地址地点检索补全站 = `needsPlaceSearch`(新增,另附
`placeSearchSamples`)。

### 2.3 r4 已修部分

r4(`3e6deb3`):288 城市中心/缺坐标站落真实坐标(上海 376→347→344)。r4 数据**从未 import 进 DB**(见 §4.4):DB `company_sites` 实测 1556 中心站 > JSON 1330,DB 仍是 r4 前旧导入,`/api/pois` 读 Postgres → 用户 UI 所见即 DB,geocode 修正不 import 不生效。

## 3. 工具链就绪核查(ws-c,2026-08-22 只读核查)

`server/scripts/geocode-sites-apply.mjs` 对「多城市占位地址站」的路径已就绪,**r5 无需代码改动**(2026-08-23 批次的三项增量见 §3.1/§3.2):

| 核查项 | 结论 | 证据(apply 脚本 / site-geocode.ts) |
|---|---|---|
| 多城市占位站走公司名 place-text 检索分支 | ✅ 就绪 | 占位串(「北京/上海/深圳/成都」)无街道特征 → `siteHasStreetAddress` false(实测 929 站全部不含 `路/街/号…`,含「厦门」的 6 站误判已由 ws-a 修复,见 §3.1)→ 走 `searchCompanyPoiVariants` 公司名检索分支(apply:362-390) |
| memo 变体 key | ✅ 就绪 | `placeSearchMemoKey(query, target)` = query+province+city;精确/宽候选 query 不同 → 变体独立缓存(apply:196-217, `placeSearchMemoSet` 只缓存成功命中) |
| 每站 place-text ≤ 2 次 | ✅ 就绪 | `addresslessQueryVariants` 最多 [精确, 宽] 两个变体;memo 命中不重复消耗(apply:231-247) |
| 裸公司名检索 | ✅ 就绪 | `cleanCompanySearchName` 去括号段/招聘尾缀/别名化后作 query(apply:331) |
| 城市闸门 | ✅ 就绪 | 地址-城市一致性闸门(`addressConflictsWithCity`)+ regeo 城市/区级校验(`regeoMatchesTarget` / `addressConflictsWithRegeoDistrict`) |
| 配额防护 | ✅ 就绪 | 三级兜底 AMap→百度→腾讯(GCJ-02)+ 连续 5 站配额失败短路退出(`QUOTA_SHORT_CIRCUIT_N`,apply:265-289,exit 2) |
| 执行参数 | ✅ 就绪 | `--dry-run` / `--only slug` / `--cities 上海,杭州`(apply:101-112;无 key 时自动降级 dry-run) |
| **前置依赖** | ✅ 已合并 | grader 复合限定词放宽 `fix/grader-seq-relax`(2026-08-22 批次 ws-a,已并入 dev HEAD `dda9555`) |

### 3.1 已知缺口(6 站「门」误判)— 2026-08-23 批次 ws-a 修复

6 站(radar: metapp×2 / 万物云×3 / 中电福富×1)的多城市占位串含「厦门」——「门」∈ STREET_RE → `siteHasStreetAddress` 误判 true → 走**地址检索**分支而非公司名检索。地址检索对城市列表串:no-result → unresolved 留中心(无害);或命中目标城内任意点且 regeo 城市闸门放行 → 可能写入非真实办公坐标(有界:6 站,写回后地址仍非城市名 → 下次 r5 仍判 needsRerun,自限)。

2026-08-23 批次 ws-a(`fix/poi-citylist-branch`):`siteHasStreetAddress` 引入「/」多城市列表串判定——地址以「/」分隔且含 ≥2 个城市 bare 名 token(复用 `bareCityName` / `CITY_CENTERS`)→ 视为非街道地址,返回 false,强制走公司名检索分支;含路/街/号等街道特征段的不误杀。**分支合并后生效**;合并后复算:6 站检索路径从地址分支切到公司名分支,中心钉点基线数字(1330/1076/929)不变。

### 3.2 2026-08-23 批次新增能力(分支合并后生效)

| 能力 | ws | 说明 |
|---|---|---|
| 多城市列表串判定 | ws-a `fix/poi-citylist-branch` | §3.1 修复;修 6 站「门」误判 + 防同类 |
| Nominatim 海外源(第四 provider) | ws-b `feat/poi-nominatim` | 三 provider 全部失败且站点判定为海外站时,尝试 OSM Nominatim(`nominatimSearchRest` / `nominatimReverseRest`;UA 带项目标识、≥1 次/秒限速、10s 超时降级);海外站判定独立命名,不污染国内路径;来源审查见 `tech/roles/data/etl/`(ws-b 文档) |
| 跨日进度 + daily 封装 | ws-c `feat/poi-daily-run` | 运行结束写 `server/.geocode-progress.json`(gitignore);新增 `npm run geocode:sites:daily` 薄封装:打印「今日进展 + 明日剩余 Top 城市(按城排序)+ QUOTA_EXHAUSTED 续跑指引」;配额事实注释入 apply 头部 |
| 本文档 | ws-d `docs/poi-r5-runbook` | 本 runbook + etl 来源审查(搜索引擎地址源) |
| 占位/无地址站地点检索补全 | ws-d-data-completion `fix/site-place-search`(2026-08-25) | 读路径剔除中心钉后的**数据补全**:地址为城市名占位(上海/深圳市/浙江省杭州市)或为无地址的带岗位站,地址无从 geocode → 「公司名+城市」地点检索取真实办公点。`cityNameOnlyAddress` / `siteNeedsPlaceSearch`(site-geocode.ts,plan/audit/apply 共用)+ `pickPlaceSearchPoi` 选点规则(名称强匹配闸门 + 同城 10 分 > 同省近邻 1 分 + 市中心半径惩罚 + office 类型 +1;无候选 → 留中心钉待跟进);apply 主循环(`sitesNeedingGeocode`)并入此类站(旧口径 siteNeedsGeocode=false「留中心」永不处理);memo 键加 `ps:` 前缀与地址 geocode 站选点隔离。**多城市列表占位串(北京/上海/深圳/成都)不属本通道**——归 needsGeocode,apply 既有公司名检索分支(ws-a 通道),点选规则不变 |
| 公司网关 place 检索 | `feature/company-jyt-provider`(2026-08-25) | place 链变为 AMap→**公司网关(map.jiaoyuntong.net, JIAOYUNTONG_MAP_KEY)**→百度→腾讯(网关配额充足, 不受 100 次/日 place 限制); geocode/regeo 链不变; 来源审查 `tech/roles/data/etl/company-gateway-map.md` |

## 4. r5 执行 runbook(2026-08-23,Env-only)

> 全部为 Env-only 命令,需本机密钥(AMAP_WEB_KEY / BAIDU_MAP_AK / TENCENT_MAP_KEY)/ DB(DATABASE_URL);不自动跑。执行者 = 用户。前置:2026-08-23 批次(a/b/c)已合并。

### 4.1 配额事实(2026-08-23 查证;个人开发者/免费档)

| provider | 接口 | 日配额 | 来源 URL |
|---|---|---|---|
| 高德 AMap | place-text 地点检索 | ~100 次/日 | https://lbs.amap.com (配额/限制说明) |
| 百度 | Web 服务地点检索 | 100 次/日 | https://lbsyun.baidu.com |
| 腾讯 | WebService 地点搜索 | ~100 次/日(个人开发者) | https://lbs.qq.com |
| 高德 AMap | regeo 逆地理 | 5000 次/日 | 同上(AMap) |
| 百度 | 逆地理编码 | 300 次/日 | 同上(百度) |

- 代码内实测佐证:2026-08-21 实测 AMap place-text 日配额耗尽(`infocode 10044`)、百度返回 302「天配额超限」(apply:265-267);AMap regeo 5000 次/天(apply:179)。
- 三 provider place 检索**合计日吞吐 ~300 站**(每站 ≤2 次 place 检索、memo 命中不消耗、同公司同城共享)→ r5 全量 needsRerun 1076 站约 **4 天**。
- regeo 5000/日不卡;百度逆地理 300/日需注意,但脚本三级兜底 AMap→百度→腾讯按失败自动切换,日间天然平衡。
- 注:配额数字以 provider 官网当日页面为准;页面调整后以实测为准(本文档数字为 2026-08-23 查证快照)。

### 4.2 多日排程建议

> **状态(2026-08-26)**:r5 主波次已完成——用户执行 Env-only apply 后 `313fc61` 落地
> 135 站真实办公点,JSON 口径中心钉点 1330 → **941**;下述节奏适用于残余站点的后续增量。

- **每天一次**,跑至 **QUOTA_EXHAUSTED 自动短路**(exit 2,打印剩余站数)——这是设计行为,不是报错。脚本幂等(已有坐标站跳过),中断/重跑安全。
- **按 Top 城市优先**:`--cities 上海` → `--cities 北京` → `--cities 深圳,广州,成都` → 其余城市(每城一天或多天,以当日 short-circuit 为准)。
- (ws-c 合并后)直接用 `npm run geocode:sites:daily`,自动打印今日进展与明日剩余 Top 城市。
- 全程可 `git diff` 观察 `server/data/recruitment/` 下 JSON 坐标变化(已写回 drops)。

### 4.3 每日命令与验证点

```bash
cd server
npm run geocode:sites:apply -- --cities 上海   # 或全量 npm run geocode:sites:apply;先 --dry-run 看计划
npm run geocode:sites                          # plan dry-run,needs 应逐日下降
node scripts/audit-city-center-pins.mjs | head -20   # 只读复核中心钉点构成
```

验证点:
1. **QUOTA_EXHAUSTED 出现** → 今日配额尽,记下剩余站数,明日续跑(exit 2 正常)。
2. **audit-city-center-pins 数字下降**:needsRerun 从 1076 逐日回落;2026-08-25 起带岗位的
   占位/无地址站列入 `needsPlaceSearch`(地点检索补全),随 apply 落真实坐标后离开中心钉
   桶自然消失;剩中心钉留在 stayCenter/noAddress 的应为**无真实岗位**站的残余。
3. **drops 坐标 diff**:`git diff --stat server/data/recruitment/` 看 JSON 变更;抽查已解析站坐标不再恰等于城市中心 ±0.0005。
4. (ws-b 合并后)海外站走 Nominatim,见 §7。

### 4.4 import 落地(DB 同步,Env-only)

```bash
cd server && npm run import:seed:apply   # 需 DATABASE_URL(读 server/.env.local,不打印)
```

- **必须执行**:DB `company_sites` 实测 1556 中心站 > JSON 1330 → r4/r5 数据从未 import;不 import 则 `/api/pois`(读 Postgres)继续吐旧中心钉点,UI 无变化(历史教训 `9d609ec` 同款)。
- 期望:import 后 DB 中心钉点 ≈ 249(stayCenter)+ 5(noAddress)+ r5 未解析残余。

### 4.5 UI 验证 + MODE_CACHE_VERSION bump

- 地图堆叠明显下降(上海/北京/深圳等中心点 marker 数大幅减少,聚合点向真实办公区散开);旧会话缓存需失效重拉。
- 数据变化 → bump `server/src/lib/mode-cache.ts` 的 `MODE_CACHE_VERSION`:**当前已 v19**(2026-08-26,r5 数据落地善后批次 `20260826-boss-post-geocode` ws p-cache-snapshot;v18 为 2026-08-25 读路径语义两连修占用:中心钉排除 + clip 空语义,`fix/server-catalog-semantics`;v17 为 2026-08-22 08:12 预 bump,commit `9e693a9`)。✅ **已完成(2026-08-26)**:r5 数据落地 commit `313fc61`(135 站)后 bump v18→**v19**,版本历史注记 + v18 拒绝用例随批提交。

## 5. 诊断与验证工具

- `server/scripts/audit-city-center-pins.mjs`(ws-c,2026-08-22 新增):只读输出 JSON+DB 双口径中心钉点计数与构成(needsRerun / **needsPlaceSearch(2026-08-25 新增,占位/无地址 + 有岗位)** / stayCenter / noAddress + cityList 拆分 + top 城市 + 来源分布),复用 `site-geocode.ts` 的 `cityCenterBareNames` / `matchesCityCenter` / `siteNeedsGeocode` / `siteNeedsPlaceSearch` / `isCityNameAddress`,口径与 plan/apply 唯一(`CITY_CENTER_EPS` 直接 import city-centers.ts,不再本地常量)。DB 侧复用同款中心 SQL 条件(有 DATABASE_URL 时)。
- `server/scripts/plan-site-geocode.mjs`:`npm run geocode:sites` dry-run,§2.2 基线来源。
- (ws-c 合并后)`server/.geocode-progress.json` + `npm run geocode:sites:daily`:跨日进度与剩余清单。
- 引用:批次目录 `tech/roles/development/parallel-sessions/20260822-boss-poi-city-center/`(manifest 根因、ws-a/b/c 汇报)与 `20260823-boss-poi-datasource/`(本批次 manifest/prompts/reports);r4 commit `3e6deb3`;v17 commit `9e693a9`;历史教训 commit `9d609ec`(geocode 修正必须 import)。

## 6. 时间线

| 日期 | 事件 |
|---|---|
| 2026-08-22 06:29 | r4 `3e6deb3`:288 站落真实坐标(上海 376→347);`MODE_CACHE_VERSION` → v16 |
| 2026-08-22 08:12 | `MODE_CACHE_VERSION` 16→17(geocode r5 预 bump,`9e693a9`) |
| 2026-08-25 | `MODE_CACHE_VERSION` 17→18(读路径语义两连修:中心钉排除 + clip 空语义,`fix/server-catalog-semantics`) |
| 2026-08-22 | 批次 `20260822-boss-poi-city-center`:ws-a grader 放宽 / ws-b 数据契约测试 / ws-c 本文档 v1.0 + 基线诊断(中心钉点 1346) |
| 2026-08-23 | 批次 `20260823-boss-poi-datasource`:ws-a 「/」列表串判定(修 6 站)/ ws-b Nominatim 海外源 / ws-c daily 进度封装 / ws-d 本文档 v2.0 runbook + etl 审查;实测基线 1330(上海 344,数据源更新所致) |
| 2026-08-25 | 批次 `20260825-boss-hi-priority-fixes` ws-d-data-completion(`fix/site-place-search`,本文档 v2.1):读路径剔除中心钉后的**数据补全**——占位/无地址带岗位站 →「公司名+城市」地点检索(`cityNameOnlyAddress` / `siteNeedsPlaceSearch` / `pickPlaceSearchPoi`;audit 分类表新增 needsPlaceSearch;apply 主循环并入此类站,place-search 选点 + `ps:` memo 前缀);读路径 isCityCenterPin 过滤不变 |
| 2026-08-26 | r5 apply 完成:用户执行 Env-only apply,commit `313fc61` 数据落地——135 站占位/中心钉坐标落真实办公点(address/lng/lat 改写);中心钉点 JSON 口径 1330 → **941**(实测,radar 839 / official-career 95 / qqdoc-jobs 7) |
| 2026-08-26 | 善后批次 `20260826-boss-post-geocode` ws p-cache-snapshot(本文档 v2.2):`MODE_CACHE_VERSION` 18→19(v18 拒绝用例 + 版本历史注记);数据契约测试 `city-center-pins.test.mjs` 计数下限 1000→900(快照基准 941,r5 后 2026-08-26 实测) |
| 2026-08-27 | 多城扩展批次 `feature/expand-city-pois`(本文档 §2.1 提及的 5 城):重庆入 radar 管线(快照 30 行在招重庆此前整行丢弃)+ 苏州 41 站欠账补齐;增量合并保留 1478 坐标。apply 落 23 站真实办公点(重庆/苏州新站 21 + 小米南京 + 三一广州串味修正);grader `QUALIFIER_SUFFIXES` 加八大区域词(「小米集团华东总部」类此前整候选被拒,南京 35 站 0 解析的根因之一)。5 城残余中心钉 **349 站**按 §4.2 续跑 |
| (待用户,Env-only) | import:seed:apply(§4.4,把 `313fc61` 新坐标落 DB;不 import 则 `/api/pois` 继续吐旧中心钉点)→ Nominatim 海外执行(§7);r5 apply 多日与 UI 验证已随 2026-08-26 落地完成 |

## 7. Env-only deferred 清单(用户执行)

| # | 待办 | 命令/位置 | 前置 |
|---|---|---|---|
| 1 | ~~geocode r5 apply 多日~~ ✅ **已完成(2026-08-26)**:`313fc61` 落地 135 站,中心钉点 1330→941;后续增量(残余 941 中 needsRerun/stayCenter)按 §4.2 排程继续跑至 QUOTA_EXHAUSTED 短路即可 | `npm run geocode:sites:apply`(建议 `--cities 上海` 优先;可用 `geocode:sites:daily`) | — |
| 2 | import 落地 | `npm run import:seed:apply`(需 DATABASE_URL;**当前待执行**——`313fc61` 新坐标尚未进 DB,不 import 则 `/api/pois` 继续吐旧中心钉点) | r5 数据已落地(§4.4) |
| 3 | ~~UI 验证 + bump~~ ✅ **已完成(2026-08-26)**:`MODE_CACHE_VERSION` → **v19**(善后批次 p-cache-snapshot;v18 已被 2026-08-25 读路径语义修复占用) | `server/src/lib/mode-cache.ts` | — |
| 4 | Nominatim 海外站执行 | ws-b 集成(合并后生效);执行方式与政策见 `tech/roles/data/etl/`(ws-b 来源审查文档);海外站规模 ~41 站(20260821 批次 deferred-notes 记录,另含新摸底的钉中心海外站) | r5 国内全量后 |
