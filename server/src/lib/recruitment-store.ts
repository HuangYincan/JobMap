// Read imported recruitment rows when DATABASE_URL is set.
// One company + one site → POI id = companies.slug.
// Return contract (2026-08-25, fix/server-catalog-semantics; 2026-08-26 收紧):
//   null = no pool / query failure → caller keeps empty (strict DB-only, no offline seed);
//   []   = DB healthy but empty after clip or coord-filter → caller keeps empty.

import { getPool, queryPublicRead } from './db.ts';
import { isCityCenterPin } from './city-centers.ts';
import { resolveCompanyLogo, type ResolvedLogo } from './company-logo.ts';
import { authenticPositionSql, isAuthenticPositionRecord } from './freshness.ts';
import { cityBoundsConsistencySql, companySitesSpatialSql, hasSpatialClip, parseMaxTier, type SpatialClip } from './spatial-query.ts';
import { ilike, likeContains, likePrefix } from './sql-like.ts';
import type { ApplySource, JobFamily, JobTaxonomy, RecruitmentPOI } from './types.ts';

type DbPoolLike = {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

const AUTHENTIC_POSITION_SQL = authenticPositionSql('source_registry', 'positions');
const AUTHENTIC_POSITION_SQL_P = authenticPositionSql('source_registry', 'p');

export interface CompanyRow {
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

export interface SiteRow {
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

export interface PositionRow {
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
  expires_at: Date | string | null;
  apply_source: ApplySource | null;
  apply_url: string | null;
  status: 'open' | 'closed' | 'paused';
  source_code?: string;
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

function isCatalogAuthenticPosition(position: PositionRow): boolean {
  // Production queries always populate source_code and exclude source-less rows
  // in SQL. The undefined fallback keeps injected legacy rows testable while
  // retaining the historical portal/radar identity rule.
  return isAuthenticPositionRecord({
    externalId: position.external_id,
    source: position.source_code,
  });
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

export function buildRecruitmentPois(
  companies: CompanyRow[],
  located: SiteRow[],
  positions: PositionRow[],
  siteCounts?: ReadonlyMap<string, number>,
): RecruitmentPOI[] {
  const sitesByCompany = new Map<string, SiteRow[]>();
  for (const site of located) {
    const list = sitesByCompany.get(site.company_id) ?? [];
    list.push(site);
    sitesByCompany.set(site.company_id, list);
  }
  const catalogPositions = positions.filter(isCatalogAuthenticPosition);
  const positionsBySite = new Map<string, PositionRow[]>();
  for (const pos of catalogPositions) {
    const list = positionsBySite.get(pos.site_id) ?? [];
    list.push(pos);
    positionsBySite.set(pos.site_id, list);
  }
  // 聚合行(taxonomy.aggregate, crawler 全国大类标题的 site_id 只是首城占位)
  // 是公司级在招信号，计入公司每个站点。
  const aggregateRows = catalogPositions.filter((pos) => pos.taxonomy?.aggregate === true);

  const pois: RecruitmentPOI[] = [];
  for (const company of companies) {
    const companySites = sitesByCompany.get(company.id) ?? [];
    if (companySites.length === 0) continue;
    for (const site of companySites) {
      const id = siteCounts
        ? (siteCounts.get(company.id) === 1 ? company.slug : `${company.slug}:${site.id}`)
        : (companySites.length === 1 ? company.slug : `${company.slug}:${site.id}`);
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
          aggregate: pos.taxonomy?.aggregate === true ? true : undefined,
        })),
      });
    }
  }
  return pois.filter((poi) => poi.positions.length > 0);
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
         JOIN sources site_source ON site_source.id = s.source_id
         WHERE s.geom IS NOT NULL${spatial.sql}${consistency.sql}`
      : `SELECT s.id::text, s.company_id::text, s.name, s.address, s.city, s.province, s.city_code, s.lng, s.lat, s.career_url, s.logo_url
         FROM company_sites s
         JOIN sources site_source ON site_source.id = s.source_id`;
    const sites = await queryPublicRead<SiteRow>(pool, siteSql, [...spatial.params, ...consistency.params]);
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
                salary_min, salary_max, education, majors, skills, description, deadline, expires_at,
                apply_source, apply_url, status,
                (SELECT source_registry.code FROM sources source_registry
                   WHERE source_registry.id = positions.source_id) AS source_code
         FROM positions
         WHERE status = 'open' AND (deadline IS NULL OR deadline >= CURRENT_DATE)
           AND (expires_at IS NULL OR expires_at >= CURRENT_TIMESTAMP)
           AND EXISTS (
             SELECT 1 FROM sources source_registry
              WHERE source_registry.id = positions.source_id
                AND ${AUTHENTIC_POSITION_SQL}
           )
           AND (site_id = ANY($1::bigint[])
                OR (taxonomy->>'aggregate' = 'true' AND company_id = ANY($2::bigint[])))`
      : `SELECT company_id::text, site_id::text, external_id, title, department, family, taxonomy,
                salary_min, salary_max, education, majors, skills, description, deadline, expires_at,
                apply_source, apply_url, status,
                (SELECT source_registry.code FROM sources source_registry
                   WHERE source_registry.id = positions.source_id) AS source_code
         FROM positions
         WHERE status = 'open' AND (deadline IS NULL OR deadline >= CURRENT_DATE)
           AND (expires_at IS NULL OR expires_at >= CURRENT_TIMESTAMP)
           AND EXISTS (
             SELECT 1 FROM sources source_registry
              WHERE source_registry.id = positions.source_id
                AND ${AUTHENTIC_POSITION_SQL}
           )`;
    const [companies, positions] = await Promise.all([
      queryPublicRead<CompanyRow>(
        pool,
        companySql,
        clipped ? (maxTier !== null ? [companyIds, maxTier] : [companyIds]) : [],
      ),
      queryPublicRead<PositionRow>(pool, positionSql, clipped ? [siteIds, companyIds] : []),
    ]);
    if (companies.rows.length === 0) return [];

    return buildRecruitmentPois(companies.rows, located, positions.rows);
  } catch {
    return null;
  }
}

