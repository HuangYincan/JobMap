# Data Quality

> **Status:** evidence recorded 2026-08-17 for the radar snapshot + official-page refresh work.
> **Owner:** product / data

## Radar multi-city mapper (national scope, 2026-08-17)

- Snapshot **2026-08-11 (1404 rows)** remapped with `radar --cities` default set
  北京/上海/广州/深圳/成都/武汉/杭州 (replaces `hangzhou_only`). Parser `2.0.0`.
- Sites split per city from the row's city text → `${slug}-site-${cityKey}` with
  `site.city` / `site.province`; `location.address` keeps the raw city text for geocode.
- **Aggregate-title flag**: category-aggregate titles ("技术、设计、数据、运营、产品等七大类")
  get `aggregate: true` for LLM validation + human curation. Heuristic calibrated on this
  snapshot: `等` / `大类|多类|各类|赛道|全覆盖|多岗位` / `类`×2+ / multi-line / 2+ paren
  cities / 2+ role tokens. **92% of titles are aggregate** — the rest are specific roles.
- Drops: **630 companies / 761 positions** (all `radar-*` externalIds unique), **700 marked
  aggregate**. Sites by city: 上海市 397 · 北京市 336 · 深圳市 253 · 成都市 127 · 广州市 117 ·
  杭州市 98 · 武汉市 61.
- Import plan (all sources): **669 companies / 1440 sites / 877 positions, 0 issues, 0 dropped**.
- **范围:全国 drops(2026-08-17)。** Geocode 已改为 **city-scoped**(`geocode-sites-apply.mjs` + `site-geocode.ts`):per-site
  place-text search with `citylimit`, and grade + regeo validate against the site's own
  province/city. **Live apply not yet run** on the national drops — the 2026-08-17 snapshot
  run hit AMap **place-text daily quota (`USER_DAILY_QUERY_OVER_LIMIT`, infocode 10044)**,
  so radar sites still carry city text only until `geocode:sites:apply` runs (3 QPS, needs
  `AMAP_WEB_KEY`, quota resets next day). Verified live: regeo on a Beijing coordinate returns
  **empty `cityname` for the direct municipalities** (北京/上海) — the regeo guard now falls
  back to `province` (`regeoMatchesTarget`). Until apply runs, the offline work catalog shows
  only the curated portal pins; re-run geocode + `import:seed:apply` restores and extends
  nationwide. Apply pass/fail stats will be recorded here.

## Radar snapshot (xiaozhao-radar jobs.json, 2026-08-11, 1404 rows)

- Mapped to `SourceCompany`: **98 companies / 125 jobs**, `hangzhou_only=true`.
- Anchor aliases merged onto existing curated pins: 11 slugs (netease, bytedance, antgroup, alibaba, tigermed, manycore, zhejiang-lab, leapmotor, h3c, hithink, didi).
- Dropped by blocked-host policy: 10 rows (Boss / 小红书 / 无链接 hosts). Confirmed 0 blocked hosts in the final drops.
- Coverage limitation (known): radar titles are **category aggregates** ("开发/算法/产品/运营"), not specific jobs; site location is **city text** ("北京/上海/杭州"), not a point. Matched slugs inherit real seed/curated coordinates; radar-only companies stay off the map until geocoded.

## Geocode plan (范围:杭州 pilot 的 drops,2026-08-17;全国 drops 见上「Radar multi-city mapper」)

- 198 companies across all drop sources; **100 sites already located**, **98 need a point**, 0 skipped (all have address text).
- Live REST apply is blocked until `AMAP_WEB_KEY` is available (`npm run geocode:sites` lists them).
- **After DB import**: 137 companies / 137 sites / 240 open positions verified in PostGIS (0 duplicate external_ids); `listImportedSitesNeedingGeocode` lists **86 sites** (radar-only companies) for geocoding.

## Geocode apply (范围:杭州 pilot,2026-08-17,AMap Web services + `AMAP_WEB_KEY`;全国 drops 的 apply 尚未运行,见上)

