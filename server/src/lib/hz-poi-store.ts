// ============================================================
// 杭州 POI 本地查询(服务端)
//
// 从 hz_pois 按 bbox + zoom(tier) + 关键词 + 分类裁剪,返回 DomainPOI 形状。
// 复用 spatial-query.ts 的 gist && 模式(GCJ bbox 直匹配,零转换)。
// 无 DATABASE_URL → 返回 null(调用方走回退)。
//
// 规划器纪律(2026-08-29):ORDER BY rating + count(*) OVER() 会让规划器走
// hz_pois_rating_idx,把 geom && 当成 Filter,百万行上超时(公开读 3s)。
// 视口级 bbox 用 MATERIALIZED CTE 先走 gist;全市/省包络改走 city_code +
// rating LIMIT(框几乎盖住该城时 gist 命中≈全城,物化更亏)。city_code 等值
// 放在 WHERE 最前,全国按城导入 / LIST 分区时可以裁到一座城。
// ============================================================

import { getPool, queryPublicRead } from './db.ts';
import type { DomainPOI, POILocation } from './types.ts';
import { HANGZHOU_BBOX, parseBoundsParam, type ViewportBounds } from './viewport-search.ts';

export interface HzPoiQueryOptions {
  /** bbox(GCJ-02) */
  bounds?: ViewportBounds | null;
  /** 当前 zoom(floor 后取整,tier <= zoom 显示) */
  zoom?: number;
  /** 关键词:name ILIKE */
  q?: string;
  /** 分类过滤:big_type = ANY(...) */
  categories?: string[];
  /** 每页条数(1..300) */
  limit?: number;
  /** 偏移(0..1000) */
  offset?: number;
  /**
   * 国标行政区划码(6 位)。全国按城扩表时用于裁剪/分区裁枝。
   * 缺省或非法 → 杭州 `HANGZHOU_CITY_CODE`(当前唯一已导入城)。
   */
  cityCode?: string;
}

export interface HzPoiResult {
  total: number;
  offset: number;
  limit: number;
  results: DomainPOI[];
}

/** Demo / 当前唯一已导入城。全国扩表后调用方传入目标城,不要扫全国。 */
export const HANGZHOU_CITY_CODE = '330100';

/** Public domain-local reads are only valid inside the imported Hangzhou extent. */
export function isAllowedHangzhouBounds(bounds: ViewportBounds | null | undefined): boolean {
  if (!bounds) return false;
  return (
    bounds.west >= HANGZHOU_BBOX.west &&
    bounds.south >= HANGZHOU_BBOX.south &&
    bounds.east <= HANGZHOU_BBOX.east &&
    bounds.north <= HANGZHOU_BBOX.north
  );
}

/** Maximum rows returned by one domain-local read, independent of client input. */
export const HZ_POI_RESULT_LIMIT = 300;

/**
 * 独立 count 上限:前端分页 offset 最大 1000、硬顶 1000 条,精确到 1001 即够
 * 判断「还有更多」。全市包络下避免 `count(*)` 扫完一座城。
 */
export const HZ_POI_COUNT_CAP = 1001;

/**
 * 视口 gist-first 的最大包络跨度(度)。约 35km:街区/区县视口走 gist;
 * 杭州市导入范围(~2.5°×1.6°)和未来「整城」包络走 rating+LIMIT。
 */
export const HZ_POI_GIST_FIRST_MAX_SPAN_DEG = 0.35;

const CITY_CODE_RE = /^[0-9]{6}$/;

const LIST_COLUMNS = `p.poi_id, p.name, p.address, p.tel, p.rating, p.cost,
           p.lng_gcj, p.lat_gcj, p.big_type, p.mid_type, p.photos, p.open_hours`;

const ORDER_BY_RATING = `rating DESC NULLS LAST, jsonb_array_length(photos) DESC, poi_id`;

interface HzPoiRow {
  poi_id: string;
  name: string;
  address: string | null;
  tel: string | null;
  rating: string | null; // pg numeric → string
  cost: string | null; // pg numeric → string
  lng_gcj: number;
  lat_gcj: number;
  big_type: string;
  mid_type: string | null;
  photos: string[] | null; // jsonb → array
  open_hours: string | null;
  total: string | number | null; // CTE count → int; 全市路径可能为 null
}

/** 6 位行政区划码;非法/空 → undefined(调用方再回落杭州)。 */
export function normalizeCityCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return CITY_CODE_RE.test(trimmed) ? trimmed : undefined;
}

/** 包络经纬跨度(度),供 gist-first 启发式使用。 */
export function envelopeSpanDeg(bounds: ViewportBounds): number {
  return Math.max(bounds.east - bounds.west, bounds.north - bounds.south);
}

/**
 * 视口足够小 → 先物化 gist 命中再按 rating 排序。
 * 全市/全国城级包络 → false(框内≈该城全量,走 rating 索引 + LIMIT)。
 */
