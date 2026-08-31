# Workstream d-data-completion — 地址烂/无地址站点的地点检索补全(fix 1)

## 角色

你是 boss 派发的 headless 开发 worker。worktree 已由 boss 预建(`/Users/acccan/dm-wt-d-data-completion`,分支 `fix/site-place-search`,从 dev 切出)。**不要 merge、不要 push、不要碰主树**。先看 `git log --oneline -3` 确认起点。

## 背景(boss 已验证,2026-08-25)

**用户发现 1:读路径无差别剔除城市中心钉,误伤大量有岗位站点。** `fix/hide-center-pins` 已合入 dev(1c2f2a8/ed9a6d5):`recruitment-store.ts:136-141`、`server-catalog.ts:28-36/64` 把 `isCityCenterPin`(city-centers.ts:177-185,任意静态城市中心 ±`CITY_CENTER_EPS=0.0005` ≈ 55m)作为「不可展示」过滤。DB 中被隐藏的站点绝大多数地址只有「深圳/深圳市/城市列表占位」,但确实带真实在招岗位;甚至存在「深圳市南山区学府路63号」这类有街道地址、只是尚未 re-geocode 的站点。

**用户裁定的修复 = 数据补全(读路径过滤保持不变):**
1. 没地址 / 地址很烂(城市名占位,如「上海」「深圳市」「浙江省杭州市」)→ **地点检索补全**(公司名 + 城市 → 地点检索 → 取真实办公点);
2. 有地址没坐标 / 地址非占位但坐标在中心钉 → **地理编码补全**(r5 `geocode-sites-apply` 已有,`siteNeedsGeocode` 覆盖)。

**现有工具链(全部在 dev,均已验证存在):**
- `server/src/lib/site-geocode.ts` — `siteNeedsGeocode` / `matchesCityCenter` / `planSiteGeocode`(输出 alreadyLocated / needs / skippedNoAddress)/ `listImportedSitesNeedingGeocode`(读 DB)/ `formatGeocodeProviderReport`;provider 注册表(AMap/百度/腾讯/交运通,geocode memo + 配额耗尽自动切换 —— 注意:输出报告前会调 `/v3/geocode/geo` 类探测,**worktree 无 key,探测自然跳过,不会真调 REST**;测试用 mock)。
- `scripts/plan-site-geocode.mjs` — dry-run 计划(不调 REST;`injectEnv` 读不到 `.env.local`(gitignored 不进 worktree)→ providers 全 missing,plan 纯本地分类可跑)。
- `scripts/geocode-sites-apply.mjs` — r5 apply(调 REST,需 key;worktree 无 key 会 fail-fast)。
- `scripts/audit-city-center-pins.mjs` — 只读审计;按地址分类中心钉:`needsRerun`(地址非占位,r5 会 re-resolve)、`stayCenter`(地址 = 城市名占位,当前**留下不动**)、`noAddress`(无地址)。**stayCenter/noAddress 正是「误伤」来源**——它们带真实岗位但地址无从 geocode。

## 任务(仅本 WS 范围)

> ⚠️ **硬边界:本 WS 只实现代码 + 纯函数测试 + dry-run 输出;绝不执行任何地点检索/地理编码 REST 调用,绝不写 DB、不改数据文件。**(Env-only,apply 由用户延后执行。)

### 1. 共享分类(纯函数,`server/src/lib/site-geocode.ts`)

- 新增占位地址判定:`cityNameOnlyAddress(address)`(归一化后仅剩城市名,如「上海」「上海市」「深圳市」「浙江省杭州市」——复用/对齐 `bareCityName`(city-centers.ts:153-156)、`cityCenter` 与 `matchesCityCenter` 既有口径)。**口径唯一关键**:`audit-city-center-pins.mjs` 的 stayCenter/noAddress 判定逻辑(JS 侧,目前与 site-geocode 有常量重复:`CITY_CENTER_EPS` 本地常量 0.0005「改时需同步」——顺手导出一个常量或收敛进 site-geocode.ts 供两处共用,消灭重复)。
- 扩展 `planSiteGeocode` 输出:将 needs 按「地址非占位 → geocode;占位 / 无地址 → placeSearch(公司名 + city + province)」分类。类别命名跟随现有风格(如 `needsGeocode` / `needsPlaceSearch` / `skippedNoAddress` 保留)。
- place-search 选点规则(纯函数):候选结果评分——同城/近似城市优先、名称相关性(公司名与 POI 名/地址匹配)、距市中心半径惩罚;返回最佳候选或 null(失败 → 记录留下中心钉,待后续跟进)。规则要简单可测,不要过度设计。

