# Data Quality

> **Status:** evidence recorded 2026-08-17 for the radar snapshot + official-page refresh work.
> **Owner:** product / data

## Radar snapshot (xiaozhao-radar jobs.json, 2026-08-11, 1404 rows)

- Mapped to `SourceCompany`: **98 companies / 125 jobs**, `hangzhou_only=true`.
- Anchor aliases merged onto existing curated pins: 11 slugs (netease, bytedance, antgroup, alibaba, tigermed, manycore, zhejiang-lab, leapmotor, h3c, hithink, didi).
- Dropped by blocked-host policy: 10 rows (Boss / 小红书 / 无链接 hosts). Confirmed 0 blocked hosts in the final drops.
- Coverage limitation (known): radar titles are **category aggregates** ("开发/算法/产品/运营"), not specific jobs; site location is **city text** ("北京/上海/杭州"), not a point. Matched slugs inherit real seed/curated coordinates; radar-only companies stay off the map until geocoded.

## Geocode plan (all drops, 2026-08-17)

- 198 companies across all drop sources; **100 sites already located**, **98 need a point**, 0 skipped (all have address text).
- Live REST apply is blocked until `AMAP_WEB_KEY` is available (`npm run geocode:sites` lists them).
- **After DB import**: 137 companies / 137 sites / 240 open positions verified in PostGIS (0 duplicate external_ids); `listImportedSitesNeedingGeocode` lists **86 sites** (radar-only companies) for geocoding.

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

- **2026-08-17 产品决策：工作模式只展示真实数据。** 示例岗位（seed / official-career 策展标题）从所有读路径过滤（`isAuthenticPositionId`），DB 中 110 条示例行标记 `closed`（可逆）。地图从 51 pin 收敛到 **14 pin，全部携带真实在招信号**（11 锚点雷达岗位 + deepseek/megvii/betta/tigermed 官网入口）。
- Re-run `radar` mapper weekly via `make refresh-radar`; record new SHA-256 here.
- **Curated** verified official portal links as positions on 4 companies (2026-08-17): betta (campus `/Jobs/campus`, social `zhiye.com/Social`), megvii (campus `join_us/campus`, social `zhaopin.megvii.com`), deepseek (`talent.deepseek.com`), tigermed (Moka ATS `hire-r1.mokahr.com/...`). wasu's hotjob link was 404 — left uncurated.
- When a per-ATS public JSON (e.g. Moka / hotjob API) is reviewed, wire it as another adapter instead of scraping SPA HTML.
