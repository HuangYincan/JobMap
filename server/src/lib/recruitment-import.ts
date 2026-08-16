// Validate and dedupe recruitment source companies before a DB upsert.
// Live insert waits on DATABASE_URL + migrations 002/006. Tests cover
// the dry-run path only.

import type { SourceCompany, SourcePosition } from './recruitment-source.ts';
import { seedRecruitmentAdapter } from './recruitment-adapters/seed.ts';

export interface ImportIssue {
  slug: string;
  field: string;
  message: string;
}

export interface ImportPlan {
  companies: SourceCompany[];
  issues: ImportIssue[];
  dropped: number;
}

const FAMILIES = new Set(['intern', 'campus', 'social']);
const SCALES = new Set(['startup', 'unicorn', 'bigtech', 'enterprise']);
const STATUSES = new Set(['open', 'closed', 'paused']);

function issue(slug: string, field: string, message: string): ImportIssue {
  return { slug, field, message };
}

export function validateSourceCompany(company: SourceCompany): ImportIssue[] {
  const slug = company.slug?.trim() || '(missing-slug)';
  const issues: ImportIssue[] = [];
  if (!company.slug?.trim()) issues.push(issue(slug, 'slug', 'required'));
  if (!company.name?.trim()) issues.push(issue(slug, 'name', 'required'));
  if (!Array.isArray(company.industries) || company.industries.length === 0) {
    issues.push(issue(slug, 'industries', 'need at least one'));
  }
  if (company.scale && !SCALES.has(company.scale)) {
    issues.push(issue(slug, 'scale', `unknown ${company.scale}`));
  }
  if (!company.sites.length) issues.push(issue(slug, 'sites', 'need at least one site'));

  const siteIds = new Set<string>();
  for (const site of company.sites) {
    if (!site.id?.trim()) issues.push(issue(slug, 'sites.id', 'required'));
    else if (siteIds.has(site.id)) issues.push(issue(slug, 'sites.id', `duplicate ${site.id}`));
    else siteIds.add(site.id);
    const loc = site.location;
    if (loc) {
      if (!Number.isFinite(loc.lng) || loc.lng < -180 || loc.lng > 180) {
        issues.push(issue(slug, 'sites.lng', `invalid ${loc.lng}`));
      }
      if (!Number.isFinite(loc.lat) || loc.lat < -90 || loc.lat > 90) {
        issues.push(issue(slug, 'sites.lat', `invalid ${loc.lat}`));
      }
    }
  }

  const externals = new Set<string>();
  for (const pos of company.positions) {
    const problems = validatePosition(pos, siteIds);
    for (const field of problems) issues.push(issue(slug, field, 'invalid'));
    if (pos.externalId && externals.has(pos.externalId)) {
      issues.push(issue(slug, 'positions.externalId', `duplicate ${pos.externalId}`));
    } else if (pos.externalId) {
      externals.add(pos.externalId);
    }
  }
  return issues;
}

function validatePosition(pos: SourcePosition, siteIds: Set<string>): string[] {
  const bad: string[] = [];
  if (!pos.externalId?.trim()) bad.push('positions.externalId');
  if (!pos.title?.trim()) bad.push('positions.title');
  if (!FAMILIES.has(pos.family)) bad.push('positions.family');
  if (!STATUSES.has(pos.status)) bad.push('positions.status');
  if (!pos.siteId || !siteIds.has(pos.siteId)) bad.push('positions.siteId');
  return bad;
}

/** Keep the first company per slug; merge extra sites/positions onto it. */
export function dedupeSourceCompanies(input: SourceCompany[]): SourceCompany[] {
  const bySlug = new Map<string, SourceCompany>();
  for (const raw of input) {
    const slug = raw.slug.trim();
    const existing = bySlug.get(slug);
    if (!existing) {
      bySlug.set(slug, cloneCompany(raw));
      continue;
    }
    mergeCompany(existing, raw);
  }
  return [...bySlug.values()];
}

function cloneCompany(company: SourceCompany): SourceCompany {
  return {
    ...company,
    industries: [...company.industries],
    sites: company.sites.map((site) => ({ ...site, location: site.location ? { ...site.location } : undefined })),
    positions: company.positions.map((pos) => ({ ...pos, majors: pos.majors ? [...pos.majors] : undefined, skills: pos.skills ? [...pos.skills] : undefined })),
  };
}

function mergeCompany(target: SourceCompany, extra: SourceCompany): void {
  for (const site of extra.sites) {
    if (!target.sites.some((row) => row.id === site.id)) target.sites.push({ ...site });
  }
  const seen = new Set(target.positions.map((pos) => pos.externalId));
  for (const pos of extra.positions) {
    if (!seen.has(pos.externalId)) {
      target.positions.push({ ...pos });
      seen.add(pos.externalId);
    }
  }
}

export function planRecruitmentImport(input: SourceCompany[]): ImportPlan {
  const merged = dedupeSourceCompanies(input);
  const issues: ImportIssue[] = [];
  const companies: SourceCompany[] = [];
  for (const company of merged) {
    const found = validateSourceCompany(company);
    if (found.length) {
      issues.push(...found);
      continue;
    }
    companies.push(company);
  }
  return {
    companies,
    issues,
    dropped: merged.length - companies.length,
  };
}

export async function planSeedImport(): Promise<ImportPlan> {
  return planRecruitmentImport(await seedRecruitmentAdapter.list());
}