- `npm run geocode:sites:apply` resolved **65 / 86** radar-only city-text sites to **real Hangzhou offices** — place-text search (`v3/place/text`, city-scoped) picks the office POI, regeo confirms it sits inside 杭州市, and copy-on-write replaces `site.location` in the radar drop. Never a city-center pin.
- 12 already-pinned slugs skipped (no duplicate markers). **21 stayed off the map**: 3 with no AMap office POI (MPS芯源系统 / 志存科技 / 麦米电气) and 18 explicitly excluded in `data/recruitment/geocode-overrides.json` because AMap has no verifiable Hangzhou office (奥比中光 / MPS / 星宸 / 多益 / 昆仑芯×2 / 拓竹 / 恒瑞 / 海天集团…); wrong-entity traps were caught by name-match gating (海天集团 vs 杭州海天管业; VAST hair salon; 游卡快递柜).
- Hand-curated overrides fixed wrong-entity auto-hits: Babycare → 白贝壳 (上峰电商产业园), 游卡 → 游卡滨江基地, 淘天集团/淘宝闪购/阿里淘天 → 阿里巴巴西溪园区, 兴业银行 → 杭州分行, 台达 → 台达电子杭州设计中心, 华润置地 → 浙江公司, vivo → 西溪首座研发中心, 海信 → 海信星海科技, 舜宇 → 舜宇光学(浙江)研究院, 迈瑞 → 杭州分公司, 禾赛 → 赫兹智能制造中心, 吉利科技集团 → 吉利科技大厦.
- **Result: offline map 14 → 79 pins** (all with street address, 0 (0,0)); import plan still 137 / 137 / 241 with 0 issues. `MODE_CACHE_VERSION` bumped 2→3. Re-run `import:seed:apply` when Postgres is up to sync DB coords; re-run `audit:pins` after that for a full DB-side audit.
- **DB-side audit (2026-08-17, after `import:seed:apply` sync): 79 pins, all verified.** `npm run audit:pins` → **72/79 PASS**; the 7 flagged are address-geocode artifacts of compound addresses, each **confirmed correct by regeo** (Layer 2): 得物（黄龙国际中心B座）、理想汽车（萧山奥体印象城）、禾赛（钱湾生物港）、淘天集团×4（西溪园区 A 区 —— geocode 落园区中心，2.98km 是园区跨度，非坐标错误）。Audit script now strips parenthetical walking notes ("(地铁站C口步行270米)") before geocoding. Work-mode `/api/pois` reads **Postgres first** — data in the JSON drops only reaches the map after `import:seed:apply` re-syncs the DB.

## Official career page refresh (50 pages, polite GET, 2026-08-17)

- Full sweep completed: **50 pages** — HTTP 200 × 23, 404 × 12, network/SSL skip × 8, 500 × 3, 403 × 1, 418 × 1, robots-disallowed × 2.
- **6 pages served candidate job links** (betta, deepseek, dtstack, megvii, tigermed, wasu). These are *candidates* — a curator reviews `--progress` JSON before `--write`. Most big-tech career pages are SPA shells (no server-side job HTML), which is why headless browsers are not added.
- **404 found and fixed: `betta-hangzhou`** — `https://www.bettapharma.com/joinus` → `https://www.bettapharma.com/Jobs/campus`.
- Robots: only checked per-fetch; 404 sites return no robots (allowed by fallback).
- Robustness fixes found by the real sweep: transient SSL/network errors and a misspelled charset (`uft-8`) no longer abort the run; `javascript:` / nav-CTA / over-long links are filtered.

## Pin location audit (2026-08-17, AMap Web services)

- **14/14 pins PASS** (`npm run audit:pins`: geocode 门牌地址 + regeo 存储坐标，全部偏移 < 0.4km、区划匹配)。
- 修正 **11 家**坐标/地址（此前多数坐标与地址不符，最严重偏差 24km）：
  - 地址+坐标修正：蚂蚁（西溪路556号蚂蚁Z空间）、滴滴（景兴路896号EFC）、深度求索（拱墅区环城北路169号汇金国际大厦）、贝达（临平区兴中路355号）、泰格医药（滨江区聚工路19号盛大科技园A座18层）、群核科技（西湖区余杭塘路515号莱茵·矩阵国际）
  - 仅坐标修正：字节跳动、旷视、同花顺、新华三、之江实验室、阿里巴巴（微调）
  - 网易、零跑原数据正确，未动