export function shouldPreferGistClip(bounds: ViewportBounds | null | undefined): boolean {
  if (!bounds) return false;
  const span = envelopeSpanDeg(bounds);
  return Number.isFinite(span) && span > 0 && span <= HZ_POI_GIST_FIRST_MAX_SPAN_DEG;
}

/**
 * 生成 hz_pois WHERE 片段。占位符从 start 递增。
 * city_code 等值在最前(全国按城导入/分区裁枝);随后 gist bbox。
 * common 过滤下推:rating>0 或 photos 非空或地标类(tier<=3)。
 */
export function hzPoiSpatialSql(
  opts: HzPoiQueryOptions,
  start = 1,
): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let i = start;

  const cityCode = normalizeCityCode(opts.cityCode);
  if (cityCode) {
    clauses.push(`p.city_code = $${i}`);
    params.push(cityCode);
    i += 1;
  }

  if (opts.bounds) {
    clauses.push(`p.geom && ST_MakeEnvelope($${i}, $${i + 1}, $${i + 2}, $${i + 3}, 4326)`);
    params.push(opts.bounds.west, opts.bounds.south, opts.bounds.east, opts.bounds.north);
    i += 4;
  }

  if (typeof opts.zoom === 'number' && Number.isFinite(opts.zoom)) {
    // zoom 0 也生效(tier <= 0 = 仅地标);上限 20 防止 tier-21「永隐」类被放出
    clauses.push(`p.tier <= $${i}`);
    params.push(Math.min(20, Math.max(0, Math.floor(opts.zoom))));
    i += 1;
  }

  const q = opts.q?.trim();
  if (q) {
    clauses.push(`p.name ILIKE $${i}`);
    params.push(`%${q}%`);
    i += 1;
  }

  const categories = opts.categories?.filter((c) => c && c.trim());
  if (categories?.length) {
    clauses.push(`p.big_type = ANY($${i}::text[])`);
    params.push(categories);
    i += 1;
  }

  // common 门槛下推:有评分 / 有照片 / 地标类(tier<=3)——避免返回大量无图无分噪声
  clauses.push(`(p.rating > 0 OR jsonb_array_length(p.photos) > 0 OR p.tier <= 3)`);

  return { where: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

/**
 * 列表 SQL。clipFirst 时 MATERIALIZED 阻断规划器把 ORDER BY rating 提成主路径。
 * 全市路径不物化,让 rating btree + LIMIT 在 city_code 裁剪后早停。
 */
export function hzPoiPageSql(
  where: string,
  params: unknown[],
  limit: number,
  offset: number,
  clipFirst: boolean,
): { sql: string; params: unknown[] } {
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  if (clipFirst) {
    return {
      sql: `
    WITH clipped AS MATERIALIZED (
      SELECT ${LIST_COLUMNS}
      FROM hz_pois p
      ${where}
    )
    SELECT poi_id, name, address, tel, rating, cost,
           lng_gcj, lat_gcj, big_type, mid_type, photos, open_hours,
           (SELECT count(*)::int FROM clipped) AS total
    FROM clipped
    ORDER BY ${ORDER_BY_RATING}
    LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params: [...params, limit, offset],
    };
  }
  return {
    sql: `
    SELECT ${LIST_COLUMNS},
           NULL::int AS total
    FROM hz_pois p
    ${where}
    ORDER BY p.rating DESC NULLS LAST, jsonb_array_length(p.photos) DESC, p.poi_id
    LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params: [...params, limit, offset],
  };
}

/** 行 → DomainPOI(GCJ 坐标零转换、photos 截 3、priceLevel 对齐 normalizeAMapPOI) */
export function hzRowToDomainPoi(row: HzPoiRow): DomainPOI {
  const costRaw = row.cost !== null && row.cost !== '' ? Number.parseFloat(row.cost) : undefined;
  const cost = costRaw && Number.isFinite(costRaw) ? costRaw : undefined;
  const rating = row.rating !== null && row.rating !== '' ? Number.parseFloat(row.rating) : undefined;
  const tel = row.tel?.trim();
  const location: POILocation = {
    lng: row.lng_gcj,
    lat: row.lat_gcj,
    address: row.address ?? undefined,
  };
  return {
    id: row.poi_id,
    kind: 'domain',
    name: row.name,
    mode: 'domain',
    source: 'api',
    location,
    category: row.big_type,
    subcategory: row.mid_type ?? undefined,
    rating,
    cost,
    priceLevel: cost !== undefined && cost > 0 ? Math.min(4, Math.ceil(cost / 100)) : undefined,
    openHours: row.open_hours ?? undefined,
    // 防御清洗:旧数据未重导时 DB 里 tel 可能是字面量 '[]'(源 CSV 空电话)
    tel: tel && tel !== '[]' && tel !== '{}' ? tel : undefined,
    photos: Array.isArray(row.photos) ? row.photos.slice(0, 3) : undefined,
  };
}

function parseDbTotal(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 无精确 total 时:短页=到底;满页=至少还有下一页(供前端 noMore,不扫全城计数)。 */
export function paginationTotal(offset: number, limit: number, rowCount: number, dbTotal: number | null): number {
  if (dbTotal != null) return dbTotal;
  if (rowCount < limit) return offset + rowCount;
  return offset + rowCount + 1;
}

/** 从 hz_pois 按 bbox+zoom+关键词 查询。无库/表缺失 → null(走回退)。
 *  pool 参数供测试注入(默认取全局连接池)。 */
export async function loadHangzhouPoisFromDb(
  opts: HzPoiQueryOptions,
  pool: {
    query: <T = HzPoiRow>(
      sql: string,
      params?: unknown[],
    ) => Promise<{ rows: T[] }>;
  } | null = getPool(),
): Promise<HzPoiResult | null> {
  if (!pool) return null;

  // Keep the store itself bounded too: the HTTP route rejects missing/invalid
  // bounds, while direct callers get the imported extent instead of an accidental full-table read.
  const cityCode = normalizeCityCode(opts.cityCode) ?? HANGZHOU_CITY_CODE;
  const boundedOpts: HzPoiQueryOptions = {
    ...(isAllowedHangzhouBounds(opts.bounds) ? opts : { ...opts, bounds: HANGZHOU_BBOX }),
    cityCode,
  };
  const limit = Number.isFinite(boundedOpts.limit)
    ? Math.min(HZ_POI_RESULT_LIMIT, Math.max(1, Math.floor(boundedOpts.limit as number)))
    : HZ_POI_RESULT_LIMIT;
  const offset = Number.isFinite(boundedOpts.offset)
    ? Math.min(1000, Math.max(0, Math.floor(boundedOpts.offset as number)))
    : 0;
  const { where, params } = hzPoiSpatialSql(boundedOpts);
  const clipFirst = shouldPreferGistClip(boundedOpts.bounds ?? null);
  const page = hzPoiPageSql(where, params, limit, offset, clipFirst);

  try {
    const result = await queryPublicRead<HzPoiRow>(pool, page.sql, page.params);
    if (result.rows.length === 0) {
      // OFFSET 越过结果末尾时页查询不产出行。独立 count 带 LIMIT 帽,
      // 全市包络下不会为了一个空页去 count 百万行。
      const countRes = await queryPublicRead<{ n: string }>(
        pool,
        `SELECT count(*)::int AS n FROM (
           SELECT 1 FROM hz_pois p ${where} LIMIT $${params.length + 1}
         ) capped`,
        [...params, HZ_POI_COUNT_CAP],
      );
      const total = Number(countRes.rows[0]?.n ?? 0);
      return { total, offset, limit, results: [] };
    }
    const total = paginationTotal(offset, limit, result.rows.length, parseDbTotal(result.rows[0].total));
    const results = result.rows.map(hzRowToDomainPoi);
    return { total, offset, limit, results };
  } catch {
    // 表缺失 / 连接错误 → 走回退
    return null;
  }
}

/** 搜索建议行(name 前缀匹配,供 /api/suggest domain 分支用)。 */
export interface HzPoiSuggestionRow {
  poi_id: string;
  name: string;
  adname: string;
  lng_gcj: number;
  lat_gcj: number;
}

/**
 * 从 hz_pois 按 name 前缀匹配取搜索建议(不裁剪 bbox/LOD——用户输入候选应
 * 任何 zoom 都可选)。必须带 city_code,全国扩表后不能对全国做前缀热门榜。
 * adname 作 subtitle。common 过滤下推(与读路径一致)。
 * 无库/表缺失 → null(调用方走高德回退)。
 */
export async function loadHzPoiSuggestions(
  q: string,
  limit = 10,
  pool: {
    query: <T = HzPoiSuggestionRow>(
      sql: string,
      params?: unknown[],
    ) => Promise<{ rows: T[] }>;
  } | null = getPool(),
  cityCode: string = HANGZHOU_CITY_CODE,
): Promise<HzPoiSuggestionRow[] | null> {
  if (!pool) return null;
  const kw = q.trim();
  if (!kw) return [];
  const n = Math.min(20, Math.max(1, Math.floor(limit)));
  const city = normalizeCityCode(cityCode) ?? HANGZHOU_CITY_CODE;
  const sql = `
    SELECT p.poi_id, p.name, p.adname, p.lng_gcj, p.lat_gcj
    FROM hz_pois p
    WHERE p.city_code = $1
      AND p.name ILIKE $2
      AND (p.rating > 0 OR jsonb_array_length(p.photos) > 0 OR p.tier <= 3)
    ORDER BY p.rating DESC NULLS LAST, jsonb_array_length(p.photos) DESC, p.poi_id
    LIMIT $3`;
  try {
    const result = await queryPublicRead<HzPoiSuggestionRow>(pool, sql, [city, `${kw}%`, n]);
    return result.rows;
  } catch {
    // 表缺失 / 连接错误 → 走回退
    return null;
  }
}

// 复用导出,便于 route 解析
export { parseBoundsParam };
