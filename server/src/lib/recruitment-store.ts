// Read imported recruitment rows when DATABASE_URL is set.
// One company + one site → POI id = companies.slug (matches WORK_SEED).
// No rows / no database → caller falls back to seed.

import { getPool } from './db.ts';
import { companySitesSpatialSql, hasSpatialClip, type SpatialClip } from './spatial-query.ts';
import type { ApplySource, JobFamily, JobTaxonomy, RecruitmentPOI } from './types.ts';

interface CompanyRow {
  id: string;
  slug: string;
  name: string;
  industries: string[];
  scale: RecruitmentPOI['company']['scale'] | null;
  rating: string | number | null;
  summary: string | null;
  career_url: string | null;
  logo_url: string | null;
  logo_emoji: string | null;
}

interface SiteRow {
  id: string;
  company_id: string;
  name: string;
  address: string | null;
  lng: number | null;
  lat: number | null;
  career_url: string | null;
  logo_url: string | null;
}

interface PositionRow {
  company_id: string;
  site_id: string;
  external_id: string;
  title: string;
  department: string | null;
  family: JobFamily;
  taxonomy: JobTaxonomy | null;
  salary_min: string | number | null;
  salary_max: string | number | null;
  education: string | null;
  majors: string[] | null;
  skills: string[] | null;
  description: string | null;
  deadline: Date | string | null;
  apply_source: ApplySource | null;
  apply_url: string | null;
  status: 'open' | 'closed' | 'paused';
}

function num(value: string | number | null | undefined): number | undefined {
  if (value == null) return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function hasPlausibleCoord(lng: number | null, lat: number | null): boolean {
  return Number.isFinite(lng) && Number.isFinite(lat) && !(lng === 0 && lat === 0);
}

export async function loadWorkCatalogFromDb(clip?: SpatialClip): Promise<RecruitmentPOI[] | null> {
  const pool = getPool();
  if (!pool) return null;
  try {
    const spatial = companySitesSpatialSql(clip);
    const siteSql = hasSpatialClip(clip)
      ? `SELECT s.id::text, s.company_id::text, s.name, s.address, s.lng, s.lat, s.career_url, s.logo_url
         FROM company_sites s
         WHERE s.geom IS NOT NULL${spatial.sql}`
      : `SELECT id::text, company_id::text, name, address, lng, lat, career_url, logo_url
         FROM company_sites`;
    const sites = await pool.query<SiteRow>(siteSql, spatial.params);
    if (hasSpatialClip(clip) && sites.rows.length === 0) return [];

    // Ungeocoded sites (address-only, lng/lat NULL) must not pin at (0,0).
    // A clip already restricts to geom-bearing sites; the unrestricted path filters here.
    const located = sites.rows.filter((site) => hasPlausibleCoord(site.lng, site.lat));
    if (located.length === 0) return null;

    const companyIds = [...new Set(located.map((site) => site.company_id))];
    const siteIds = located.map((site) => site.id);
    const companySql = hasSpatialClip(clip)
      ? `SELECT id::text, slug, name, industries, scale, rating, summary, career_url, logo_url, logo_emoji
         FROM companies WHERE id = ANY($1::bigint[]) ORDER BY slug`
      : `SELECT id::text, slug, name, industries, scale, rating, summary, career_url, logo_url, logo_emoji
         FROM companies ORDER BY slug`;
    const positionSql = hasSpatialClip(clip)
      ? `SELECT company_id::text, site_id::text, external_id, title, department, family, taxonomy,
                salary_min, salary_max, education, majors, skills, description, deadline,
                apply_source, apply_url, status
         FROM positions WHERE status = 'open' AND site_id = ANY($1::bigint[])`
      : `SELECT company_id::text, site_id::text, external_id, title, department, family, taxonomy,
                salary_min, salary_max, education, majors, skills, description, deadline,
                apply_source, apply_url, status
         FROM positions WHERE status = 'open'`;
    const [companies, positions] = await Promise.all([
      pool.query<CompanyRow>(companySql, hasSpatialClip(clip) ? [companyIds] : []),
      pool.query<PositionRow>(positionSql, hasSpatialClip(clip) ? [siteIds] : []),
    ]);
    if (companies.rows.length === 0) return [];

    const sitesByCompany = new Map<string, SiteRow[]>();
    for (const site of located) {
      const list = sitesByCompany.get(site.company_id) ?? [];
      list.push(site);
      sitesByCompany.set(site.company_id, list);
    }
    const positionsBySite = new Map<string, PositionRow[]>();
    for (const pos of positions.rows) {
      const list = positionsBySite.get(pos.site_id) ?? [];
      list.push(pos);
      positionsBySite.set(pos.site_id, list);
    }

    const pois: RecruitmentPOI[] = [];
    for (const company of companies.rows) {
      const companySites = sitesByCompany.get(company.id) ?? [];
      if (companySites.length === 0) continue;
      for (const site of companySites) {
        const id = companySites.length === 1 ? company.slug : `${company.slug}:${site.id}`;
        const loc = {
          lng: site.lng ?? 0,
          lat: site.lat ?? 0,
          address: site.address ?? undefined,
        };
        pois.push({
          id,
          kind: 'recruitment',
          name: company.name,
          mode: 'work',
          source: 'api',
          location: loc,
          company: {
            name: company.name,
            industries: company.industries ?? [],
            scale: company.scale ?? 'startup',
            rating: num(company.rating),
            logo: company.logo_emoji ?? undefined,
            logoUrl: company.logo_url ?? undefined,
            summary: company.summary ?? undefined,
            careerUrl: site.career_url || company.career_url || undefined,
          },
          sites: [
            {
              id: site.id,
              name: site.name,
              location: loc,
              careerUrl: site.career_url ?? undefined,
              logoUrl: site.logo_url ?? undefined,
            },
          ],
          positions: (positionsBySite.get(site.id) ?? []).map((pos) => ({
            id: pos.external_id,
            siteId: site.id,
            title: pos.title,
            department: pos.department ?? undefined,
            type: pos.family,
            taxonomy: pos.taxonomy ?? { family: pos.family },
            salary:
              pos.salary_min != null || pos.salary_max != null
                ? { min: num(pos.salary_min) ?? 0, max: num(pos.salary_max) ?? 0 }
                : undefined,
            education: pos.education ?? undefined,
            majors: pos.majors ?? undefined,
            skills: pos.skills ?? undefined,
            description: pos.description ?? undefined,
            deadline: pos.deadline ? String(pos.deadline).slice(0, 10) : undefined,
            apply: pos.apply_url
              ? { source: pos.apply_source ?? 'official', url: pos.apply_url }
              : undefined,
            status: pos.status,
          })),
        });
      }
    }
    // A site with no open positions is not a map pin (matches the offline path).
    return pois.filter((poi) => poi.positions.length > 0);
  } catch {
    return null;
  }
}
