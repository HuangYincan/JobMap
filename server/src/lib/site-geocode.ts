// Plan (and optionally apply) office-site geocodes.
// Seed already ships Hangzhou coords. This is for imported rows / future
// adapters that only have an address. Live AMap REST waits on AMAP_WEB_KEY
// (Web 服务 key, not the JS key). Never print that key.

import { getPool } from './db.ts';
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
  return lng === 0 && lat === 0;
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
  return {
    city: withCity.city?.trim() || '杭州市',
    province: withCity.province?.trim() || '浙江省',
  };
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

/** Rows already in Postgres with no usable point. No pool → []. */
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
    }>(
      `SELECT s.id::text, c.slug AS company_slug, c.name AS company_name,
              s.name AS site_name, s.address, s.city, s.province
         FROM company_sites s
         JOIN companies c ON c.id = s.company_id
        WHERE s.lng IS NULL OR s.lat IS NULL
           OR (s.lng = 0 AND s.lat = 0)`,
    );
    return rows.map((row) => ({
      id: row.id,
      companySlug: row.company_slug,
      companyName: row.company_name,
      siteName: row.site_name,
      address: row.address,
      query: importedSiteQuery(row.address, row.city, row.company_name, row.site_name),
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

/** A site whose address names a real street/building — geocodable as-is. */
export function siteHasStreetAddress(site: CompanySite): boolean {
  const address = site.location?.address?.trim();
  return !!address && STREET_RE.test(address);
}

export interface RestGeocodeResult {
  ok: boolean;
  location?: POILocation;
  reason?: 'no-key' | 'http' | 'empty' | 'parse' | 'quota' | `baidu-status:${number}`;
  /** AMap unusable (no key / daily quota exhausted) — result may come from Baidu. */
  amapUnavailable?: boolean;
  provider?: 'amap' | 'baidu';
}

/**
 * Optional Web 服务 geocode. Missing AMAP_WEB_KEY → no-op (Baidu fallback when
 * BAIDU_MAP_AK is present). Caller must not log the key. QPS stays ≤3/s for
 * AMap and ~2/s for Baidu (sleep ≥600ms) at the call site.
 */
export async function geocodeAddressRest(
  query: string,
  city = '杭州',
  fetchImpl: typeof fetch = fetch,
): Promise<RestGeocodeResult> {
  const key = amapWebKey();
  if (!key) {
    // No AMap key — Baidu becomes the provider (GCJ-02 via ret_coordtype).
    if (baiduWebKey()) {
      const b = await baiduGeocodeAddressRest(query, city, fetchImpl);
      return { ...b, amapUnavailable: true };
    }
    return { ok: false, reason: 'no-key' };
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
  if (down && baiduWebKey()) {
    const b = await baiduGeocodeAddressRest(query, city, fetchImpl);
    return { ...b, amapUnavailable: true };
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
const GOOD_BRACKET_SEG_RE = /(号楼|大厦|中心|园区|广场|总部|办公|研究院|大学|学院|医院|产业园|科技园|软件园|创业园|世界城|金融城|天地)$/;

function isQualifierPrefix(token: string): boolean {
  if (CITY_PREFIXES.has(token.replace(/[省市]$/, ''))) return true;
  return ROMAN_PREFIX_RE.test(token);
}

/** 公司名+城市 也是常见分支命名 (快手北京 / 某司上海) — 城市名算限定词后缀. */
function isQualifierSuffix(token: string): boolean {
  if (QUALIFIER_SUFFIXES.has(token)) return true;
  return CITY_PREFIXES.has(token.replace(/[省市]$/, ''));
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
  const matches = (prefix: string, suffix: string) =>
    (prefix === '' && suffix === '') ||
    (prefix === '' && isQualifierSuffix(suffix)) ||
    (suffix === '' && isQualifierPrefix(prefix)) ||
    (isQualifierPrefix(prefix) && isQualifierSuffix(suffix));
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
): GeocodeResolution['poi'] {
  const scored = pois.map((poi) => {
    const grade = gradeOfficePoi(poi, companyName, province, city);
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
  reason?: 'no-key' | 'http' | 'parse' | 'quota' | `baidu-status:${number}`;
  amapUnavailable?: boolean;
  provider?: 'amap' | 'baidu';
}

/**
 * v3/place/text scoped to one city. No key → no-op; Baidu place search is the
 * fallback when AMap is key-less or daily-quota exhausted (10044). All
 * providers return GCJ-02 (AMap native / Baidu ret_coordtype=gcj02ll). Callers
 * throttle — ≥600ms when amapUnavailable.
 */
export async function placeTextSearchRest(
  query: string,
  city = '杭州',
  fetchImpl: typeof fetch = fetch,
): Promise<PlaceTextResult> {
  const key = amapWebKey();
  if (!key) {
    if (baiduWebKey()) {
      const b = await baiduPlaceSearchRest(query, city, fetchImpl);
      return { ...b, amapUnavailable: true };
    }
    return { ok: false, pois: [], reason: 'no-key' };
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
      if (down && baiduWebKey()) {
        const b = await baiduPlaceSearchRest(query, city, fetchImpl);
        return { ...b, amapUnavailable: true };
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
  amapUnavailable?: boolean;
  provider?: 'amap' | 'baidu';
}

/**
 * A regeo hit confirms a coordinate sits in `target` city. 直辖市 (北京/上海)
 * regeo 的 cityname 为空 — province 兜底校验 (北京 POI 的 pname = '北京市').
 * 百度 regeo 直辖市直接返回 city='上海市' (无此问题, 统一走同一条校验).
 */
export function regeoMatchesTarget(re: RegeoResult, target: CityTarget): { ok: boolean; reason?: string } {
  if (re.province && re.province !== target.province) return { ok: false, reason: `outside-province:${re.province}` };
  if (re.cityname && re.cityname !== target.city) return { ok: false, reason: `outside-city:${re.cityname}` };
  return { ok: true };
}

/**
 * Confirm a coordinate sits in the target city: AMap v3/geocode/regeo, falling
 * back to Baidu reverse_geocoding/v3 when AMap is key-less / quota-exhausted.
 */
export async function regeoCityRest(
  lng: number,
  lat: number,
  fetchImpl: typeof fetch = fetch,
): Promise<RegeoResult> {
  const key = amapWebKey();
  if (!key) {
    if (baiduWebKey()) {
      const b = await baiduRegeoCityRest(lng, lat, fetchImpl);
      return { ...b, amapUnavailable: true };
    }
    return { ok: false };
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
      regeocode?: { addressComponent?: { cityname?: string; district?: string; province?: string; adcode?: string } };
    };
    const comp = payload.regeocode?.addressComponent;
    if (payload.status !== '1' || !comp) {
      const down = amapQuotaExhausted(payload);
      if (down && baiduWebKey()) {
        const b = await baiduRegeoCityRest(lng, lat, fetchImpl);
        return { ...b, amapUnavailable: true };
      }
      return { ok: false, amapUnavailable: down };
    }
    return { ok: true, provider: 'amap', cityname: comp.cityname, district: comp.district, province: comp.province };
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
  let payload: { status?: number; result?: { addressComponent?: { province?: string; city?: string; district?: string } } };
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
    return { ok: true, provider: 'baidu', cityname: comp.city, district: comp.district, province: comp.province };
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
