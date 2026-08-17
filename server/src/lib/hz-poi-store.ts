// ============================================================
// 杭州 POI 本地查询(服务端)
//
// 从 hz_pois 按 bbox + zoom(tier) + 关键词 + 分类裁剪,返回 DomainPOI 形状。
// 复用 spatial-query.ts 的 gist && 模式(GCJ bbox 直匹配,零转换)。
// 无 DATABASE_URL → 返回 null(调用方走回退)。
// ============================================================

import { getPool } from './db.ts';
import type { DomainPOI, POILocation } from './types.ts';
import { hasSpatialClip, parseMaxTier, type SpatialClip } from './spatial-query.ts';
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

  if (typeof opts.zoom === 'number' && Number.isFinite(opts.zoom) && opts.zoom > 0) {
    clauses.push(`p.tier <= $${i}`);
    params.push(Math.floor(opts.zoom));
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

/** 从 hz_pois 按 bbox+zoom+关键词 查询。无库/表缺失 → null(走回退)。 */
export async function loadHangzhouPoisFromDb(
  opts: HzPoiQueryOptions,
): Promise<HzPoiResult | null> {
  const pool = getPool();
  if (!pool) return null;

  const limit = Math.min(300, Math.max(1, Math.floor(opts.limit ?? 300)));
  const offset = Math.min(1000, Math.max(0, Math.floor(opts.offset ?? 0)));
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
      return { total: 0, offset, limit, results: [] };
    }
    const total = Number(result.rows[0].total);
    const results = result.rows.map(hzRowToDomainPoi);
    return { total, offset, limit, results };
  } catch {
    // 表缺失 / 连接错误 → 走回退
    return null;
  }
}

/** 杭州判定:中心点是否落在杭州数据范围框内(服务端侧) */
export function isHangzhouCenter(loc: { lng: number; lat: number }): boolean {
  // 杭州 GCJ-02 数据范围 + 边距(与 hz-poi-import.ts HANGZHOU_BBOX 同)
  return (
    loc.lng >= 118.3 && loc.lng <= 120.8 && loc.lat >= 29.1 && loc.lat <= 30.7
  );
}

// 复用导出,便于 route 解析
export { parseBoundsParam, parseMaxTier, hasSpatialClip };
