# Hangzhou POI CSV — source review

> **Status:** reviewed (offline dataset; no crawl, no API quota consumed)
> **Reviewed:** 2026-08-17
> **Owner:** product / data

## Source

`/Users/acccan/Downloads/杭州市/杭州市POI.csv` (2026-08 export, 1,006,185 rows,
603MB, 58 columns). License: **user-authorized for import** (user owns the dataset;
stated explicitly: "全量都带图 / 有授权可入库"). Demo scope: Hangzhou only.

## What the data is

A full export of AMap-aligned POI records for Hangzhou:

- Identity: `id` (AMap poiid), `name`, `address`, `tel`, `typecode` +
  `bigType/midType/smallType` classification
- Coordinates: GCJ-02 (`location` = `"lng,lat"`) **and** WGS84 pair — both 100%
- Rich fields: `rating` (41%), `cost` (8%), `photos` (46%, AMap CDN URLs),
  `adname` (13 districts), `business_area`
- Missing for this source: `reviewCount`, `reviews`, `website`, `biz_ext.open_time`
  (0 hits in first 300k rows) → open hours unsupported from this dataset

## Data quality notes (sampled ~20k rows)

| Field | Coverage | Notes |
|---|---|---|
| id/name/address/coords | 100% | `id` unique except 27 duplicate `poi_id` (merged on import) |
| classification | 100% | typecode + 3-level class |
| photos | 46% | `[{'url':'...'}]` python-repr, single quotes (not standard JSON) |
| rating | 41% | 0–5, numeric |
| cost | 8% | numeric |
| adname | 100% | all 13 Hangzhou districts |

Parsing hazard: `photos` / `biz_ext` are **python-repr**, not JSON — regex parsers
must tolerate quoted keys (`/['"]?url['"]?\s*:/`). See
`server/src/lib/hz-poi-import.ts` (pure functions, unit-tested).

## Access method

Local file read; no network requests, no login, no cookies, no CAPTCHA. The AMap
REST quota is **not** consumed by any part of this pipeline (only the out-of-HZ
fallback touches AMap, at 1 call per scroll).

## Import pipeline

`server/scripts/import-hz-pois.mjs` → `hz_pois` table (migration `013`):

- Streams CSV (csv-parse), drops rows missing required fields
- Staged `COPY`-style batch INSERT, `ON CONFLICT (poi_id) DO UPDATE` — idempotent
  (verified: re-run keeps count at 1,006,158)
- `--apply` / `--truncate` / `--limit` flags; DB URL from `server/.env.local`,
  never printed

## Retention / kill switch

- Drop `hz_pois` (migration rollback) or truncate via `import:hz:pois --truncate`.
- The frontend falls back to AMap when the DB is empty/unreachable — removing the
  table degrades to the pre-local behavior, no breakage.

## Why this is not a crawler

Static authorized export — no anti-bot measures, no rate limiting, no bypass.
Nothing in this pipeline requests external hosts.
