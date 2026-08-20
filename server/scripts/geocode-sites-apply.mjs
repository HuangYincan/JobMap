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
//   --cities 上海,杭州  resolve only sites whose site.city is in this list
//                      (海外/非目标城市站点跳过,防止单公司 170 站拖垮全流程)
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
// 2026-08-20 (w4): 地址-城市一致性闸门。城市拆分时代 drops 的城市站点继承了
// 杭州 office 地址文本 ("西湖区莲花街333号…"), 在目标城市做地址检索会城市内
// 错配 (实测: 广州 "花都区西湖"), 而省级 regeo 拦不住。地址含非目标城市的
// 已知区县/城市名 → 跳过地址检索, 直接公司名检索; 地址检索命中后 regeo 区级
// 校验 (落点区 ≠ 地址区名) → 回退公司名检索。两种路径都不写错坐标。
//
// Hand-curated resolutions can be dropped into data/recruitment/geocode-overrides.json
// as { "<slug>": { "name", "address", "lng", "lat" } } — they apply verbatim.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addressConflictsWithCity,
  addressConflictsWithRegeoDistrict,
  cleanCompanySearchName,
  geocodeAddressRest,
  gradeOfficePoi,
  pickBestOfficePoi,
  placeSearchMemoKey,
  placeSearchMemoSet,
  placeTextSearchRest,
  regeoCityRest,
  regeoMatchesTarget,
  shouldShortCircuitQuota,
  siteCityTarget,
  siteHasStreetAddress,
  siteNeedsGeocode,
} from '../src/lib/site-geocode.ts';
import { loadOfflineWorkCatalog } from '../src/lib/server-catalog.ts';
import { RADAR_DIR } from '../src/lib/recruitment-adapters/radar.ts';
import { OFFICIAL_CAREER_DIR } from '../src/lib/recruitment-adapters/official-career.ts';

// 代理/网络挂起防御:所有 fetch 默认 20s 超时(不覆盖调用方显式 signal)。
// 背景:Node 原生 fetch 无超时,请求卡死在代理(Clash 198.18.0.0/15,
// ESTABLISHED 但无响应)时进程无限挂起。超时抛 AbortError,site-geocode.ts
// 上层 catch 后按 reason 记 unresolved,不中断整体流程。
const __origFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const opts = init ?? {};
  const signal = opts.signal ?? AbortSignal.timeout(20_000);
  return __origFetch(input, { ...opts, signal });
};

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
if (env.BAIDU_MAP_AK && !process.env.BAIDU_MAP_AK) process.env.BAIDU_MAP_AK = env.BAIDU_MAP_AK;