function splitCatalogId(id: string): { slug: string; siteId?: string } | null {
  const separator = id.indexOf(':');
  if (separator < 0) return id ? { slug: id } : null;
  const slug = id.slice(0, separator);
  const siteId = id.slice(separator + 1);
  if (!slug || !/^\d+$/.test(siteId)) return null;
  return { slug, siteId };
}

/**
 * Detail read: resolve one company slug and its requested site before loading
 * only that company's open positions. It intentionally does not call the full
 * catalog loader, which would materialize every company on a detail cache miss.
 */
export async function loadWorkCatalogByIdFromDb(
  id: string,
  pool: DbPoolLike | null = getPool(),
): Promise<RecruitmentPOI | null | undefined> {
  if (!pool) return null;
  const parsed = splitCatalogId(id);
  if (!parsed) return undefined;

  try {
    const companyResult = await queryPublicRead<CompanyRow>(
      pool,
      `SELECT c.id::text, c.slug, c.name, c.industries, c.scale, c.rating, c.summary,
              c.career_url, c.logo_url, c.logo_emoji, c.tier, c.category
       FROM companies c
       WHERE c.slug = $1
       LIMIT 1`,
      [parsed.slug],
    );
    const company = companyResult.rows[0];
    if (!company) return undefined;

    // Load only this company's sites so the slug-vs-slug:site.id shape can be
    // reconstructed exactly as it is for the full catalog path.
    const sites = await queryPublicRead<SiteRow>(
      pool,
      `SELECT s.id::text, s.company_id::text, s.name, s.address, s.city, s.province,
              s.city_code, s.lng, s.lat, s.career_url, s.logo_url
       FROM company_sites s
       JOIN sources site_source ON site_source.id = s.source_id
       WHERE s.company_id = $1::bigint
         AND s.geom IS NOT NULL`,
      [company.id],
    );
    const located = sites.rows.filter(
      (site) => hasPlausibleCoord(site.lng, site.lat) && !isCityCenterPin(site.lng as number, site.lat as number),
    );
    const targetSites = parsed.siteId
      ? located.filter((site) => site.id === parsed.siteId)
      : located;
    if (targetSites.length === 0) return undefined;

    const siteIds = targetSites.map((site) => site.id);
    const positions = await queryPublicRead<PositionRow>(
      pool,
      `SELECT p.company_id::text, p.site_id::text, p.external_id, p.title, p.department,
              p.family, p.taxonomy, p.salary_min, p.salary_max, p.education, p.majors,
              p.skills, p.description, p.deadline, p.expires_at,
              p.apply_source, p.apply_url, p.status, source_registry.code AS source_code
       FROM positions p
       JOIN sources source_registry ON source_registry.id = p.source_id
       WHERE p.company_id = $2::bigint
         AND p.status = 'open'
         AND (p.deadline IS NULL OR p.deadline >= CURRENT_DATE)
         AND (p.expires_at IS NULL OR p.expires_at >= CURRENT_TIMESTAMP)
         AND ${AUTHENTIC_POSITION_SQL_P}
         AND (p.site_id = ANY($1::bigint[])
              OR p.taxonomy->>'aggregate' = 'true')`,
      [siteIds, company.id],
    );
    const pois = buildRecruitmentPois([company], located, positions.rows);
    return pois.find((poi) => poi.id === id);
  } catch {
    return null;
  }
}

