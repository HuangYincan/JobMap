// Plan (and optionally apply) office-site geocodes.
// Seed already ships Hangzhou coords. This is for imported rows / future
// adapters that only have an address. Live AMap REST waits on AMAP_WEB_KEY
// (Web 服务 key, not the JS key); Tencent WebService (TENCENT_MAP_KEY) is the
// third-level fallback behind Baidu. Never print any of those keys.

import { getPool } from './db.ts';
import { cityProvinceOf } from './recruitment-adapters/official-site-parse.ts';
import { CITY_CENTERS, OVERSEAS_CITY_KEYS, bareCityName } from './city-centers.ts';
import type { CompanySite, POILocation } from './types.ts';
import type { SourceCompany } from './recruitment-source.ts';

export interface GeocodeNeed {
  slug: string;
  companyName: string;
  siteId: string;
  siteName: string;
  query: string;
  city: string;
}

export interface GeocodeHit {
  query: string;
  location: POILocation;
}

export interface GeocodePlan {
  needs: GeocodeNeed[];
  alreadyLocated: number;
  skippedNoAddress: number;
}

export function siteNeedsGeocode(site: CompanySite): boolean {
  const loc = site.location;
  if (!loc) return true;
  const { lng, lat } = loc;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return true;
  if (lng === 0 && lat === 0) return true;
  // 2026-08-22 (fix/geocode-citycenter-rerun): 坐标钉在城市中心 (city-centers
  // 批次历史落点) 且地址已非城市名 (w2/w4 回填的街道地址 / 城市列表占位) →
  // 需要重新 geocode; 地址仍是城市名 (占位) → 留在中心。
  if (matchesCityCenter(lng, lat)) {
    const address = loc.address?.trim();
    if (address && !isCityNameAddress(address, (site as SiteWithCity).city, cityCenterBareNames(lng, lat))) return true;
  }
  return false;
}

/**
 * 缺坐标站点全量收集 (2026-08-21, fix/geocode-plan-count)。
 * geocode-sites-apply.mjs 主循环前预扫用 — 统计真实 planTotal (所有
 * siteNeedsGeocode 的站点数, ONLY/CITIES 过滤前口径)。配额短路后 planCount
 * 停在短路点 ("Sites needing a point: 5" 误导, 实际 1783 个), 输出改用
 * planTotal 报真实全量; 真实剩余 = planTotal - resolutions - unresolved -
 * skipped。返回 (company, site) 引用供主循环复用, 避免预扫 + 主循环两次
 * JSON.parse。放在本模块 (而非脚本内) 是为了可单测 — 脚本顶层跑主循环 +
 * 真实网络, 无法 import; 与 shouldShortCircuitQuota 同模式。
 */
export interface NeedingSite {
  company: SourceCompany;
  site: CompanySite;
}