- 核查方式：高德 Web 服务（geocoding / regeocoding / POI 搜索）+ 工商公开地址（启信宝/工商记录）。岗位→地址第三层核查通过（所有投递链接为公司官网或官方 ATS 域名）。
- 数据已同步：seed-data.ts、official-career drops、PostGIS（`import:seed:apply` 重导）。

## Remediation

- **2026-08-17 产品决策：工作模式只展示真实数据。** 示例岗位（seed / official-career 策展标题）从所有读路径过滤（`isAuthenticPositionId`），DB 中 110 条示例行标记 `closed`（可逆）。地图从 51 pin 收敛到 **14 pin，全部携带真实在招信号**（11 锚点雷达岗位 + deepseek/megvii/betta/tigermed 官网入口）；同日晚些时候经 `geocode:sites:apply` 扩大到 **79 pin**（真实杭州办公点，见上「Geocode apply」）。
- Re-run `radar` mapper weekly via `make refresh-radar`; record new SHA-256 here.
- **Curated** verified official portal links as positions on 4 companies (2026-08-17): betta (campus `/Jobs/campus`, social `zhiye.com/Social`), megvii (campus `join_us/campus`, social `zhaopin.megvii.com`), deepseek (`talent.deepseek.com`), tigermed (Moka ATS `hire-r1.mokahr.com/...`). wasu's hotjob link was 404 — left uncurated.
- When a per-ATS public JSON (e.g. Moka / hotjob API) is reviewed, wire it as another adapter instead of scraping SPA HTML.

## LLM 并发岗位真实性验证（WS3，2026-08-17）

脚本校验对确定性规则（坐标、字段、外部 ID）有效，但对「多个岗位合到一条」的聚合行（如「技术、设计、数据、运营、产品等七大类」「招聘方向：模型研究 / AI Infra / …」）效果有限。因此开发 LLM 并发验证脚本，用户自配 API，一次验证整批岗位；地址/位置校验同思路（LLM 判断公司 ↔ 城市/地址是否一致）。

- **脚本**：`server/scripts/validate-positions-llm.mjs`（逻辑库 `src/lib/llm-validate.ts`，mock 测试 `tests/llm-validate.test.mjs`）。读 `server/data/recruitment/{radar,official-career}` 全部 drop，每条公司/岗位一次 OpenAI 兼容 chat completions。
- **维度**：title 真实性 / 聚合行检测（附拆解建议）/ 公司↔岗位一致性 / 公司↔站点↔城市一致性 / applyUrl 域名↔公司（官网或可信 ATS，已知 ATS 域名 mokahr.com / zhiye.com 作提示，LLM 终判）。
- **env 配置**（从 process.env 与 `server/.env.local` 读取，key 绝不打印、不写报告）：
  - `LLM_API_KEY` —— 必填，否则 dry-run
  - `LLM_BASE_URL` —— OpenAI 兼容 base，默认 `https://api.openai.com/v1`
  - `LLM_MODEL` —— 必填，否则 dry-run
- **用法**：`node scripts/validate-positions-llm.mjs [--only a,b] [--sample N] [--limit N] [--concurrency N] [--dry-run]`
  - 并发默认 512（Promise 池，上限 5000）；429/5xx/网络错误指数退避（1s×2ⁿ+抖动）重试 3 次；单条失败记 error，不中断。
  - 无 `LLM_API_KEY` / `LLM_MODEL` 时自动 dry-run：打印条数 + 示例输入，退出码 0。
- **判定优先级**（`llm-validate.ts:verdictLevel`，2026-08-17 修订）：**聚合行 → warn 优先于一切 fail**（聚合标题如「策划、技术、美术、运营、职能」是真实目录数据、需要拆分,不是造假——实测 817 条首跑曾把 692 条聚合行误判 fail,已修）；其余按 titleReal / 维度 fail → fail,维度 warn → warn,否则 pass。prompt 同步要求聚合行的 titleReal 返回 true。
- **输出**：`tech/roles/data/validation-report-<YYYYMMDD>.json`（每条 pass/warn/fail/error + 理由 + suggestedSplit 聚合拆解）+ 控制台汇总。
- **聚合行落地**（2026-08-19）：聚合标记已贯通导入与读路径——`recruitment-import.ts:positionTaxonomy` 把 `aggregate` 写入 taxonomy jsonb，DB / offline 两条读路径都带出到 position；UI 对聚合行诚实展示（岗位行「汇总岗位」徽标 + JD 缺失时聚合兜底文案「具体岗位与 JD 以招聘官网为准」）。首个拆分样例：群核科技 `radar-735415a42603` 拆为 4 个真实岗位（星核人才计划/科研算法/AI Infra/AI产品经理，JD 来自公开职位页），原聚合行转 `status: closed` 墓碑保留 externalId，导入 upsert 即隐藏。
- **隐私**：每次请求仅含单条岗位文本（公司名/行业/站点/标题/部门/技能/applyUrl）；LLM 返回只当 JSON 解析，不执行。
- 计划：2026-08-17 全量 817 条（WS2 merge 后 radar 761 + official 56）已跑,聚合行按 `suggestedSplit` 拆解;后续每次 drops 刷新后重跑对比。

