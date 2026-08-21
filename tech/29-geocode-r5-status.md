# 29 — geocode r5 状态与操作清单(城市中心假坐标修复链)

**文档版本:** 1.0
**创建日期:** 2026-08-22
**状态:** r5 待执行(前置代码缺口 ws-a「grader 放宽」落地后,用户跑 Env-only apply);本文档为**当前事实契约**——数字均来自 2026-08-22 实测(worktree `fix/geocode-r5-readiness` 复算与主树 boss 实测一致)
**相关:** `tech/16-bug-fixes.md`(坐标 bug 记录)、`tech/21-city-clustering.md`、批次 `tech/roles/development/parallel-sessions/20260822-boss-poi-city-center/`(manifest/ws-a~c prompt/汇报)、r4 commit `3e6deb3`、`server/src/lib/site-geocode.ts`、`server/scripts/geocode-sites-apply.mjs`、`server/scripts/plan-site-geocode.mjs`、`server/scripts/audit-city-center-pins.mjs`

---

## 1. 背景:为什么地图上堆了一堆城市中心 POI

三层问题叠加(2026-08-22 探索 + 实测,详见批次 manifest 根因段):

1. **JSON drops 中心钉点 1346 站**:城市拆分时代 `split-city-sites.mjs`(:149-157/:114-125)给无坐标站补 `cityCenter()` 静态中心坐标(`server/src/lib/city-centers.ts`)。这是占位,不是真实办公点。
2. **geocode r5 从未执行**:r4(`3e6deb3`, 2026-08-22)只修 288 站;r5(多城市占位站公司名检索重试)在 `20260821-boss-address-first` 批次 next_plan 中但未落地——前置代码缺口:grader `officeNameMatchStrength` 拒绝复合限定词(「百度研发大厦」= 研发+大厦 两个 token),831 站 no-result。该缺口由 ws-a `fix/grader-seq-relax` 修复(本批次,合并后生效)。
3. **DB 未同步**:DB `company_sites` 实测 1556 站钉城市中心(比 JSON 1346 更多)→ DB 是 r4 前的旧导入;`/api/pois` 读 Postgres,geocode 修正不 `import:seed:apply` 不生效(历史教训 `9d609ec` 同款)。

## 2. 现状(2026-08-22 实测基线)

### 2.1 r5 前 plan dry-run 基线(只读,`npm run geocode:sites`)

| 指标 | 实测值 |
|---|---|
| companies | 916 |
| alreadyLocated | 962 |
| needs(缺坐标/待重跑) | 1248 |
| skippedNoAddress | 0 |

### 2.2 中心钉点构成(口径:CITY_CENTERS ± 0.0005,即 `site-geocode.ts` CITY_CENTER_EPS)

`node scripts/audit-city-center-pins.mjs` 复算(与 manifest 完全一致):

| 分类 | 数量 | 说明 |
|---|---|---|
| **合计** | **1346** | 坐标恰等于某静态城市中心 ±0.0005 |
| 需重跑(needsRerun) | **1092** | 地址非「仅城市名」→ r5 将重跑(其中多城市占位串 941 / 真实街道 134 / 海外·其他 17) |
| 留中心(stayCenter) | **249** | 地址是城市名占位(「北京」「北京市」「浙江省杭州市」)→ r5 语义:留在中心 |
| 无地址(noAddress) | **5** | 中心钉点但无地址(qqdoc-jobs 5 站) |

来源分布:radar 1232 / official-career 106 / qqdoc-jobs 8。

Top 城市(中心钉点数):

| 城市 | centerPins | needsRerun | stayCenter |
|---|---|---|---|
| 上海 | 347 | 272 | 75 |
| 北京 | 296 | 249 | 45 |
| 深圳 | 217 | 187 | 29 |
| 广州 | 117 | 98 | 19 |
| 成都 | 116 | 109 | 7 |
| 武汉 | 59 | 48 | 11 |
| 南京 | 47 | 37 | 10 |
| 西安 | 41 | 35 | 6 |
| 杭州 | 29 | 24 | 5 |
| 重庆 | 7 | 5 | 2 |

(其余城市各 1-5 站,共 ~70 站;完整表见 audit 脚本输出)

### 2.3 r4 已修部分

r4(`3e6deb3`):288 城市中心/缺坐标站落真实坐标(上海 376→347)。r4 数据已随 `MODE_CACHE_VERSION` v16(2026-08-22)bump 进 UI,但**从未 import 进 DB**(见 §4)。

## 3. 工具链就绪核查(ws-c,2026-08-22 只读核查)

`server/scripts/geocode-sites-apply.mjs` 对「多城市占位地址站」的路径已就绪,**r5 无需代码改动**(ws-a grader 放宽除外):