const DRY_RUN = process.argv.includes('--dry-run') || (!env.AMAP_WEB_KEY && !env.BAIDU_MAP_AK);
const onlyArg = process.argv.find((a) => a.startsWith('--only=')) || process.argv.find((a, i) => process.argv[i - 1] === '--only');
const ONLY = onlyArg
  ? String(onlyArg.split('=')[1] ?? process.argv[process.argv.indexOf('--only') + 1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : null;

const citiesArg = process.argv.find((a) => a.startsWith('--cities=')) || process.argv.find((a, i) => process.argv[i - 1] === '--cities');
const CITIES = citiesArg
  ? String(citiesArg.split('=')[1] ?? process.argv[process.argv.indexOf('--cities') + 1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : [];

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

// --- place-search memo (2026-08-21, fix/geocode-place-memo) ------------------
// AMap place-text 免费配额 100 次/天, 而同一公司同一城市的多个 office 站点
// (安克创新 38 站 / 元气森林 71 站 / 小鹏 52 站) 用相同 query+region 逐站独立
// place-search 是结构性浪费。按 (query, province, city) 只缓存成功命中; 失败/
// 空结果/配额类失败绝不缓存 (配额恢复后必须重试, 缓存旧失败会永久卡死站点)。
// override 站点 (manual-override) 不走 place-text, 不参与 memo; w4 地址门控
// 路径 (geocodeAddressRest) 不受影响。regeo 验证仍按站点独立执行 (5000 次/天,
// 不是瓶颈)。
const placeSearchMemo = new Map();

/**
 * 公司名城市级 place-search 解析 (无街道地址 / 地址不可信时的统一路径)。
 * 2026-08-20 (w4): 从主循环抽出的公共 helper —— 地址-城市一致性闸门拒绝的
 * 站点与 regeo 区级校验拒绝的地址检索命中都回退到这里, 而不是写错坐标。
 * 2026-08-21 (fix/geocode-place-memo): memo 成功命中 —— 同 query+region 的
 * 后续站点直接复用第一个命中 POI, 不再逐站消耗 place-text 配额。
 */
async function searchCompanyPoi(query, target) {
  const out = { poi: null, confidence: null, reason: '', provider: 'amap' };
  if (DRY_RUN || env.AMAP_WEB_KEY || env.BAIDU_MAP_AK) {
    const memoKey = placeSearchMemoKey(query, target);
    const cached = placeSearchMemo.get(memoKey);
    if (cached) return cached;
    const hit = await placeTextSearchRest(query, target.city);
    await sleep(hit.amapUnavailable ? 600 : 340);
    if (hit.ok && hit.pois.length) {
      // 用别名后的 query 评分: 中微公司 → 中微半导体设备, 否则查询命中但
      // 原始快照名对不上 POI 名会被 grader 拒.
      const picked = pickBestOfficePoi(hit.pois, query, target.province, target.city);
      if (picked) {
        const grade = gradeOfficePoi(picked, query, target.province, target.city);
        out.poi = grade.confidence === 'low' ? null : picked;
        out.confidence = grade.confidence;
        out.reason = grade.reason;
      }
    } else {
      out.reason = hit.reason ?? 'no-pois';
    }
    if (hit.provider) out.provider = hit.provider;
    // 只缓存成功命中 (poi 非空); 失败/空/配额类失败留在 memo 外, 下次重试。
    placeSearchMemoSet(placeSearchMemo, memoKey, out);
  }
  return out;
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

// --- 配额短路 (2026-08-21, fix/geocode-quota-short-circuit) ------------------
// 2026-08-21 实测: AMap place-text 日配额 100% 耗尽 (infocode 10044) + 百度兜底
// 返回 302 "天配额超限" 后, 脚本仍逐站空跑 (~1800 站, 数十分钟零产出)。判定:
// 连续 QUOTA_SHORT_CIRCUIT_N 个已尝试站点全部配额类失败 (quota /
// baidu-status:302 / no-key) → 提前停止: REPORT 照常打印 + QUOTA_EXHAUSTED
// 醒目行 + 非零退出码。非配额类失败 (http/empty/parse/regeo-outside:*/401) 或
// 成功解析都会冲掉窗口, 不会误停。skip 站 (not-in-only-list 等) 不是尝试,
// 不进窗口, 也不冲窗口。
const QUOTA_SHORT_CIRCUIT_N = 5;
let shortCircuited = false;
/** 每站一条: unresolved 原因字符串 | null(已解析)。 */
const quotaHistory = [];
const recordOutcome = (reason) => {
  quotaHistory.push(reason);
  if (shouldShortCircuitQuota(quotaHistory, QUOTA_SHORT_CIRCUIT_N)) {
    shortCircuited = true;
    return true;
  }
  return false;
};

const files = dropFiles();
const resolutions = [];
const applied = [];
const skipped = [];
const unresolved = [];

let planCount = 0;
mainLoop: for (const file of files) {
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
      // 2026-08-19: 城市过滤器。单公司 drop 可能带上百个海外/非目标城市站点
      // (如 蔚来 170 站),逐站 place-search 会拖死全流程并烧光百度地点检索
      // 配额(100 次/天)。--cities 只落目标城市站点,其余记 skipped。
      if (CITIES.length && !CITIES.some((c) => target.city === c || target.city.startsWith(c) || c.startsWith(target.city))) {
        skipped.push({ slug, siteId: site.id, reason: `city-not-in-list:${target.city}` });
        continue;
      }
      let override = overrides[slug];
      const query = cleanCompanySearchName(company.name);
      const addr = site.location?.address?.trim() ?? '';
      let poi = null;
      let confidence = null;
      let reason = '';
      let provider = 'amap';
      let addressGeocode = false;

      if (override?.exclude) {
        unresolved.push({ slug, siteId: site.id, query, reason: 'manual-exclude' });
        if (recordOutcome('manual-exclude')) break mainLoop;
        continue;
      }
      // 2026-08-19:override 城市门控。8/17 的 40 条 legacy override 全为杭州
      // office(无 city 字段,默认 杭州市)——若不按城市过滤,会把杭州坐标
      // 原样套到 -shanghai/-beijing 站点(实测:禾赛-site-shanghai 被写成
      // 萧山赫兹智造中心)。override.city 显式时按城市精确匹配。
      const overrideCity = override?.city ?? '杭州市';
      if (override && overrideCity !== target.city) {
        skipped.push({ slug, siteId: site.id, reason: 'override-city-mismatch' });
        // 城市不匹配的 override 只对本站点失效(忽略), 回落地址/公司检索——
        // 直接 continue 会把 -shanghai/-beijing 站点永久留在图外.
        override = null;
      }
      if (override) {
        poi = { name: override.name, address: override.address, lng: override.lng, lat: override.lat, type: 'override', adname: '', pname: target.province, cityname: target.city };
        confidence = 'high';
        reason = 'manual-override';
      } else if (siteHasStreetAddress(site) && !addressConflictsWithCity(addr, target.city)) {
        // 2026-08-20 (w4): 地址-城市一致性闸门。fecef85 城市拆分时代 drops 的
        // 城市站点继承了杭州 office 地址("西湖区莲花街333号…"), 在目标城市
        // 做地址检索会城市内错配(实测:广州 "花都区西湖" 113.20/23.38), 而
        // regeo 省级校验拦不住(pname 同省即过)。地址含非目标城市的已知
        // 区县/城市名 → 地址不可信, 跳过地址检索, 直接走公司名检索。
        const g = await geocodeAddressRest(addr, target.city);
        await sleep(g.amapUnavailable ? 600 : 340);
        if (g.ok && g.location) {
          poi = { name: company.name, address: addr, lng: g.location.lng, lat: g.location.lat, type: 'geocode', adname: '', pname: target.province, cityname: target.city };
          confidence = 'high';
          reason = 'address-geocode';
          provider = g.provider ?? 'amap';
          addressGeocode = true;
        } else {
          reason = g.reason ?? 'geocode-failed';
        }
      } else {
        const res = await searchCompanyPoi(query, target);
        poi = res.poi;
        confidence = res.confidence;
        reason = res.reason;
        provider = res.provider;
      }

      if (!poi) {
        unresolved.push({ slug, siteId: site.id, query, reason: reason || 'no-result' });
        if (recordOutcome(reason || 'no-result')) break mainLoop;
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
          if (recordOutcome(`regeo-outside:${match.reason}`)) break mainLoop;
          continue;
        }
        // 2026-08-20 (w4): 区级校验 —— 地址检索命中但 geocoder 落点所在的区
        // (regeo adname) 与地址文本区名不符 (未收录区名的地址在目标城市内错配,
        // 如 杭州地址 → 广州 "花都区西湖"), 坐标不可信 → 回退公司名检索,
        // 不写错坐标。
        if (re.ok && addressGeocode && addressConflictsWithRegeoDistrict(addr, re.district ?? '')) {
          const res = await searchCompanyPoi(query, target);
          if (!res.poi) {
            unresolved.push({ slug, siteId: site.id, query, reason: 'address-district-mismatch' });
            if (recordOutcome('address-district-mismatch')) break mainLoop;
            continue;
          }
          poi = res.poi;
          confidence = res.confidence;
          reason = res.reason;
          provider = res.provider;
          const re2 = await regeoCityRest(poi.lng, poi.lat);
          await sleep(re2.amapUnavailable ? 600 : 340);
          const match2 = regeoMatchesTarget(re2, target);
          if (re2.ok && !match2.ok) {
            unresolved.push({ slug, siteId: site.id, query, reason: `regeo-outside:${match2.reason}` });
            if (recordOutcome(`regeo-outside:${match2.reason}`)) break mainLoop;
            continue;
          }
          verified = re2.ok ? `${re2.cityname ?? ''} ${re2.district ?? ''}`.trim() || re2.province || 'unverified' : 'unverified';
        } else {
          verified = re.ok ? `${re.cityname ?? ''} ${re.district ?? ''}`.trim() || re.province || 'unverified' : 'unverified';
        }
      }

      const district = poi.adname || verified.split(' ').pop() || '';
      const address = district && !poi.address.includes(district) ? `${district}${poi.address}` : poi.address;

      resolutions.push({ slug, siteId: site.id, company: company.name, query, city: target.city, poi: { name: poi.name, address, lng: round(poi.lng), lat: round(poi.lat) }, confidence, reason, verified, provider });
      recordOutcome(null); // 解析成功冲掉配额窗口 — 配额不是卡点, 不误停
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

// 双配额耗尽 → 提前停止 (REPORT 已按正常收尾同款打印): 醒目说明 + 剩余站数 +
// 非零退出码 (exit 2)。已写入的站点保留 — 重跑时 siteNeedsGeocode 跳过有坐标
// 站点, 幂等。
if (shortCircuited) {
  const remaining = planCount - resolutions.length - unresolved.length - skipped.length;
  console.log(`\nQUOTA_EXHAUSTED: AMap+百度 双配额耗尽(或无可用 key),已提前停止,剩余 ${remaining} 站待下次运行。`);
  process.exit(2);
}