## LLM 校验 fail 修正 + 重跑（B2.1，2026-08-18）

- 用户已批准 `fix-plan-20260817.md` 方案(2026-08-17 全量 817 条:82 pass / 724 warn / 10 fail / 1 error)。
- **移除 4 条**（删除整个 position 对象）:`radar-c08140d30e81`(博世智能驾控,问卷星硬伤)、`radar-732fce657587`(学而思网校,标题=城市列表)、`portal-megvii-social`(megvii 官网入口)、`portal-tigermed-moka`(tigermed 官网入口)。
- **修正标题 3 条**(仅 title):`radar-52e776ddb58f`→「暑期实习(咨询顾问方向)」、`radar-a6a104980035`→「实习生(研究/投行方向)」、`radar-e49ce7364a1a`→「攻防渗透工程师」。
- **标注聚合 3 条**(补 `aggregate: true`):`radar-ce7419500bcc`(度小满)、`radar-cf5a954e8f78`(曼伦)、`radar-a72738f8085f`(申万宏源研究)。
- **DB 清理**：`positions` 表删除 2 行(博世/学而思不在 DB)——`portal-megvii-social`、`portal-tigermed-moka`,删除前已 SELECT 确认。
- **2026-08-19 追加**:同型入口 `portal-megvii-campus`(megvii 校园招聘(官网投递),warn)经用户拍板一并移除——drop 对象删除 + DB 行删除(SELECT 确认);`megvii-hangzhou` 只剩真实岗位「前端开发工程师(2026 秋招)」。全量统计由 813 → **812 条**(下次全量校验落数)。
- **全量重跑(2026-08-18)**:813 条 = **86 pass / 718 warn / 8 fail / 1 error**。
  - 修正的 3 条标题 titleReal 全部翻 true;讯飞 `radar-b871edcdf925`(原 error)被覆盖为 warn。
  - 剩余 8 fail 为同类「招聘计划/专项/入口名」标题(度小满/曼伦在 C 组已标注聚合——标注即交付物,不改标题不修校验器;其余 netease-hangzhou/vast/聂果基金/长亭/betta/deepseek 属同性质,留待后续拆解/决策)。
  - 剩余 1 error 为腾讯 `radar-302c5ea36a84`(LLM 空响应,非数据问题,下次全量自动覆盖)。
- 报告:`tech/roles/data/validation-report-20260818.json`(gitignored)。

## 无地址站点「网络查地址」优先通道 (2026-08-21, `fix/geocode-address-first`)

只带城市无地址的站点 (`siteNeedsGeocode` 为 true 且 `location.address` 缺失,如
official-career drops 的 `"address": "无"` / `/` / 城市名文本) 把网络检索当首要通道,
提高拿到「地址+坐标」的命中率。**检索源不变** — 仍是 AMap/百度/腾讯 place-search
(已登记,见 README「AMap Web services key」/「Tencent WebService key」);新增的是
query 策略与补查行为:

- **先精确后宽 (每站点 place-text ≤ 2 次)**: 站点名存在且不同于公司名/城市名时,
  先发「公司名 站点名」精确候选 (网易 杭州研究院), 命中且地址可用 (非空含街道)
  即收; 否则回落裸公司名宽候选 (既有行为, 同公司同城共享 memo)。理由: 精确命中
  多数站点 1 次调用即收, 配额最优 (AMap place-text 免费 100 次/天); 精确未命中
  自动回落 → 命中率不低于现状 (现状只有宽检索)。站点名 = 公司名 / 空 / 只是城市名
  时精确候选跳过 (去重), 行为与旧版一致。
