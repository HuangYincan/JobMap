// Validate and dedupe recruitment source companies before a DB upsert.
// Live insert waits on DATABASE_URL + migrations 002/006. Tests cover
// the dry-run path only.

import { getPool } from './db.ts';
import type { SourceCompany, SourcePosition } from './recruitment-source.ts';
import { TIER_DEFAULT } from './lod.ts';
import { bossAdapter } from './recruitment-adapters/boss.ts';
import { nowcoderAdapter } from './recruitment-adapters/nowcoder.ts';
import { officialCareerAdapter } from './recruitment-adapters/official-career.ts';
import { radarAdapter } from './recruitment-adapters/radar.ts';
import { seedRecruitmentAdapter } from './recruitment-adapters/seed.ts';
import { shixisengAdapter } from './recruitment-adapters/shixiseng.ts';
import { isAuthenticPositionId } from './freshness.ts';
import { HANGZHOU_DISTRICTS } from './spatial-filters.ts';
import type { CompanySite, JobTaxonomy } from './types.ts';

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

/** 首批目标城市（tech/18 D2）。地址解析只认这些城市的名字。 */
const TARGET_CITIES = ['北京', '上海', '广州', '深圳', '成都', '武汉', '杭州'] as const;

/**
 * drop 自带 source code → sources 表元数据（sources.code 约束 ^[a-z][a-z0-9-]*$）。
 * 未收录的 code（或 drop 缺 source）回退 'seed' —— 未知 code 不臆造 provenance。
 * 取值与 tech/roles/data/etl/ 各源评审一致（xiaozhao-radar.md / feishu-ats.md /
 * official-career.md），attribution 保留「Domain Map curated seed」语义。
 */
const SOURCE_META: Record<string, { originUri: string; authorizationBasis: string; accessMethod: string; attribution: string; retention: string; deletion: string }> = {
  seed: {
    originUri: 'local:WORK_SEED',
    authorizationBasis: 'curated-public',
    accessMethod: 'manual',
    attribution: 'Domain Map curated seed',
    retention: 'until-replaced',
    deletion: 'delete-with-source',
  },
  'official-career': {
    originUri: 'local:WORK_SEED',
    authorizationBasis: 'curated-public',
    accessMethod: 'manual',
    attribution: 'Domain Map curated official career pages',
    retention: 'until-replaced',
    deletion: 'delete-with-source',
  },
  'feishu-ats': {
    originUri: 'https://*.jobs.feishu.cn',
    authorizationBasis: 'public-api',
    accessMethod: 'polite-json-api',
    attribution: 'Feishu ATS public job search API (tech/roles/data/etl/feishu-ats.md)',
    retention: 'until-replaced',
    deletion: 'delete-with-source',
  },
  'xiaozhao-radar': {
    originUri: 'https://raw.githubusercontent.com/jiabaobei/xiaozhao-radar/main/jobs.json',
    authorizationBasis: 'apache-2.0',
    accessMethod: 'public-file',
    attribution: 'xiaozhao-radar contributors (Apache-2.0); Domain Map field mapping',
    retention: 'until-replaced',
    deletion: 'delete-with-source',
  },
};

/**
 * site 城市名（写入 company_sites.city）：site.city 字段优先（WS2 drop 形状）；
 * 否则从 location.address 解析 —— 地址等于目标城市名、以「城市名+市」开头，
 * 或以杭州区名开头（'西湖区龙井路1号' → 杭州）。多城市文本（'北京/上海'）与
 * 无法识别地址返回 null（保持现状，不猜）。
 */
