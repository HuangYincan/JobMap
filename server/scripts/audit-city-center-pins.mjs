#!/usr/bin/env node
// Read-only diagnostic: count sites pinned at a static city center
// (CITY_CENTERS ± CITY_CENTER_EPS) across JSON drops and — when DATABASE_URL
// is set — Postgres company_sites. Classifies every center pin:
//
//   needsRerun — at center, address present and NOT city-name-only
//                (r5 geocode-sites-apply will re-resolve these;
//                siteNeedsGeocode → true)
//   stayCenter — at center, address is city-name-only placeholder
//                ("北京" / "北京市" / "浙江省杭州市") — r5 leaves these
//   noAddress  — at center, no address
//
// Prints one JSON document; never writes files, never calls REST geocode,
// never prints any key. JSON 口径与 plan-site-geocode.mjs 同源 (adapters 读
// 本地 drop), DB 口径与 listImportedSitesNeedingGeocode 同款条件 (中心条件
// SQL 等价生成, 分类在 JS 侧复用同一批导出函数 — 口径唯一, 不漂移)。
//
//   node scripts/audit-city-center-pins.mjs
//
// 2026-08-22 (fix/geocode-r5-readiness): r5 执行前基线诊断 — 中心钉点构成
// (需重跑/留中心/无地址) + top 城市表 + 来源分布。CITY_CENTER_EPS 与
// site-geocode.ts:85 保持同值 (0.0005, 未导出故本地常量, 改时需同步)。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bossAdapter } from '../src/lib/recruitment-adapters/boss.ts';
import { nowcoderAdapter } from '../src/lib/recruitment-adapters/nowcoder.ts';
import { officialCareerAdapter } from '../src/lib/recruitment-adapters/official-career.ts';
import { qqdocOfficialAdapter } from '../src/lib/recruitment-adapters/qqdoc-official.ts';
import { radarAdapter } from '../src/lib/recruitment-adapters/radar.ts';
import { seedRecruitmentAdapter } from '../src/lib/recruitment-adapters/seed.ts';
import { shixisengAdapter } from '../src/lib/recruitment-adapters/shixiseng.ts';
import { qqdocJobsAdapter } from '../src/lib/recruitment-adapters/qqdoc-jobs.ts';
import { embodiedJobsAdapter } from '../src/lib/recruitment-adapters/embodied-jobs.ts';
import { CITY_CENTERS } from '../src/lib/city-centers.ts';
import { getPool } from '../src/lib/db.ts';
import { cityCenterBareNames, matchesCityCenter, siteNeedsGeocode } from '../src/lib/site-geocode.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');

