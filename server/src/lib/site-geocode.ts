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

export interface RestGeocodeResult {
  ok: boolean;
  location?: POILocation;
  reason?: 'no-key' | 'http' | 'empty' | 'parse';
}

/**
 * Optional Web 服务 geocode. Missing AMAP_WEB_KEY → no-op.
 * Caller must not log the key. QPS stays 3/s at the call site.
 */
export async function geocodeAddressRest(
  query: string,
  city = '杭州',
  fetchImpl: typeof fetch = fetch,
): Promise<RestGeocodeResult> {
  const key = amapWebKey();
  if (!key) return { ok: false, reason: 'no-key' };
  const url = new URL('https://restapi.amap.com/v3/geocode/geo');
  url.searchParams.set('address', query);
  url.searchParams.set('city', city);
  url.searchParams.set('output', 'JSON');
  url.searchParams.set('key', key);
  let payload: { status?: string; geocodes?: Array<{ location?: string }> };
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return { ok: false, reason: 'http' };
    payload = (await res.json()) as { status?: string; geocodes?: Array<{ location?: string }> };
  } catch {
    return { ok: false, reason: 'http' };
  }
  const raw = payload.geocodes?.[0]?.location;
  if (payload.status !== '1' || !raw || typeof raw !== 'string') {
    return { ok: false, reason: 'empty' };
  }
  const [lngRaw, latRaw] = raw.split(',');
  const lng = Number(lngRaw);
  const lat = Number(latRaw);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return { ok: false, reason: 'parse' };
  return { ok: true, location: { lng, lat, address: query } };
}

// ---------------------------------------------------------------------------
// Office discovery via AMap place-text search (Web 服务, same AMAP_WEB_KEY).
// Used to give city-list-only radar sites a real Hangzhou office + street
// address instead of pinning a company at a city center. Callers throttle QPS.
// ---------------------------------------------------------------------------

/** Known aliases: radar snapshot names → the name AMap actually knows. */
export const COMPANY_QUERY_ALIASES: Record<string, string> = {
  认养: '认养一头牛',
  财通证劵: '财通证券',
  字节跳动Seed大模型: '字节跳动',
  淘天集团: '淘天集团',
  商汤科技: '商汤科技',
  阿里淘天: '淘天集团',
};

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
  const q = normalizeNameForMatch(companyName);
  const c = normalizeNameForMatch(poi.name);
  const match = q.length > 0 && c.length > 0 && (q.includes(c) || c.includes(q));
  const street = STREET_RE.test(poi.address);
  if (!match) return { confidence: 'low', reason: `name-mismatch:${poi.name}` };
  if (!street) return { confidence: 'medium', reason: 'name-match-no-street' };
  return { confidence: 'high', reason: `matched:${poi.name}` };
}

/** Best AMap hit for a company's Hangzhou office; office-type wins ties. */
export function pickBestOfficePoi(pois: OfficePoiCandidate[], companyName: string): GeocodeResolution['poi'] {
  const scored = pois.map((poi) => {
    const grade = gradeOfficePoi(poi, companyName);
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
  reason?: 'no-key' | 'http' | 'parse';
}

/** v3/place/text scoped to one city. No key → no-op; callers throttle. */
export async function placeTextSearchRest(
  query: string,
  city = '杭州',
  fetchImpl: typeof fetch = fetch,
): Promise<PlaceTextResult> {
  const key = amapWebKey();
  if (!key) return { ok: false, pois: [], reason: 'no-key' };
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
    const payload = (await res.json()) as { status?: string; pois?: Array<Record<string, unknown>> };
    if (payload.status !== '1') return { ok: false, pois: [], reason: 'parse' };
    return { ok: true, pois: (payload.pois ?? []).map(parseOfficePoi).filter((p): p is OfficePoiCandidate => !!p) };
  } catch {
    return { ok: false, pois: [], reason: 'http' };
  }
}

export interface RegeoResult {
  ok: boolean;
  cityname?: string;
  district?: string;
  province?: string;
}

/**
 * A regeo hit confirms a coordinate sits in `target` city. 直辖市 (北京/上海)
 * regeo 的 cityname 为空 — province 兜底校验 (北京 POI 的 pname = '北京市').
 */
export function regeoMatchesTarget(re: RegeoResult, target: CityTarget): { ok: boolean; reason?: string } {
  if (re.province && re.province !== target.province) return { ok: false, reason: `outside-province:${re.province}` };
  if (re.cityname && re.cityname !== target.city) return { ok: false, reason: `outside-city:${re.cityname}` };
  return { ok: true };
}

/** v3/geocode/regeo: confirm a coordinate actually sits in the target city. */
export async function regeoCityRest(
  lng: number,
  lat: number,
  fetchImpl: typeof fetch = fetch,
): Promise<RegeoResult> {
  const key = amapWebKey();
  if (!key) return { ok: false };
  const url = new URL('https://restapi.amap.com/v3/geocode/regeo');
  url.searchParams.set('location', `${lng},${lat}`);
  url.searchParams.set('output', 'JSON');
  url.searchParams.set('key', key);
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return { ok: false };
    const payload = (await res.json()) as {
      status?: string;
      regeocode?: { addressComponent?: { cityname?: string; district?: string; province?: string; adcode?: string } };
    };
    const comp = payload.regeocode?.addressComponent;
    if (payload.status !== '1' || !comp) return { ok: false };
    return { ok: true, cityname: comp.cityname, district: comp.district, province: comp.province };
  } catch {
    return { ok: false };
  }
}