| 核查项 | 结论 | 证据(apply 脚本 / site-geocode.ts) |
|---|---|---|
| 多城市占位站走公司名 place-text 检索分支 | ✅ 就绪 | 占位串(「北京/上海/深圳/成都」)无街道特征 → `siteHasStreetAddress` false(实测 941 站全部不含 `路/街/号…`,仅 6 站含「厦门」的「门」误判,见 §3.1 缺口)→ 走 `searchCompanyPoiVariants` 公司名检索分支(apply:362-390) |
| memo 变体 key | ✅ 就绪 | `placeSearchMemoKey(query, target)` = query+province+city;精确/宽候选 query 不同 → 变体独立缓存(apply:196-217, `placeSearchMemoSet` 只缓存成功命中) |
| 每站 place-text ≤ 2 次 | ✅ 就绪 | `addresslessQueryVariants` 最多 [精确, 宽] 两个变体;memo 命中不重复消耗(apply:231-247) |
| 裸公司名检索 | ✅ 就绪 | `cleanCompanySearchName` 去括号段/招聘尾缀/别名化后作 query(apply:331) |
| 城市闸门 | ✅ 就绪 | 地址-城市一致性闸门(`addressConflictsWithCity`)+ regeo 城市/区级校验(`regeoMatchesTarget` / `addressConflictsWithRegeoDistrict`) |
| 配额防护 | ✅ 就绪 | 三级兜底 AMap→百度→腾讯(GCJ-02)+ 连续 5 站配额失败短路退出(`QUOTA_SHORT_CIRCUIT_N`,apply:265-289) |
| **前置依赖** | ⚠️ 需 ws-a | grader `officeNameMatchStrength` 复合限定词放宽(`fix/grader-seq-relax` 本批次 ws-a)——未合并前 831 站仍 no-result |

### 3.1 核查发现的小缺口(不修,记 boss 裁决)

6 站(radar: metapp×2 / 万物云×3 / 中电福富×1)的多城市占位串含「厦门」——「门」∈ STREET_RE → `siteHasStreetAddress` 误判 true → 走**地址检索**分支而非公司名检索。地址检索对城市列表串:no-result → unresolved 留中心(无害);或命中目标城内任意点且 regeo 城市闸门放行(点在目标城市内)→ 可能写入非真实办公坐标(有界:6 站,写回后地址仍非城市名 → 下次 r5 仍判 needsRerun,自限)。建议后续在地址检索前加「地址含 `/` → 直接公司名检索」判定。

## 4. 用户操作清单(Env-only,按序执行)

> 全部为 Env-only 命令,需本机密钥/DB;不自动跑。执行者 = 用户,顺序不能乱。

### 步骤 1:r5 apply(前置:ws-a 已合并)

```bash
cd server && npm run geocode:sites:apply
```

- 语义(20260821-boss-address-first next_plan 的 w10 语义):**城市名地址站留中心、有街道地址站重跑**;多城市占位站走公司名 place-text 检索(ws-a 放宽后命中率恢复)。
- 规模:中心钉点中「需重跑」1092 站(§2.2)+ 其他缺坐标站点(plan dry-run `needs` 1248 为 7 源口径,apply 预扫以其 5 源 drop 目录为准);以 `npm run geocode:sites` dry-run 输出为执行前核对。
- 配额:AMap place-text 日配额 ~100 次 + 百度(100 次/天)/腾讯兜底;可分**多日**多次运行;脚本幂等(有坐标即跳过)+ 配额耗尽自动短路退出(exit 2,剩余站数明确)。
- 可选:`--dry-run` 先看计划;`--cities 上海,杭州` 分批;`--only slug` 单公司强推。
- 完成后重跑 `npm run geocode:sites` 验证 `needs` 下降(期望:从 1248 大幅回落;留中心的 249 + 无地址 5 + unresolved 残余)。

### 步骤 2:import 落地(DB 同步)

```bash
cd server && npm run import:seed:apply   # 需 DATABASE_URL
```

- **必须执行**:DB 当前实测 1556 中心站 > JSON 1346 → r4 数据从未 import;不 import 则 `/api/pois`(读 Postgres)继续吐旧中心钉点,UI 无变化。
- 期望:import 后 DB 中心钉点 ≈ 249(stayCenter)+ 5(noAddress)+ r5 未解析残余。

### 步骤 3:UI 验证

- 地图堆叠明显下降(上海/北京/深圳等中心点 marker 数大幅减少,聚合点向真实办公区散开)。
- 数据变化 → bump `server/src/lib/mode-cache.ts` 的 `MODE_CACHE_VERSION`(当前 v16,上次 r4 bump;r5 后 bump v17),旧会话缓存自动失效重拉。

## 5. 诊断与验证工具

- `server/scripts/audit-city-center-pins.mjs`(新增,ws-c):只读输出 JSON+DB 双口径中心钉点计数与构成(needsRerun/stayCenter/noAddress + cityList 拆分 + top 城市 + 来源分布),复用 `site-geocode.ts` 的 `cityCenterBareNames` / `matchesCityCenter` / `siteNeedsGeocode` / `isCityNameAddress`,口径与 plan/apply 唯一。DB 侧复用同款中心 SQL 条件(有 DATABASE_URL 时)。
- `server/scripts/plan-site-geocode.mjs`:`npm run geocode:sites` dry-run,§2.1 基线来源。
- 引用:批次目录 `tech/roles/development/parallel-sessions/20260822-boss-poi-city-center/`(manifest 根因、ws-a/b/c 汇报);r4 commit `3e6deb3`;历史教训 commit `9d609ec`(geocode 修正必须 import)。

## 6. 时间线

| 日期 | 事件 |
|---|---|
| 2026-08-22 06:29 | r4 `3e6deb3`:288 站落真实坐标(上海 376→347);`MODE_CACHE_VERSION` → v16 |
| 2026-08-22 | 本批次 `20260822-boss-poi-city-center`:ws-a grader 放宽 / ws-b 数据契约测试 / ws-c 本文档 + 基线诊断 |
| (待用户) | r5 apply → import:seed:apply → UI 验证 + bump v17 |
