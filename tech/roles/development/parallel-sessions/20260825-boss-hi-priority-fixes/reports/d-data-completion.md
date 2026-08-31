# d-data-completion 汇报(2026-08-25)

> ws: `d-data-completion` | 分支: `fix/site-place-search`(worktree `/Users/acccan/dm-wt-d-data-completion`,未 merge 未 push)
> 任务: 地址烂/无地址站点的地点检索补全(读路径 `isCityCenterPin` 过滤不变,数据补全)

## 实际改动

**`server/src/lib/site-geocode.ts`**(核心,`ce47495`)

- `CITY_CENTER_EPS` 收敛:删除本地重复常量,改从 `city-centers.ts` 导出导入(city-centers.ts 本身零改动)。
- 新增 `cityNameOnlyAddress(address)`(导出,自包含占位判定):不动点归一化(`bareCityName` 去「省/市/区」尾缀 + 「省+城市」连写前缀 + 前后缀窗口剥离)+ 迭代剥除中心表城市键收拢 → 恰为中心表收录城市名即占位。覆盖「上海/上海市/深圳市/浙江省杭州市/广西柳州/伦敦市区/重庆市重庆市(重复城市名)」;街道地址(北京市海淀区中关村)、多城市列表串(北京/上海/深圳/成都)→ false。
- 新增 `siteNeedsPlaceSearch(site)`:占位/无地址 **且**(缺坐标 或 坐标仍是中心钉);真实坐标非钉(坐标可用,地址缺可容忍)→ 不补全。列表串不属本通道(有地址形态,归 needsGeocode,apply 既有公司名检索分支不改)。
- `planSiteGeocode` 输出拆分:`needsGeocode`(地址可 geocode,含列表串=apply 公司名检索通道)+ `needsPlaceSearch`(占位/无地址)+ 保留 `alreadyLocated`/`skippedNoAddress`。**关键缺口修复**:旧 placeSearch 分支放在 `siteNeedsGeocode` true 之内,而中心钉占位/无地址站 `siteNeedsGeocode` 恒 false(「留中心」)→ 计划永远列不出;现前置判定,补全对象真正入列。
- `sitesNeedingGeocode`(apply 预扫)并入 place-search 站 —— 否则 apply 主循环永不处理占位/无地址中心钉站,用户裁定的补全不发生(剩余/续跑计数同步为真实全量)。
- 新增 `distanceKm`/`placeSearchRadiusScore`/`pickPlaceSearchPoi`:选点规则 = 名称强匹配闸门(`officeNameMatchStrength`,门店/同名工厂不认领)→ 同城 10 分 > 同省近邻 1 分(异城异省淘汰,宁缺勿错)→ 市中心半径惩罚(3km 内 0,13km+ 满 1,中心钉本身是占位,远郊办公区加分)→ office 类型 +1;同分保序(provider 相关性作 tie-break);置信度复用 `gradeOfficePoi` 口径;无候选过闸门 → null(留中心钉待跟进)。

**`server/scripts/plan-site-geocode.mjs` + `geocode-sites-apply.mjs` + `audit-city-center-pins.mjs`**(`a09c2f3`)

- plan:输出 `needsGeocode`/`needsPlaceSearch` 计数 + `samples`/`placeSearchSamples`;仍纯本地分类,不调 REST。
- audit:分类表新增 `needsPlaceSearch`(占位/无地址 **且有真实岗位**;无岗位仍 stayCenter/noAddress,不烧配额);`CITY_CENTER_EPS` 与分类判定收敛到共享模块(import,不再本地常量/重复逻辑);JSON 结构**只增字段不改名**,消费方兼容;DB 段无岗位信息按 hasJobs=true(报告中可见差异)。
- apply:占位/无地址站(`placeSearchMode = siteNeedsPlaceSearch`)换 `pickPlaceSearchPoi` 选点;memo 键加 `ps:` 前缀与地址 geocode 站选点隔离(旧磁盘 memo 不受影响);报告新增 `place-search(占位/无地址)` 计数;写回口径不变(仅 confidence=high 写回,近似城市 low 不写)。**本 WS 未执行任何 REST/写 DB**;`--dry-run`/无 key 自动 dry-run 行为不变。

**测试**(`b93c7f2`)

- 新 `server/tests/geocode-place-search.test.mjs`:占位判定 4 组、siteNeedsPlaceSearch 通道、plan 分类(含中心钉占位站 `s-ps-pin`)、选点 6 组(同城优先/名称闸门/半径排序/近邻 low/异城淘汰/office 破平局)、distanceKm/radiusScore 数值。
- `city-center-pins.test.mjs`:真实 drops 契约 —— 中心钉占位/无地址站全走 place-search 通道(数据驱动断言;已含「伦敦市区」「重庆市重庆市」脏地址行,驱动了归一化增强)。
- `geocode-address-first`/`geocode-place-memo`:接线断言同步 apply 新形态(placeSearchMode 第四参 + `ps:` memo 键);`site-geocode`/`geocode-dropfiles-coverage`:`plan.needs` → `needsGeocode` 改名。

**文档**(`0a647c1`)

