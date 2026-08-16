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

export function logoForSite(company: SourceCompany, site?: CompanySite): ResolvedLogo {
  return resolveCompanyLogo({
    siteCareerUrl: site?.careerUrl,
    siteLogoUrl: site?.logoUrl,
    companyCareerUrl: company.careerUrl,
    companyLogoUrl: company.logoUrl,
    fallbackEmoji: company.logoEmoji,
  });
}

/** 把源记录压成现有 RecruitmentPOI（一职场一张地图点）。 */
export function sourceCompanyToPois(
  company: SourceCompany,
  source: RecruitmentPOI['source'] = 'api',
): RecruitmentPOI[] {
  const sites = company.sites.length
    ? company.sites
    : [{ id: `${company.slug}-hq`, name: company.name, careerUrl: company.careerUrl }];

  return sites.map((site) => {
    const logo = logoForSite(company, site);
    const sitePositions = company.positions.filter((p) => p.siteId === site.id);
    return {
      id: `${company.slug}:${site.id}`,
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
      positions: sitePositions.map((p) => ({
        id: p.externalId,
        siteId: p.siteId,
        title: p.title,
        department: p.department,
        type: p.family,
        taxonomy: p.taxonomy ?? { family: p.family },
        salary: p.salary,
        education: p.education,
        majors: p.majors,
        skills: p.skills,
        description: p.description,
        deadline: p.deadline,
        apply: p.applyUrl
          ? { source: p.applySource ?? 'official', url: p.applyUrl }
          : undefined,
        status: p.status,
      })),
    };
  });
}