### 2. 计划脚本 `scripts/plan-site-geocode.mjs`

- 输出增加 placeSearch 分类(数量 + samples),与 needs 并列;仍不调 REST(保持 dry-run 性质)。

### 3. 审计脚本 `scripts/audit-city-center-pins.mjs`

- 分类表加 `needsPlaceSearch`(地址为城市名占位 / 无地址,且站点有真实岗位);`stayCenter`/`noAddress` 判定收敛到 site-geocode.ts 共享函数(脚本 import 之,不再重复实现)。保留 JSON 输出结构兼容性(字段新增而非改名,除非现有消费方已查明且一并更新——优先只增)。

### 4. apply 路径 `scripts/geocode-sites-apply.mjs`

- 增加 place-search 阶段:对 placeSearch 类站点,用公司名+城市发起地点检索(走 provider 注册表的已有抽象/配额切换机制),按选点规则写回 address + lng/lat;失败记录待跟进。**代码写完整、可跑,但本 WS 不执行**;dry-run/`--dry-run` 模式(如存在)输出 would-apply 列表。若现有 apply 脚本结构不便扩展,新建姊妹脚本亦可,但保持与 plan/audit 同名口径(prompt 默认:扩展现有脚本,除非你读代码后认为新建更贴合——在汇报说明取舍)。

### 5. 测试

- 纯函数测试(风格跟随 `server/tests/geocode-*.test.mjs`、`city-center-pins.test.mjs`):占位判定(「上海」/「上海市」/「深圳市」/「浙江省杭州市」/「北京市海淀区中关村」→ false)、plan 分类、选点规则(同城优先/名称相关/半径惩罚/mock 候选)。
- provider 层如有新接口(place search),mock 单测;不碰真实 key。
- `cd server && npm test` 全量必须绿。

### 6. 文档

- `tech/` 下 geocode 工具链文档若有 plan/apply 描述,同步 place-search 阶段;`tech/roles/data/etl/` 来源审查记录如有数据加工说明,补一句(注意:地点检索/geocode 属**数据加工**,不是新增外部数据源采集——来源审查纪律只约束「采集源」,但若你引用某数据源,注明来源是加工自既有 drop 数据而非新抓取;BOSS 直聘/牛客/小红书/实习僧不可直抓的红线不动)。
- `audit-city-center-pins.mjs` 头部注释(分类口径说明)同步更新。

## 文件边界

**拥有**:`server/src/lib/site-geocode.ts`、`server/scripts/plan-site-geocode.mjs`、`server/scripts/geocode-sites-apply.mjs`、`server/scripts/audit-city-center-pins.mjs`、`server/tests/geocode-*.test.mjs`、`server/tests/city-center-pins.test.mjs`、相关 tech 文档。

**不碰**:`server/src/lib/recruitment-store.ts`、`server/src/lib/server-catalog.ts`、`server/src/lib/city-centers.ts`(读其导出可以,不改)——读路径 isCityCenterPin 过滤**不变**;`server/src/components/**`、`server/src/hooks/**`、`server/src/lib/{mode-cache,map-markers,viewport-search}.ts`、`server/.env*`、数据源文件(drops 目录等)、主树。

## 门禁(必须真跑,全绿才算)

```bash
cd /Users/acccan/dm-wt-d-data-completion/server && npm test
cd /Users/acccan/dm-wt-d-data-completion/server && npm run typecheck
cd /Users/acccan/dm-wt-d-data-completion && make docs-check && git diff --check
```

> worktree 无 `.env.local`(gitignored)→ plan 脚本的 DB 段输出 `available:false`、provider 段全 missing,属正常;**不要**为此去复制 .env 或另想办法注入 key。

## 提交

小步高频,Conventional Commits(`feat(site-geocode): 占位地址分类 + 地点检索选点规则`、`feat(scripts): plan/audit 感知 needsPlaceSearch`、`test(site-geocode): 占位判定/选点规则/mock provider 用例`)。

## 回报

写入 `/Users/acccan/Repos/huangyincan/domain-map/tech/roles/development/parallel-sessions/20260825-boss-hi-priority-fixes/reports/d-data-completion.md`,含改动摘要(重点:分类口径、选点规则、apply 边界)、门禁结果、遇到的问题、结论。**末两行必须精确**:

```
门禁: PASSED
结论: OK
```

阻塞时:`结论: BLOCKED: <一句话问题>`。