// --- env (server/.env.local, without printing the key) ---------------------
function loadEnv() {
  const envFile = path.join(SERVER_DIR, '.env.local');
  if (!fs.existsSync(envFile)) return {};
  const out = {};
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return out;
}
const env = { ...loadEnv(), ...process.env };
if (env.DATABASE_URL && !process.env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL;

/** 与 site-geocode.ts:85 CITY_CENTER_EPS 同值 (未导出, 本地常量须同步)。 */
const CITY_CENTER_EPS = 0.0005;

/** 中心钉点分类 (与 siteNeedsGeocode / isCityNameAddress 同口径)。 */
function classifyCenterPin(site) {
  const loc = site.location;
  if (!loc || !Number.isFinite(loc.lng) || !Number.isFinite(loc.lat) || !matchesCityCenter(loc.lng, loc.lat)) return null;
  const address = String(loc.address ?? '').trim();
  if (!address) return 'noAddress';
  if (siteNeedsGeocode(site)) {
    // 多城市占位串 (北京/上海/深圳/成都) vs 真实街道地址 — r5 对两者都重跑,
    // 但前者是「公司名检索」通道的典型 (ws-a grader 放宽的直接受益者)。
    site._cityList = address.includes('/');
    return 'needsRerun';
  }
  return 'stayCenter';
}

function emptyBucket() {
  return { centerPins: 0, needsRerun: 0, cityList: 0, stayCenter: 0, noAddress: 0 };
}

function tally(bucket, site) {
  bucket.centerPins += 1;
  bucket[site._centerKind] += 1;
  if (site._centerKind === 'needsRerun' && site._cityList) bucket.cityList += 1;
}

function summarize(rows) {
  const bySource = new Map();
  const byCity = new Map();
  for (const { kind, site } of rows) {
    const src = bySource.get(kind) ?? emptyBucket();
    tally(src, site);
    bySource.set(kind, src);
    const names = cityCenterBareNames(site.location.lng, site.location.lat);
    const city = names[0] ?? 'unknown';
    const c = byCity.get(city) ?? emptyBucket();
    tally(c, site);
    byCity.set(city, c);
  }
  const sourceOut = Object.fromEntries([...bySource.entries()].sort((a, b) => b[1].centerPins - a[1].centerPins));
  const topCities = [...byCity.entries()]
    .sort((a, b) => b[1].centerPins - a[1].centerPins)
    .map(([city, b]) => ({ city, ...b }));
  const total = [...bySource.values()].reduce(
    (acc, b) => ({ centerPins: acc.centerPins + b.centerPins, needsRerun: acc.needsRerun + b.needsRerun, cityList: acc.cityList + b.cityList, stayCenter: acc.stayCenter + b.stayCenter, noAddress: acc.noAddress + b.noAddress }),
    emptyBucket(),
  );
  return { total, bySource: sourceOut, topCities };
}

// --- JSON drops (同 geocode-sites-apply.mjs dropFiles 5 源 + 其余 catalog 源) --
const adapters = [
  seedRecruitmentAdapter,
  qqdocOfficialAdapter(),
  officialCareerAdapter(),
  bossAdapter(),
  nowcoderAdapter(),
  shixisengAdapter(),
  radarAdapter(),
  qqdocJobsAdapter(),
  embodiedJobsAdapter(),
];
const listed = await Promise.all(adapters.map((a) => a.list()));
const jsonRows = [];
let jsonSites = 0;
for (let i = 0; i < adapters.length; i += 1) {
  const adapter = adapters[i];
  for (const company of listed[i]) {
    for (const site of company.sites ?? []) {
      jsonSites += 1;
      if (!site.location) continue;
      const kind = classifyCenterPin(site);
      if (!kind) continue;
      jsonRows.push({ kind: adapter.kind, site: { ...site, _centerKind: kind } });
    }
  }
}
const jsonSummary = summarize(jsonRows);

// --- Postgres company_sites (DATABASE_URL 可用时; 只读 SELECT) ---------------
let dbSummary = null;
const pool = getPool();
if (pool) {
  const seen = new Set();
  const parts = [];
  for (const { lng, lat } of Object.values(CITY_CENTERS)) {
    const key = `${lng},${lat}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(`(ABS(s.lng - ${lng}) <= ${CITY_CENTER_EPS} AND ABS(s.lat - ${lat}) <= ${CITY_CENTER_EPS})`);
  }
  const { rows } = await pool.query(
    `SELECT s.id::text, s.name AS site_name, s.address, s.city, s.lng, s.lat
       FROM company_sites s
      WHERE s.lng IS NOT NULL AND s.lat IS NOT NULL AND (${parts.join(' OR ')})`,
  );
  const dbRows = [];
  for (const row of rows) {
    const site = {
      id: row.site_name,
      name: row.site_name,
      city: row.city,
      location: { address: row.address, lng: Number(row.lng), lat: Number(row.lat) },
    };
    const kind = classifyCenterPin(site);
    if (kind) dbRows.push({ kind: 'postgres', site: { ...site, _centerKind: kind } });
  }
  dbSummary = summarize(dbRows);
}

console.log(
  JSON.stringify(
    {
      eps: CITY_CENTER_EPS,
      json: { sitesTotal: jsonSites, ...jsonSummary },
      db: dbSummary,
    },
    null,
    2,
  ),
);
