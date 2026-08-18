// ============================================================
// 杭州 POI 本地查询(服务端)
//
// 从 hz_pois 按 bbox + zoom(tier) + 关键词 + 分类裁剪,返回 DomainPOI 形状。
// 复用 spatial-query.ts 的 gist && 模式(GCJ bbox 直匹配,零转换)。
// 无 DATABASE_URL → 返回 null(调用方走回退)。
// ============================================================

import { getPool } from './db.ts';
import type { DomainPOI, POILocation } from './types.ts';
import { parseBoundsParam, type ViewportBounds } from './viewport-search.ts';

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
}

export interface HzPoiResult {
  total: number;
  offset: number;
  limit: number;
  results: DomainPOI[];
}

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
  total: string; // count(*) OVER() → string
}

/**
 * 生成 hz_pois WHERE 片段。占位符从 start 递增。
 * common 过滤下推:rating>0 或 photos 非空或地标类(tier<=3)。
 */
export function hzPoiSpatialSql(
  opts: HzPoiQueryOptions,
  start = 1,
): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let i = start;

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

/** 行 → DomainPOI(GCJ 坐标零转换、photos 截 3、priceLevel 对齐 normalizeAMapPOI) */
export function hzRowToDomainPoi(row: HzPoiRow): DomainPOI {
  const costRaw = row.cost !== null && row.cost !== '' ? Number.parseFloat(row.cost) : undefined;
  const cost = costRaw && Number.isFinite(costRaw) ? costRaw : undefined;
  const rating = row.rating !== null && row.rating !== '' ? Number.parseFloat(row.rating) : undefined;
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
    priceLevel: cost !== undefined && cost > 0 ? Math.min(4, Math.ceil(cost / 100)) : undefined,
    openHours: row.open_hours ?? undefined,
    tel: row.tel ?? undefined,
    photos: Array.isArray(row.photos) ? row.photos.slice(0, 3) : undefined,
  };
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

  // 非法数值(NaN/Infinity)落回默认值;pg 驱动会把 NaN 序列化成字面量
  // "NaN" 让 Postgres 报错,而 catch 会把它伪装成「无数据」的 200。
  const limit = Number.isFinite(opts.limit)
    ? Math.min(300, Math.max(1, Math.floor(opts.limit as number)))
    : 300;
  const offset = Number.isFinite(opts.offset)
    ? Math.min(1000, Math.max(0, Math.floor(opts.offset as number)))
    : 0;
  const { where, params } = hzPoiSpatialSql(opts);

  // count(*) OVER() 一次拿总数 + 分页窗口
  const sql = `
    SELECT p.poi_id, p.name, p.address, p.tel, p.rating, p.cost,
           p.lng_gcj, p.lat_gcj, p.big_type, p.mid_type, p.photos, p.open_hours,
           count(*) OVER() AS total
    FROM hz_pois p
    ${where}
    ORDER BY p.rating DESC NULLS LAST, jsonb_array_length(p.photos) DESC, p.poi_id
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

  try {
    const result = await pool.query<HzPoiRow>(sql, [...params, limit, offset]);
    if (result.rows.length === 0) {
      // OFFSET 越过结果末尾时 count(*) OVER() 不产出行,total 会误报 0;
      // 补一次独立 count 保持契约(调用方用 offset+rows 判「没有更多」)。
      const countRes = await pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM hz_pois p ${where}`,
        params,
      );
      const total = Number(countRes.rows[0]?.n ?? 0);
      return { total, offset, limit, results: [] };
    }
    const total = Number(result.rows[0].total);
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
 * 任何 zoom 都可选)。adname 作 subtitle。common 过滤下推(与读路径一致)。
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
): Promise<HzPoiSuggestionRow[] | null> {
  if (!pool) return null;
  const kw = q.trim();
  if (!kw) return [];
  const n = Math.min(20, Math.max(1, Math.floor(limit)));
  const sql = `
    SELECT p.poi_id, p.name, p.adname, p.lng_gcj, p.lat_gcj
    FROM hz_pois p
    WHERE p.name ILIKE $1
      AND (p.rating > 0 OR jsonb_array_length(p.photos) > 0 OR p.tier <= 3)
    ORDER BY p.rating DESC NULLS LAST, jsonb_array_length(p.photos) DESC, p.poi_id
    LIMIT $2`;
  try {
    const result = await pool.query<HzPoiSuggestionRow>(sql, [`${kw}%`, n]);
    return result.rows;
  } catch {
    // 表缺失 / 连接错误 → 走回退
    return null;
  }
}

// 复用导出,便于 route 解析
export { parseBoundsParam };
