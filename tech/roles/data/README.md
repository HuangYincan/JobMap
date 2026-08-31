# Data Role Records

> **状态：角色记录模板；子文件仅在有真实证据时创建。最后审查：2026-08-15**


> **Status:** current data-governance contract
> **Last reviewed:** 2026-08-15

## Source Registry Policy

Every source must receive a review record before acquisition code is written or scheduled. The record must state: purpose, fields, access method, authorization/license/ToS basis, robots status, rate limit, PII classification, retention and deletion rule, attribution, refresh target, quality checks, owner, review date, and kill-switch condition.

Implemented (reviewed 2026-08-17): published `xiaozhao-radar` `jobs.json` mapping, and polite GET of curated official `careerUrl` HTML. See `etl/xiaozhao-radar.md` and `etl/official-career.md`.

**National scope (2026-08-17, plan `tech/18`):** work mode extends from Hangzhou to 北京/上海/广州/深圳/成都/武汉. Pre-crawled source data is imported into Postgres (not real-time). Domain mode deliberately does **not** import AMap POIs (high volume, no raw POI source, quality variance) — it calls the AMap API directly and refreshes on user refresh only. Position authenticity (company ↔ site ↔ city ↔ applyUrl) is validated by a concurrent LLM script (`scripts/validate-positions-llm.mjs`, user-provided `LLM_API_KEY`); aggregate rows ("技术/设计/数据/运营…七大类") are flagged `aggregate` for splitting. New city/country sources still require a review record before acquisition.

## AMap Web services key (`AMAP_WEB_KEY`)

- **Purpose:** server-side geocoding only — the key must never be printed or committed, and is read from env (`server/.env.local`).
- **Used by:** `geocodeAddressRest` + `placeTextSearchRest` + `regeoCityRest` (`server/src/lib/site-geocode.ts`, address→coordinate and office discovery for `geocode:sites:apply`), and `npm run audit:pins` (`scripts/audit-pin-locations.mjs`, three-layer pin audit: geocoding + regeocoding + POI search).
- **Not used for:** map rendering (that is the browser JS key `NEXT_PUBLIC_AMAP_KEY`), or any Domain-mode live search (browser AMap SDK).

## Tencent WebService key (`TENCENT_MAP_KEY`)

- **Purpose:** third-level geocode fallback (2026-08-21, `feature/geocode-tencent`) — after AMap daily quota (infocode 10044) and Baidu daily quota (status 302) are both exhausted, or both keys are absent. The key must never be printed or committed, and is read from env (`server/.env.local`).
- **Used by:** `tencentGeocodeAddressRest` + `tencentPlaceSearchRest` + `tencentRegeoCityRest` (`server/src/lib/site-geocode.ts`, ws/geocoder/v1 + ws/place/v1/search, native GCJ-02).
- **Quota:** individual developer 10,000 calls/day per API, 5 QPS (official FAQ, lbs.qq.com) — vs AMap place-text 100/day and Baidu place search 100/day.
- **Not used for:** map rendering or any frontend code.

| Source | MVP status | Permitted action | Conditions |
|---|---|---|---|
| `xiaozhao-radar` `jobs.json` | Candidate approved for design | Build an import only after attribution and license evidence are recorded | Apache-2.0 attribution, source URL/hash, parser version, idempotency |
| Official ATS/API | Candidate | Per-source import after review | Explicit terms/robots/rate/retention review |
| User-provided CSV/data | Deferred | No importer yet | Declarative template, validation, tenant visibility and audit design |
| BOSS Direct Hire | Deferred and not approved | No automated acquisition | Requires explicit authorization and separate legal/security review |
| Xiaohongshu | Deferred and not approved | No automated acquisition | Requires explicit authorization and separate legal/security review |

Do not design or run login automation, CAPTCHA solving, rate-limit evasion, browser fingerprint evasion, or other controls intended to bypass source restrictions.

## Planned Records

When real work starts, add evidence-based records beneath this directory:

- `data-sources.md`: reviewed sources and their authorization status.
- `data-quality.md`: measured completeness, geocode success, freshness, duplicates, and remediation.
- `etl/<source>.md`: actual import transformation and idempotency behavior.

Do not prefill pass/fail results or authorization conclusions without evidence.