- **memo 覆盖所有变体 key**: `(query, province, city)` 精确到变体检索串, 同
  query+region 跨站点复用成功命中; 失败/空/配额类失败仍不缓存 (配额恢复后重试)。
- **精确命中两级评分** (`gradeVariantHit`): 精确候选搜到的 POI 常以完整名命名
  (网易杭州研究院) — 先按完整检索串评分 (整名命中 → 精确可信), 被拒再回落公司名
  评分 (网易大厦等通用形态); name-match 闸门不绕过, 同品牌陷阱两级都拒。
- **地址缺失补查**: 命中 POI 的 address 为空/仅区名时, 先换另一个变体补查 (受
  配额约束, ≤2 次/站); 仍缺则用 **regeo 格式化地址兜底** (AMap
  `regeocode.formatted_address` / 百度 `result.formatted_address` / 腾讯
  `result.address`; 零额外配额 — 复用城市校验的那次 regeo, 坐标已过城市闸门 →
  格式化地址必属目标城市)。补查后与命中时同口径重评分: name-match-no-street 的
  medium 升 high → 可写回; 补查失败保持 medium → 不写回。
- **回填保障**: 所有写回路径 `location.address` 非空 (区名前缀逻辑保留);
  resolution 里 address 非空 (极少数兜底 verified 城市+区文本)。
- **不变**: 地址-城市一致性闸门 (`addressConflictsWithCity`)、regeo 城市/区级双
  闸门、override 优先级、配额短路 (连续 5 站配额类失败提前停, 退出码 2) — 变体链
  原样传播 quota reason, 不绕过。无地址站点每站配额上限: place-text ≤2、
  regeo 1 (5000/天)、地址 geocode 0、补查 0。
- 实际提升受数据形态限制: 当前 drops 的站点名多数 = 公司名 (精确候选去重, 行为
  近旧版); 增益主要来自 (a) 少数有意义站点名 (如 Shopee研发中心) 的精确命中,
  (b) name-match-no-street 的 medium 命中经 regeo 格式化地址补查升级为 high 写回。
  真实命中率需用户重跑 `geocode:sites:apply` 后对比 (Env-only)。

## Geocode 腾讯第三级兜底(2026-08-21,`feature/geocode-tencent`)

兜底链升级为 AMap→Baidu→Tencent(第三级)。以下为真实 key 探测实测记录(Env-only 步骤由用户配置 `TENCENT_MAP_KEY`,Agent 不代写、不打印):

- **三端点冒烟(status:0)**:geocoder `杭州市西湖区文二西路712号` → `120.079398,30.281334`(GCJ-02);place `keyword=得物&boundary=region(上海市,0)` → 18 条,首条 `得物|嘉定区马陆镇育绿路88号`(与 2026-08-19 上海试点记录的得物嘉定运营中心一致,grader 可直接命中);regeo `location=31.272,121.512` → `ad_info: 上海市/上海市/杨浦区`(直辖市 city 直接给市名,同百度)。
- **错误码分类校准(非破坏性探测)**:缺 key → `301 必要字段key缺少或有多个`;错误 key 格式 → `311 key格式错误`;缺 address/location → `404 错误的请求路径`。与预设(`TENCENT_QUOTA_STATUSES={121,321,322}`、瞬态 `{120}`)无冲突;`311` 为永久配置失效 → 并入 `QUOTA_CLASS_REASONS` 短路集。
- **腾讯-only 链路探测**(临时仅保留 TENCENT_MAP_KEY,`--dry-run --only=MiniMax --cities=重庆`):REPORT 正确显示 `AMAP_WEB_KEY: MISSING | BAIDU_MAP_AK: MISSING | TENCENT_MAP_KEY: set | mode: DRY-RUN`;链正确落到腾讯。
- **实测发现:key 日配额在探测期间耗尽。** 探测开始时三端点均 status:0,约 7 次调用后全部返回 `121 此key每日调用量已达到上限`(与官方状态码页一致)。推测 key 日配额在探测前已接近耗尽(今日早前已有调用),或账号未完成个人认证导致配额小于官方文档的 10000 次/天。**待办**:用户在 lbs.qq.com 控制台核对账号认证状态与今日用量;日配额重置后重跑腾讯-only 探测(`--dry-run --only=MiniMax --cities=重庆`),观察 RESOLVED 出现 `[…/tencent]`;三 key 齐全时跑全量 `geocode:sites:apply`,记录 provider 分布。

