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

export function geocodeQueryForSite(companyName: string, site: CompanySite, city = '杭州'): string {
  const address = site.location?.address?.trim();
  if (address) return `${address} ${companyName}`;
  return `${city} ${companyName} ${site.name}`.trim();
}

export function planSiteGeocode(companies: SourceCompany[], city = '杭州'): GeocodePlan {
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
      needs.push({
        slug: company.slug,
        companyName: company.name,
        siteId: site.id,
        siteName: site.name,
        query: geocodeQueryForSite(company.name, site, city),
        city,
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
    }>(
      `SELECT s.id::text, c.slug AS company_slug, c.name AS company_name,
              s.name AS site_name, s.address
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
      query: row.address?.trim()
        ? `${row.address.trim()} ${row.company_name}`
        : `杭州 ${row.company_name} ${row.site_name}`,
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
