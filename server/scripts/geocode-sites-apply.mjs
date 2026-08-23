#!/usr/bin/env node
// Resolve real offices for drop sites that only carry a city list
// ("北京/上海/杭州"), so radar-only companies can appear on the map at an
// address that actually exists — never a city-center pin. Each site is
// searched within its own city (site.city, falling back to 杭州市) and regeo
// confirms the hit sits inside that city.
//
//   node scripts/geocode-sites-apply.mjs [--dry-run] [--only slug1,slug2] [--cities 上海,杭州] [--continue]
//
//   --dry-run          print the plan and resolutions, write nothing (default
//                      when none of AMAP_WEB_KEY / BAIDU_MAP_AK / TENCENT_MAP_KEY
//                      is set)
//   --only a,b         resolve only these slugs (bypasses the confidence gate)
//   --cities 上海,杭州  resolve only sites whose site.city is in this list
//                      (海外/非目标城市站点跳过,防止单公司 170 站拖垮全流程)
//   --continue         显式续跑 (多日执行)。默认行为: 存在
//                      server/.geocode-progress.json 即读回并打印「上次进展 +
//                      剩余 Top 城市」; 本 flag 仅显式表达意图, 供 runbook 使用。
//   (no flag)          resolve every non-pinned site that gets a high-confidence
//                      match; low-confidence / unresolved stay off the map
//
// Writes back into the owning drop JSON (copy-on-write: only site.location is
// replaced). The site's city is enforced via regeo. Reads AMAP_WEB_KEY from
// server/.env.local; when AMap's daily quota is exhausted (infocode 10044) or
// no AMap key is set, falls back to Baidu Web 服务 (BAIDU_MAP_AK), then Tencent
// WebService (TENCENT_MAP_KEY) when Baidu also fails — all GCJ-02 coordinates.
// Never prints any key. AMap throttles at 3 req/s, Baidu at ~2 req/s (sleep
// ≥600ms), Tencent at ~5 req/s (sleep ≥340ms after a fallback call).
//
// 配额事实 (2026-08-23 查证, 个人开发者配额): AMap 地点搜索 place-text ~100 次/日
//   (https://lbs.amap.com), 百度 Web 服务地点检索 ~100 次/日
//   (https://lbsyun.baidu.com), 腾讯 WebService 地点搜索 ~100 次/日
//   (https://lbs.qq.com)。三 provider 合计日吞吐 ~300 站 — 2026-08-23 实测
//   backlog 1076 站 (上海 269 / 北京 246 / 深圳 182 …), 全量约需 4 天。
// 跨日执行 (2026-08-23, ws-c): 每次运行结束写 server/.geocode-progress.json
//   (已在 .gitignore 登记) — 运行时间/计数/QUOTA_EXHAUSTED 标记/按城市分组的
//   剩余清单; 下次运行开始时读回并打印「上次进展 + 剩余 Top 城市」。进度文件
//   只是报告/排程辅助, 不参与判定 — 已有坐标站点照常由 siteNeedsGeocode 幂等
//   跳过, 也不缓存任何检索结果 (place-search memo 仍是内存态)。
//   `npm run geocode:sites:daily -- --cities 上海` 封装单日跑 + 配额耗尽后的
//   明日续跑指引 (scripts/geocode-sites-daily.mjs, 薄封装)。
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
  addresslessQueryVariants,
  backfillAddressFromRegeo,
  cleanCompanySearchName,
  formatGeocodeProviderReport,
  geocodeAddressRest,
  gradeVariantHit,
  pickBestOfficePoi,
  placeSearchMemoKey,
  placeSearchMemoSet,
  placeTextSearchRest,
  poiAddressUsable,
  regeoCityRest,
  regeoMatchesTarget,
  shouldShortCircuitQuota,
  siteCityTarget,
  siteHasStreetAddress,
  siteNeedsGeocode,
  sitesNeedingGeocode,
} from '../src/lib/site-geocode.ts';
import { loadOfflineWorkCatalog } from '../src/lib/server-catalog.ts';
import { RADAR_DIR } from '../src/lib/recruitment-adapters/radar.ts';
import { OFFICIAL_CAREER_DIR } from '../src/lib/recruitment-adapters/official-career.ts';
import { QQDOC_JOBS_DIR } from '../src/lib/recruitment-adapters/qqdoc-jobs.ts';
import { QQDOC_OFFICIAL_DIR } from '../src/lib/recruitment-adapters/qqdoc-official.ts';
import { EMBODIED_JOBS_DIR } from '../src/lib/recruitment-adapters/embodied-jobs.ts';

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
if (env.TENCENT_MAP_KEY && !process.env.TENCENT_MAP_KEY) process.env.TENCENT_MAP_KEY = env.TENCENT_MAP_KEY;