## 无地址站点网络检索补全(2026-08-22,`fix/address-backfill`)

373 个只带城市、无街道地址的站点(qqdoc-jobs 203 + qqdoc-official 123 + embodied-jobs 47)由 17 个 subagent 上网检索地址后回填进 drop JSON:

- **检索产物**:`parallel-sessions/20260821-boss-address-first/results/batch-01..17.json`(主仓库只读)——398 条结果,每条含 `site_id / address / source_url / address_type / confidence / note`;**来源 URL 全量存于批次 results/**,本小节不重复搬运。
- **命中率**:398 条结果中带地址 353 条(条目级 88.7%);按站点聚合后 **342/373 站点成功回填(91.7%)**,31 站点无地址(子代理未检索到,清单见下)。
- **聚合规则**:一站点多条结果选 `confidence: high > medium > low`,同 confidence 选 `address_type: office > registered`;无 address 的条目不参与。多城市拆分条目(site_id 带 `-城市` 后缀)按 `city-only-list.json` 权威清单归属原 site_id(精确匹配;不在清单时去掉最后一段 `-<城市>` 再匹配,仍不中记入批次报告)。
- **city 修正规则(确定性)**:从回填地址提取城市——地址含省/市/自治区 → 取首段城市名(直辖市取「北京市」式,省+市取「XX市」);自贸区/经开区/高新区/工业园区前缀与「中国(上海)自由贸易试验区」式写法单独处理;海外英文地址取末段城市(「Waltham, MA」式取 `城市, 州`,国家后缀回落前段);已知城市表以 `official-site-parse.ts` 的 CITY_TABLE 为准。**qqdoc-official 数据契约**:提取结果必须为已知城市全称(CITY_TABLE 内,`normalizeCityName` 闸门),否则保留原值记 city-unresolved。
- **结果**:342 站回填 `location.address`(location 已有 lng/lat 的保留坐标);203 站 city 由脏值(多城市文本/「XX总部」占位/「全国」)修正为单城市全称;2 站 city-unresolved 保留原值(`qq-三菱东京日联银行-site-hq` 地址为「日本东京都…」、`qq-中国矿产资源集团-site-hq` 地址为「河北省雄安新区…」——均不在 CITY_TABLE,仍待 geocode 城市解析)。
- **剩余 null 清单**:31 站无地址可回填(仍保持原样,待后续通道)——`qqj-中际旭创-site-上海/北京`、`qqj-临界点-site-深圳/北京`、`qqj-启元机器人-site-上海`、`qqj-圣邦微电子-site-厦门`、`qqj-时代共赢私募基金-site`、`qqj-沛睿微电子-site-苏州`、`qqj-源件星球-site`、`qqj-神州税道-site`、`qqj-箭元科技-site`、`qqj-络明芯微电子-site`、`qqj-联合电子-site-重庆`、`qqj-艾飞智控-site`、`qqj-荣盛集团-site-苏州`、`qqj-语核科技-site`、`qqj-逆矩阵-site`、`qqj-量智开物-site`、`qqj-靖戈量化-site`、`qqj-首形科技-site`、`qq-九江银行-site-hq`、`qq-北京市各级机关-site-hq`、`embj-1X Technologies-site`、`embj-AIM Intelligent Machines-site`、`embj-Amazon Robotics-site`、`embj-Apptronik-site`、`embj-Boston Dynamics-site`、`embj-Cruise-site`、`embj-Grit Ventures-site`、`embj-HTX-site`、`embj-Tactus-site`。
- **数据契约注意**:本次回填使 4 个断言旧值的真实数据 canary 测试不再适用(`tests/qqdoc-jobs.test.mjs` 新东方西安学校、`tests/qqdoc-official.test.mjs` 城市全称闸门已通过契约对齐、`tests/split-city-sites.test.mjs` 临界点 location、`tests/embodied-jobs-drops.test.mjs` 47 个 embj drop location 留空)——待 boss 裁决更新为回填后状态(见批次汇报 w2)。
