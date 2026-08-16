// ============================================================
// 招聘数据源插件
//
// 一家公司多个职场；一个岗位必须挂一个 site。
// 先 seed，再 official-career / boss 等 adapter。
// 过期岗位由 adapter 标 closed，新岗增量 upsert。
// ============================================================

import { resolveCompanyLogo, type ResolvedLogo } from './company-logo.ts';
import type { ApplySource, CompanySite, JobFamily, JobTaxonomy, RecruitmentPOI } from './types.ts';

export type RecruitmentSourceKind = 'seed' | 'official-career' | 'boss' | 'nowcoder' | 'shixiseng';

export interface SourcePosition {
  externalId: string;
  title: string;
  siteId: string;
  family: JobFamily;
  taxonomy?: JobTaxonomy;
  department?: string;
  salary?: { min: number; max: number };
  education?: string;
  majors?: string[];
  skills?: string[];
  description?: string;
  deadline?: string;
  applySource?: ApplySource;
  applyUrl?: string;
  status: 'open' | 'closed' | 'paused';
  retrievedAt?: string;
  expiresAt?: string;
}

export interface SourceCompany {
  slug: string;
  name: string;
  industries: string[];
  scale: RecruitmentPOI['company']['scale'];
  rating?: number;
  summary?: string;
  careerUrl?: string;
  logoUrl?: string;
  logoEmoji?: string;
  sites: CompanySite[];
  positions: SourcePosition[];
}

export interface RecruitmentAdapter {
  kind: RecruitmentSourceKind;
  list(): Promise<SourceCompany[]>;
}

/** 现有 RecruitmentPOI → 源记录（seed / 回写库表）。一 POI 一职场。 */
export function poiToSourceCompany(poi: RecruitmentPOI): SourceCompany {
  const siteId = poi.sites?.[0]?.id ?? `${poi.id}-site`;
  const site: CompanySite = poi.sites?.[0] ?? {
    id: siteId,
    name: poi.name,
    location: poi.location,
    careerUrl: poi.company.careerUrl,
    logoUrl: poi.company.logoUrl,
  };
  return {
    slug: poi.id.includes(':') ? poi.id.slice(0, poi.id.indexOf(':')) : poi.id,
    name: poi.company.name,
    industries: poi.company.industries,
    scale: poi.company.scale,
    rating: poi.company.rating,
    summary: poi.company.summary,
    careerUrl: poi.company.careerUrl,
    logoUrl: poi.company.logoUrl,
    logoEmoji: poi.company.logo,
    sites: [site],
    positions: poi.positions.map((p) => ({
      externalId: p.id,
      title: p.title,
      siteId: p.siteId ?? site.id,
      family: p.type,
      taxonomy: p.taxonomy,
      department: p.department,
      salary: p.salary,
      education: p.education,
      majors: p.majors,
      skills: p.skills,
      description: p.description,
      deadline: p.deadline,
      applySource: p.apply?.source,
      applyUrl: p.apply?.url,
      status: p.status,
    })),
  };
}

export async function collectRecruitmentPois(
  adapters: RecruitmentAdapter[],
  source: RecruitmentPOI['source'] = 'api',
): Promise<RecruitmentPOI[]> {
  const batches = await Promise.all(adapters.map((adapter) => adapter.list()));
  return batches.flatMap((companies) => companies.flatMap((company) => sourceCompanyToPois(company, source)));
}

export function logoForSite(company: SourceCompany, site?: CompanySite): ResolvedLogo {
  return resolveCompanyLogo({
    siteCareerUrl: site?.careerUrl,
    siteLogoUrl: site?.logoUrl,
    companyCareerUrl: company.careerUrl,
    companyLogoUrl: company.logoUrl,
    fallbackEmoji: company.logoEmoji,
  });
}

export function catalogSlug(poi: RecruitmentPOI): string {
  const colon = poi.id.indexOf(':');
  return colon === -1 ? poi.id : poi.id.slice(0, colon);
}

/** Single office keeps `slug`; extra offices become `slug:site.id`. */
export function catalogIdForSite(slug: string, siteId: string, siteCount: number): string {
  return siteCount === 1 ? slug : `${slug}:${siteId}`;
}