/**
 * Targeted position detail by `external_id`. Same open + deadline-alive
 * semantics as the catalog loaders; does not materialize the national catalog
 * and does not select `description`.
 *
 * Return contract:
 *   null      = no pool / query failure
 *   undefined = not found or not currently visible
 *   record    = one visible position
 */
export interface WorkPositionDetailRecord {
  positionId: string;
  title: string;
  department?: string;
  family: JobFamily;
  city?: string;
  siteId?: string;
  siteLabel?: string;
  companyCatalogId: string;
  companyName: string;
  salary?: { min: number; max: number };
  education?: string;
  deadline?: string;
  applySource?: ApplySource;
  status: 'open' | 'closed' | 'paused';
  location?: { lng: number; lat: number; coordinateSystem: 'gcj02' };
}

interface PositionDetailRow {
  external_id: string;
  title: string;
  department: string | null;
  family: JobFamily;
  salary_min: string | number | null;
  salary_max: string | number | null;
  education: string | null;
  deadline: Date | string | null;
  expires_at: Date | string | null;
  apply_source: ApplySource | null;
  status: 'open' | 'closed' | 'paused';
  site_id: string | null;
  source_code?: string;
  slug: string;
  company_name: string;
  site_name: string | null;
  city: string | null;
  lng: number | null;
  lat: number | null;
}