- `tech/29-geocode-r5-status.md` v2.1:状态/相关行;§2.1 后补 2026-08-25 分类口径更新;§2.2 plan 字段改名说明;§3.2 能力行;§4.3 验证点(needsPlaceSearch 随 apply 落点消失);§5 audit 描述;§6 时间线。
- `tech/roles/data/etl/search-engine-addresses.md`:替代清单补一条 —— 占位/无地址站地点检索补全属**数据加工**(既有 drop + 既有 provider 检索链),非新增外部数据源采集;SERP 抓取合规红线与 BOSS 直聘/牛客/小红书/实习僧直抓红线不变。

## 关键口径决策(与初始 prompt 的差异点,需 boss 知悉)

1. **多城市列表串(北京/上海/深圳/成都)不归 place-search 通道** —— prompt §1 占位定义只列「城市名占位 + 无地址」;列表串有「地址」形态,`siteNeedsGeocode` 已判 needsRerun,apply 走既有公司名检索分支(ws-a「/」判定通道,929 站),点选规则不变。半成品初稿把列表串并入 place-search,会 (a) 让真实数据契约测试失败(929 中心钉列表串行),(b) 让 929 站既有选点行为改变 —— 已修正。若 boss 想让列表串也走 `pickPlaceSearchPoi` 选点,是另一个决策(需单独改 audit classify 顺序)。
2. **apply 预扫并入 place-search 站**(`sitesNeedingGeocode` 语义扩展为「需要任何点位补全」)——不做这步,plan 列出的 needsPlaceSearch 站 apply 永远不会碰(旧 `siteNeedsGeocode` 对中心钉占位站恒 false)。这是本次功能成立的前提,也是对半成品最大的一处修正。
3. **plan 不区分岗位,audit 区分岗位** —— plan 理论列全量(251 站),audit 只列「有真实岗位值得烧配额」的(中心钉 254 站,本次快照 stayCenter/noAddress 均为 0 —— 数据里全部带岗);apply 未加岗位过滤(prompt 未要求,执行由用户 Env-only 控制,可 `--cities`/`--only` 收敛)。
4. **扩展方式**:直接扩展现有 3 个脚本(未新建姊妹脚本)——结构上 apply 的公司名检索分支(无街道地址/地址不可信统一路径)与 place-search 选点天然同构,第四参切换成本最低;memo 前缀隔离保证两套选点不串。

## 门禁结果

- `npm test`(server): **1656 通过 / 0 失败 / 2 skip**(tests 1658;基线 1610 → 本次新增 48)。
- `npm run typecheck`:通过(tsc --noEmit,0 错误)。
- `make docs-check`:通过;**`git diff --check`**:通过。

## 脚本 dry-run 验证(无 key/DB,均不联网)

- `npm run geocode:sites`(plan):`companies 916 / alreadyLocated 996 / needsGeocode 963 / needsPlaceSearch 251 / skippedNoAddress 0`,samples + placeSearchSamples 正常;provider 全 missing、imported available:false(预期)。
- `node scripts/audit-city-center-pins.mjs`:**needsPlaceSearch 254**(= 2026-08-23 基线 stayCenter 249 + noAddress 5,数据当前全部带岗);needsRerun 809(cityList 682);stayCenter 0 / noAddress 0;JSON 输出结构兼容(只增字段)。
- `node scripts/geocode-sites-apply.mjs --dry-run`:`planTotal 1261`(963 geocode + 251 place-search + 其他),无 key 自动 dry-run → 5 站后 QUOTA_EXHAUSTED 短路(exit 2,既有设计),无任何写回;`.geocode-progress.json` 已 gitignore,未入库。

## 遇到的问题

- 半成品(上次中断遗留)两处问题已修复:① `cityCenter` 未 import(typecheck 会挂);② placeSearch 分支置于 `siteNeedsGeocode` 内 → 中心钉占位/无地址站永远不进计划/apply(功能缺口)。另修正半成品把多城市列表串并入 place-search 的过设计(见「关键口径决策」1)。
- 真实 drops 有「伦敦市区」「重庆市重庆市」等重复/带缀城市名地址,自包含占位判定首版漏判 → 归一化增强(不动点 + 中心表键迭代收拢)后数据契约测试通过。
- worktree 无 `.env.local`(pinit 说明):plan/audit/apply 均为 dry-run 验证,无 REST、无 DB;apply 实跑(Env-only)由用户延后执行。

## 证据

- 测试输出:`npm test` → `tests 1658 / pass 1656 / fail 0 / skipped 2`(2026-08-25 全量)。
- plan dry-run JSON:needsGeocode 963 / needsPlaceSearch 251(samples 含 元气森林/腾讯系占位站)。
- audit JSON:centerPins 1063 / needsRerun 809(cityList 682)/ needsPlaceSearch 254 / stayCenter 0 / noAddress 0(上海 249/北京 226/深圳 163 居前)。
- apply dry-run:planTotal 1261,attempted 5(unresolved=no-key 短路),0 写回;报告行含 `place-search(占位/无地址): 2`(前 5 站中)。

门禁: PASSED
结论: OK