export function siteCityOf(site: CompanySite): string | null {
  const city = site.city?.trim();
  if (city) return city;
  const address = site.location?.address?.trim();
  if (!address) return null;
  for (const name of TARGET_CITIES) {
    if (address === name || address.startsWith(`${name}市`)) return name;
  }
  if (HANGZHOU_DISTRICTS.some((district) => address.startsWith(district.value))) return '杭州';
  return null;
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
  if (company.tier !== undefined && !(Number.isInteger(company.tier) && company.tier >= 0 && company.tier <= 21)) {
    issues.push(issue(slug, 'tier', `unknown ${company.tier}`));
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
  // logo 合并 (2026-08-19 Bug2): 非空不覆盖 — dedupe 保留第一个公司
  // (真实 drops 先行、seed 垫底), seed 的 logoUrl/logoEmoji 补上 drops 的
  // 空缺, 但不覆盖 drop 自带值 (drop 与 seed 均可提供)。
  if (!target.logoUrl && extra.logoUrl) target.logoUrl = extra.logoUrl;
  if (!target.logoEmoji && extra.logoEmoji) target.logoEmoji = extra.logoEmoji;
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
  // 真实 drops 优先于 seed 脚手架: dedupeSourceCompanies 保留每个 slug 的
  // 第一个公司, seed 里的示例副本 (过期坐标/tier/示例岗位) 会压过官方 drops
  // 的当前数据 (2026-08-19: tencent 被 seed 的 120.155 旧坐标盖掉, deepseek
  // tier 被 seed 的 12 盖掉官方 drop 的 1, 高 zoom 才可见)。seed 只补
  // 无 drops 的公司 (坐标骨架)。
  const plan = planRecruitmentImport([...official, ...radar, ...boss, ...nowcoder, ...shixiseng, ...seed]);
  // 数据策略 (2026-08-19): 公司有 portal-* 官方直爬岗位时, 抑制其 radar-*
  // 聚合行。radar 是快照聚合 (合成岗位, 非真实 JD); 官方 ATS 直爬是雇主录入
  // 的真实岗位 —— 同 slug 并存时后者优先 (dedupe 已保官方站点/坐标)。
  return suppressRadarForPortalCompanies(plan);
}

/** 有 portal-* 真实岗位的公司 → 丢弃同公司的 radar-* 快照行 (2026-08-19)。 */
export function suppressRadarForPortalCompanies(plan: ImportPlan): ImportPlan {
  const companies = plan.companies.map((company) => {
    const hasPortal = company.positions.some((pos) => pos.externalId.startsWith('portal-'));
    if (!hasPortal) return company;
    return {
      ...company,
      positions: company.positions.filter((pos) => !pos.externalId.startsWith('radar-')),
    };
  });
  return { ...plan, companies };
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

/**
 * Position taxonomy jsonb payload: keep the drop's family (and any other
 * taxonomy fields) and carry the aggregate flag so the DB read path can
 * show aggregate rows honestly. Family must never be dropped.
 */
export function positionTaxonomy(pos: SourcePosition): JobTaxonomy {
  return {
    ...(pos.taxonomy ?? { family: pos.family }),
    ...(pos.aggregate ? { aggregate: true } : {}),
  };
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
    // 落库 provenance: 尊重 drop 自带 source(2026-08-20 w5),缺失回退 'seed'。
    // 按 code 幂等 upsert 并缓存,同一次 apply 内同 code 只写一行 sources。
    const sourceIds = new Map<string, string>();
    const sourceIdFor = async (code: string): Promise<string> => {
      const cached = sourceIds.get(code);
      if (cached) return cached;
      const meta = SOURCE_META[code] ?? SOURCE_META.seed;
      const source = await client.query<{ id: string }>(
        `INSERT INTO sources (
           code, origin_uri, authorization_basis, allowed_access_method,
           attribution_text, retention_policy, deletion_policy
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (code) DO UPDATE SET origin_uri = EXCLUDED.origin_uri
         RETURNING id::text`,
        [code, meta.originUri, meta.authorizationBasis, meta.accessMethod, meta.attribution, meta.retention, meta.deletion],
      );
      const id = source.rows[0].id;
      sourceIds.set(code, id);
      return id;
    };

    for (const company of authentic) {
      const sourceId = await sourceIdFor(company.source ?? 'seed');
      const upserted = await client.query<{ id: string }>(
        `INSERT INTO companies (slug, name, industries, scale, rating, summary, career_url, logo_url, logo_emoji, tier, category)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name,
           industries = EXCLUDED.industries,
           scale = EXCLUDED.scale,
           rating = EXCLUDED.rating,
           summary = EXCLUDED.summary,
           career_url = EXCLUDED.career_url,
           logo_url = COALESCE(EXCLUDED.logo_url, logo_url),
           logo_emoji = COALESCE(EXCLUDED.logo_emoji, logo_emoji),
           tier = EXCLUDED.tier,
           category = EXCLUDED.category,
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
          company.tier ?? TIER_DEFAULT,
          company.category ?? 'other',
        ],
      );
      const companyId = upserted.rows[0].id;
      companies += 1;

      const siteIds = new Map<string, string>();
      for (const site of company.sites) {
        const siteCity = siteCityOf(site);
        // 站点合并键 = drop 的 site.id (site_key)。按 (company_id, name) 合并会
        // 把多城市公司同名站点全部折叠进一行,city/坐标互相覆盖 (2026-08-19 事故:
        // 得物/米哈游等 9 家 import 后只剩 1 站,米哈游 city=北京市 坐标却在上海)。
        const existing = await client.query<{ id: string }>(
          `SELECT id::text FROM company_sites WHERE company_id = $1 AND site_key = $2 LIMIT 1`,
          [companyId, site.id],
        );
        let siteRowId = existing.rows[0]?.id;
        if (!siteRowId) {
          // site_key 迁移前的存量行: 按 (name, city) 一次性认领并回填 key。
          // 多城市站点按城市区分, (name, city) 组合唯一, 不会误配。
          const legacy = await client.query<{ id: string }>(
            `SELECT id::text FROM company_sites
              WHERE company_id = $1 AND name = $2 AND site_key IS NULL
                AND city IS NOT DISTINCT FROM $3
              LIMIT 1`,
            [companyId, site.name, siteCity],
          );
          if (legacy.rows[0]) {
            siteRowId = legacy.rows[0].id;
            await client.query(
              `UPDATE company_sites SET site_key = $3 WHERE id = $1 AND company_id = $2`,
              [siteRowId, companyId, site.id],
            );
          }
        }
        if (!siteRowId) {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO company_sites (company_id, name, site_key, address, city, province, city_code, lng, lat, career_url, logo_url, source_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING id::text`,
            [
              companyId,
              site.name,
              site.id,
              site.location?.address ?? null,
              siteCity,
              site.province ?? null,
              site.cityCode ?? null,
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
               site_key = $3,
               address = $4, city = $5, province = $6, city_code = $7,
               lng = COALESCE($8, lng), lat = COALESCE($9, lat),
               career_url = $10, logo_url = $11, source_id = $12, updated_at = now()
             WHERE id = $1 AND company_id = $2`,
            // COALESCE: 绝不因 drop 缺坐标而清空已 geocoded 的既有坐标
            // (2026-08-19 事故:refresh-radar 重生成 drops 丢坐标后,import:apply
            //  曾把 DB 里唯一的坐标覆盖成 NULL,地图 79 pins → 2)。
            [
              siteRowId,
              companyId,
              site.id,
              site.location?.address ?? null,
              siteCity,
              site.province ?? null,
              site.cityCode ?? null,
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
            JSON.stringify(positionTaxonomy(pos)),
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
