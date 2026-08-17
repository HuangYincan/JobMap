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
- Geocode is now **city-scoped** (`geocode-sites-apply.mjs` + `site-geocode.ts`): per-site
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

## Geocode plan (all drops, 2026-08-17)

- 198 companies across all drop sources; **100 sites already located**, **98 need a point**, 0 skipped (all have address text).
- Live REST apply is blocked until `AMAP_WEB_KEY` is available (`npm run geocode:sites` lists them).
- **After DB import**: 137 companies / 137 sites / 240 open positions verified in PostGIS (0 duplicate external_ids); `listImportedSitesNeedingGeocode` lists **86 sites** (radar-only companies) for geocoding.

## Geocode apply (2026-08-17, AMap Web services + `AMAP_WEB_KEY`)

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
- **输出**：`tech/roles/data/validation-report-<YYYYMMDD>.json`（每条 pass/warn/fail/error + 理由 + suggestedSplit 聚合拆解）+ 控制台汇总。
- **隐私**：每次请求仅含单条岗位文本（公司名/行业/站点/标题/部门/技能/applyUrl）；LLM 返回只当 JSON 解析，不执行。
- 计划：用户配好 key 后跑首批 181 条（2026-08-17 drops），聚合行按 `suggestedSplit` 拆解；后续每次 drops 刷新后重跑对比。
