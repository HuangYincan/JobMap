#!/usr/bin/env node
// Resolve real offices for drop sites that only carry a city list
// ("北京/上海/杭州"), so radar-only companies can appear on the map at an
// address that actually exists — never a city-center pin. Each site is
// searched within its own city (site.city, falling back to 杭州市) and regeo
// confirms the hit sits inside that city.
//
//   node scripts/geocode-sites-apply.mjs [--dry-run] [--only slug1,slug2]
//
//   --dry-run          print the plan and resolutions, write nothing (default
//                      when neither AMAP_WEB_KEY nor BAIDU_MAP_AK is set)
//   --only a,b         resolve only these slugs (bypasses the confidence gate)
//   (no flag)          resolve every non-pinned site that gets a high-confidence
//                      match; low-confidence / unresolved stay off the map
//
// Writes back into the owning drop JSON (copy-on-write: only site.location is
// replaced). The site's city is enforced via regeo. Reads AMAP_WEB_KEY from
// server/.env.local; when AMap's daily quota is exhausted (infocode 10044) or
// no AMap key is set, falls back to Baidu Web 服务 (BAIDU_MAP_AK, same GCJ-02
// coordinates). Never prints either key. AMap throttles at 3 req/s, Baidu at
// ~2 req/s (sleep ≥600ms after a fallback call).
//
// Hand-curated resolutions can be dropped into data/recruitment/geocode-overrides.json
// as { "<slug>": { "name", "address", "lng", "lat" } } — they apply verbatim.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanCompanySearchName,
  geocodeAddressRest,
  gradeOfficePoi,
  pickBestOfficePoi,
  placeTextSearchRest,
  regeoCityRest,
  regeoMatchesTarget,
  siteCityTarget,
  siteHasStreetAddress,
  siteNeedsGeocode,
} from '../src/lib/site-geocode.ts';
import { loadOfflineWorkCatalog } from '../src/lib/server-catalog.ts';
import { RADAR_DIR } from '../src/lib/recruitment-adapters/radar.ts';
import { OFFICIAL_CAREER_DIR } from '../src/lib/recruitment-adapters/official-career.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(SERVER_DIR, 'data', 'recruitment');
const OVERRIDES_FILE = path.join(DATA_DIR, 'geocode-overrides.json');

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
if (env.AMAP_WEB_KEY && !process.env.AMAP_WEB_KEY) process.env.AMAP_WEB_KEY = env.AMAP_WEB_KEY;

const DRY_RUN = process.argv.includes('--dry-run') || (!env.AMAP_WEB_KEY && !env.BAIDU_MAP_AK);
const onlyArg = process.argv.find((a) => a.startsWith('--only=')) || process.argv.find((a, i) => process.argv[i - 1] === '--only');
const ONLY = onlyArg
  ? String(onlyArg.split('=')[1] ?? process.argv[process.argv.indexOf('--only') + 1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (x, d = 6) => Number(x.toFixed(d));

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function loadOverrides() {
  return readJson(OVERRIDES_FILE) ?? {};
}

/** Update site.location in a parsed drop (single object or array). */
function setSiteLocation(file, slug, siteId, location) {
  let changed = false;
  const raw = readJson(file);
  if (!raw) return false;
  const walk = (company) => {
    if (!company || company.slug !== slug) return;
    for (const site of company.sites ?? []) {
      if (site.id !== siteId) continue;
      site.location = location;
      changed = true;
    }
  };
  if (Array.isArray(raw)) raw.forEach(walk);
  else walk(raw);
  if (changed) fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  return changed;
}

function dropFiles() {
  const dirs = [RADAR_DIR, OFFICIAL_CAREER_DIR];
  const files = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      if (name.endsWith('.json') && !name.startsWith('.')) files.push(path.join(dir, name));
    }
  }
  return files;
}

// --- main -------------------------------------------------------------------
const onMap = await loadOfflineWorkCatalog();
// 2026-08-19:公司级 already-pinned 跳过已废弃——多城市时代一家公司可有多个
// 城市办公点(上海试点:得物/禾赛/商汤有杭州 pin 仍需解析上海 office)。
// 防重复由站点级 siteNeedsGeocode(有坐标即跳过)承担;此处仅保留城市级去重
// 视图信息供日志输出。
const pinnedCities = new Map();
for (const p of onMap) {
  const slug = p.id.split(':')[0];
  const city = p.sites?.[0]?.city ?? p.location?.address ?? '';
  const list = pinnedCities.get(slug) ?? new Set();
  list.add(city);
  pinnedCities.set(slug, list);
}
const overrides = loadOverrides();

const files = dropFiles();
const resolutions = [];
const applied = [];
const skipped = [];
const unresolved = [];