export async function loadWorkPositionByExternalIdFromDb(
  externalId: string,
  pool: DbPoolLike | null = getPool(),
): Promise<WorkPositionDetailRecord | null | undefined> {
  if (!pool) return null;
  const id = externalId.trim();
  if (!id || id.length > 128) return undefined;

  try {
    const result = await queryPublicRead<PositionDetailRow>(
      pool,
      `SELECT p.external_id, p.title, p.department, p.family,
              p.salary_min, p.salary_max, p.education, p.deadline, p.expires_at,
              p.apply_source, p.status, p.site_id::text, source_registry.code AS source_code,
              c.slug, c.name AS company_name,
              s.name AS site_name, s.city, s.lng, s.lat
       FROM positions p
       INNER JOIN companies c ON c.id = p.company_id
       INNER JOIN sources source_registry ON source_registry.id = p.source_id
       LEFT JOIN company_sites s ON s.id = p.site_id
       WHERE p.external_id = $1
         AND p.status = 'open'
         AND (p.deadline IS NULL OR p.deadline >= CURRENT_DATE)
         AND (p.expires_at IS NULL OR p.expires_at >= CURRENT_TIMESTAMP)
         AND ${AUTHENTIC_POSITION_SQL_P}
       LIMIT 1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const siteId = row.site_id ?? undefined;
    const record: WorkPositionDetailRecord = {
      positionId: row.external_id,
      title: row.title,
      family: row.family,
      companyCatalogId: siteId ? `${row.slug}:${siteId}` : row.slug,
      companyName: row.company_name,
      status: row.status,
    };
    if (row.department) record.department = row.department;
    if (row.city) record.city = row.city;
    if (siteId) record.siteId = siteId;
    if (row.site_name) record.siteLabel = row.site_name;
    if (row.salary_min != null || row.salary_max != null) {
      record.salary = { min: num(row.salary_min) ?? 0, max: num(row.salary_max) ?? 0 };
    }
    if (row.education) record.education = row.education;
    const deadline = isoDate(row.deadline);
    if (deadline) record.deadline = deadline;
    if (row.apply_source) record.applySource = row.apply_source;
    if (hasPlausibleCoord(row.lng, row.lat) && !isCityCenterPin(row.lng as number, row.lat as number)) {
      record.location = {
        lng: row.lng as number,
        lat: row.lat as number,
        coordinateSystem: 'gcj02',
      };
    }
    return record;
  } catch {
    return null;
  }
}

export interface WorkSuggestionRow {
  kind: 'company' | 'job';
  slug: string;
  company_name: string;
  industries: string[];
  summary: string | null;
  logo_emoji: string | null;
  site_id: string;
  site_count: string | number;
  lng: number;
  lat: number;
  position_id?: string;
  position_title?: string;
  department?: string | null;
  education?: string | null;
}

const SUGGEST_ALIAS_GROUPS: string[][] = [
  ['前端', 'fe', 'frontend', 'front-end'],
  ['后端', 'be', 'backend', 'back-end'],
  ['算法', 'algorithm', 'ml', '机器学习'],
  ['产品', 'pm', 'product'],
  ['设计', 'ui', 'ux', 'designer'],
  ['阿里巴巴', '阿里', 'alibaba'],
  ['字节跳动', '字节', 'bytedance'],
  ['腾讯', 'tencent'],
  ['网易', 'netease'],
  ['华为', 'huawei'],
  ['蚂蚁集团', '蚂蚁', 'antgroup'],
  ['哔哩哔哩', 'b站', 'bilibili'],
  ['深信服', 'sangfor'],
  ['之江实验室', '之江', 'zhejiang lab'],
];

function suggestSearchGroups(query: string): string[][] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => SUGGEST_ALIAS_GROUPS.find((group) => group.some((alias) => alias === term)) ?? [term]);
}

function sqlSuggestionMatch(
  fields: string[],
  query: string,
  start = 1,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  let index = start;
  const terms = suggestSearchGroups(query);
  const clauses = terms.map((group) => {
    const alternatives = group.flatMap((term) => {
      const patterns = [likePrefix(term)];
      // The existing title trigram index can serve longer contains matches;
      // short aliases stay prefix-only to avoid broad two-character scans.
      if (term.length >= 3) patterns.push(likeContains(term));
      return patterns.flatMap((pattern) => {
        const placeholder = `$${index++}`;
        params.push(pattern);
        return fields.map((field) => ilike(field, placeholder));
      });
    });
    return alternatives.length > 1 ? `(${alternatives.join(' OR ')})` : alternatives[0];
  });
  return { sql: clauses.join(' AND '), params };
}

/**
 * SQL-backed work autocomplete. Both result families are capped independently
 * at ten rows; callers merge them without ever loading the full work catalog.
 */
export async function loadWorkSuggestionsFromDb(
  query: string,
  limit = 10,
  pool: DbPoolLike | null = getPool(),
): Promise<WorkSuggestionRow[] | null> {
  if (!pool) return null;
  const q = query.trim();
  if (!q || limit <= 0) return [];
  const n = Math.min(10, Math.max(1, Math.floor(limit)));
  const companyMatch = sqlSuggestionMatch(['c.name', 'c.slug'], q);
  const jobMatch = sqlSuggestionMatch(['p.title', 'COALESCE(p.department, \'\')'], q);
  const companySql = `
    SELECT 'company'::text AS kind, c.slug, c.name AS company_name, c.industries,
           c.summary, c.logo_emoji, s.id::text AS site_id,
           (SELECT count(*) FROM company_sites all_sites
            WHERE all_sites.company_id = c.id AND all_sites.geom IS NOT NULL) AS site_count,
           s.lng, s.lat
    FROM companies c
    JOIN company_sites s ON s.company_id = c.id
    JOIN sources site_source ON site_source.id = s.source_id
    WHERE s.geom IS NOT NULL
      AND (${companyMatch.sql})
      AND EXISTS (
        SELECT 1 FROM positions ep
        JOIN sources ep_source ON ep_source.id = ep.source_id
        WHERE ep.company_id = c.id
          AND (ep.site_id = s.id OR ep.taxonomy->>'aggregate' = 'true')
          AND ep.status = 'open'
          AND (ep.deadline IS NULL OR ep.deadline >= CURRENT_DATE)
          AND (ep.expires_at IS NULL OR ep.expires_at >= CURRENT_TIMESTAMP)
          AND ${authenticPositionSql('ep_source', 'ep')}
      )
    ORDER BY c.slug, s.id
    LIMIT $${companyMatch.params.length + 1}`;
  const jobSql = `
    SELECT 'job'::text AS kind, c.slug, c.name AS company_name, c.industries,
           c.summary, c.logo_emoji, s.id::text AS site_id,
           (SELECT count(*) FROM company_sites all_sites
            WHERE all_sites.company_id = c.id AND all_sites.geom IS NOT NULL) AS site_count,
           s.lng, s.lat, p.external_id AS position_id, p.title AS position_title,
           p.department, p.education
    FROM positions p
    JOIN sources position_source ON position_source.id = p.source_id
    JOIN companies c ON c.id = p.company_id
    JOIN company_sites s ON s.company_id = p.company_id
      AND (s.id = p.site_id OR p.taxonomy->>'aggregate' = 'true')
    WHERE s.geom IS NOT NULL
      AND p.status = 'open'
      AND (p.deadline IS NULL OR p.deadline >= CURRENT_DATE)
      AND (p.expires_at IS NULL OR p.expires_at >= CURRENT_TIMESTAMP)
      AND ${authenticPositionSql('position_source', 'p')}
      AND (${jobMatch.sql})
    ORDER BY p.title, c.slug, s.id
    LIMIT $${jobMatch.params.length + 1}`;

  try {
    const [companies, jobs] = await Promise.all([
      queryPublicRead<WorkSuggestionRow>(pool, companySql, [...companyMatch.params, n]),
      queryPublicRead<WorkSuggestionRow>(pool, jobSql, [...jobMatch.params, n]),
    ]);
    const rows = [...companies.rows, ...jobs.rows].filter(
      (row) => hasPlausibleCoord(row.lng, row.lat) && !isCityCenterPin(row.lng, row.lat),
    );
    return rows;
  } catch {
    return null;
  }
}

type WorkTag = { key: string; value: string };

function tagCountClause(tag: WorkTag, start: number): { clause: string; params: unknown[] } | null {
  // benefits/班车 are not persisted by buildRecruitmentPois, so preserve the
  // existing zero-count semantics without touching the database.
  if (tag.key === 'providesHousing' || tag.key === 'providesShuttle') return null;
  if (tag.key === 'scale') return { clause: `c.scale = $${start}`, params: [tag.value] };
  if (tag.key === 'education') return { clause: `p.education = $${start}`, params: [tag.value] };
  if (tag.key === 'jobTaxonomy') {
    const [family, detail] = tag.value.split('/');
    if (detail && family === 'intern') {
      return {
        clause: `p.family = $${start} AND (p.taxonomy->>'internKind' = $${start + 1} OR p.taxonomy->>'conversion' = $${start + 1})`,
        params: [family, detail],
      };
    }
    return {
      clause: detail
        ? `p.family = $${start} AND p.taxonomy->>$${start + 1} = $${start + 2}`
        : `p.family = $${start}`,
      params: detail
        ? [family, family === 'intern' ? 'internKind' : 'campusSeason', detail]
        : [family],
    };
  }
  if (tag.key !== 'roleFamily') return null;
  // Keep this regex list aligned with job-taxonomy.ts. These are constants,
  // not user-supplied regular expressions.
  const hay = `concat_ws(' ', p.title, COALESCE(p.department, ''), array_to_string(p.skills, ' '))`;
  if (tag.value === 'ops') return { clause: `${hay} ~* $${start}`, params: ['运营'] };
  if (tag.value === 'product') {
    return { clause: `${hay} ~* $${start} AND NOT ${hay} ~* $${start + 1}`, params: ['产品', '运营'] };
  }
  if (tag.value === 'design') {
    return { clause: `${hay} ~* $${start} AND NOT ${hay} ~* $${start + 1}`, params: ['视觉|设计师|UI|UX', '芯片'] };
  }
  if (tag.value === 'tech') {
    return {
      clause: `${hay} ~* $${start} AND NOT ${hay} ~* $${start + 1} AND NOT ${hay} ~* $${start + 2}`,
      params: [
        '前端|后端|算法|开发|工程|Java|Android|iOS|SLAM|NLP|Infra|芯片|嵌入式|SRE|测试|数据',
        '运营',
        '产品经理',
      ],
    };
  }
  return null;
}

/** Batch all tag counts into one bounded aggregate join per suggestion miss. */
export async function countWorkTagMatchesBatchFromDb(
  tags: readonly WorkTag[],
  pool: DbPoolLike | null = getPool(),
): Promise<number[] | null> {
  if (!pool) return null;
  if (tags.length === 0) return [];
  if (!tags.some((tag) => tagCountClause(tag, 1) !== null)) return tags.map(() => 0);

  const params: unknown[] = [];
  let index = 1;
  const expressions = tags.map((tag, tagIndex) => {
    const built = tagCountClause(tag, index);
    if (!built) return `0::bigint AS count_${tagIndex}`;
    params.push(...built.params);
    index += built.params.length;
    return `count(DISTINCT s.id) FILTER (WHERE ${built.clause})::text AS count_${tagIndex}`;
  });
  try {
    const result = await queryPublicRead<Record<string, string>>(
      pool,
      `SELECT ${expressions.join(',\n              ')}
       FROM companies c
       JOIN company_sites s ON s.company_id = c.id
       JOIN positions p ON p.company_id = c.id
       JOIN sources position_source ON position_source.id = p.source_id
       WHERE s.geom IS NOT NULL
         AND (p.site_id = s.id OR p.taxonomy->>'aggregate' = 'true')
         AND p.status = 'open'
         AND (p.deadline IS NULL OR p.deadline >= CURRENT_DATE)
         AND (p.expires_at IS NULL OR p.expires_at >= CURRENT_TIMESTAMP)
         AND ${authenticPositionSql('position_source', 'p')}`,
      params,
    );
    const row = result.rows[0] ?? {};
    return tags.map((_, tagIndex) => Number(row[`count_${tagIndex}`] ?? 0));
  } catch {
    return null;
  }
}

/** Count one tag via a legacy-shaped aggregate for direct callers/tests. */
export async function countWorkTagMatchesFromDb(
  tag: WorkTag,
  pool: DbPoolLike | null = getPool(),
): Promise<number | null> {
  if (!pool) return null;
  const built = tagCountClause(tag, 1);
  if (!built) return 0;
  try {
    const result = await queryPublicRead<{ count: string }>(
      pool,
      `SELECT count(DISTINCT s.id)::text AS count
       FROM companies c
       JOIN company_sites s ON s.company_id = c.id
       JOIN positions p ON p.company_id = c.id
       JOIN sources position_source ON position_source.id = p.source_id
       WHERE s.geom IS NOT NULL
         AND (p.site_id = s.id OR p.taxonomy->>'aggregate' = 'true')
         AND p.status = 'open'
         AND (p.deadline IS NULL OR p.deadline >= CURRENT_DATE)
         AND (p.expires_at IS NULL OR p.expires_at >= CURRENT_TIMESTAMP)
         AND ${authenticPositionSql('position_source', 'p')}
         AND ${built.clause}`,
      built.params,
    );
    return Number(result.rows[0]?.count ?? 0);
  } catch {
    return null;
  }
}


export interface WorkPlaceRow {
  slug: string;
  company_name: string;
  site_id: string;
  site_name: string | null;
  address: string | null;
  city: string | null;
  lng: number;
  lat: number;
}

/**
 * Agent 地点检索:按公司名/slug/站点名查已落坐标的办公点。
 * 不要求在招岗位(导航要的是办公点,不是 JD)。无库/失败 → null。
 */
export async function searchWorkSitesForPlace(
  terms: string[],
  city?: string,
  limit = 8,
  pool: DbPoolLike | null = getPool(),
): Promise<WorkPlaceRow[] | null> {
  if (!pool) return null;
  const needles = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2))].slice(0, 8);
  if (needles.length === 0) return [];
  const n = Math.min(20, Math.max(1, Math.floor(limit)));
  const params: unknown[] = [];
  let index = 1;
  const fieldMatch = needles
    .map((term) => {
      const pattern = /[\u4e00-\u9fff]/.test(term) || term.length >= 3
        ? likeContains(term)
        : likePrefix(term);
      const placeholder = `$${index++}`;
      params.push(pattern);
      return `(${ilike('c.name', placeholder)} OR ${ilike('c.slug', placeholder)} OR ${ilike('s.name', placeholder)})`;
    })
    .join(' OR ');
  let citySql = '';
  if (city && city.trim()) {
    const placeholder = `$${index++}`;
    params.push(likeContains(city.trim()));
    citySql = ` AND (${ilike('s.city', placeholder)} OR ${ilike('s.province', placeholder)})`;
  }
  const limitPlaceholder = `$${index++}`;
  params.push(n);
  const sql = `
    SELECT c.slug, c.name AS company_name, s.id::text AS site_id,
           s.name AS site_name, s.address, s.city, s.lng, s.lat
    FROM companies c
    JOIN company_sites s ON s.company_id = c.id
    JOIN sources site_source ON site_source.id = s.source_id
    WHERE s.geom IS NOT NULL
      AND (${fieldMatch})
      ${citySql}
    ORDER BY c.slug, s.id
    LIMIT ${limitPlaceholder}`;
  try {
    const result = await queryPublicRead<WorkPlaceRow>(pool, sql, params);
    return result.rows.filter(
      (row) => hasPlausibleCoord(row.lng, row.lat) && !isCityCenterPin(row.lng, row.lat),
    );
  } catch {
    return null;
  }
}