export function sitesNeedingGeocode(companies: ReadonlyArray<SourceCompany>): NeedingSite[] {
  const out: NeedingSite[] = [];
  for (const company of companies) {
    if (!company || typeof company.slug !== 'string') continue;
    for (const site of company.sites ?? []) {
      if (siteNeedsGeocode(site)) out.push({ company, site });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 城市中心假坐标重跑 (2026-08-22, fix/geocode-citycenter-rerun)。
// 背景: city-centers 批次把无坐标站点钉在城市中心 (上海 121.47/31.23 堆 376 站、
// 北京 327 …), 后续 w2/w4 回填了街道地址, 但旧 siteNeedsGeocode「有坐标即跳过」
// → apply 永不重跑 → 地图几百 POI 永久堆在同一中心点 (用户反馈)。扩展判定:
// 中心坐标 (±CITY_CENTER_EPS) + 地址非空且不是城市名 → 需要重新 geocode。
// 地址仍是城市名 (占位) 的站点留在中心。多城市串地址 (北京/上海/深圳/成都)
// 是城市列表占位、不是城市名 → 需要重新 geocode。
// ---------------------------------------------------------------------------

const CITY_CENTER_EPS = 0.0005;

/** 命中静态城市中心 (±CITY_CENTER_EPS) 的所有城市 bare 名 (同坐标多 key 去重). */
export function cityCenterBareNames(lng: number, lat: number): string[] {
  const names = new Set<string>();
  for (const [key, center] of Object.entries(CITY_CENTERS)) {
    if (Math.abs(lng - center.lng) <= CITY_CENTER_EPS && Math.abs(lat - center.lat) <= CITY_CENTER_EPS) {
      names.add(bareCityName(key));
    }
  }
  return [...names];
}

/** 坐标是否精确等于某个静态城市中心 (±CITY_CENTER_EPS)。 */
export function matchesCityCenter(lng: number, lat: number): boolean {
  return cityCenterBareNames(lng, lat).length > 0;
}

/** 省级名 (直辖市/自治区/特别行政区) — 「仅含城市名」地址剥掉城市后的残余判定。 */
const PROVINCE_BARE_RE =
  /^(?:北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)$/;

/** 剥掉城市 bare 名后, 残余只有 省/市/县/区 前后缀或省级名 → 仅含城市名。 */
function cityNameOnlyAddress(address: string, cityName: string): boolean {
  const bare = bareCityName(cityName);
  if (!bare || !address.includes(bare)) return false;
  const rest = address.replace(bare, '');
  const stripped = rest.replace(/^(?:省|市|县|区)+/, '').replace(/(?:省|市|县|区)+$/, '');
  return stripped === '' || PROVINCE_BARE_RE.test(stripped);
}

/**
 * 地址是否「城市名」形态 (留在城市中心的占位地址)。对照 site.city 与命中中心
 * 的城市名 (双保险: site.city 缺失/脏值时中心名兜底), 四种形态:
 *   1. address === site.city 原样 ('三亚市' === '三亚市')
 *   2. address === 「去市的 city」+ 市 (site.city='上海' → '上海市')
 *   3. address === 去「市」的 city (site.city='三亚市' → '三亚')
 *   4. 仅含城市名 — 剥掉城市 bare 名后残余只有 省/市/县/区 前后缀或省级名
 *      ('海南省三亚市' / '三亚市' / '三亚')。多城市串 (北京/上海/深圳/成都)
 *      不算城市名 — 是城市列表占位, 需要重新 geocode。
 */
export function isCityNameAddress(
  address: string | null | undefined,
  siteCity: string | null | undefined,
  centerNames: readonly string[] = [],
): boolean {
  const a = address?.trim() ?? '';
  if (!a) return false;
  const names = new Set<string>(centerNames);
  if (siteCity?.trim()) {
    names.add(siteCity.trim());
    const bare = bareCityName(siteCity);
    if (bare) names.add(bare);
  }
  if (!names.size) return false;
  for (const name of names) {
    if (a === name || a === `${name}市`) return true;
    if (cityNameOnlyAddress(a, name)) return true;
  }
  return false;
}

/**
 * WS1's types.ts lands `city` / `province` on CompanySite (national scope).
 * Read them defensively through a local intersection so this module is not
 * blocked on that file; sites without the fields fall back to 杭州.
 */
type SiteWithCity = CompanySite & { city?: string; province?: string };

export interface CityTarget {
  /** Full city name, e.g. 北京市 / 杭州市 — matches AMap regeo cityname. */
  city: string;
  /** Province/municipality name, e.g. 广东省 / 北京市 — matches AMap pname. */
  province: string;
}

export function siteCityTarget(site: CompanySite): CityTarget {
  const withCity = site as SiteWithCity;
  const city = withCity.city?.trim() || '杭州市';
  const province =
    withCity.province?.trim() ||
    // 2026-08-22 (fix/geocode-province-infer): qqdoc-jobs/qqdoc-official/embodied
    // 站 province 字段为空 → 旧默认「浙江省」, 上海/北京/广东/湖北等站 geocode
    // 命中后 regeo 校验 (落点省 vs target 省) 必拒 — 全量跑 492 unresolved 中
    // 332 个 outside-province。province 空时从 city 反查 CITY_TABLE 取真实省
    // (城市全称去「市」后缀作 key); 查不到 (海外/脏值) 回退现行为。
    cityProvinceOf(city) ||
    '浙江省';
  return { city, province };
}

export function geocodeQueryForSite(companyName: string, site: CompanySite): string {
  const address = site.location?.address?.trim();
  if (address) return `${address} ${companyName}`;
  const target = siteCityTarget(site);
  const hasOwnCity = !!((site as SiteWithCity).city ?? '').trim();
  // No city field → legacy Hangzhou drops → 杭州市 fallback (siteCityTarget default).
  return `${hasOwnCity ? target.city : '杭州市'} ${companyName} ${site.name}`.trim();
}

export function planSiteGeocode(companies: SourceCompany[]): GeocodePlan {
  const needs: GeocodeNeed[] = [];
  let alreadyLocated = 0;
  let skippedNoAddress = 0;
  for (const company of companies) {
    for (const site of company.sites) {
      if (!siteNeedsGeocode(site)) {
        alreadyLocated += 1;
        continue;
      }
      const address = site.location?.address?.trim();
      if (!address && !site.name) {
        skippedNoAddress += 1;
        continue;
      }
      const target = siteCityTarget(site);
      needs.push({
        slug: company.slug,
        companyName: company.name,
        siteId: site.id,
        siteName: site.name,
        query: geocodeQueryForSite(company.name, site),
        city: target.city,
      });
    }
  }
  return { needs, alreadyLocated, skippedNoAddress };
}

/** Copy-on-write: fill missing site coords from hits keyed by query. */
export function applyGeocodeHits(companies: SourceCompany[], hits: GeocodeHit[]): SourceCompany[] {
  const byQuery = new Map(hits.map((hit) => [hit.query, hit.location]));
  return companies.map((company) => ({
    ...company,
    sites: company.sites.map((site) => {
      if (!siteNeedsGeocode(site)) return site;
      const query = geocodeQueryForSite(company.name, site);
      const loc = byQuery.get(query);
      if (!loc) return site;
      return {
        ...site,
        location: {
          lng: loc.lng,
          lat: loc.lat,
          address: site.location?.address ?? loc.address,
        },
      };
    }),
  }));
}

export interface ImportedSiteNeed {
  id: string;
  companySlug: string;
  companyName: string;
  siteName: string;
  address: string | null;
  query: string;
}

/**
 * AMap geocode query for an imported site row (DB fallback path). Street
 * address wins; otherwise scope the company search to the row's own city
 * (site city from the drop, last-resort 杭州 for legacy city-less rows).
 */
export function importedSiteQuery(
  address: string | null,
  city: string | null,
  companyName: string,
  siteName: string,
): string {
  const trimmed = address?.trim();
  if (trimmed) return `${trimmed} ${companyName}`;
  return `${city?.trim() || '杭州'} ${companyName} ${siteName}`;
}

/** 城市中心 ±EPS 的 SQL 判定片段 (listImportedSitesNeedingGeocode 用, 与 JS 侧同口径). */
function cityCenterSqlCondition(): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const { lng, lat } of Object.values(CITY_CENTERS)) {
    const key = `${lng},${lat}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(`(ABS(s.lng - ${lng}) <= ${CITY_CENTER_EPS} AND ABS(s.lat - ${lat}) <= ${CITY_CENTER_EPS})`);
  }
  return parts.join(' OR ');
}

/**
 * Rows already in Postgres with no usable point. No pool → [].
 * 2026-08-22 (fix/geocode-citycenter-rerun): 中心假坐标行 (中心坐标 + 非空地址)
 * 也纳入候选 — 与 siteNeedsGeocode 新语义对齐; 地址仍是城市名的行在 JS 侧剔除
 * (留在中心合理)。纯静态常量拼 SQL, 无用户输入。
 */
export async function listImportedSitesNeedingGeocode(): Promise<ImportedSiteNeed[] | null> {
  const pool = getPool();
  if (!pool) return null;
  try {
    const { rows } = await pool.query<{
      id: string;
      company_slug: string;
      company_name: string;
      site_name: string;
      address: string | null;
      city: string | null;
      province: string | null;
      lng: string | null;
      lat: string | null;
    }>(
      `SELECT s.id::text, c.slug AS company_slug, c.name AS company_name,
              s.name AS site_name, s.address, s.city, s.province, s.lng, s.lat
         FROM company_sites s
         JOIN companies c ON c.id = s.company_id
        WHERE s.lng IS NULL OR s.lat IS NULL
           OR (s.lng = 0 AND s.lat = 0)
           OR (s.address IS NOT NULL AND btrim(s.address) <> ''
               AND (${cityCenterSqlCondition()}))`,
    );
    return rows
      .map((row) => ({
        id: row.id,
        companySlug: row.company_slug,
        companyName: row.company_name,
        siteName: row.site_name,
        address: row.address,
        city: row.city,
        province: row.province,
        lng: row.lng == null ? null : Number(row.lng),
        lat: row.lat == null ? null : Number(row.lat),
      }))
      .filter(
        (row) =>
          row.lng == null ||
          row.lat == null ||
          !matchesCityCenter(row.lng, row.lat) ||
          !isCityNameAddress(row.address, row.city, cityCenterBareNames(row.lng, row.lat)),
      )
      .map((row) => ({
        id: row.id,
        companySlug: row.companySlug,
        companyName: row.companyName,
        siteName: row.siteName,
        address: row.address,
        query: importedSiteQuery(row.address, row.city, row.companyName, row.siteName),
      }));
  } catch {
    return null;
  }
}

export function amapWebKey(): string | undefined {
  const key = process.env.AMAP_WEB_KEY?.trim();
  return key || undefined;
}

/** Baidu Web 服务 key (server/.env.local BAIDU_MAP_AK). Never printed. */
export function baiduWebKey(): string | undefined {
  const key = process.env.BAIDU_MAP_AK?.trim();
  return key || undefined;
}

/** Tencent WebService key (server/.env.local TENCENT_MAP_KEY). Never printed. */
export function tencentWebKey(): string | undefined {
  const key = process.env.TENCENT_MAP_KEY?.trim();
  return key || undefined;
}

// ---------------------------------------------------------------------------
// Geocode provider 只读注册表 (2026-08-21, feature/map-engine-backend).
// 只读配置面:脚本 REPORT(PROVIDERS 行)、配置校验、未来 UI 面板读取,不改
// fallbackChain 的固定顺序语义。注册表与上方 key getter 读同一 env
// (AMAP_WEB_KEY / BAIDU_MAP_AK / TENCENT_MAP_KEY,trim 后非空即 configured),
// 但**不共享实现**——两者一致性由 tests/geocode-providers.test.mjs 钉住
// (防注册表与链漂移),改 getter 或注册表任一侧都必须同步另一侧并跑该测试。
export interface GeocodeProviderInfo {
  id: 'amap' | 'baidu' | 'tencent';
  envVar: string;
  configured: boolean;
}

/** 按 fallbackChain 顺序 (AMap→百度→腾讯) 返回 provider 配置状态。 */
export function getGeocodeProviders(): GeocodeProviderInfo[] {
  return [
    { id: 'amap', envVar: 'AMAP_WEB_KEY', configured: amapWebKey() != null },
    { id: 'baidu', envVar: 'BAIDU_MAP_AK', configured: baiduWebKey() != null },
    { id: 'tencent', envVar: 'TENCENT_MAP_KEY', configured: tencentWebKey() != null },
  ];
}

/** 脚本 REPORT 一行输出:各 provider 配置状态 + 固定链顺序说明。 */
export function formatGeocodeProviderReport(): string {
  const flags = getGeocodeProviders()
    .map((p) => `${p.id}=${p.configured ? 'set' : 'missing'}`)
    .join(' ');
  return `PROVIDERS ${flags} | chain=AMap→Baidu→Tencent (skip no-key)`;
}

/**
 * AMap daily-quota / key-unusable detection. AMap reports these as
 * status="0" + infocode 10044 (USER_DAILY_QUERY_OVER_LIMIT) or 10043.
 * Callers use the flag to switch provider for the rest of a run.
 */
export function amapQuotaExhausted(payload: { status?: string; info?: string; infocode?: string }): boolean {
  if (payload.status === '1') return false;
  const info = payload.info ?? '';
  const infocode = payload.infocode ?? '';
  return info.includes('QUERY_OVER_LIMIT') || infocode.includes('10044') || infocode.includes('10043');
}

/**
 * Tencent daily-quota detection. Tencent reports errors as status≠0; the
 * current official status page lists 121 = 每日调用量上限, with the legacy
 * 321/322 family still seen in the wild — accept both. Final calibration
 * against a live key is a post-merge verification step (see
 * tech/roles/data/data-quality.md).
 */
const TENCENT_QUOTA_STATUSES = new Set(['121', '321', '322']);
export function tencentQuotaExhausted(payload: { status?: unknown }): boolean {
  return TENCENT_QUOTA_STATUSES.has(String(payload.status ?? ''));
}

// ---------------------------------------------------------------------------
// Quota short-circuit (2026-08-21, fix/geocode-quota-short-circuit).
// AMap place-text/geocode 日配额 (10044/10043) 与百度日配额 (status 302) 双耗尽
// 后, geocode-sites-apply.mjs 逐站空跑只烧时间零产出。执行链按「连续 N 个已尝试
// 站点全部配额类失败」提前停止。判定口径:
//   配额类  = quota (AMap 10044/10043 且无兜底) | baidu-status:302 (百度天配额
//             超限, 内部已重试一次仍 302) | tencent-status:121/321/322 (腾讯每日
//             调用量上限) | tencent-status:110/112/190/199/311 (key/IP/功能配置
//             永久失效 — 等同无兜底, 否则腾讯-only 空跑 1783 站; 311=key 格式
//             错误, 2026-08-21 真实探测校准) | no-key (全部 key 均缺)。
//   非配额类 = http/empty/parse (间歇性) | regeo-outside:* (有 POI 但城市不符,
//             证明配额不是卡点) | baidu-status:401 | tencent-status:120 (并发/
//             每秒限流, 可重试) | name-mismatch:* 等 grader 拒收 (接口有返回但
//             没命中)。
// ---------------------------------------------------------------------------

const QUOTA_CLASS_REASONS = new Set([
  'quota',
  'baidu-status:302',
  'tencent-status:121',
  'tencent-status:321',
  'tencent-status:322',
  'tencent-status:110',
  'tencent-status:112',
  'tencent-status:190',
  'tencent-status:199',
  // 311 = key 格式错误 — 永久配置失效 (2026-08-21 真实探测校准).
  'tencent-status:311',
  'no-key',
]);

/** 配额类失败判定。401 是并发限流不算;302 是百度天配额超限(重试后仍 302)算。 */
export function isQuotaClassReason(reason: string | null | undefined): boolean {
  return !!reason && QUOTA_CLASS_REASONS.has(reason);
}

/**
 * 双配额耗尽判定: 最近 n 个已尝试站点全部配额类失败 → true。
 * history 每站一条: unresolved 原因字符串 | null/undefined (已解析)。只取末 n 个
 * — 非配额类失败或成功解析都会冲掉窗口, 不会误停; 恢复后再次连续耗尽仍会触发。
 */
export function shouldShortCircuitQuota(history: ReadonlyArray<string | null | undefined>, n = 5): boolean {
  if (n <= 0) return false;
  const window = history.slice(-n);
  return window.length === n && window.every((r) => isQuotaClassReason(r));
}

// ---------------------------------------------------------------------------
// Place-search result memo (2026-08-21, fix/geocode-place-memo).
// AMap place-text 免费配额 100 次/天 — 同一公司同一城市的多个 office 站点
// (安克创新 38 站 / 元气森林 71 站 / 小鹏 52 站) 用相同 query+region 逐站重复
// 调用是结构性浪费。memo 只缓存成功命中 (poi 非空); 失败/空结果/配额类失败
// 绝不缓存 — 配额恢复后必须重新尝试, 缓存旧失败会永久卡死站点。key 精确到
// (query, province, city): 公司名相同但城市不同 → 不同 key, 不串。
// 该策略放在本模块 (而非 scripts/geocode-sites-apply.mjs 内) 是为了可单测 —
// 脚本顶层跑主循环 + 真实网络, 无法 import; 与 shouldShortCircuitQuota 同模式。
// ---------------------------------------------------------------------------

export interface PlaceSearchMemoHit {
  poi: OfficePoiCandidate;
  confidence: GeocodeConfidence;
  reason: string;
  provider: string;
}

/** Memo key: query + target (province, city) 精确绑定 — 城市不同不串。 */
export function placeSearchMemoKey(query: string, target: CityTarget): string {
  return `${query} ${target.province} ${target.city}`;
}

/**
 * 只缓存成功命中 (poi 非空)。失败/空结果/配额类失败 (poi: null) 绝不写入 —
 * 配额恢复后调用方必须重新尝试, 缓存旧失败会永久卡死站点。
 */
export function placeSearchMemoSet(
  memo: Map<string, PlaceSearchMemoHit>,
  key: string,
  hit: PlaceSearchMemoHit | null | undefined,
): void {
  if (hit?.poi) memo.set(key, hit);
}

// ---------------------------------------------------------------------------
// 多城市列表占位串判定 (2026-08-23, fix/poi-citylist-branch)。
// radar 快照无办公地址时用城市列表占位 ("北京/上海/厦门/深圳")。STREET_RE
// 含「门」→ "厦门" 命中 → siteHasStreetAddress 误判 true → 走地址检索分支
// (对城市列表串 no-result 白跑, 或命中目标城内任意点写非真实办公坐标, 见
// tech/29 §3.1)。「/」分隔且每段都是城市名 (bare 名, 可带「市」后缀) →
// 城市列表占位, 非街道地址; 任一段含街道特征 (路/街/号…) → 真实地址,
// 放行 STREET_RE 判定, 不误杀 ("文二西路/莲花街" 类交叉口地址)。
// ---------------------------------------------------------------------------

/** 城市 bare 名集合 (CITY_CENTERS 键去「省/市/区」后缀) — 占位串段判定用。 */
const CITY_CENTER_BARE_NAMES = new Set(Object.keys(CITY_CENTERS).map(bareCityName));

/** 地址是否多城市列表占位串 ("/" 分隔 ≥2 段, 每段都是城市 bare 名或「城市名+市」)。 */
export function isCityListPlaceholderAddress(address: string): boolean {
  const parts = address.split('/');
  if (parts.length < 2) return false;
  for (const part of parts) {
    if (!CITY_CENTER_BARE_NAMES.has(bareCityName(part.trim()))) return false;
  }
  return true;
}

/** A site whose address names a real street/building — geocodable as-is. */
export function siteHasStreetAddress(site: CompanySite): boolean {
  const address = site.location?.address?.trim();
  if (!address) return false;
  // 2026-08-23 (fix/poi-citylist-branch): 城市列表占位串优先于 STREET_RE —
  // "北京/上海/厦门/深圳" 是城市列表占位 (厦门含「门」会误命中 STREET_RE),
  // 必须走公司名检索分支而非地址检索分支。
  if (isCityListPlaceholderAddress(address)) return false;
  return STREET_RE.test(address);
}

/**
 * 命中 POI 的 address 是否「可用」— 非空且含街道/门牌 (空串或仅区名 → 视为
 * 缺失, 触发补查)。与 gradeOfficePoi 的 street 判定共用 STREET_RE, 口径一致。
 */
export function poiAddressUsable(address: string): boolean {
  const a = (address ?? '').trim();
  return !!a && STREET_RE.test(a);
}

// ---------------------------------------------------------------------------
// 无地址站点「上网找地址」优先通道 (2026-08-21, fix/geocode-address-first).
// 只带城市无地址的站点 (siteNeedsGeocode && location.address 缺失) 把网络检索
// 当首要通道: 站点名存在且不同于公司名/城市名时, 生成「公司名 站点名」精确
// 候选 (网易 杭州研究院), 精确候选未命中/地址缺失再回落裸公司名宽候选 (既有
// 行为, 同公司同城共享 memo)。每站点 place-text ≤ 2 次; memo 按变体 key
// (query, province, city) 独立缓存成功命中, 跨站点不重复消耗。
// ---------------------------------------------------------------------------

export interface AddresslessQueryVariant {
  /** 发送给 place-text 的检索串 (memo key 的一部分). */
  searchQuery: string;
  /** 评分用公司名 — 精确候选 query 含站点名, POI 名通常不含, 评分必须用裸公司名兜底. */
  gradeName: string;
  kind: 'precise' | 'broad';
}

/**
 * 无地址站点的检索变体 (先精确后宽)。宽候选恒在; 精确候选被跳过 (站点名缺失 /
 * 与公司名相同 / 只是城市名) 时返回 [宽] — 即既有单检索行为。站点名含公司名时
 * (网易杭州研究院) 精确候选直接以站点名检索 (更精确), 否则拼「公司名 站点名」。
 */
export function addresslessQueryVariants(
  companyQuery: string,
  siteName: string | null | undefined,
  target: CityTarget,
): AddresslessQueryVariant[] {
  const broad: AddresslessQueryVariant = { searchQuery: companyQuery, gradeName: companyQuery, kind: 'broad' };
  const name = siteName?.trim();
  if (!name) return [broad];
  const normName = normalizeNameForMatch(name);
  const normCompany = normalizeNameForMatch(companyQuery);
  if (!normName || !normCompany || normName === normCompany) return [broad];
  // 站点名只是城市名 (北京/北京市/杭州市 …) → 无定位信息, 跳过精确候选
  const normCity = normName.replace(/[省市县]$/, '');
  if (normCity === bareCity(target.city) || CITY_PREFIXES.has(normCity) || CITY_PREFIXES.has(normName)) return [broad];
  const searchQuery = normName.includes(normCompany) ? name : `${companyQuery} ${name}`;
  return [{ searchQuery, gradeName: companyQuery, kind: 'precise' }, broad];
}

export interface AddressBackfill {
  poi: OfficePoiCandidate;
  confidence: GeocodeConfidence;
  reason: string;
}

/**
 * 命中 POI 地址缺失/过短 (空串或仅区名) 时的 regeo 格式化地址兜底补查
 * (2026-08-21, fix/geocode-address-first)。坐标已过 regeo 城市闸门, 格式化
 * 地址出自坐标本身 → 必属目标城市, 无城市一致性风险; 零额外配额 (复用城市
 * 校验的那次 regeo)。补查成功 (地址含街道) → 重评分: name-match-no-street
 * 的 medium 升 high, 可写回; 补查失败 → 返回 null, 保持原 poi/置信度
 * (medium 不写回)。重评分与命中时同口径 (gradeVariantHit, searchQuery 缺省
 * = companyQuery 即单级公司名评分) — 精确候选命中 (整名 POI 如 网易杭州研究院)
 * 不会被裸公司名评分误拒。返回拷贝, 不突变 memo 缓存里的 POI 对象。
 */
export function backfillAddressFromRegeo(
  poi: OfficePoiCandidate,
  formattedAddress: string | null | undefined,
  companyQuery: string,
  target: CityTarget,
  searchQuery = companyQuery,
): AddressBackfill | null {
  if (poiAddressUsable(poi.address) || !formattedAddress?.trim()) return null;
  const filled: OfficePoiCandidate = { ...poi, address: formattedAddress.trim() };
  const grade = gradeVariantHit(filled, searchQuery, companyQuery, target.province, target.city);
  return { poi: filled, confidence: grade.confidence, reason: grade.reason };
}

// ---------------------------------------------------------------------------
// Address ↔ city consistency (2026-08-20, fix/geocode-address-strategy).
// fecef85 城市拆分时代, drops 的城市站点 (site-guangzhou / site-chengdu …) 的
// location.address 继承了杭州 office 的地址文本 ("西湖区莲花街333号…")。直接拿
// 该地址在目标城市做地址级 geocode 会城市内错配 (实测: 广州 "花都区西湖"
// 113.20/23.38 + 地址被污染), 而 regeo 省级校验拦不住 (pname 同省即过)。
// 因此地址检索前必须做地址-城市一致性检查; 命中不可信地址 → 跳过地址检索,
// 直接走公司名检索。未收录区名无法判定 → 放行, 由 regeo 区级校验兜底。
// ---------------------------------------------------------------------------

const ADDR_CITY_RE = /[一-龥]{2,8}?(?<!区|县)市/g;
const ADDR_DISTRICT_RE = /[一-龥]{2,8}?(?:区|县)/g;
/** 功能区/非正式区名 — geocoder 的 regeo adname 是底层行政区, 不具可比性. */
const FUNCTIONAL_DISTRICT_RE = /(新区|园区|开发区|高新区|示范区|试验区|科技园|产业园|软件园|保税区|自贸区|林区|矿区|高教区|自治区)$/;

/**
 * 城市 bare 名 (杭州市 → 杭州)。目标城市可能带 市/省 后缀或裸名, 统一比较。
 */
function bareCity(name: string): string {
  return name.replace(/[省市县]$/, '');
}

/** 城市名 token 归一: 切掉 省/区/县 前缀 ("广东省深圳市" → "深圳市"). */
function cutCityToken(token: string): string {
  const cut = Math.max(token.lastIndexOf('省'), token.lastIndexOf('区'), token.lastIndexOf('县'));
  return cut >= 0 ? token.slice(cut + 1) : token;
}

/** 区县名 token 归一: 切掉 省/市/县 前缀 ("广东省深圳市南山区" → "南山区"). */
function cutDistrictToken(token: string): string {
  const cut = Math.max(token.lastIndexOf('省'), token.lastIndexOf('市'), token.lastIndexOf('县'));
  return cut >= 0 ? token.slice(cut + 1) : token;
}

/**
 * 已知区县/功能区 → 所属城市 (bare 名)。覆盖 drop 数据实际出现的区县 +
 * 主要目标城市, 用于判定「地址文本中的区名不属于目标城市」。同名区县可属
 * 多个城市 (西湖区: 杭州/南昌; 朝阳区: 北京/长春)。未收录的区名 → 放行,
 * 由 regeo 区级校验 (addressConflictsWithRegeoDistrict) 兜底。
 */
export const CITY_DISTRICTS: Record<string, readonly string[]> = {
  杭州: ['上城区', '拱墅区', '西湖区', '滨江区', '萧山区', '余杭区', '临平区', '钱塘区', '富阳区', '临安区', '桐庐县', '淳安县', '建德市'],
  北京: ['东城区', '西城区', '朝阳区', '海淀区', '丰台区', '石景山区', '门头沟区', '房山区', '通州区', '顺义区', '昌平区', '大兴区', '怀柔区', '平谷区', '密云区', '延庆区'],
  上海: ['黄浦区', '徐汇区', '长宁区', '静安区', '普陀区', '虹口区', '杨浦区', '闵行区', '宝山区', '嘉定区', '浦东新区', '金山区', '松江区', '青浦区', '奉贤区', '崇明区'],
  广州: ['越秀区', '海珠区', '荔湾区', '天河区', '白云区', '黄埔区', '番禺区', '花都区', '南沙区', '从化区', '增城区'],
  深圳: ['罗湖区', '福田区', '南山区', '宝安区', '龙岗区', '盐田区', '龙华区', '坪山区', '光明区', '大鹏新区'],
  成都: ['锦江区', '青羊区', '金牛区', '武侯区', '成华区', '龙泉驿区', '青白江区', '新都区', '温江区', '双流区', '郫都区', '新津区', '都江堰市', '彭州市', '邛崃市', '崇州市', '简阳市', '金堂县', '大邑县', '蒲江县', '高新区', '天府新区'],
  武汉: ['江岸区', '江汉区', '硚口区', '汉阳区', '武昌区', '青山区', '洪山区', '东西湖区', '汉南区', '蔡甸区', '江夏区', '黄陂区', '新洲区'],
  南京: ['玄武区', '秦淮区', '建邺区', '鼓楼区', '浦口区', '栖霞区', '雨花台区', '江宁区', '六合区', '溧水区', '高淳区', '江北新区'],
  苏州: ['姑苏区', '虎丘区', '吴中区', '相城区', '吴江区', '昆山市', '常熟市', '张家港市', '太仓市', '工业园区', '高新区'],
  西安: ['新城区', '碑林区', '莲湖区', '灞桥区', '未央区', '雁塔区', '阎良区', '临潼区', '长安区', '高陵区', '鄠邑区', '蓝田县', '周至县', '高新区', '曲江新区', '西咸新区'],
  珠海: ['香洲区', '斗门区', '金湾区', '横琴新区', '高新区'],
  南昌: ['东湖区', '西湖区', '青云谱区', '青山湖区', '新建区', '红谷滩区', '红谷滩新区', '南昌县', '高新区'],
  宁波: ['海曙区', '江北区', '北仑区', '镇海区', '鄞州区', '奉化区', '余姚市', '慈溪市', '象山县', '宁海县'],
  合肥: ['瑶海区', '庐阳区', '蜀山区', '包河区', '长丰县', '肥东县', '肥西县', '庐江县', '巢湖市', '高新区', '经开区'],
  石家庄: ['长安区', '桥西区', '新华区', '裕华区', '藁城区', '鹿泉区', '栾城区', '正定县', '高新区'],
  长沙: ['芙蓉区', '天心区', '岳麓区', '开福区', '雨花区', '望城区', '长沙县', '浏阳市', '宁乡市', '高新区', '经开区'],
  郑州: ['中原区', '二七区', '管城回族区', '金水区', '惠济区', '上街区', '中牟县', '巩义市', '荥阳市', '新密市', '新郑市', '登封市', '高新区', '经开区'],
  青岛: ['市南区', '市北区', '李沧区', '崂山区', '城阳区', '即墨区', '黄岛区', '胶州市', '平度市', '莱西市'],
  太原: ['小店区', '迎泽区', '杏花岭区', '尖草坪区', '万柏林区', '晋源区', '清徐县', '阳曲县', '娄烦县'],
  兰州: ['城关区', '七里河区', '西固区', '安宁区', '红古区', '永登县', '皋兰县', '榆中县'],
  拉萨: ['城关区', '堆龙德庆区', '达孜区'],
  呼和浩特: ['新城区', '回民区', '玉泉区', '赛罕区', '土默特左旗', '托克托县'],
  西宁: ['城东区', '城中区', '城西区', '城北区', '湟中区'],
  无锡: ['锡山区', '惠山区', '滨湖区', '梁溪区', '新吴区', '江阴市', '宜兴市'],
  肇庆: ['端州区', '鼎湖区', '高要区', '广宁县', '四会市'],
  常州: ['天宁区', '钟楼区', '新北区', '武进区', '金坛区', '溧阳市'],
  重庆: ['渝中区', '江北区', '南岸区', '九龙坡区', '沙坪坝区', '大渡口区', '北碚区', '渝北区', '巴南区', '两江新区', '高新区'],
  天津: ['和平区', '河东区', '河西区', '南开区', '河北区', '红桥区', '东丽区', '西青区', '津南区', '北辰区', '武清区', '宝坻区', '滨海新区', '宁河区', '静海区', '蓟州区', '经开区'],
  六安: ['金安区', '裕安区', '叶集区', '舒城县'],
  淮北: ['相山区', '杜集区', '烈山区', '濉溪县'],
  安庆: ['迎江区', '大观区', '宜秀区', '怀宁县', '潜山市', '太湖县', '桐城市'],
  九江: ['浔阳区', '濂溪区', '柴桑区', '武宁县', '修水县', '永修县', '彭泽县', '经开区'],
  湖州: ['吴兴区', '南浔区', '德清县', '长兴县', '安吉县'],
  温州: ['鹿城区', '龙湾区', '瓯海区', '洞头区', '瑞安市', '乐清市', '永嘉县', '平阳县'],
  金华: ['婺城区', '金东区', '义乌市', '东阳市', '永康市', '兰溪市', '浦江县'],
  台州: ['椒江区', '黄岩区', '路桥区', '温岭市', '临海市', '玉环市', '天台县', '仙居县', '三门县'],
  厦门: ['思明区', '湖里区', '集美区', '海沧区', '同安区', '翔安区'],
  福州: ['鼓楼区', '台江区', '仓山区', '晋安区', '马尾区', '长乐区', '闽侯县'],
  南宁: ['兴宁区', '青秀区', '江南区', '西乡塘区', '良庆区', '邕宁区', '武鸣区'],
  丽水: ['莲都区', '青田县'],
  南充: ['顺庆区', '高坪区', '嘉陵区'],
  宜宾: ['翠屏区', '南溪区', '叙州区'],
  眉山: ['东坡区', '彭山区'],
  衡水: ['桃城区', '冀州区', '深州市'],
  咸宁: ['咸安区', '赤壁市'],
  保定: ['竞秀区', '莲池区', '满城区', '清苑区', '徐水区'],
  宝鸡: ['渭滨区', '金台区', '陈仓区', '凤翔区'],
  阳江: ['江城区', '阳东区', '阳西县'],
  韶关: ['武江区', '浈江区', '曲江区'],
  茂名: ['茂南区', '电白区', '高新区'],
  鄂尔多斯: ['东胜区', '康巴什区'],
};

const CITY_DISTRICT_INDEX = new Map<string, string[]>();
for (const [city, districts] of Object.entries(CITY_DISTRICTS)) {
  for (const district of districts) {
    const list = CITY_DISTRICT_INDEX.get(district) ?? [];
    list.push(city);
    CITY_DISTRICT_INDEX.set(district, list);
  }
}

/**
 * 地址-城市一致性判定。地址文本中出现「不属于目标城市的已知城市/区县」→
 * 地址不可信 (如 奇安信 drops 的 site-guangzhou 继承了杭州 "西湖区莲花街"),
 * 返回 true, 调用方应跳过地址检索、直接走公司名检索。无法判定 (未收录
 * 区名 / 地址无区县) → 返回 false 放行, 由 regeo 区级校验兜底。
 */
export function addressConflictsWithCity(address: string, city: string): boolean {
  const bare = bareCity(city.trim());
  for (const m of address.matchAll(ADDR_CITY_RE)) {
    const name = bareCity(cutCityToken(m[0]));
    if (name && name !== bare && Object.hasOwn(CITY_DISTRICTS, name)) return true;
  }
  for (const m of address.matchAll(ADDR_DISTRICT_RE)) {
    const district = cutDistrictToken(m[0]);
    const cities = CITY_DISTRICT_INDEX.get(district);
    if (cities && !cities.includes(bare)) return true;
  }
  return false;
}

/**
 * regeo 区级校验 (地址检索命中后的第二道闸)。地址文本区名与 geocoder 落点
 * 所在区 (adname) 不一致 → 坐标不可信, 调用方回退公司名检索。仅比对「未收录
 * 区名」—— 已收录区名的归属由 addressConflictsWithCity 前置把关, 行政区边界
 * 附近的 geocode 落点可能落在邻区 (adname 模糊), 不具可比性; 功能区名
 * (高新区/园区/新区 等) 的 regeo adname 是底层行政区, 同样跳过。
 */
export function addressConflictsWithRegeoDistrict(address: string, adname: string): boolean {
  if (!adname) return false;
  for (const m of address.matchAll(ADDR_DISTRICT_RE)) {
    const district = cutDistrictToken(m[0]);
    if (district.length < 3 || district.length > 6) continue; // 行政区名 2-5 汉字+后缀
    if (FUNCTIONAL_DISTRICT_RE.test(district)) continue;
    if (CITY_DISTRICT_INDEX.has(district)) continue;
    if (district !== adname) return true;
  }
  return false;
}

export interface RestGeocodeResult {
  ok: boolean;
  location?: POILocation;
  reason?: 'no-key' | 'http' | 'empty' | 'parse' | 'quota' | `baidu-status:${number}` | `tencent-status:${number}`;
  /** AMap unusable (no key / daily quota exhausted) — result may come from Baidu or Tencent. */
  amapUnavailable?: boolean;
  provider?: 'amap' | 'baidu' | 'tencent';
}

/**
 * 三级兜底链 (2026-08-21, feature/geocode-tencent)。
 * 语义: 高德不可用 (无 key / 10044 配额耗尽) 时先试百度; 百度任何失败
 * (no-key / baidu-status:* / http / empty / parse — 内部 302/401 已重试过的
 * 终态) 再试腾讯。最终 reason 归属最后一次实际尝试的 provider; 两兜底 key
 * 都缺时返回 noFallback 构造的失败 (调用方注入 'no-key' 或 'quota')。
 */
async function fallbackChain<T extends { ok: boolean }>(
  makeBaidu: () => Promise<T>,
  makeTencent: () => Promise<T>,
  noFallback: () => T,
): Promise<T & { amapUnavailable?: boolean }> {
  if (baiduWebKey()) {
    const b = await makeBaidu();
    if (b.ok || !tencentWebKey()) return { ...b, amapUnavailable: true };
  }
  if (!tencentWebKey()) return noFallback();
  const t = await makeTencent();
  return { ...t, amapUnavailable: true };
}

/**
 * Optional Web 服务 geocode. Missing AMAP_WEB_KEY → no-op (Baidu → Tencent
 * fallback when those keys are present). Caller must not log the key. QPS
 * stays ≤3/s for AMap and ~2/s for Baidu / ~5/s for Tencent (sleep ≥600ms for
 * Baidu, ≥340ms otherwise) at the call site.
 */
export async function geocodeAddressRest(
  query: string,
  city = '杭州',
  fetchImpl: typeof fetch = fetch,
): Promise<RestGeocodeResult> {
  const key = amapWebKey();
  if (!key) {
    // No AMap key — Baidu → Tencent become the providers (all GCJ-02).
    return fallbackChain(
      () => baiduGeocodeAddressRest(query, city, fetchImpl),
      () => tencentGeocodeAddressRest(query, city, fetchImpl),
      () => ({ ok: false, reason: 'no-key' } as RestGeocodeResult),
    );
  }
  const url = new URL('https://restapi.amap.com/v3/geocode/geo');
  url.searchParams.set('address', query);
  url.searchParams.set('city', city);
  url.searchParams.set('output', 'JSON');
  url.searchParams.set('key', key);
  let payload: { status?: string; info?: string; infocode?: string; geocodes?: Array<{ location?: string }> };
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return { ok: false, reason: 'http' };
    payload = (await res.json()) as typeof payload;
  } catch {
    return { ok: false, reason: 'http' };
  }
  const down = amapQuotaExhausted(payload);
  if (down) {
    return fallbackChain(
      () => baiduGeocodeAddressRest(query, city, fetchImpl),
      () => tencentGeocodeAddressRest(query, city, fetchImpl),
      () => ({ ok: false, reason: 'quota', amapUnavailable: true } as RestGeocodeResult),
    );
  }
  const raw = payload.geocodes?.[0]?.location;
  if (payload.status !== '1' || !raw || typeof raw !== 'string') {
    return { ok: false, reason: down ? 'quota' : 'empty', amapUnavailable: down };
  }
  const [lngRaw, latRaw] = raw.split(',');
  const lng = Number(lngRaw);
  const lat = Number(latRaw);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return { ok: false, reason: 'parse' };
  return { ok: true, provider: 'amap', location: { lng, lat, address: query } };
}

// ---------------------------------------------------------------------------
// Office discovery via AMap place-text search (Web 服务, same AMAP_WEB_KEY).
// Used to give city-list-only radar sites a real Hangzhou office + street
// address instead of pinning a company at a city center. Callers throttle QPS.
// ---------------------------------------------------------------------------

/** Known aliases: radar snapshot names → the name AMap/Baidu actually knows. */
export const COMPANY_QUERY_ALIASES: Record<string, string> = {
  认养: '认养一头牛',
  财通证劵: '财通证券',
  字节跳动Seed大模型: '字节跳动',
  淘天集团: '淘天集团',
  商汤科技: '商汤科技',
  阿里淘天: '淘天集团',
  // 2026-08-19 上海试点: radar 快照名 ≠ POI 名 (法律实体/品牌形态), 需先过别名
  // 才能命中; grader 按别名后的名字评分 (中微公司 → 中微半导体设备(上海)股份有限公司).
  中微公司: '中微半导体设备',
  联影集团: '联影医疗',
  携程集团: '携程国际',
  拼多多: '上海寻梦信息技术',
  乐鑫科技: '乐鑫信息科技',
};

/** Baidu 间歇性限流 (302 日配额误报 / 401 并发) — 重试一次, 间隔 1.5s. */
const BAIDU_TRANSIENT_STATUS = new Set(['302', '401']);
const BAIDU_RETRY_SLEEP_MS = 1500;

function isTransientBaiduStatus(reason: string | undefined): boolean {
  if (!reason?.startsWith('baidu-status:')) return false;
  return BAIDU_TRANSIENT_STATUS.has(reason.slice('baidu-status:'.length));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const BRACKET_SEG_RE = /[（(【\[「][^）)】\]」]*[）)】\]」]/g;
const RECRUIT_TAIL_RE = /(校园招聘|人才招聘|实习生招聘|校招|秋招|春招|社招|招聘|实习生)$/g;
const LEGAL_FORM_RE = /(股份有限公司|有限责任公司|有限公司)/g;

/** Turn a display name into a place-search query (decor stripped, aliased). */
export function cleanCompanySearchName(name: string): string {
  const aliased = COMPANY_QUERY_ALIASES[name.trim()] ?? name;
  return aliased
    .replace(BRACKET_SEG_RE, '')
    .replace(RECRUIT_TAIL_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Names compared on the same normalized surface; legal forms never block a match. */
export function normalizeNameForMatch(name: string): string {
  return cleanCompanySearchName(name)
    .replace(LEGAL_FORM_RE, '')
    .toLowerCase()
    .replace(/\s+/g, '');
}

// --- office-name match strength ---------------------------------------------
// 2026-08-19: Baidu place search 返回大量同品牌陷阱(门店/驿站/同名工厂)。
// 候选名只能以「限定词」认领公司名: 城市前缀 / 品牌拼音 / 总部·分公司·大厦·
// 科技·公司 等。"得物" ⊂ "广州得物包装实业有限公司" 不是匹配; "上海燧原科技"
// 匹配 "燧原科技"。括号段(门店指示)必须呈办公形态, 带 店/站/驿站 拒收。
// 2026-08-22 (fix/grader-seq-relax): 单个限定词 token 放宽为「限定词 token 序列」—
// 集合内 token 可拼接 (研发大厦 = 研发+大厦; 杭州研究院 = 杭州+研究院; 科技公司 =
// 科技+公司)。旧规则只认整段在集合内, 「百度研发大厦」类真实办公室 POI 被误拒
// (r4 apply 831 站 no-result 主因)。整段仍必须完全由集合 token 组成 — 非限定词
// token (包装/实业/造型/鱼庄/驿站/店/站/旗舰店…) 混入 → 整段拒绝, 防线不变。

const QUALIFIER_SUFFIXES = new Set([
  '总部', '运营总部', '分公司', '子公司', '研发', '研究院', '办公', '大楼', '大厦', '广场',
  '园区', '基地', '公司', '集团', '科技', '学院', '学校', '大学',
]);
const CITY_PREFIXES = new Set([
  '北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '苏州', '宁波', '南京', '天津', '重庆',
  '西安', '长沙', '青岛', '济南', '厦门', '福州', '合肥', '郑州', '沈阳', '大连', '东莞', '佛山',
  '珠海', '无锡', '常州', '嘉兴', '温州', '金华', '绍兴', '台州', '香港', '澳门',
]);
const ROMAN_PREFIX_RE = /^[a-z]{2,}$/;
// 允许表语义: 不在表内即拒 — 分店/旗舰店/体验店/站/驿站 括号段无需显式排除.
// 2026-08-22 (fix/grader-seq-relax): 增加 分公司/公司/科技/研发/基地/大楼/学校.
const GOOD_BRACKET_SEG_RE = /(号楼|大厦|中心|园区|广场|总部|办公|研究院|大学|学院|医院|产业园|科技园|软件园|创业园|世界城|金融城|天地|分公司|公司|科技|研发|基地|大楼|学校)$/;

/** 限定词 token 最长长度 (序列拆解用, 最长 token 优先). */
const MAX_QUALIFIER_TOKEN_LEN = 4;

/** 城市名 token 长度 (2 字城市名, 可带 省/市 后缀 → 最长 3); 0 = 非城市 token. */
function cityTokenLen(text: string): number {
  if (text.length >= 3 && CITY_PREFIXES.has(text.slice(0, 3).replace(/[省市]$/, ''))) return 3;
  if (text.length >= 2 && CITY_PREFIXES.has(text.slice(0, 2))) return 2;
  return 0;
}

/**
 * 限定词前缀 token 序列 (2026-08-22, fix/grader-seq-relax): 整段完全由城市名
 * token (可带 省/市 后缀) + 品牌拼音 token (连续 ≥2 位小写字母, ROMAN_PREFIX_RE
 * 语义) 拼接而成; 任一其他 token → false。线性贪心拼接, 超长串不递归不崩。
 */
function isQualifierPrefixSeq(text: string): boolean {
  let rest = text;
  while (rest.length > 0) {
    const roman = /^[a-z]+/.exec(rest);
    if (roman) {
      if (!ROMAN_PREFIX_RE.test(roman[0])) return false;
      rest = rest.slice(roman[0].length);
      continue;
    }
    const len = cityTokenLen(rest);
    if (!len) return false;
    rest = rest.slice(len);
  }
  return true;
}

/**
 * 限定词后缀 token 序列 (2026-08-22, fix/grader-seq-relax): 整段完全由
 * QUALIFIER_SUFFIXES token + 城市名 token (快手北京 类分支命名) 拼接而成。
 * 最长 token 优先 — 「研发大厦」拆 研发|大厦 而非 研发大|厦 (集合内无 研发大);
 * 研究院/运营总部 等长 token 优先整段命中; 非限定词 token 混入 → false。
 */
function isQualifierSuffixSeq(text: string): boolean {
  let rest = text;
  while (rest.length > 0) {
    let len = 0;
    for (let n = Math.min(MAX_QUALIFIER_TOKEN_LEN, rest.length); n >= 1; n--) {
      if (QUALIFIER_SUFFIXES.has(rest.slice(0, n))) {
        len = n;
        break;
      }
    }
    if (!len) len = cityTokenLen(rest);
    if (!len) return false;
    rest = rest.slice(len);
  }
  return true;
}

function candidateBracketSegments(name: string): string[] {
  const segments: string[] = [];
  for (const m of name.matchAll(/[（(【\[「][^）)】\]」]*[）)】\]」]/g)) {
    segments.push(m[0].slice(1, -1));
  }
  return segments;
}

/** 'strong' iff the candidate name claims `companyName` with only qualifier tokens. */
export function officeNameMatchStrength(candidateName: string, companyName: string): 'strong' | 'no' {
  const q = normalizeNameForMatch(companyName);
  const c = normalizeNameForMatch(candidateName);
  if (!q || !c || !c.includes(q)) return 'no';
  // 每侧为空或「全限定词 token 序列」; 组合须至少一边非空且全限定词, 但
  // 精确同名 (两侧皆空) 是最强认领, 保持既有行为 (得物=得物 / 快手(星耀中心
  // 7号楼)=快手 自 2026-08-19 起均 strong; 收紧只增假阴性).
  const matches = (prefix: string, suffix: string) =>
    (prefix === '' && suffix === '') ||
    (prefix === '' && isQualifierSuffixSeq(suffix)) ||
    (suffix === '' && isQualifierPrefixSeq(prefix)) ||
    (isQualifierPrefixSeq(prefix) && isQualifierSuffixSeq(suffix));
  let strong = false;
  for (let i = 0; i + q.length <= c.length; i++) {
    if (c.slice(i, i + q.length) !== q) continue;
    if (matches(c.slice(0, i), c.slice(i + q.length))) {
      strong = true;
      break;
    }
  }
  if (!strong) return 'no';
  for (const seg of candidateBracketSegments(candidateName)) {
    if (!GOOD_BRACKET_SEG_RE.test(seg)) return 'no';
  }
  return 'strong';
}

export interface OfficePoiCandidate {
  name: string;
  address: string;
  lng: number;
  lat: number;
  type: string;
  adname: string;
  pname: string;
  cityname: string;
}

export type GeocodeConfidence = 'high' | 'medium' | 'low';

export interface GeocodeResolution {
  slug: string;
  siteId: string;
  query: string;
  poi?: OfficePoiCandidate;
  confidence: GeocodeConfidence;
  reason: string;
}

// A "street" address carries a road / building / number — a bare district
// ("滨江区") is not enough to claim a real office.
const STREET_RE = /(路|街|号|大厦|园|城|座|巷|里|弄|桥|门|广场|中心|板块|大道)|\d/;
const OFFICE_TYPE_RE = /^(公司企业|商务|科教|金融保险)/;

export function parseOfficePoi(raw: Record<string, unknown>): OfficePoiCandidate | null {
  const loc = typeof raw.location === 'string' ? raw.location.split(',') : [];
  const lng = Number(loc[0]);
  const lat = Number(loc[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return {
    name: String(raw.name ?? ''),
    address: String(raw.address ?? ''),
    lng,
    lat,
    type: String(raw.type ?? ''),
    adname: String(raw.adname ?? ''),
    pname: String(raw.pname ?? ''),
    cityname: String(raw.cityname ?? ''),
  };
}

/**
 * Grade a candidate as a plausible office of `companyName` in the target
 * province/city. Defaults keep the Hangzhou behavior for sites without a
 * city field; multi-city drops pass the site's own province/city.
 */
export function gradeOfficePoi(
  poi: OfficePoiCandidate,
  companyName: string,
  province = '浙江省',
  city = '杭州市',
): { confidence: GeocodeConfidence; reason: string } {
  if (poi.pname && poi.pname !== province) return { confidence: 'low', reason: `outside-province:${poi.pname}` };
  if (poi.cityname && poi.cityname !== city) return { confidence: 'low', reason: `outside-city:${poi.cityname}` };
  const match = officeNameMatchStrength(poi.name, companyName) === 'strong';
  const street = STREET_RE.test(poi.address);
  if (!match) return { confidence: 'low', reason: `name-mismatch:${poi.name}` };
  if (!street) return { confidence: 'medium', reason: 'name-match-no-street' };
  return { confidence: 'high', reason: `matched:${poi.name}` };
}

/**
 * 变体命中的两级评分 (2026-08-21, fix/geocode-address-first): 精确候选
 * 「公司名 站点名」搜到的 POI 常以完整名命名 (网易杭州研究院) — 先按完整
 * searchQuery 评分 (整名命中 → 精确可信), 被拒 (如 POI 是 网易大厦 通用形态)
 * 再回落公司名评分。searchQuery === gradeName (宽候选/既有调用) 时单一评分,
 * 行为与 gradeOfficePoi 完全一致。name-match 闸门不绕过 — 两级都过不了 low
 * 判定就拒。
 */
export function gradeVariantHit(
  poi: OfficePoiCandidate,
  searchQuery: string,
  gradeName: string,
  province = '浙江省',
  city = '杭州市',
): { confidence: GeocodeConfidence; reason: string } {
  if (searchQuery !== gradeName) {
    const precise = gradeOfficePoi(poi, searchQuery, province, city);
    if (precise.confidence !== 'low') return precise;
  }
  return gradeOfficePoi(poi, gradeName, province, city);
}

/**
 * Best office hit for a company in the target province/city; office-type wins
 * ties. Multi-city: grade against the site's own province/city (defaults keep
 * the legacy Hangzhou behavior for single-city callers) — a Shanghai POI must
 * pass 上海市, not the 浙江省/杭州市 defaults, or every non-Hangzhou site
 * silently fails the confidence gate.
 */
export function pickBestOfficePoi(
  pois: OfficePoiCandidate[],
  companyName: string,
  province = '浙江省',
  city = '杭州市',
  searchQuery = companyName,
): GeocodeResolution['poi'] {
  const scored = pois.map((poi) => {
    const grade = gradeVariantHit(poi, searchQuery, companyName, province, city);
    const office = OFFICE_TYPE_RE.test(poi.type) ? 1 : 0;
    const street = STREET_RE.test(poi.address) ? 1 : 0;
    const exact = normalizeNameForMatch(poi.name) === normalizeNameForMatch(companyName) ? 2 : 0;
    return { poi, grade, rank: exact + office * 2 + street };
  });
  const sorted = scored.sort((a, b) => b.rank - a.rank);
  const best = sorted[0];
  return best && best.grade.confidence !== 'low' ? best.poi : undefined;
}

export interface PlaceTextResult {
  ok: boolean;
  pois: OfficePoiCandidate[];
  reason?: 'no-key' | 'http' | 'parse' | 'quota' | `baidu-status:${number}` | `tencent-status:${number}`;
  amapUnavailable?: boolean;
  provider?: 'amap' | 'baidu' | 'tencent';
}

/**
 * v3/place/text scoped to one city. No key → no-op; Baidu place search is the
 * fallback when AMap is key-less or daily-quota exhausted (10044), Tencent the
 * last resort when Baidu also fails. All providers return GCJ-02 (AMap native /
 * Baidu ret_coordtype=gcj02ll / Tencent native). Callers throttle — ≥600ms for
 * Baidu, ≥340ms otherwise.
 */
export async function placeTextSearchRest(
  query: string,
  city = '杭州',
  fetchImpl: typeof fetch = fetch,
): Promise<PlaceTextResult> {
  const key = amapWebKey();
  if (!key) {
    return fallbackChain(
      () => baiduPlaceSearchRest(query, city, fetchImpl),
      () => tencentPlaceSearchRest(query, city, fetchImpl),
      () => ({ ok: false, pois: [], reason: 'no-key' } as PlaceTextResult),
    );
  }
  const url = new URL('https://restapi.amap.com/v3/place/text');
  url.searchParams.set('keywords', query);
  url.searchParams.set('city', city);
  url.searchParams.set('citylimit', 'true');
  url.searchParams.set('offset', '10');
  url.searchParams.set('output', 'JSON');
  url.searchParams.set('key', key);
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return { ok: false, pois: [], reason: 'http' };
    const payload = (await res.json()) as {
      status?: string;
      info?: string;
      infocode?: string;
      pois?: Array<Record<string, unknown>>;
    };
    if (payload.status !== '1') {
      const down = amapQuotaExhausted(payload);
      if (down) {
        return fallbackChain(
          () => baiduPlaceSearchRest(query, city, fetchImpl),
          () => tencentPlaceSearchRest(query, city, fetchImpl),
          () => ({ ok: false, pois: [], reason: 'quota', amapUnavailable: true } as PlaceTextResult),
        );
      }
      return { ok: false, pois: [], reason: down ? 'quota' : 'parse', amapUnavailable: down };
    }
    return {
      ok: true,
      provider: 'amap',
      pois: (payload.pois ?? []).map(parseOfficePoi).filter((p): p is OfficePoiCandidate => !!p),
    };
  } catch {
    return { ok: false, pois: [], reason: 'http' };
  }
}

export interface RegeoResult {
  ok: boolean;
  cityname?: string;
  district?: string;
  province?: string;
  /** 坐标的格式化地址 (AMap regeocode.formatted_address / Baidu result.formatted_address / Tencent result.address) — 无地址 POI 的地址兜底补查来源. */
  formattedAddress?: string;
  amapUnavailable?: boolean;
  provider?: 'amap' | 'baidu' | 'tencent';
}

/**
 * A regeo hit confirms a coordinate sits in `target` city. 直辖市 (北京/上海)
 * regeo 的 cityname 为空 — province 兜底校验 (北京 POI 的 pname = '北京市').
 * 百度/腾讯 regeo 直辖市直接返回 city='上海市' (无此问题, 统一走同一条校验).
 */
export function regeoMatchesTarget(re: RegeoResult, target: CityTarget): { ok: boolean; reason?: string } {
  if (re.province && re.province !== target.province) return { ok: false, reason: `outside-province:${re.province}` };
  if (re.cityname && re.cityname !== target.city) return { ok: false, reason: `outside-city:${re.cityname}` };
  return { ok: true };
}

/**
 * Confirm a coordinate sits in the target city: AMap v3/geocode/regeo, falling
 * back to Baidu reverse_geocoding/v3 (then Tencent ws/geocoder/v1) when AMap
 * is key-less / quota-exhausted.
 */
export async function regeoCityRest(
  lng: number,
  lat: number,
  fetchImpl: typeof fetch = fetch,
): Promise<RegeoResult> {
  const key = amapWebKey();
  if (!key) {
    return fallbackChain(
      () => baiduRegeoCityRest(lng, lat, fetchImpl),
      () => tencentRegeoCityRest(lng, lat, fetchImpl),
      () => ({ ok: false } as RegeoResult),
    );
  }
  const url = new URL('https://restapi.amap.com/v3/geocode/regeo');
  url.searchParams.set('location', `${lng},${lat}`);
  url.searchParams.set('output', 'JSON');
  url.searchParams.set('key', key);
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return { ok: false };
    const payload = (await res.json()) as {
      status?: string;
      info?: string;
      infocode?: string;
      regeocode?: { addressComponent?: { cityname?: string; district?: string; province?: string; adcode?: string }; formatted_address?: string };
    };
    const comp = payload.regeocode?.addressComponent;
    if (payload.status !== '1' || !comp) {
      const down = amapQuotaExhausted(payload);
      if (down) {
        return fallbackChain(
          () => baiduRegeoCityRest(lng, lat, fetchImpl),
          () => tencentRegeoCityRest(lng, lat, fetchImpl),
          () => ({ ok: false, amapUnavailable: true } as RegeoResult),
        );
      }
      return { ok: false, amapUnavailable: down };
    }
    return { ok: true, provider: 'amap', cityname: comp.cityname, district: comp.district, province: comp.province, formattedAddress: payload.regeocode?.formatted_address || undefined };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Baidu fallback (Web 服务, BAIDU_MAP_AK). Same GCJ-02 output as AMap — every
// endpoint requests ret_coordtype / coordtype=gcj02ll so pins stay in the
// catalog's native coordinate system; no BD-09 conversion needed. Baidu free
// tier throttles at ~2 QPS — callers sleep ≥600ms. Never prints the key.
// ---------------------------------------------------------------------------

/** Baidu place POI → the same GCJ-02 candidate shape AMap produces. */
export function parseBaiduOfficePoi(raw: Record<string, unknown>): OfficePoiCandidate | null {
  const loc = raw.location as { lng?: unknown; lat?: unknown } | null | undefined;
  const lng = Number(loc?.lng);
  const lat = Number(loc?.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return {
    name: String(raw.name ?? ''),
    address: String(raw.address ?? raw.district ?? ''),
    lng,
    lat,
    type: '',
    adname: String(raw.district ?? ''),
    pname: String(raw.province ?? ''),
    cityname: String(raw.city ?? ''),
  };
}

/** Baidu place/v2/search (行政区域检索) scoped to one city, GCJ-02 output.
 * 302/401 是间歇性配额误报(实测同 key 同分钟有的查询通有的不通)——重试一次. */
export async function baiduPlaceSearchRest(
  query: string,
  city = '杭州',
  fetchImpl: typeof fetch = fetch,
): Promise<PlaceTextResult> {
  const key = baiduWebKey();
  if (!key) return { ok: false, pois: [], reason: 'no-key' };
  const url = new URL('https://api.map.baidu.com/place/v2/search');
  url.searchParams.set('query', query);
  url.searchParams.set('region', city);
  url.searchParams.set('output', 'json');
  url.searchParams.set('ret_coordtype', 'gcj02ll');
  url.searchParams.set('page_size', '10');
  url.searchParams.set('scope', '1');
  url.searchParams.set('ak', key);
  let payload: { status?: number; results?: Array<Record<string, unknown>> };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) return { ok: false, pois: [], reason: 'http' };
      payload = (await res.json()) as typeof payload;
    } catch {
      return { ok: false, pois: [], reason: 'http' };
    }
    if (payload.status !== 0) {
      const reason = `baidu-status:${payload.status ?? -1}` as PlaceTextResult['reason'];
      if (attempt === 0 && isTransientBaiduStatus(reason)) {
        await sleep(BAIDU_RETRY_SLEEP_MS);
        continue;
      }
      return { ok: false, pois: [], reason };
    }
    return {
      ok: true,
      provider: 'baidu',
      pois: (payload.results ?? []).map(parseBaiduOfficePoi).filter((p): p is OfficePoiCandidate => !!p),
    };
  }
  return { ok: false, pois: [], reason: 'http' };
}

/** Baidu reverse_geocoding/v3 — city check for a GCJ-02 coordinate. */
export async function baiduRegeoCityRest(
  lng: number,
  lat: number,
  fetchImpl: typeof fetch = fetch,
): Promise<RegeoResult> {
  const key = baiduWebKey();
  if (!key) return { ok: false };
  const url = new URL('https://api.map.baidu.com/reverse_geocoding/v3');
  // location = "lat,lng" (百度纬度在前); coordtype=gcj02ll 输入已是国测局坐标.
  url.searchParams.set('location', `${lat},${lng}`);
  url.searchParams.set('coordtype', 'gcj02ll');
  url.searchParams.set('output', 'json');
  url.searchParams.set('ak', key);
  let payload: { status?: number; result?: { addressComponent?: { province?: string; city?: string; district?: string }; formatted_address?: string } };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) return { ok: false };
      payload = (await res.json()) as typeof payload;
    } catch {
      return { ok: false };
    }
    const comp = payload.result?.addressComponent;
    if (payload.status !== 0 || !comp) {
      const reason = `baidu-status:${payload.status ?? -1}`;
      if (attempt === 0 && isTransientBaiduStatus(reason)) {
        await sleep(BAIDU_RETRY_SLEEP_MS);
        continue;
      }
      return { ok: false };
    }
    return { ok: true, provider: 'baidu', cityname: comp.city, district: comp.district, province: comp.province, formattedAddress: payload.result?.formatted_address || undefined };
  }
  return { ok: false };
}

/** Baidu geocoding/v3 — full address → GCJ-02 point. */
export async function baiduGeocodeAddressRest(
  query: string,
  city = '杭州',
  fetchImpl: typeof fetch = fetch,
): Promise<RestGeocodeResult> {
  const key = baiduWebKey();
  if (!key) return { ok: false, reason: 'no-key' };
  const url = new URL('https://api.map.baidu.com/geocoding/v3');
  url.searchParams.set('address', query);
  url.searchParams.set('city', city);
  url.searchParams.set('output', 'json');
  url.searchParams.set('ret_coordtype', 'gcj02ll');
  url.searchParams.set('ak', key);
  let payload: {
    status?: number;
    result?: { location?: { lng?: unknown; lat?: unknown }; precise?: number; confidence?: number };
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) return { ok: false, reason: 'http' };
      payload = (await res.json()) as typeof payload;
    } catch {
      return { ok: false, reason: 'http' };
    }
    const loc = payload.result?.location;
    const lng = Number(loc?.lng);
    const lat = Number(loc?.lat);
    if (payload.status !== 0 || !Number.isFinite(lng) || !Number.isFinite(lat)) {
      const reason = (payload.status !== 0 ? `baidu-status:${payload.status ?? -1}` : 'empty') as RestGeocodeResult['reason'];
      if (attempt === 0 && isTransientBaiduStatus(reason)) {
        await sleep(BAIDU_RETRY_SLEEP_MS);
        continue;
      }
      return { ok: false, reason };
    }
    return { ok: true, provider: 'baidu', location: { lng, lat, address: query } };
  }
  return { ok: false, reason: 'http' };
}

// ---------------------------------------------------------------------------
// Tencent fallback (WebService, TENCENT_MAP_KEY). 第三级兜底 (2026-08-21,
// feature/geocode-tencent): 百度重试后仍失败时的最后一道。个人开发者每接口
// 10000 次/天、5 QPS (官方 FAQ); 输出原生 GCJ-02, 无需转换。status≠0 即错误:
// 121 = 每日调用量上限 (配额类)、120 = 每秒请求量上限 (重试一次)、
// 110/112/190/199 = key/IP/功能配置问题 (永久失效, 归配额类短路)。
// 字段形状与百度/高德不同: POI 名是 title (非 name)、坐标是 location:{lat,lng}
// 命名对象 (键序与百度相反, 不能按序拆分)、行政区在 ad_info 嵌套 —
// parseTencentOfficePoi 独立实现。Never prints the key.
// ---------------------------------------------------------------------------

/** 腾讯地理编码 address 必须含省市区 (官方文档) — 目标城市缺失时前缀拼接. */
function cityQualifiedAddress(query: string, city: string): string {
  const bare = bareCity(city);
  if (query.includes(bare) || query.includes(city)) return query;
  return `${city}${query}`;
}

/** 腾讯 place 检索 data[i] → 统一 GCJ-02 candidate (title/location 对象/ad_info). */
export function parseTencentOfficePoi(raw: Record<string, unknown>): OfficePoiCandidate | null {
  const loc = raw.location as { lat?: unknown; lng?: unknown } | null | undefined;
  const lng = Number(loc?.lng);
  const lat = Number(loc?.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const ad = (raw.ad_info ?? {}) as Record<string, unknown>;
  return {
    name: String(raw.title ?? ''),
    address: String(raw.address ?? ''),
    lng,
    lat,
    type: String(raw.category ?? ''),
    adname: String(ad.district ?? ''),
    pname: String(ad.province ?? ''),
    cityname: String(ad.city ?? ''),
  };
}

/** 腾讯间歇性限流: 120 = 每秒请求量上限 — 重试一次, 间隔 1.5s. */
const TENCENT_TRANSIENT_STATUS = new Set(['120']);
const TENCENT_RETRY_SLEEP_MS = 1500;

function isTransientTencentStatus(reason: string | undefined): boolean {
  if (!reason?.startsWith('tencent-status:')) return false;
  return TENCENT_TRANSIENT_STATUS.has(reason.slice('tencent-status:'.length));
}

/** Tencent place/v1/search (boundary=region 城市内检索), GCJ-02 原生输出. */
export async function tencentPlaceSearchRest(
  query: string,
  city = '杭州',
  fetchImpl: typeof fetch = fetch,
): Promise<PlaceTextResult> {
  const key = tencentWebKey();
  if (!key) return { ok: false, pois: [], reason: 'no-key' };
  const url = new URL('https://apis.map.qq.com/ws/place/v1/search');
  url.searchParams.set('keyword', query);
  url.searchParams.set('boundary', `region(${city},0)`);
  url.searchParams.set('page_size', '10');
  url.searchParams.set('page_index', '1');
  url.searchParams.set('key', key);
  let payload: { status?: number; data?: Array<Record<string, unknown>> };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) return { ok: false, pois: [], reason: 'http' };
      payload = (await res.json()) as typeof payload;
    } catch {
      return { ok: false, pois: [], reason: 'http' };
    }
    if (payload.status !== 0) {
      const reason = `tencent-status:${payload.status ?? -1}` as PlaceTextResult['reason'];
      if (attempt === 0 && isTransientTencentStatus(reason)) {
        await sleep(TENCENT_RETRY_SLEEP_MS);
        continue;
      }
      return { ok: false, pois: [], reason };
    }
    return {
      ok: true,
      provider: 'tencent',
      pois: (payload.data ?? []).map(parseTencentOfficePoi).filter((p): p is OfficePoiCandidate => !!p),
    };
  }
  return { ok: false, pois: [], reason: 'http' };
}

/** Tencent ws/geocoder/v1 reverse — city check for a GCJ-02 coordinate. */
export async function tencentRegeoCityRest(
  lng: number,
  lat: number,
  fetchImpl: typeof fetch = fetch,
): Promise<RegeoResult> {
  const key = tencentWebKey();
  if (!key) return { ok: false };
  const url = new URL('https://apis.map.qq.com/ws/geocoder/v1');
  // location = "lat,lng" (腾讯纬度在前, 同百度); 输入已是 GCJ-02 国测局坐标.
  url.searchParams.set('location', `${lat},${lng}`);
  url.searchParams.set('key', key);
  let payload: { status?: number; result?: { ad_info?: { province?: string; city?: string; district?: string }; address?: string } };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) return { ok: false };
      payload = (await res.json()) as typeof payload;
    } catch {
      return { ok: false };
    }
    const ad = payload.result?.ad_info;
    if (payload.status !== 0 || !ad) {
      const reason = `tencent-status:${payload.status ?? -1}`;
      if (attempt === 0 && isTransientTencentStatus(reason)) {
        await sleep(TENCENT_RETRY_SLEEP_MS);
        continue;
      }
      return { ok: false };
    }
    return { ok: true, provider: 'tencent', cityname: ad.city, district: ad.district, province: ad.province, formattedAddress: payload.result?.address || undefined };
  }
  return { ok: false };
}

/** Tencent ws/geocoder/v1 forward — full address → GCJ-02 point. */
export async function tencentGeocodeAddressRest(
  query: string,
  city = '杭州',
  fetchImpl: typeof fetch = fetch,
): Promise<RestGeocodeResult> {
  const key = tencentWebKey();
  if (!key) return { ok: false, reason: 'no-key' };
  const url = new URL('https://apis.map.qq.com/ws/geocoder/v1');
  // address 必须含省市区 (官方文档); region 参数消歧 (文档未列但历史接口支持).
  url.searchParams.set('address', cityQualifiedAddress(query, city));
  url.searchParams.set('region', city);
  url.searchParams.set('key', key);
  let payload: {
    status?: number;
    result?: { location?: { lng?: unknown; lat?: unknown } };
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) return { ok: false, reason: 'http' };
      payload = (await res.json()) as typeof payload;
    } catch {
      return { ok: false, reason: 'http' };
    }
    const loc = payload.result?.location;
    const lng = Number(loc?.lng);
    const lat = Number(loc?.lat);
    if (payload.status !== 0 || !Number.isFinite(lng) || !Number.isFinite(lat)) {
      const reason = (payload.status !== 0 ? `tencent-status:${payload.status ?? -1}` : 'empty') as RestGeocodeResult['reason'];
      if (attempt === 0 && isTransientTencentStatus(reason)) {
        await sleep(TENCENT_RETRY_SLEEP_MS);
        continue;
      }
      return { ok: false, reason };
    }
    return { ok: true, provider: 'tencent', location: { lng, lat, address: query } };
  }
  return { ok: false, reason: 'http' };
}

// ---------------------------------------------------------------------------
// OSM Nominatim — 海外站第四 provider (2026-08-23, feat/poi-nominatim)。
// 背景: drops 2410 站中海外站 (悉尼/新加坡/东京/英文城市等, 2026-08-23 摸底
// 114 站 = CJK 海外 91 站/65 城 + 纯拉丁城市串 23 站/18 城串, 其中 88 站无
// 可用坐标) 的城市不在 AMap/百度/腾讯 place 检索覆盖范围 — 三级兜底链对海外
// 地址必然全失败, 海外站永远无法落真实坐标。Nominatim (OpenStreetMap 公共
// 实例 https://nominatim.openstreetmap.org) 全球覆盖, 输出 WGS-84 — 与
// city-centers.ts OVERSEAS_CENTERS 的 WGS-84 约定一致, 无需坐标转换。
//
// 政策合规 (Nominatim Usage Policy,
// https://operations.osmfoundation.org/policies/nominatim/):
//   1. UA 必须标识应用: NOMINATIM_USER_AGENT — 缺失/通用 UA 会被 OSM 封 IP。
//   2. 限速 ≥1 req/s: 调用方 (geocode-sites-apply.mjs throttleMs) 每次调用后
//      sleep ≥ NOMINATIM_MIN_INTERVAL_MS; 本模块不自行限速 (保持可单测)。
//   3. 不并发轰炸: apply 脚本主循环严格串行, 本模块无并发启动。
//   4. 错误/超时 (NOMINATIM_TIMEOUT_MS = 10s, AbortSignal.timeout) 优雅降级为
//      { ok: false, ... } — 调用方记 unresolved, 不崩溃。
// 海外站判定 (isOverseasCity) 独立命名, 国内站点永不进本路径。
// ---------------------------------------------------------------------------

/** Nominatim 请求 User-Agent — 项目标识 (Usage Policy 强制). */
export const NOMINATIM_USER_AGENT = 'DomainMap/1.0 (job-map contact)';

/** 单次请求超时 — 超过视为失败降级 (reason 'timeout'), 不重试不崩溃. */
export const NOMINATIM_TIMEOUT_MS = 10_000;

/** 调用方限速下限: ≥1 req/s (Usage Policy). 实际节流在 apply 脚本调用点. */
export const NOMINATIM_MIN_INTERVAL_MS = 1_000;

/**
 * Nominatim 检索串长度上限 — 官方建议 ≤256 字符 (超长返回 400 → unresolved
 * 噪音, 优雅但无谓). 变体检索串形如 "<街道地址> <公司名>", 公司名在尾部 —
 * 超长时保留尾部 (公司名主体), 丢弃头部地址段 (见 nominatimSearchRest).
 */
export const NOMINATIM_QUERY_MAX_LEN = 256;

// --- 海外站判定 (独立命名, 不污染国内路径) ------------------------------------
// 数据实测口径 (2026-08-23 摸底, 见 20260823-boss-poi-datasource 批次汇报):
// drops 海外站 114 站 = CJK 海外/港澳台城市名 91 站 (65 城) + 纯拉丁城市串
// 23 站 (18 城串, embodied-jobs 为主)。判定四通道 (命中任一即海外):
//   1. 城市名含拉丁字母 — Mountain View, CA / Singapore / London…
//   2. 城市 bare 名命中 city-centers.ts OVERSEAS_CITY_KEYS (新加坡/悉尼/东京/
//      洛杉矶/伦敦/慕尼黑/吉隆坡/纽约/旧金山/巴黎/柏林/首尔/曼谷/迪拜)。
//   3. 城市名命中实测海外/港澳台 CJK 名单 (墨尔本/台北/雅加达/多伦多/中国香港/
//      九龙/新界/胡志明/三菱东京日联银行总部…)。
//   4. 城市名含「海外」标记 — "北京 洛阳  海外"。
// ---------------------------------------------------------------------------

/** 数据实测海外/港澳台 CJK 城市名 (bare 或原样均可命中; 2026-08-23 摸底). */
export const OVERSEAS_CJK_CITIES = new Set([
  // 港澳台
  '中国香港', '香港', '九龙', '新界', '台北', '台北市',
  // 日本
  '东京', '横滨', '横滨市', '札幌', '札幌市', '三菱东京日联银行总部',
  // 东南亚
  '雅加达', '南雅加达行政', '南雅加达行政市', '吉隆坡', '胡志明', '胡志明市',
  '曼谷', '马尼拉', '清化', '清化市', '下龙', '下龙市', '巴生', '瓜拉雪兰莪',
  '梅赫伦', '普哇加达县', '亚罗牙也',
  // 欧美澳
  '墨尔本', '西雅图', '温哥华', '多伦多', '纽约', '洛杉矶', '旧金山', '费利蒙',
  '圣克拉拉', '帕洛阿尔托', '奥斯汀', '布鲁克林', '墨西哥城', '圣保罗',
  '伦敦', '巴黎', '柏林', '慕尼黑', '杜塞尔多夫', '鹿特丹', '华沙', '苏黎世',
  '米兰', '马德里', '莫斯科', '布达佩斯', '哥本哈根', '巴塞罗那', '阿姆斯特丹',
  '法兰克福', '斯图加特', '格拉茨', '巴尔韦伦', '松德比贝里', '范雷宁', '迪门',
  '巴勒鲁普', '维厄勒', '阿斯塔纳', '仁川',
]);

/**
 * 海外站判定。国内站点永不进 Nominatim 分支 — 判定通道见上 (拉丁城市名 /
 * OVERSEAS_CITY_KEYS / 实测 CJK 名单 / 「海外」标记)。
 */
export function isOverseasCity(city: string | null | undefined): boolean {
  const c = city?.trim();
  if (!c) return false;
  if (/[A-Za-z]/.test(c)) return true;
  const bare = bareCity(c);
  if (OVERSEAS_CITY_KEYS.has(bare) || OVERSEAS_CITY_KEYS.has(c)) return true;
  if (OVERSEAS_CJK_CITIES.has(bare) || OVERSEAS_CJK_CITIES.has(c)) return true;
  if (c.includes('海外')) return true;
  return false;
}

export interface NominatimSearchResult {
  ok: boolean;
  pois: OfficePoiCandidate[];
  reason?: 'http' | 'parse' | 'empty' | 'timeout';
  provider?: 'nominatim';
}

/** Nominatim search 行 → 统一 OfficePoiCandidate (name/address = display_name). */
export function parseNominatimPoi(raw: Record<string, unknown>): OfficePoiCandidate | null {
  const lng = Number(raw.lon);
  const lat = Number(raw.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const address = (raw.address ?? {}) as Record<string, unknown>;
  return {
    name: String(raw.display_name ?? ''),
    address: String(raw.display_name ?? ''),
    lng,
    lat,
    type: String(raw.type ?? ''),
    adname: String(address.city_district ?? address.suburb ?? address.neighbourhood ?? ''),
    pname: String(address.state ?? address.country ?? ''),
    cityname: String(address.city ?? address.town ?? address.county ?? address.municipality ?? ''),
  };
}

/**
 * Nominatim /search (format=jsonv2, limit=3)。target.city 提供且检索串未含城市
 * 名时, 追加 bare 城市名作约束 (Nominatim 无 region 参数, 文本约束最接近)。
 * 2026-08-23 (scan r2 #7): 最终 q 超 NOMINATIM_QUERY_MAX_LEN (256, 官方建议)
 * 时截断到 256 — 保留尾部 (公司名主体), 丢弃头部地址段; 不改变失败降级语义。
 * 失败 (http/超时/解析) 一律降级为 { ok: false } — 调用方记 unresolved, 不抛。
 */
export async function nominatimSearchRest(
  query: string,
  target: { city: string } | null = null,
  fetchImpl: typeof fetch = fetch,
): Promise<NominatimSearchResult> {
  const q = query.trim();
  if (!q) return { ok: false, pois: [], reason: 'empty' };
  const url = new URL('https://nominatim.openstreetmap.org/search');
  const city = target?.city?.trim();
  const bare = city ? bareCity(city) : '';
  if (city && !q.includes(city) && !q.includes(bare)) url.searchParams.set('q', `${q} ${bare}`);
  else url.searchParams.set('q', q);
  // 超长截断: 保留尾部 (公司名主体), 丢弃头部地址段 (与 Nominatim ≤256 建议对齐)
  const composed = url.searchParams.get('q') ?? '';
  if (composed.length > NOMINATIM_QUERY_MAX_LEN) {
    url.searchParams.set('q', composed.slice(composed.length - NOMINATIM_QUERY_MAX_LEN));
  }
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '3');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('accept-language', 'zh-CN,en');
  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': NOMINATIM_USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(NOMINATIM_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, pois: [], reason: 'http' };
    const payload = (await res.json()) as unknown;
    if (!Array.isArray(payload)) return { ok: false, pois: [], reason: 'parse' };
    return {
      ok: true,
      provider: 'nominatim',
      pois: payload.map(parseNominatimPoi).filter((p): p is OfficePoiCandidate => !!p),
    };
  } catch (err) {
    const name = (err as { name?: string })?.name ?? '';
    return { ok: false, pois: [], reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'http' };
  }
}

export interface NominatimReverseResult {
  ok: boolean;
  displayName?: string;
  city?: string;
  country?: string;
  reason?: 'http' | 'parse' | 'empty' | 'timeout';
}

// ---------------------------------------------------------------------------
// Nominatim search memo (2026-08-23, quality-scan r2 #6)。
// 海外路径 (geocode-sites-apply.mjs searchOverseasNominatim) 逐站重复打 OSM
// 公共实例 — 同公司同城多海外站 (安克创新 38 站 / 元气森林 71 站 / 小鹏 52 站)
// 用相同 query+city 逐站重复检索是结构性浪费, 且 OSM 公共服务有限速/封 IP
// 政策风险。与国内 place-search memo 同构 (见上): 只缓存成功命中 (poi 非空);
// 失败/空结果/超时 (poi: null) 绝不缓存 — 服务恢复后必须重新尝试, 缓存旧失败
// 会永久卡死站点。key 精确到 (query, city): 公司名相同但城市不同 → 不同 key,
// 不串。策略放本模块 (而非 apply 脚本内) 是为了可单测 — 与 shouldShortCircuitQuota
// / placeSearchMemoKey 同模式; 调用方层级接线见 geocode-sites-apply.mjs。
// ---------------------------------------------------------------------------

export interface NominatimMemoHit {
  poi: OfficePoiCandidate;
  confidence: GeocodeConfidence;
  reason: string;
  query: string;
}

/** Memo key: 检索变体串 + 城市精确绑定 — 城市不同不串。 */
export function nominatimSearchMemoKey(query: string, city: string): string {
  return `${query}\t${city}`;
}

/**
 * 只缓存成功命中 (poi 非空)。失败/空结果/超时 (poi: null) 绝不写入 —
 * 服务恢复后调用方必须重新尝试, 缓存旧失败会永久卡死站点。
 */
export function nominatimSearchMemoSet(
  memo: Map<string, NominatimMemoHit>,
  key: string,
  hit: NominatimMemoHit | null | undefined,
): void {
  if (hit?.poi) memo.set(key, hit);
}

/** Nominatim /reverse — WGS-84 坐标的证据文本 (海外路径的 regeo 替代证据). */
export async function nominatimReverseRest(
  lng: number,
  lat: number,
  fetchImpl: typeof fetch = fetch,
): Promise<NominatimReverseResult> {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return { ok: false, reason: 'parse' };
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('zoom', '16');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('accept-language', 'zh-CN,en');
  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': NOMINATIM_USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(NOMINATIM_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: 'http' };
    const payload = (await res.json()) as { display_name?: unknown; address?: Record<string, unknown>; error?: unknown };
    if (!payload || typeof payload !== 'object' || payload.error) return { ok: false, reason: 'empty' };
    const address = payload.address ?? {};
    return {
      ok: true,
      displayName: String(payload.display_name ?? ''),
      city: String(address.city ?? address.town ?? address.county ?? ''),
      country: String(address.country ?? ''),
    };
  } catch (err) {
    const name = (err as { name?: string })?.name ?? '';
    return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'http' };
  }
}

// --- Nominatim 命中评分 (海外独立口径) ----------------------------------------
// 国内 grader (gradeOfficePoi/gradeVariantHit) 校验 pname/cityname 对海外不适用
// (siteCityTarget 的 province 缺省 浙江省, 海外 POI 必被拒), 且海外 POI 名多为
// 本地语言 (Anker Innovations / 渋谷区神宮前…), 中文公司名强匹配命中率低。
// 海外口径双通道 (任一中 high/medium, 都不中 → low 不写回 — 宁可留
// unresolved, 不钉错点):
//   1. 公司名 (归一) 出现在 display_name → 自家 POI 命中 → high。
//   2. 检索串去掉公司名/城市名后的地址部分与 display_name 的 token 重叠 ≥2 →
//      地址级解析命中。地址部分含数字 (门牌) → high, 否则 (城市级) → medium。
//      跨语言归一: 拉丁 token 小写 + NFKD 去变音 + ß→ss (Georg-Muche-Street 与
//      Georg-Muche-Straße 仍重叠), CJK 滑窗 bigram (渋谷区神宮前 → 渋谷/谷区/
//      区神/神宮/宮前)。
// ---------------------------------------------------------------------------

const NOMINATIM_DIACRITICS_RE = /[̀-ͯ]/g; // 组合变音符号 (NFKD 后剥离)
const NOMINATIM_CJK_RE = /[぀-ヿ㐀-鿿]/; // 平假名/片假名/汉字

/** NFKD 去变音 + ß→ss + 小写 — 跨语言可比面 (Straße ≡ strasse). */
function normalizeNominatimText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(NOMINATIM_DIACRITICS_RE, '')
    .replace(/ß/g, 'ss')
    .toLowerCase();
}

/** 检索/显示名 → 可比 token: 拉丁+数字 (≥3 字符) + CJK 滑窗 bigram. */
export function nominatimMatchTokens(text: string): Set<string> {
  const norm = normalizeNominatimText(text);
  const out = new Set<string>();
  for (const m of norm.matchAll(/[a-z0-9]{3,}/g)) out.add(m[0]);
  if (NOMINATIM_CJK_RE.test(norm)) {
    const chars = [...norm];
    for (let i = 0; i + 1 < chars.length; i += 1) {
      if (NOMINATIM_CJK_RE.test(chars[i]) && NOMINATIM_CJK_RE.test(chars[i + 1])) out.add(`${chars[i]}${chars[i + 1]}`);
    }
  }
  return out;
}

/**
 * Nominatim 命中评分 (海外口径, 见上)。query 为实际发送的检索串
 * (地址+公司 或 公司+城市), city 为目标城市 (供剔除城市 token)。
 */
export function gradeNominatimHit(
  poi: OfficePoiCandidate,
  companyName: string,
  query: string,
  city: string | null,
): { confidence: GeocodeConfidence; reason: string } {
  const display = poi.name;
  const normCompany = normalizeNameForMatch(companyName);
  if (normCompany && normalizeNominatimText(display).includes(normCompany)) {
    return { confidence: 'high', reason: 'nominatim-company-match' };
  }
  const addrPart = query.replace(companyName, '').replace(bareCity(city ?? ''), '').trim();
  const addrTokens = nominatimMatchTokens(addrPart);
  const displayTokens = nominatimMatchTokens(display);
  let overlap = 0;
  for (const t of addrTokens) {
    if (displayTokens.has(t)) overlap += 1;
  }
  if (addrTokens.size > 0 && overlap >= 2) {
    const streetLevel = /\d/.test(addrPart);
    return streetLevel
      ? { confidence: 'high', reason: `nominatim-address-match:${poi.type || 'place'}` }
      : { confidence: 'medium', reason: `nominatim-city-match:${poi.type || 'place'}` };
  }
  return { confidence: 'low', reason: `nominatim-name-mismatch:${display.slice(0, 48)}` };
}

/** 按评分顺序取首个非 low 候选 (Nominatim 自身 relevance 已排序). */
export function pickBestNominatimPoi(
  pois: OfficePoiCandidate[],
  companyName: string,
  query: string,
  city: string | null,
): OfficePoiCandidate | undefined {
  for (const poi of pois) {
    if (gradeNominatimHit(poi, companyName, query, city).confidence !== 'low') return poi;
  }
  return undefined;
}

/**
 * Nominatim 检索变体 (海外路径, 每站点 ≤2 次检索):
 *   1. 街道地址 + 公司名 (地址级, 命中即高置信)
 *   2. 公司名 + 城市 (城市级, 兜底)
 * 地址不呈街道级 (城市名占位 新加坡/伦敦/非中国大陆地区) 时跳过变体 1 —
 * STREET_RE 同国内口径 (含门牌/路/街/大厦…)。去重后返回。
 */
export function nominatimQueryVariants(
  companyQuery: string,
  address: string | null | undefined,
  city: string,
): string[] {
  const out: string[] = [];
  const addr = address?.trim();
  if (addr && STREET_RE.test(addr)) out.push(`${addr} ${companyQuery}`);
  out.push(`${companyQuery} ${city}`);
  return [...new Set(out)];
}
