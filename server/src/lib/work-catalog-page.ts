// Bounded national Work catalog page reads.
//
// This module is deliberately separate from the full catalog loader: public list
// callers can page a filtered site relation first, then hydrate only the selected
// sites and their companies' aggregate positions. It never changes recruitment
// source eligibility; the SQL uses the same open + deadline predicate as the
// existing DB read path.

import { getPool, queryPublicRead } from './db.ts';
import { CITY_CENTERS, CITY_CENTER_EPS } from './city-centers.ts';
import { parseMaxTier } from './spatial-query.ts';
import { ilike, likeContains } from './sql-like.ts';
import { buildRecruitmentPois, type CompanyRow, type PositionRow, type SiteRow } from './recruitment-store.ts';
import { withDistance, type RecruitmentPOI } from './types.ts';

interface DbPoolLike {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface WorkCatalogPageQuery {
  q?: string;
  filters?: Record<string, unknown>;
  sort?: string;
  page?: number;
  pageSize?: number;
  /** Distance sort uses the same fallback as public-search when omitted. */
  center?: { lng: number; lat: number };
}

export interface WorkCatalogPage {
  total: number;
  page: number;
  pageSize: number;
  results: RecruitmentPOI[];
  aggregations: { industries: Record<string, number> };
}

const DEFAULT_CENTER = { lng: 120.15, lat: 30.27 };
const MAX_PAGE_SIZE = 50;

const SEARCH_QUERY_ALIASES: string[][] = [
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
  ['西湖', 'west lake', 'westlake'],
  ['灵隐', 'lingyin'],
  ['银泰', 'in77'],
];

const UNSUPPORTED_FILTERS = new Set([
  // These become a SpatialClip or depend on fields not persisted in the DB
  // projection. The route keeps the full loader for them to preserve semantics.
  'distance', 'district', 'city', 'providesHousing', 'providesShuttle',
]);

function finiteCenter(value: unknown): { lng: number; lat: number } {
  if (!value || typeof value !== 'object') return DEFAULT_CENTER;
  const candidate = value as { lng?: unknown; lat?: unknown };
  return typeof candidate.lng === 'number' && Number.isFinite(candidate.lng)
    && typeof candidate.lat === 'number' && Number.isFinite(candidate.lat)
    ? { lng: candidate.lng, lat: candidate.lat }
    : DEFAULT_CENTER;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === 'string');
}

function validDateFilter(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  return Number.isFinite(Date.parse(String(value)));
}

function literalQuery(q: unknown): string[][] | null {
  if (typeof q !== 'string') return q == null ? [] : null;
  const raw = q.trim();
  if (!raw) return [];
  if (raw.includes('#')) return null;
  const exactAlias = SEARCH_QUERY_ALIASES.find((group) => group.some((alias) => alias.toLowerCase() === raw));
  if (exactAlias) return [exactAlias];
  return raw.toLowerCase().split(/\s+/).filter(Boolean).map((term) =>
    SEARCH_QUERY_ALIASES.find((group) => group.some((alias) => alias.toLowerCase() === term)) ?? [term],
  );
}

function supportedFilters(filters: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(filters)) {
    if (UNSUPPORTED_FILTERS.has(key)) return false;
    if (key === 'industry' || key === 'scale' || key === 'education' || key === 'positionType' || key === 'roleFamily' || key === 'jobTaxonomy') {
      if (value !== undefined && value !== null && value !== '' && stringArray(value) === null) return false;
    }
    if (key === 'salary') {
      if (value !== undefined && value !== null && value !== '') {
        if (!Array.isArray(value) || value.length !== 2 || !value.every((item) => typeof item === 'number' && Number.isFinite(item))) return false;
      }
    }
    if (key === 'deadline' && !validDateFilter(value)) return false;
    if (key === 'maxTier' && parseMaxTier(value) === null && value !== undefined && value !== null && value !== '') return false;
  }
  return true;
}

/** Whether the route can use the bounded SQL adapter without semantic fallback. */
export function supportsWorkCatalogPageQuery(query: WorkCatalogPageQuery): boolean {
  if (literalQuery(query.q) === null) return false;
  if (query.filters != null && (typeof query.filters !== 'object' || Array.isArray(query.filters))) return false;
  if (!supportedFilters(query.filters ?? {})) return false;
  return query.sort == null || query.sort === '' || ['distance', 'rating', 'salaryDesc', 'positionCount', 'deadline'].includes(query.sort);
}

