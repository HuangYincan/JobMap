// Read imported recruitment rows when DATABASE_URL is set.
// One company + one site → POI id = companies.slug.
// Return contract (2026-08-25, fix/server-catalog-semantics; 2026-08-26 收紧):
//   null = no pool / query failure → caller keeps empty (strict DB-only, no offline seed);
//   []   = DB healthy but empty after clip or coord-filter → caller keeps empty.

import { getPool } from './db.ts';
import { isCityCenterPin } from './city-centers.ts';
import { resolveCompanyLogo, type ResolvedLogo } from './company-logo.ts';
import { cityBoundsConsistencySql, companySitesSpatialSql, hasSpatialClip, parseMaxTier, type SpatialClip } from './spatial-query.ts';
import type { ApplySource, JobFamily, JobTaxonomy, RecruitmentPOI } from './types.ts';

type DbPoolLike = {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

interface CompanyRow {
  id: string;
  slug: string;
  name: string;
  industries: string[];
  scale: RecruitmentPOI['company']['scale'] | null;
  tier: number | string | null;
  category: string | null;
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
  city: string | null;
  province: string | null;
  city_code: string | null;
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

/** deadline 是 date 列：pg 返回 Date 对象（本地午夜）。按本地时区格式化回 YYYY-MM-DD。 */
function isoDate(value: Date | string | null | undefined): string | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

/**
 * 站点岗位 = 精确 site_id 命中 ∪ 本公司聚合行(公司级在招信号, fan-out)。
 * 按 external_id 去重——聚合行的 site_id 恰等于本站 id 时不能双计;
 * 排序稳定: 具体行(查询顺序)在前, 聚合行在后。
 */
function positionsForSite(
  siteId: string,
  companyId: string,
  bySite: Map<string, PositionRow[]>,
  aggregates: PositionRow[],
): PositionRow[] {
  const rows = [
    ...(bySite.get(siteId) ?? []),
    ...aggregates.filter((pos) => pos.company_id === companyId),
  ];
  const seen = new Set<string>();
  const merged: PositionRow[] = [];
  for (const pos of rows) {
    if (seen.has(pos.external_id)) continue;
    seen.add(pos.external_id);
    merged.push(pos);
  }
  return merged;
}

/**
 * DB 行 → 公司级 logo（2026-08-19 Bug2 修复：DB 读路径此前直接读列、绕过
 * 解析链，672 家公司 logo_url/logo_emoji 全空 → 全 🏢）。
 * 已落库的 logo_url / logo_emoji 优先；两者皆空才走 company-logo.ts 解析链
 * （站点 logo → 站点 favicon → 公司 logo → 公司 favicon → 🏢 emoji），
 * 与离线 seed 路径（recruitment-source.logoForSite）共用同一链条。
 * 「无 logo → 🏢 emoji」的兜底语义不变。
 */
export function resolveDbCompanyLogo(
  company: Pick<CompanyRow, 'name' | 'logo_url' | 'logo_emoji' | 'career_url'>,
  site: Pick<SiteRow, 'career_url' | 'logo_url'>,
): ResolvedLogo {
  if (company.logo_url || company.logo_emoji) {
    return {
      url: company.logo_url ?? undefined,
      emoji: company.logo_emoji ?? '🏢',
      source: 'company',
    };
  }
  return resolveCompanyLogo({
    siteCareerUrl: site.career_url ?? undefined,
    siteLogoUrl: site.logo_url ?? undefined,
    companyCareerUrl: company.career_url ?? undefined,
    companyLogoUrl: company.logo_url ?? undefined,
    companyName: company.name,
  });
}

export async function loadWorkCatalogFromDb(
  clip?: SpatialClip,
  pool: DbPoolLike | null = getPool(),
): Promise<RecruitmentPOI[] | null> {
  if (!pool) return null;
  try {
    const spatial = companySitesSpatialSql(clip);
    // Bug1 跨城串味防御（2026-08-19）：单一城市视野下剔除「city 与坐标矛盾」的行
    // （如 city=深圳 但坐标在杭州）。cityBoundsConsistencySql 在非单一城市视野返回
    // 空片段，全国/省际视野不受影响。占位符编号从 spatial.params 之后继续。
    const consistency = cityBoundsConsistencySql(clip?.bounds, spatial.params.length + 1);
    const clipped = hasSpatialClip(clip) || consistency.sql !== '';
    const siteSql = clipped
      ? `SELECT s.id::text, s.company_id::text, s.name, s.address, s.city, s.province, s.city_code, s.lng, s.lat, s.career_url, s.logo_url
         FROM company_sites s
         WHERE s.geom IS NOT NULL${spatial.sql}${consistency.sql}`
      : `SELECT id::text, company_id::text, name, address, city, province, city_code, lng, lat, career_url, logo_url
         FROM company_sites`;
    const sites = await pool.query<SiteRow>(siteSql, [...spatial.params, ...consistency.params]);
    // SQL 级裁剪未命中 = 空：已知 clip 范围内无行 → 调用方保持空、不回退离线目录。
    if (clipped && sites.rows.length === 0) return [];

    // Ungeocoded sites (address-only, lng/lat NULL) must not pin at (0,0).
    // A clip already restricts to geom-bearing sites; the unrestricted path filters here.
    // 2026-08-25 (fix/hide-center-pins): 城市中心钉(无真实办公坐标、钉在行政中心的
    // 站点)一并排除, 与离线 catalog 路径同规则 — 地图不再堆假办公点。
    // null/[] 契约(2026-08-25, fix/server-catalog-semantics): 带 clip 的请求过滤后
    // 为空必须返回 [] — 旧实现返回 null 会触发离线目录回退, 使搜索/建议结果来自
    // 种子而非当前 DB 的真实空结果([] = DB 健康但裁剪或过滤后为空; null = 无 DB/失败)。
    const located = sites.rows.filter(
      (site) => hasPlausibleCoord(site.lng, site.lat) && !isCityCenterPin(site.lng as number, site.lat as number),
    );
    if (located.length === 0) return clipped ? [] : null;

    const companyIds = [...new Set(located.map((site) => site.company_id))];
    const siteIds = located.map((site) => site.id);
    const maxTier = parseMaxTier(clip?.maxTier);
    const tierClause = maxTier !== null ? ' AND tier <= $2' : '';
    const companySql = clipped
      ? `SELECT id::text, slug, name, industries, scale, rating, summary, career_url, logo_url, logo_emoji, tier, category
         FROM companies WHERE id = ANY($1::bigint[])${tierClause} ORDER BY slug`
      : `SELECT id::text, slug, name, industries, scale, rating, summary, career_url, logo_url, logo_emoji, tier, category
         FROM companies ORDER BY slug`;
    // A1 (tech/18)：只读在招 —— status='open' 且 deadline 为空或 >= 今天。
    // 2026-08-27 (fix/agg-fanout-clipped): 裁剪查询也必须加载公司级聚合行 —
    // 聚合岗的 site_id 是首城占位(如北京), 只按 site_id = ANY(located) 加载会把
    // 这些行挡在 aggregateRows 之外 → 扇出失效 → 单城市视野下多城公司(仅聚合岗、
    // 本城站无具体岗)整条不出现。按 company_id 补加载聚合行, 扇出语义与全国
    // (未裁剪)查询一致。
    const positionSql = clipped
      ? `SELECT company_id::text, site_id::text, external_id, title, department, family, taxonomy,
                salary_min, salary_max, education, majors, skills, description, deadline,
                apply_source, apply_url, status
         FROM positions WHERE status = 'open' AND (deadline IS NULL OR deadline >= CURRENT_DATE)
           AND (site_id = ANY($1::bigint[])
                OR (taxonomy->>'aggregate' = 'true' AND company_id = ANY($2::bigint[])))`
      : `SELECT company_id::text, site_id::text, external_id, title, department, family, taxonomy,
                salary_min, salary_max, education, majors, skills, description, deadline,
                apply_source, apply_url, status
         FROM positions WHERE status = 'open' AND (deadline IS NULL OR deadline >= CURRENT_DATE)`;
    const [companies, positions] = await Promise.all([
      pool.query<CompanyRow>(
        companySql,
        clipped ? (maxTier !== null ? [companyIds, maxTier] : [companyIds]) : [],
      ),
      pool.query<PositionRow>(positionSql, clipped ? [siteIds, companyIds] : []),
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
    // 2026-08-26 (fix/aggregate-site-fanout): 聚合行(taxonomy.aggregate, crawler
    // 全国大类标题的 site_id 只是首城占位)= 公司级在招信号 → 计入公司每个站点,
    // 否则多城公司除占位站外全被 positions.length > 0 过滤(深圳腾讯不收录的根因)。
    const aggregateRows = positions.rows.filter((pos) => pos.taxonomy?.aggregate === true);

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
        const logo = resolveDbCompanyLogo(company, site);
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
            tier: num(company.tier) ?? 12,
            category: company.category ?? 'other',
            rating: num(company.rating),
            logo: logo.emoji,
            logoUrl: logo.url,
            summary: company.summary ?? undefined,
            careerUrl: site.career_url || company.career_url || undefined,
          },
          sites: [
            {
              id: site.id,
              name: site.name,
              location: loc,
              city: site.city ?? undefined,
              province: site.province ?? undefined,
              cityCode: site.city_code ?? undefined,
              careerUrl: site.career_url ?? undefined,
              logoUrl: site.logo_url ?? undefined,
            },
          ],
          positions: positionsForSite(site.id, company.id, positionsBySite, aggregateRows).map((pos) => ({
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
            deadline: isoDate(pos.deadline),
            apply: pos.apply_url
              ? { source: pos.apply_source ?? 'official', url: pos.apply_url }
              : undefined,
            status: pos.status,
            // Aggregate flag is persisted inside taxonomy jsonb (recruitment-import).
            aggregate: pos.taxonomy?.aggregate === true ? true : undefined,
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