const DRY_RUN = process.argv.includes('--dry-run') || (!env.AMAP_WEB_KEY && !env.BAIDU_MAP_AK && !env.TENCENT_MAP_KEY);
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

// 2026-08-23 (ws-c): 显式续跑标记。默认行为即读进度文件 — 有
// server/.geocode-progress.json 就在启动时打印「上次进展 + 剩余 Top 城市」。
const CONTINUE = process.argv.includes('--continue');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 节流: 百度 ~2 QPS → 600ms; 高德 ~3 QPS、腾讯 ~5 QPS(个人开发者) → 340ms。
// provider 缺失(unverified 等)按 340ms 兜底。340ms ≥ 腾讯 5 QPS 的 200ms 间隔。
const throttleMs = (provider) => (provider === 'baidu' ? 600 : 340);
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

// 2026-08-22 (fix/geocode-qqdoc-embodied, w3): 覆盖 5 源 — w2 已把 342 个
// 有地址站点回填进 qqdoc-jobs / qqdoc-official / embodied-jobs drops, 不纳入
// 本扫描则这些站点永远无法落坐标上地图。qqdoc-official 的 city_pending 站点
// (city 仍为「XX总部」脏值, 如 qq-中国矿产资源集团-site-hq) 照常进计划: 地址
// 检索可执行, 脏 city 在 regeo 城市闸门 (outside-province / outside-city) 被
// 跳过是可接受行为 — 不崩脚本, 留待 city 修正后自然解。
function dropFiles() {
  const dirs = [RADAR_DIR, OFFICIAL_CAREER_DIR, QQDOC_JOBS_DIR, QQDOC_OFFICIAL_DIR, EMBODIED_JOBS_DIR];
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
 * 2026-08-21 (fix/geocode-address-first): gradeName 与检索串分离 —— 精确候选
 * (公司名+站点名) 检索、按站点名完整串或裸公司名两级评分 (gradeVariantHit);
 * 宽候选 gradeName 缺省 = query, 行为不变。
 */
async function searchCompanyPoi(query, target, gradeName = query) {
  const out = { poi: null, confidence: null, reason: '', provider: 'amap' };
  if (DRY_RUN || env.AMAP_WEB_KEY || env.BAIDU_MAP_AK || env.TENCENT_MAP_KEY) {
    const memoKey = placeSearchMemoKey(query, target);
    const cached = placeSearchMemo.get(memoKey);
    if (cached) return cached;
    const hit = await placeTextSearchRest(query, target.city);
    await sleep(throttleMs(hit.provider));
    if (hit.ok && hit.pois.length) {
      // 用别名后的 query 评分: 中微公司 → 中微半导体设备, 否则查询命中但
      // 原始快照名对不上 POI 名会被 grader 拒. 精确候选先按完整检索串评分
      // (网易杭州研究院 整名命中), 被拒回落 gradeName (公司名) 评分.
      const picked = pickBestOfficePoi(hit.pois, gradeName, target.province, target.city, query);
      if (picked) {
        const grade = gradeVariantHit(picked, query, gradeName, target.province, target.city);
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

/**
 * 无地址站点检索链 (2026-08-21, fix/geocode-address-first): 先精确候选
 * 「公司名 站点名」, 命中且地址可用 (非空含街道) 即收; 否则回落宽候选
 * (裸公司名, 既有行为)。每站点 place-text ≤ 2 次; memo 按变体 key 独立
 * 缓存成功命中, 同 query+region 跨站点不重复消耗。精确命中但地址缺失/过短
 * → 宽候选补查; 补查仍无可用地址 → 保留第一个命中 (置信度按既有闸门,
 * medium 不写回)。配额类失败 (quota / baidu-status:302 / tencent-status:*)
 * 原样传播 → 配额短路不受影响。
 */
async function searchCompanyPoiVariants(query, target, site) {
  const variants = addresslessQueryVariants(query, site.name, target);
  let firstHit = null;
  let lastMiss = null;
  for (const v of variants) {
    const res = await searchCompanyPoi(v.searchQuery, target, v.gradeName);
    const tagged = { ...res, variant: v.kind, searchQuery: v.searchQuery };
    if (!res.poi) {
      lastMiss = tagged;
      continue;
    }
    if (poiAddressUsable(res.poi.address)) return tagged;
    if (!firstHit) firstHit = tagged;
  }
  if (firstHit) return firstHit;
  return lastMiss ?? { poi: null, confidence: null, reason: 'no-pois', provider: 'amap' };
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
// baidu-status:302 / tencent-status:121|321|322 (腾讯每日上限) /
// tencent-status:110|112|190|199 (key/IP/功能配置永久失效) / no-key) →
// 提前停止: REPORT 照常打印 + QUOTA_EXHAUSTED 醒目行 + 非零退出码。非配额类
// 失败 (http/empty/parse/regeo-outside:*/baidu-status:401/tencent-status:120
// (每秒限流, 可重试)) 或成功解析都会冲掉窗口, 不会误停。skip 站
// (not-in-only-list 等) 不是尝试, 不进窗口, 也不冲窗口。
// 2026-08-21 (fix/geocode-plan-count): 短路后 REPORT 的计数不再用停在短路点
// 的 planCount, 而用主循环前预扫的真实全量 planTotal (见下) — 否则
// "Sites needing a point: 5" 严重误导 (实际缺坐标站点 1783 个)。
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

// --- 跨日进度记录 (2026-08-23, ws-c) ------------------------------------------
// 多日执行 (配额 ~300 站/日, 全量 1076 站约 4 天 — 见头部注释) 的报告/排程辅助:
// 运行结束时写 server/.geocode-progress.json (已在 .gitignore 登记), 下次运行
// 开始时读回打印「上次进展 + 剩余 Top 城市」。只报告、不参与判定 — 已有坐标
// 站点照常由 siteNeedsGeocode 幂等跳过; 进度文件不缓存任何检索结果。
const PROGRESS_FILE = path.join(SERVER_DIR, '.geocode-progress.json');

/** 配额事实 (2026-08-23 查证, 个人开发者配额, 来源见头部注释)。 */
function printQuotaFacts() {
  console.log(
    '配额事实 (2026-08-23 查证, 个人开发者配额): AMap place-text ~100 次/日 (https://lbs.amap.com) + 百度 Web 服务地点检索 ~100 次/日 (https://lbsyun.baidu.com) + 腾讯 WebService 地点搜索 ~100 次/日 (https://lbs.qq.com) ≈ 300 站/日 — 2026-08-23 实测 backlog 1076 站 (上海 269 / 北京 246 / 深圳 182 …), 全量约 4 天。',
  );
}

// 剩余清单排序: 上海/北京/深圳优先 (多日执行按单城跑), 其余按剩余数降序。
const CITY_PRIORITY = ['上海', '北京', '深圳'];
function citySortKey(city) {
  const i = CITY_PRIORITY.findIndex((p) => city.startsWith(p) || p.startsWith(city));
  return i === -1 ? CITY_PRIORITY.length : i;
}

/** 分组城市键: 取首个空白分隔 token 并去「市」后缀 — 与 --cities 过滤的
 *  startsWith 匹配口径一致 (脏 city 值如 "上海  南京" 归入 上海 组, 报告的
 *  --cities 提示值可直接命中)。只影响报告分组, 不改检索逻辑。 */
function cityGroupKey(city) {
  return (city ?? '').trim().split(/\s+/)[0].replace(/市$/, '');
}

/** 剩余 = 预扫 needing − 本次 applied (写回坐标的站点明天幂等跳过; unresolved/
 *  skipped 仍留待重试, 计入剩余)。按城市分组 (cityGroupKey) + 排序。
 *  appliedKeys: slug:siteId。 */
function buildRemainingByCity(needingList, appliedKeys) {
  const byCity = new Map();
  for (const n of needingList) {
    const city = cityGroupKey(n.city);
    if (appliedKeys.has(`${n.company.slug}:${n.site.id}`)) continue;
    const entry = byCity.get(city) ?? { city, count: 0, sites: [] };
    entry.count += 1;
    entry.sites.push(`${n.company.slug}:${n.site.id}`);
    byCity.set(city, entry);
  }
  return [...byCity.values()].sort(
    (a, b) => citySortKey(a.city) - citySortKey(b.city) || b.count - a.count,
  );
}

function formatTopCities(byCity, top = 8) {
  if (!byCity.length) return '无';
  const head = byCity.slice(0, top).map((c) => `${c.city} ${c.count}`).join(' | ');
  return byCity.length > top ? `${head} | …共 ${byCity.length} 城` : head;
}

const files = dropFiles();
const resolutions = [];
const applied = [];
const skipped = [];
const unresolved = [];

// --- 预扫: 真实全量 (2026-08-21, fix/geocode-plan-count) ----------------------
// 2026-08-21 实测: 双配额耗尽短路后输出 "Sites needing a point: 5", 而实际
// 缺坐标站点 1783 个 (radar 1363 + official-career 420) — planCount 是处理
// 过程中的累计计数, 短路触发后停在短路点, 严重误导。主循环前只读预扫一遍,
// 统计真实全量 planTotal (所有 siteNeedsGeocode 的站点数, ONLY/CITIES 过滤前
// 口径): "待下次运行" 的真实剩余 = planTotal - resolutions - unresolved -
// skipped, 被过滤跳过的站点在 skipped 单列。预扫结果 (company, site) 引用
// 直接供主循环复用, 不重复 JSON.parse。预扫只读不写, 无网络调用。
const needing = [];
for (const file of files) {
  const raw = readJson(file);
  const companies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  // 2026-08-23 (ws-c): 预扫时顺带记下每站目标城市 (siteCityTarget 纯函数, 无
  // 网络), 供运行结束时的按城剩余清单分组 — 不重算、不改主循环逻辑。
  for (const n of sitesNeedingGeocode(companies)) needing.push({ file, ...n, city: siteCityTarget(n.site).city });
}
const planTotal = needing.length;

// 跨日续跑 (2026-08-23, ws-c): 有上次进度文件即打印「上次进展 + 剩余 Top 城市」
// (--continue 显式续跑, 默认行为一致)。只报告, 不参与判定。
const prevProgress = readJson(PROGRESS_FILE);
if (prevProgress) {
  const r = prevProgress.run ?? {};
  const rem = prevProgress.remaining ?? { total: 0, byCity: [] };
  console.log(`\n--- 上次运行进展 (${prevProgress.updatedAt ?? '?'}) [${prevProgress.mode ?? '?'}]${CONTINUE ? ' (--continue 续跑)' : ''} ---`);
  console.log(
    `计划 ${r.planTotal ?? 0} 站 | 已尝试 ${r.attempted ?? 0} | 解析 ${r.resolved ?? 0} / 失败 ${r.unresolved ?? 0} | 写回 ${r.applied ?? 0} | 配额耗尽 ${r.quotaExhausted ? '是' : '否'}`,
  );
  console.log(`上次剩余 ${rem.total ?? 0} 站 (Top 城市): ${formatTopCities(rem.byCity ?? [])}`);
  printQuotaFacts();
  console.log('续跑: npm run geocode:sites:daily -- --cities 上海 (或 --cities 北京/深圳 — 单城 ~250 站, 可切 --cities 单城多日消化)');
}

let planCount = 0;
mainLoop: for (const { file, company, site } of needing) {
  const slug = company.slug;
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
  /** 本次命中的检索变体 (precise/broad) 与对应检索串 — 仅无地址站点网络检索路径有值. */
  let variant = null;
  let variantQuery = null;

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
    await sleep(throttleMs(g.provider));
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
    // 2026-08-21 (fix/geocode-address-first): 无地址站点网络检索优先通道 —
    // 先精确候选 (公司名+站点名, 站点名存在时), 未命中/地址缺失回落宽候选
    // (裸公司名, 既有行为); 每站点 place-text ≤ 2 次。
    const res = await searchCompanyPoiVariants(query, target, site);
    poi = res.poi;
    confidence = res.confidence;
    reason = res.reason;
    provider = res.provider;
    variant = res.variant;
    variantQuery = res.searchQuery ?? null;
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
  /** 校验最终 poi 的那次 regeo 结果 — 地址兜底补查的来源 (格式化地址零额外配额). */
  let finalRe = null;
  if (!override) {
    const re = await regeoCityRest(poi.lng, poi.lat);
    await sleep(throttleMs(re.provider));
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
      await sleep(throttleMs(re2.provider));
      const match2 = regeoMatchesTarget(re2, target);
      if (re2.ok && !match2.ok) {
        unresolved.push({ slug, siteId: site.id, query, reason: `regeo-outside:${match2.reason}` });
        if (recordOutcome(`regeo-outside:${match2.reason}`)) break mainLoop;
        continue;
      }
      finalRe = re2;
      verified = re2.ok ? `${re2.cityname ?? ''} ${re2.district ?? ''}`.trim() || re2.province || 'unverified' : 'unverified';
    } else {
      finalRe = re;
      verified = re.ok ? `${re.cityname ?? ''} ${re.district ?? ''}`.trim() || re.province || 'unverified' : 'unverified';
    }
  }

  // 2026-08-21 (fix/geocode-address-first): 命中 POI 地址缺失/过短 (空串或仅
  // 区名) 时, 用 regeo 格式化地址兜底补查 (零额外配额 — 复用城市校验的这次
  // regeo; 坐标已过城市闸门 → 格式化地址必属目标城市)。补查成功 → 重评分
  // (name-match-no-street 的 medium 升 high, 可写回; 与命中时同口径 —
  // 精确候选整名 POI 传 variantQuery 两级评分, 不被裸公司名误拒); 补查失败
  // → 保持原置信度 (medium 不写回)。backfillAddressFromRegeo 返回拷贝, 不
  // 突变 memo 缓存里的 POI。override / 地址检索路径 (地址文本已真实) 不参与。
  if (finalRe && !addressGeocode) {
    const bf = backfillAddressFromRegeo(poi, finalRe.formattedAddress, query, target, variantQuery ?? undefined);
    if (bf) {
      poi = bf.poi;
      confidence = bf.confidence;
      reason = bf.reason;
    }
  }

  const district = poi.adname || verified.split(' ').pop() || '';
  let address = district && !poi.address.includes(district) ? `${district}${poi.address}` : poi.address;
  // 回填保障 (2026-08-21): 无地址站点的 resolution 里 address 非空 — 极少数
  // 情况下 POI 无地址、无格式化地址时, 最后用 verified 文本 (城市+区, 已过
  // regeo 城市闸门) 兜底。
  if (!address.trim()) address = verified === 'unverified' ? poi.address : verified;

  resolutions.push({ slug, siteId: site.id, company: company.name, query, city: target.city, poi: { name: poi.name, address, lng: round(poi.lng), lat: round(poi.lat) }, confidence, reason, verified, provider, variant });
  recordOutcome(null); // 解析成功冲掉配额窗口 — 配额不是卡点, 不误停
  if (!DRY_RUN && (confidence === 'high' || override)) {
    if (setSiteLocation(file, slug, site.id, { address, lng: round(poi.lng), lat: round(poi.lat) })) {
      applied.push({ slug, siteId: site.id, address, lng: round(poi.lng), lat: round(poi.lat) });
    }
  }
}

// --- report -----------------------------------------------------------------
console.log(`\nAMAP_WEB_KEY: ${env.AMAP_WEB_KEY ? 'set' : 'MISSING'} | BAIDU_MAP_AK: ${env.BAIDU_MAP_AK ? 'set' : 'MISSING'} | TENCENT_MAP_KEY: ${env.TENCENT_MAP_KEY ? 'set' : 'MISSING'} | mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'APPLY'}`);
console.log(formatGeocodeProviderReport());
console.log(`Sites needing a point: ${planTotal} (attempted: ${planCount}) | skipped (not-in-only-list): ${skipped.filter((s) => s.reason === 'not-in-only-list').length} | city-not-in-list: ${skipped.filter((s) => s.reason.startsWith('city-not-in-list')).length} | override-city-mismatch: ${skipped.filter((s) => s.reason === 'override-city-mismatch').length}`);
console.log(`Resolved: ${resolutions.length} | unresolved: ${unresolved.length}`);
console.log('\n=== RESOLVED ===');
for (const r of resolutions) {
  console.log(
    `${String(r.confidence).padEnd(6)} ${r.slug.padEnd(26)} ${String(r.city).padEnd(6)} ${r.poi.name.padEnd(26)} ${r.poi.address.padEnd(32)} ${r.poi.lng},${r.poi.lat} [${r.reason}/${r.provider}${r.variant ? `/${r.variant}` : ''}] regeo=${r.verified}`,
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

// --- 跨日进度记录 + 下次续跑指引 (2026-08-23, ws-c) ---------------------------
// 运行结束时写 server/.geocode-progress.json (gitignore): 运行时间/计数/配额
// 标记/按城市分组的剩余清单。剩余 = 预扫 needing − 本次 applied — 写回坐标的
// 站点明天由 siteNeedsGeocode 幂等跳过; unresolved/skipped 仍待重试, 计入剩余。
const appliedKeys = new Set(applied.map((a) => `${a.slug}:${a.siteId}`));
const remainingByCity = buildRemainingByCity(needing, appliedKeys);
const remainingTotal = remainingByCity.reduce((s, c) => s + c.count, 0);
const progressRecord = {
  version: 1,
  updatedAt: new Date().toISOString(),
  mode: DRY_RUN ? 'DRY-RUN' : 'APPLY',
  flags: { only: ONLY, cities: CITIES },
  run: {
    planTotal,
    attempted: planCount,
    resolved: resolutions.length,
    unresolved: unresolved.length,
    applied: applied.length,
    skippedTotal: skipped.length,
    quotaExhausted: shortCircuited,
    // 未尝试量 (短路前剩余) — 与下方 QUOTA_EXHAUSTED 行的 remaining 同口径。
    untouched: planTotal - resolutions.length - unresolved.length - skipped.length,
  },
  remaining: { total: remainingTotal, byCity: remainingByCity },
};
fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progressRecord, null, 2) + '\n');

console.log(`\n=== 进度已记录 (${PROGRESS_FILE}, 仅报告/排程辅助, 不参与判定) ===`);
console.log(`剩余 ${remainingTotal} 站 (按城市): ${formatTopCities(remainingByCity)}`);
printQuotaFacts();
if (remainingTotal > 0) {
  const next = remainingByCity[0];
  console.log(`单城跑法: npm run geocode:sites:apply -- --cities ${next.city}   (每日封装: npm run geocode:sites:daily -- --cities ${next.city})`);
} else {
  console.log('无剩余站点 — 本轮 geocode 全部完成。');
}

// 配额耗尽 → 提前停止 (REPORT 已按正常收尾同款打印): 醒目说明 + 剩余站数 +
// 非零退出码 (exit 2)。已写入的站点保留 — 重跑时 siteNeedsGeocode 跳过有坐标
// 站点, 幂等。剩余数用预扫的 planTotal 算真实全量 (2026-08-21,
// fix/geocode-plan-count): planCount 停在短路点 (如 5) 会误导,
// planTotal - resolutions - unresolved - skipped 才是「待下次运行」真实剩余。
if (shortCircuited) {
  const remaining = planTotal - resolutions.length - unresolved.length - skipped.length;
  console.log(`\nQUOTA_EXHAUSTED: AMap+百度+腾讯 配额耗尽(或无可用 key),已提前停止,剩余 ${remaining} 站待下次运行。`);
  process.exit(2);
}