function industrySearchSql(): string {
  // Keep this mapping aligned with search.ts INDUSTRY_LABELS. The values are
  // constants, not user input, and therefore need no extra bound parameters.
  return `concat_ws(' ', array_to_string(c.industries, ' '),
    CASE WHEN 'internet' = ANY(c.industries) THEN '互联网' ELSE '' END,
    CASE WHEN 'finance' = ANY(c.industries) THEN '金融' ELSE '' END,
    CASE WHEN 'consulting' = ANY(c.industries) THEN '咨询' ELSE '' END,
    CASE WHEN 'hardware' = ANY(c.industries) THEN '硬件制造 硬件' ELSE '' END,
    CASE WHEN 'ai' = ANY(c.industries) THEN '人工智能 AI' ELSE '' END,
    CASE WHEN 'ecommerce' = ANY(c.industries) THEN '电商 电子商务' ELSE '' END,
    CASE WHEN 'game' = ANY(c.industries) THEN '游戏' ELSE '' END,
    CASE WHEN 'automotive' = ANY(c.industries) THEN '汽车' ELSE '' END,
    CASE WHEN 'biotech' = ANY(c.industries) THEN '生物医药' ELSE '' END,
    CASE WHEN 'consumer' = ANY(c.industries) THEN '消费品' ELSE '' END,
    CASE WHEN 'transport' = ANY(c.industries) THEN '出行 交通' ELSE '' END,
    CASE WHEN 'content' = ANY(c.industries) THEN '内容 内容平台' ELSE '' END)`;
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function queryTermSql(haystack: string, terms: string[], b: SqlBuilder): string {
  return terms.map((term) => {
    const isShortAlias = /^[a-z0-9]{1,2}$/i.test(term);
    if (isShortAlias) {
      return `${haystack} ~* ${b.bind(`(^|[^a-z0-9])${escapeRegex(term)}([^a-z0-9]|$)`)}`;
    }
    return ilike(haystack, b.bind(likeContains(term)));
  }).join(' OR ');
}

function querySql(haystack: string, groups: string[][], b: SqlBuilder): string {
  return groups
    .map((terms) => `(${queryTermSql(haystack, terms, b)})`)
    .join(' AND ');
}

function positionHaystack(alias: string): string {
  return `concat_ws(' ', ${alias}.title, COALESCE(${alias}.department, ''), array_to_string(${alias}.skills, ' '))`;
}

const COMPANY_HAYSTACK = `concat_ws(' ', c.name, ${industrySearchSql()}, COALESCE(c.summary, ''))`;
const POSITION_HAYSTACK = positionHaystack('p');

function roleClause(value: string, b: SqlBuilder): string | null {
  const hay = POSITION_HAYSTACK;
  if (value === 'ops') return `${hay} ~* ${b.bind('运营')}`;
  if (value === 'product') return `${hay} ~* ${b.bind('产品')} AND NOT ${hay} ~* ${b.bind('运营')}`;
  if (value === 'design') return `${hay} ~* ${b.bind('视觉|设计师|UI|UX')} AND NOT ${hay} ~* ${b.bind('芯片')}`;
  if (value === 'tech') {
    return `${hay} ~* ${b.bind('前端|后端|算法|开发|工程|Java|Android|iOS|SLAM|NLP|Infra|芯片|嵌入式|SRE|测试|数据')}
      AND NOT ${hay} ~* ${b.bind('运营')}
      AND NOT ${hay} ~* ${b.bind('产品经理')}`;
  }
  return null;
}

interface SqlBuilder {
  params: unknown[];
  bind(value: unknown): string;
}

function builder(): SqlBuilder {
  const params: unknown[] = [];
  return {
    params,
    bind(value: unknown) {
      params.push(value);
      return `$${params.length}`;
    },
  };
}

function taxonomyPredicate(values: string[], b: SqlBuilder): string | null {
  const parsed: Array<{ family: string; leaf?: string }> = [];
  for (const path of values) {
    const [family, leaf] = path.split('/');
    if (family === 'intern' || family === 'campus' || family === 'social') parsed.push({ family, leaf });
  }
  if (!parsed.length) return null;
  const byFamily = new Map<string, Array<string | undefined>>();
  for (const item of parsed) {
    const list = byFamily.get(item.family) ?? [];
    list.push(item.leaf);
    byFamily.set(item.family, list);
  }
  const familyClauses: string[] = [];
  for (const [family, leaves] of byFamily) {
    const familyParam = b.bind(family);
    const leafClauses = leaves.filter(Boolean).map((leaf) => {
      const key = family === 'intern'
        ? (leaf === 'summer' || leaf === 'daily' ? 'internKind' : 'conversion')
        : family === 'campus' ? 'campusSeason' : 'experience';
      const value = b.bind(leaf);
      if (family === 'intern' && key === 'conversion') {
        return `p.taxonomy->>'conversion' = ${value}`;
      }
      return `p.taxonomy->>'${key}' = ${value}`;
    });
    familyClauses.push(leafClauses.length
      ? `(p.family = ${familyParam} AND (${leafClauses.join(' OR ')}))`
      : `p.family = ${familyParam}`);
  }
  return familyClauses.length === 1 ? familyClauses[0] : `(${familyClauses.join(' OR ')})`;
}

function positionFilterClauses(filters: Record<string, unknown>, b: SqlBuilder): string[] {
  const clauses: string[] = [];
  const positionType = stringArray(filters.positionType);
  if (positionType?.length) clauses.push(`p.family = ANY(${b.bind(positionType)}::text[])`);

  const taxonomy = stringArray(filters.jobTaxonomy);
  const taxonomySql = taxonomy?.length ? taxonomyPredicate(taxonomy, b) : null;
  if (taxonomySql) clauses.push(taxonomySql);

  const education = stringArray(filters.education);
  if (education?.length) clauses.push(`p.education = ANY(${b.bind(education)}::text[])`);

  const roleFamily = stringArray(filters.roleFamily);
  if (roleFamily?.length) {
    const roleClauses: string[] = [];
    for (const role of roleFamily) {
      const roleSql = roleClause(role, b);
      if (roleSql) roleClauses.push(`(${roleSql})`);
    }
    if (roleClauses.length) clauses.push(roleClauses.length === 1 ? roleClauses[0] : `(${roleClauses.join(' OR ')})`);
  }

  const salary = filters.salary;
  if (Array.isArray(salary) && salary.length === 2) {
    const lo = Number(salary[0]);
    const hi = Number(salary[1]);
    clauses.push(`(p.salary_min IS NOT NULL OR p.salary_max IS NOT NULL)
      AND ((COALESCE(p.salary_min, 0) + COALESCE(p.salary_max, 0)) / 2 >= ${b.bind(lo)})
      AND ((COALESCE(p.salary_min, 0) + COALESCE(p.salary_max, 0)) / 2 <= ${b.bind(hi)})`);
  }

  const deadline = filters.deadline;
  if (deadline !== undefined && deadline !== null && deadline !== '' && Number.isFinite(Date.parse(String(deadline)))) {
    clauses.push(`(p.deadline IS NULL OR p.deadline >= ${b.bind(String(deadline).slice(0, 10))}::date)`);
  }
  return clauses;
}

function activePositionSql(alias: string): string {
  return `${alias}.status = 'open' AND (${alias}.deadline IS NULL OR ${alias}.deadline >= CURRENT_DATE)`;
}

function cityCenterExclusionSql(alias = 's'): string {
  const unique = new Set<string>();
  for (const center of Object.values(CITY_CENTERS)) unique.add(`${center.lng},${center.lat}`);
  return [...unique]
    .map((pair) => {
      const [lng, lat] = pair.split(',');
      return `NOT (ABS(${alias}.lng - ${Number(lng)}) <= ${CITY_CENTER_EPS} AND ABS(${alias}.lat - ${Number(lat)}) <= ${CITY_CENTER_EPS})`;
    })
    .join(' AND ');
}

function locatedSiteSql(alias = 's'): string {
  return `${alias}.geom IS NOT NULL
    AND ${alias}.lng IS NOT NULL
    AND ${alias}.lat IS NOT NULL
    AND NOT (${alias}.lng = 0 AND ${alias}.lat = 0)
    AND ${cityCenterExclusionSql(alias)}`;
}

interface CandidateSql {
  from: string;
  where: string;
  params: unknown[];
}

function candidateSql(query: WorkCatalogPageQuery): CandidateSql {
  const b = builder();
  const filters = query.filters ?? {};
  const clauses = [
    locatedSiteSql('s'),
  ];
  const maxTier = parseMaxTier(filters.maxTier);
  if (maxTier !== null) clauses.push(`COALESCE(c.tier, 12) <= ${b.bind(maxTier)}`);

  const industry = stringArray(filters.industry);
  if (industry?.length) clauses.push(`c.industries @> ${b.bind(industry)}::text[]`);
  const scale = stringArray(filters.scale);
  if (scale?.length) clauses.push(`c.scale = ANY(${b.bind(scale)}::text[])`);

  const positionClauses = [
    activePositionSql('p'),
    '(p.site_id = s.id OR p.taxonomy->>\'aggregate\' = \'true\')',
    ...positionFilterClauses(filters, b),
  ];
  const positionMatch = `EXISTS (SELECT 1 FROM positions p WHERE ${positionClauses.join(' AND ')})`;
  clauses.push(positionMatch);

  const groups = literalQuery(query.q) ?? [];
  if (groups.length) {
    const companyMatch = querySql(COMPANY_HAYSTACK, groups, b);
    const positionMatchWithQuery = `EXISTS (SELECT 1 FROM positions qp WHERE ${[
      activePositionSql('qp'),
      '(qp.site_id = s.id OR qp.taxonomy->>\'aggregate\' = \'true\')',
      querySql(positionHaystack('qp'), groups, b),
    ].join(' AND ')})`;
    clauses.push(`(${companyMatch} OR ${positionMatchWithQuery})`);
  }

  return {
    from: 'FROM companies c JOIN company_sites s ON s.company_id = c.id',
    where: `WHERE ${clauses.filter(Boolean).join(' AND ')}`,
    params: b.params,
  };
}

function activePositionAggregateSql(kind: 'count' | 'salary' | 'deadline'): string {
  const select = kind === 'count'
    ? 'count(DISTINCT sp.external_id)'
    : kind === 'salary'
      ? 'max(COALESCE(sp.salary_max, 0))'
      : 'min(sp.deadline)';
  return `(SELECT ${select} FROM positions sp
    WHERE ${activePositionSql('sp')}
      AND (sp.site_id = s.id OR sp.taxonomy->>'aggregate' = 'true'))`;
}

function orderBy(query: WorkCatalogPageQuery, b: SqlBuilder): string {
  const sort = query.sort || '';
  if (sort === 'distance') {
    const center = finiteCenter(query.center);
    const lng = b.bind(center.lng);
    const lat = b.bind(center.lat);
    return `ST_DistanceSphere(s.geom, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)) ASC, c.slug ASC, s.id ASC`;
  }
  if (sort === 'rating') return 'COALESCE(c.rating, 0) DESC, c.slug ASC, s.id ASC';
  if (sort === 'salaryDesc') return `${activePositionAggregateSql('salary')} DESC, c.slug ASC, s.id ASC`;
  if (sort === 'positionCount') return `${activePositionAggregateSql('count')} DESC, c.slug ASC, s.id ASC`;
  if (sort === 'deadline') return `${activePositionAggregateSql('deadline')} ASC NULLS LAST, c.slug ASC, s.id ASC`;
  return 'c.slug ASC, s.id ASC';
}

function pageRowSql(query: WorkCatalogPageQuery, candidate: CandidateSql, page: number, pageSize: number): { sql: string; params: unknown[] } {
  const b = builder();
  b.params.push(...candidate.params);
  const offset = (page - 1) * pageSize;
  const order = orderBy(query, b);
  const offsetPlaceholder = b.bind(offset);
  const limitPlaceholder = b.bind(pageSize);
  return {
    sql: `/* work-page rows */
      SELECT c.id::text AS company_id, c.slug, c.name, c.industries, c.scale, c.rating,
             c.summary, c.career_url, c.logo_url, c.logo_emoji, c.tier, c.category,
             (SELECT COUNT(*) FROM company_sites all_sites
              WHERE all_sites.company_id = c.id AND ${locatedSiteSql('all_sites')})::text AS site_count,
             s.id::text AS site_id, s.name AS site_name, s.address, s.city, s.province,
             s.city_code, s.lng, s.lat, s.career_url AS site_career_url, s.logo_url AS site_logo_url
      ${candidate.from}
      ${candidate.where}
      ORDER BY ${order}
      OFFSET ${offsetPlaceholder} LIMIT ${limitPlaceholder}`,
    params: b.params,
  };
}

interface WorkCatalogPageRow {
  company_id: string;
  slug: string;
  name: string;
  industries: string[];
  scale: CompanyRow['scale'];
  tier: CompanyRow['tier'];
  category: string | null;
  rating: CompanyRow['rating'];
  summary: string | null;
  career_url: string | null;
  logo_url: string | null;
  logo_emoji: string | null;
  site_count: string | number;
  site_id: string;
  site_name: string;
  site_career_url: string | null;
  site_logo_url: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  city_code: string | null;
  lng: number | null;
  lat: number | null;
}

function mapCompany(row: WorkCatalogPageRow): CompanyRow {
  return {
    id: row.company_id,
    slug: row.slug,
    name: row.name,
    industries: row.industries,
    scale: row.scale,
    tier: row.tier,
    category: row.category,
    rating: row.rating,
    summary: row.summary,
    career_url: row.career_url,
    logo_url: row.logo_url,
    logo_emoji: row.logo_emoji,
  };
}

function mapSite(row: WorkCatalogPageRow): SiteRow {
  return {
    id: row.site_id,
    company_id: row.company_id,
    name: row.site_name,
    address: row.address,
    city: row.city,
    province: row.province,
    city_code: row.city_code,
    lng: row.lng,
    lat: row.lat,
    career_url: row.site_career_url,
    logo_url: row.site_logo_url,
  };
}

function pagePositionSql(siteIds: string[], companyIds: string[]): { sql: string; params: unknown[] } {
  return {
    sql: `/* work-page positions */
      SELECT p.company_id::text, p.site_id::text, p.external_id, p.title, p.department,
             p.family, p.taxonomy, p.salary_min, p.salary_max, p.education, p.majors,
             p.skills, p.description, p.deadline, p.apply_source, p.apply_url, p.status
      FROM positions p
      WHERE p.status = 'open'
        AND (p.deadline IS NULL OR p.deadline >= CURRENT_DATE)
        AND (p.site_id = ANY($1::bigint[])
             OR (p.taxonomy->>'aggregate' = 'true' AND p.company_id = ANY($2::bigint[])))`,
    params: [siteIds, companyIds],
  };
}

export async function loadWorkCatalogPageFromDb(
  query: WorkCatalogPageQuery,
  pool: DbPoolLike | null = getPool(),
): Promise<WorkCatalogPage | null> {
  if (!pool || !supportsWorkCatalogPageQuery(query)) return null;
  const page = Math.max(1, Math.floor(query.page || 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(query.pageSize || 20)));
  const candidate = candidateSql(query);
  const countSql = `/* work-page count */ SELECT COUNT(*)::text AS total ${candidate.from} ${candidate.where}`;
  const aggregateSql = `/* work-page aggregations */
    SELECT u.industry, COUNT(*)::text AS count
    FROM (
      SELECT c.industries
      ${candidate.from}
      ${candidate.where}
    ) eligible
    CROSS JOIN LATERAL unnest(eligible.industries) AS u(industry)
    GROUP BY u.industry`;
  const rowsQuery = pageRowSql(query, candidate, page, pageSize);

  try {
    const [count, aggregates, rows] = await Promise.all([
      queryPublicRead<{ total: string }>(pool, countSql, candidate.params),
      queryPublicRead<{ industry: string; count: string }>(pool, aggregateSql, candidate.params),
      queryPublicRead<WorkCatalogPageRow>(pool, rowsQuery.sql, rowsQuery.params),
    ]);
    const total = Number(count.rows[0]?.total ?? 0);
    const industries: Record<string, number> = {};
    for (const row of aggregates.rows) industries[row.industry] = Number(row.count ?? 0);
    if (rows.rows.length === 0) {
      return { total, page, pageSize, results: [], aggregations: { industries } };
    }

    const companies: CompanyRow[] = [];
    const companyIds: string[] = [];
    const located: SiteRow[] = [];
    const siteIds: string[] = [];
    const siteCounts = new Map<string, number>();
    const seenCompanies = new Set<string>();
    for (const row of rows.rows) {
      if (!seenCompanies.has(row.company_id)) {
        seenCompanies.add(row.company_id);
        companyIds.push(row.company_id);
        companies.push(mapCompany(row));
      }
      siteIds.push(row.site_id);
      siteCounts.set(row.company_id, Number(row.site_count));
      located.push(mapSite(row));
    }
    const positionsQuery = pagePositionSql(siteIds, companyIds);
    const positions = await queryPublicRead<PositionRow>(pool, positionsQuery.sql, positionsQuery.params);
    const center = finiteCenter(query.center);
    const results = withDistance<RecruitmentPOI>(buildRecruitmentPois(companies, located, positions.rows, siteCounts), center);
    const order = new Map<string, number>();
    rows.rows.forEach((row, index) => {
      const siteCount = Number(row.site_count);
      const id = siteCount === 1 ? row.slug : `${row.slug}:${row.site_id}`;
      order.set(id, index);
    });
    results.sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER));
    return { total, page, pageSize, results, aggregations: { industries } };
  } catch {
    return null;
  }
}
