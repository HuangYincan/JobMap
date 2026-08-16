// Validate and dedupe recruitment source companies before a DB upsert.
// Live insert waits on DATABASE_URL + migrations 002/006. Tests cover
// the dry-run path only.

import { getPool } from './db.ts';
import type { SourceCompany, SourcePosition } from './recruitment-source.ts';
import { bossAdapter } from './recruitment-adapters/boss.ts';
import { nowcoderAdapter } from './recruitment-adapters/nowcoder.ts';
import { officialCareerAdapter } from './recruitment-adapters/official-career.ts';
import { radarAdapter } from './recruitment-adapters/radar.ts';
import { seedRecruitmentAdapter } from './recruitment-adapters/seed.ts';
import { shixisengAdapter } from './recruitment-adapters/shixiseng.ts';
import { isAuthenticPositionId } from './freshness.ts';

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
      // Address-only sites are valid (pending geocode); validate only present coords.
      if (loc.lng !== undefined && (!Number.isFinite(loc.lng) || loc.lng < -180 || loc.lng > 180)) {
        issues.push(issue(slug, 'sites.lng', `invalid ${loc.lng}`));
      }
      if (loc.lat !== undefined && (!Number.isFinite(loc.lat) || loc.lat < -90 || loc.lat > 90)) {
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
  // positions.deadline is a date column; non-ISO deadlines crash the apply.
  if (pos.deadline && normalizeDeadline(pos.deadline) === null) bad.push('positions.deadline');
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
  const [seed, official, boss, nowcoder, shixiseng, radar] = await Promise.all([
    seedRecruitmentAdapter.list(),
    officialCareerAdapter().list(),
    bossAdapter().list(),
    nowcoderAdapter().list(),
    shixisengAdapter().list(),
    radarAdapter().list(),
  ]);
  return planRecruitmentImport([...seed, ...official, ...boss, ...nowcoder, ...shixiseng, ...radar]);
}

export async function planOfficialCareerImport(dir?: string): Promise<ImportPlan> {
  return planRecruitmentImport(await officialCareerAdapter(dir).list());
}

export interface ImportApplyResult {
  wrote: boolean;
  reason?: 'no-database' | 'empty-plan';
  companies: number;
  sites: number;
  positions: number;
}

/**
 * Normalize a position deadline to an ISO date or null (positions.deadline is a
 * date column). Mirrors crawler parse_deadline: YYYY[-/ .]MM[-/ .]DD, delimiters
 * optional; calendar-invalid dates and human text ("招满即止") → null.
 */