let planCount = 0;
for (const file of files) {
  const raw = readJson(file);
  const companies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const company of companies) {
    if (!company || typeof company.slug !== 'string') continue;
    const slug = company.slug;
    for (const site of company.sites ?? []) {
      if (!siteNeedsGeocode(site)) continue;
      planCount += 1;
      if (ONLY && !ONLY.includes(slug)) {
        skipped.push({ slug, siteId: site.id, reason: 'not-in-only-list' });
        continue;
      }

      const target = siteCityTarget(site);
      const override = overrides[slug];
      const query = cleanCompanySearchName(company.name);
      let poi = null;
      let confidence = null;
      let reason = '';
      let provider = 'amap';

      if (override?.exclude) {
        unresolved.push({ slug, siteId: site.id, query, reason: 'manual-exclude' });
        continue;
      }
      // 2026-08-19:override 城市门控。8/17 的 40 条 legacy override 全为杭州
      // office(无 city 字段,默认 杭州市)——若不按城市过滤,会把杭州坐标
      // 原样套到 -shanghai/-beijing 站点(实测:禾赛-site-shanghai 被写成
      // 萧山赫兹智造中心)。override.city 显式时按城市精确匹配。
      const overrideCity = override?.city ?? '杭州市';
      if (override && overrideCity !== target.city) {
        skipped.push({ slug, siteId: site.id, reason: 'override-city-mismatch' });
        continue;
      }
      if (override) {
        poi = { name: override.name, address: override.address, lng: override.lng, lat: override.lat, type: 'override', adname: '', pname: target.province, cityname: target.city };
        confidence = 'high';
        reason = 'manual-override';
      } else if (siteHasStreetAddress(site)) {
        // 有真实街道地址(如 tencent-hangzhou 西溪乐谷)——地址级 geocode 优先于
        // 公司名检索, 精确打点; 结果仍走 regeo 城市校验.
        const addr = site.location?.address?.trim() ?? '';
        const g = await geocodeAddressRest(addr, target.city);
        await sleep(g.amapUnavailable ? 600 : 340);
        if (g.ok && g.location) {
          poi = { name: company.name, address: addr, lng: g.location.lng, lat: g.location.lat, type: 'geocode', adname: '', pname: target.province, cityname: target.city };
          confidence = 'high';
          reason = 'address-geocode';
          provider = g.provider ?? 'amap';
        } else {
          reason = g.reason ?? 'geocode-failed';
        }
      } else {
        if (DRY_RUN || env.AMAP_WEB_KEY || env.BAIDU_MAP_AK) {
          const hit = await placeTextSearchRest(query, target.city);
          await sleep(hit.amapUnavailable ? 600 : 340);
          if (hit.ok && hit.pois.length) {
            poi = pickBestOfficePoi(hit.pois, company.name);
            if (poi) {
              const grade = gradeOfficePoi(poi, company.name, target.province, target.city);
              confidence = grade.confidence;
              reason = grade.reason;
              if (grade.confidence === 'low') poi = null;
            }
          } else {
            reason = hit.reason ?? 'no-pois';
          }
          if (hit.provider) provider = hit.provider;
        }
      }

      if (!poi) {
        unresolved.push({ slug, siteId: site.id, query, reason: reason || 'no-result' });
        continue;
      }

      // Regeo guard: a place-search hit must actually sit in the site's city.
      // 直辖市 (北京/上海) regeo 的 cityname 为空 — province 兜底 (regeoMatchesTarget).
      // regeoCityRest 自带高德→百度兜底; 两者 key 都缺时 ok=false → 'unverified'.
      let verified = '';
      if (!override) {
        const re = await regeoCityRest(poi.lng, poi.lat);
        await sleep(re.amapUnavailable ? 600 : 340);
        const match = regeoMatchesTarget(re, target);
        if (re.ok && !match.ok) {
          unresolved.push({ slug, siteId: site.id, query, reason: `regeo-outside:${match.reason}` });
          continue;
        }
        verified = re.ok ? `${re.cityname ?? ''} ${re.district ?? ''}`.trim() || re.province || 'unverified' : 'unverified';
      }

      const district = poi.adname || verified.split(' ').pop() || '';
      const address = district && !poi.address.includes(district) ? `${district}${poi.address}` : poi.address;

      resolutions.push({ slug, siteId: site.id, company: company.name, query, city: target.city, poi: { name: poi.name, address, lng: round(poi.lng), lat: round(poi.lat) }, confidence, reason, verified, provider });
      if (!DRY_RUN && (confidence === 'high' || override)) {
        if (setSiteLocation(file, slug, site.id, { address, lng: round(poi.lng), lat: round(poi.lat) })) {
          applied.push({ slug, siteId: site.id, address, lng: round(poi.lng), lat: round(poi.lat) });
        }
      }
    }
  }
}

// --- report -----------------------------------------------------------------
console.log(`\nAMAP_WEB_KEY: ${env.AMAP_WEB_KEY ? 'set' : 'MISSING'} | BAIDU_MAP_AK: ${env.BAIDU_MAP_AK ? 'set' : 'MISSING'} | mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'APPLY'}`);
console.log(`Sites needing a point: ${planCount} | skipped (not-in-only-list): ${skipped.filter((s) => s.reason === 'not-in-only-list').length} | override-city-mismatch: ${skipped.filter((s) => s.reason === 'override-city-mismatch').length}`);
console.log(`Resolved: ${resolutions.length} | unresolved: ${unresolved.length}`);
console.log('\n=== RESOLVED ===');
for (const r of resolutions) {
  console.log(
    `${String(r.confidence).padEnd(6)} ${r.slug.padEnd(26)} ${String(r.city).padEnd(6)} ${r.poi.name.padEnd(26)} ${r.poi.address.padEnd(32)} ${r.poi.lng},${r.poi.lat} [${r.reason}/${r.provider}] regeo=${r.verified}`,
  );
}
if (unresolved.length) {
  console.log('\n=== UNRESOLVED (stayed off map) ===');
  for (const u of unresolved) console.log(`${u.slug.padEnd(26)} ${u.query.padEnd(20)} ${u.reason}`);
}
if (!DRY_RUN) {
  console.log(`\nWRITTEN: ${applied.length} site(s) updated in drop JSON.`);
  if (applied.length !== resolutions.length) {
    console.log(`Skipped ${resolutions.length - applied.length} low-confidence resolution(s) (use --only to force).`);
  }
}