function positionFromSource(pos: SourcePosition) {
  return {
    id: pos.externalId,
    siteId: pos.siteId,
    title: pos.title,
    department: pos.department,
    type: pos.family,
    taxonomy: pos.taxonomy ?? { family: pos.family },
    salary: pos.salary,
    education: pos.education,
    majors: pos.majors,
    skills: pos.skills,
    description: pos.description,
    deadline: pos.deadline,
    apply: pos.applyUrl
      ? { source: pos.applySource ?? 'official', url: pos.applyUrl }
      : undefined,
    status: pos.status,
  };
}

function poiFromSourceSite(
  company: SourceCompany,
  site: CompanySite,
  id: string,
  source: RecruitmentPOI['source'],
): RecruitmentPOI {
  const logo = logoForSite(company, site);
  return {
    id,
    kind: 'recruitment',
    name: company.name,
    mode: 'work',
    source,
    location: site.location ?? { lng: 0, lat: 0 },
    company: {
      name: company.name,
      industries: company.industries,
      scale: company.scale,
      rating: company.rating,
      logo: logo.emoji,
      logoUrl: logo.url,
      summary: company.summary,
      careerUrl: site.careerUrl || company.careerUrl,
    },
    sites: [site],
    positions: company.positions.filter((p) => p.siteId === site.id).map(positionFromSource),
  };
}

/** Read-path ids: one site → slug, many sites → slug:site.id. */
export function sourceCompanyToCatalogPois(
  company: SourceCompany,
  source: RecruitmentPOI['source'] = 'api',
): RecruitmentPOI[] {
  const sites = company.sites.length
    ? company.sites
    : [{ id: `${company.slug}-hq`, name: company.name, careerUrl: company.careerUrl }];
  return sites.map((site) =>
    poiFromSourceSite(company, site, catalogIdForSite(company.slug, site.id, sites.length), source),
  );
}

/** 把源记录压成现有 RecruitmentPOI（一职场一张地图点）。 */
export function sourceCompanyToPois(
  company: SourceCompany,
  source: RecruitmentPOI['source'] = 'api',
): RecruitmentPOI[] {
  const sites = company.sites.length
    ? company.sites
    : [{ id: `${company.slug}-hq`, name: company.name, careerUrl: company.careerUrl }];

  return sites.map((site) => poiFromSourceSite(company, site, `${company.slug}:${site.id}`, source));
}

/** Union official-career drops onto seed POIs. Keep seed ids; add new slugs as catalog POIs. */
export function mergeOfficialCareerIntoSeed(
  seed: RecruitmentPOI[],
  official: SourceCompany[],
): RecruitmentPOI[] {
  const bySlug = new Map<string, RecruitmentPOI[]>();
  for (const poi of seed) {
    const slug = catalogSlug(poi);
    const list = bySlug.get(slug) ?? [];
    list.push({
      ...poi,
      sites: [...(poi.sites ?? [])],
      positions: [...poi.positions],
    });
    bySlug.set(slug, list);
  }

  const extras: RecruitmentPOI[] = [];
  for (const company of official) {
    const existing = bySlug.get(company.slug);
    if (existing) mergeCompanyOntoSeedPois(existing, company);
    else extras.push(...sourceCompanyToCatalogPois(company, 'api'));
  }
  return [...[...bySlug.values()].flat(), ...extras];
}

function mergeCompanyOntoSeedPois(pois: RecruitmentPOI[], company: SourceCompany): void {
  const knownSites = new Set(pois.flatMap((poi) => (poi.sites ?? []).map((site) => site.id)));
  const knownJobs = new Set(pois.flatMap((poi) => poi.positions.map((pos) => pos.id)));

  for (const site of company.sites) {
    if (knownSites.has(site.id)) continue;
    knownSites.add(site.id);
    pois.push(poiFromSourceSite(company, site, `${company.slug}:${site.id}`, 'api'));
  }

  for (const pos of company.positions) {
    if (knownJobs.has(pos.externalId)) continue;
    const target = pois.find((poi) => (poi.sites ?? []).some((site) => site.id === pos.siteId)) ?? pois[0];
    if (!target) continue;
    target.positions.push(positionFromSource(pos));
    knownJobs.add(pos.externalId);
  }
}