function normalizeDeadline(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = /^(\d{4})\s*[-/.]?\s*(\d{1,2})\s*[-/.]?\s*(\d{1,2})$/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) {
    return null;
  }
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** Upsert a validated plan. No DATABASE_URL → no-op (tests / laptop without Docker). */
export async function applyRecruitmentImport(plan: ImportPlan): Promise<ImportApplyResult> {
  if (plan.companies.length === 0) {
    return { wrote: false, reason: 'empty-plan', companies: 0, sites: 0, positions: 0 };
  }
  // Product rule (2026-08-17): only authentic positions (radar-* / portal-*) are
  // imported/kept open — example jobs stay closed even if a drop re-offers them.
  const authentic = plan.companies.map((company) => ({
    ...company,
    positions: company.positions.filter((pos) => isAuthenticPositionId(pos.externalId)),
  }));
  const pool = getPool();
  if (!pool) {
    return {
      wrote: false,
      reason: 'no-database',
      companies: authentic.length,
      sites: authentic.reduce((n, c) => n + c.sites.length, 0),
      positions: authentic.reduce((n, c) => n + c.positions.length, 0),
    };
  }

  const client = await pool.connect();
  let companies = 0;
  let sites = 0;
  let positions = 0;
  try {
    await client.query('BEGIN');
    const source = await client.query<{ id: string }>(
      `INSERT INTO sources (
         code, origin_uri, authorization_basis, allowed_access_method,
         attribution_text, retention_policy, deletion_policy
       ) VALUES (
         'seed', 'local:WORK_SEED', 'curated-public', 'manual',
         'Domain Map curated seed', 'until-replaced', 'delete-with-source'
       )
       ON CONFLICT (code) DO UPDATE SET origin_uri = EXCLUDED.origin_uri
       RETURNING id::text`,
    );
    const sourceId = source.rows[0].id;

    for (const company of authentic) {
      const upserted = await client.query<{ id: string }>(
        `INSERT INTO companies (slug, name, industries, scale, rating, summary, career_url, logo_url, logo_emoji)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name,
           industries = EXCLUDED.industries,
           scale = EXCLUDED.scale,
           rating = EXCLUDED.rating,
           summary = EXCLUDED.summary,
           career_url = EXCLUDED.career_url,
           logo_url = EXCLUDED.logo_url,
           logo_emoji = EXCLUDED.logo_emoji,
           updated_at = now()
         RETURNING id::text`,
        [
          company.slug,
          company.name,
          company.industries,
          company.scale ?? null,
          company.rating ?? null,
          company.summary ?? null,
          company.careerUrl ?? null,
          company.logoUrl ?? null,
          company.logoEmoji ?? null,
        ],
      );
      const companyId = upserted.rows[0].id;
      companies += 1;

      const siteIds = new Map<string, string>();
      for (const site of company.sites) {
        const existing = await client.query<{ id: string }>(
          `SELECT id::text FROM company_sites WHERE company_id = $1 AND name = $2 LIMIT 1`,
          [companyId, site.name],
        );
        let siteRowId = existing.rows[0]?.id;
        if (!siteRowId) {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO company_sites (company_id, name, address, city, lng, lat, career_url, logo_url, source_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id::text`,
            [
              companyId,
              site.name,
              site.location?.address ?? null,
              null,
              site.location?.lng ?? null,
              site.location?.lat ?? null,
              site.careerUrl ?? null,
              site.logoUrl ?? null,
              sourceId,
            ],
          );
          siteRowId = inserted.rows[0].id;
        } else {
          await client.query(
            `UPDATE company_sites SET
               address = $3, lng = $4, lat = $5, career_url = $6, logo_url = $7,
               source_id = $8, updated_at = now()
             WHERE id = $1 AND company_id = $2`,
            [
              siteRowId,
              companyId,
              site.location?.address ?? null,
              site.location?.lng ?? null,
              site.location?.lat ?? null,
              site.careerUrl ?? null,
              site.logoUrl ?? null,
              sourceId,
            ],
          );
        }
        siteIds.set(site.id, siteRowId);
        sites += 1;
      }

      for (const pos of company.positions) {
        const siteRowId = siteIds.get(pos.siteId);
        if (!siteRowId) continue;
        await client.query(
          `INSERT INTO positions (
             company_id, site_id, external_id, title, department, family, taxonomy,
             salary_min, salary_max, education, majors, skills, description, deadline,
             apply_source, apply_url, status, source_id
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7::jsonb,
             $8, $9, $10, $11, $12, $13, $14,
             $15, $16, $17, $18
           )
           ON CONFLICT (source_id, external_id) DO UPDATE SET
             title = EXCLUDED.title,
             department = EXCLUDED.department,
             family = EXCLUDED.family,
             taxonomy = EXCLUDED.taxonomy,
             salary_min = EXCLUDED.salary_min,
             salary_max = EXCLUDED.salary_max,
             education = EXCLUDED.education,
             majors = EXCLUDED.majors,
             skills = EXCLUDED.skills,
             description = EXCLUDED.description,
             deadline = EXCLUDED.deadline,
             apply_source = EXCLUDED.apply_source,
             apply_url = EXCLUDED.apply_url,
             status = EXCLUDED.status,
             site_id = EXCLUDED.site_id,
             updated_at = now()`,
          [
            companyId,
            siteRowId,
            pos.externalId,
            pos.title,
            pos.department ?? null,
            pos.family,
            JSON.stringify(pos.taxonomy ?? { family: pos.family }),
            pos.salary?.min ?? null,
            pos.salary?.max ?? null,
            pos.education ?? null,
            pos.majors ?? [],
            pos.skills ?? [],
            pos.description ?? null,
            pos.deadline ? normalizeDeadline(pos.deadline) : null,
            pos.applySource ?? null,
            pos.applyUrl ?? null,
            pos.status,
            sourceId,
          ],
        );
        positions += 1;
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return { wrote: true, companies, sites, positions };
}
