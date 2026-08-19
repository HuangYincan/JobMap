// Spatial clip helpers for public work reads.
// SQL uses gist && then optional ST_DWithin. No DATABASE_URL → caller
// keeps the in-memory inBounds / pipeline clip.

import {
  DISTRICT_BOXES,
  HANGZHOU_DISTRICTS,
  type HangzhouDistrict,
} from './spatial-filters.ts';
import type { ViewportBounds } from './viewport-search.ts';

export interface SpatialClip {
  bounds?: ViewportBounds | null;
  /** WGS84 point used with ST_DWithin. */
  origin?: { lng: number; lat: number } | null;
  /** Radius in meters. Ignored unless origin is set and radius > 0. */
  radiusMeters?: number | null;
  /**
   * Hangzhou districts. SQL is a superset (address ILIKE or coarse box).
   * Memory `poiMatchesDistrict` still does the exact address-over-box rule.
   */
  districts?: string[] | null;
  /** 城市名（'北京'）或行政区划码（'110000'）。SQL: city_code 精确 OR city ILIKE。 */
  city?: string | null;
  /** LOD：只保留 tier <= maxTier 的公司 site（maxTier = 当前 zoom 取整，0..20；tier 语义见 tech/19）。 */
  maxTier?: number | null;
  /** 只在招：status='open' 且 deadline 为空或 >= 今天。DB 读路径恒开；内存路径按旗标。 */
  alive?: boolean | null;
}

/** 城市过滤值：'北京市' / '北京' 归一成 ILIKE 的裸名（去掉 省/市 后缀）。 */
export function bareCityName(value: string): string {
  return value.replace(/[省市区]$/, '');
}

/** maxTier 解析：0..20 的整数（0=只显示 tier 0，20=最大可见）；缺失 / 非法 → null（不过滤）。 */
export function parseMaxTier(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 20) return null;
  return Math.floor(n);
}

export function knownHangzhouDistricts(values: unknown): HangzhouDistrict[] {
  if (!Array.isArray(values)) return [];
  const allowed = new Set<string>(HANGZHOU_DISTRICTS.map((d) => d.value));
  return values.filter((value): value is HangzhouDistrict => typeof value === 'string' && allowed.has(value));
}

export function hasSpatialClip(clip?: SpatialClip | null): boolean {
  if (!clip) return false;
  if (clip.bounds) return true;
  if (clip.districts && clip.districts.length > 0) return true;
  if (clip.city && clip.city.trim()) return true;
  if (clip.maxTier != null) return true;
  if (clip.alive === true) return true;
  return Boolean(clip.origin && clip.radiusMeters && clip.radiusMeters > 0);
}

// ============================================================
// 城市↔坐标一致性裁剪(Bug1 跨城串味,2026-08-19)
//
// DB company_sites 存在「城市标签与坐标矛盾」行:如 city='深圳市' 但
// lng/lat 是杭州坐标(geocode/import 把一公司某杭州办公室坐标盖到所有
// 城市行上,147 行 / 76 家公司,见 tech 记录)。服务端唯一空间裁剪是
// `s.geom && ST_MakeEnvelope(bounds)`,从不校验 city 与 bounds 是否一致,
// 于是杭州视口查询里 city=深圳 的串味行是合法命中。
//
// 这里在「视口明确是单一城市区域」时追加一致性 WHERE 片段:只保留
//   - city IS NULL(无可判断,放行);
//   - city / province 命中「当前视野所属城市」参考框的标签(SQL 超集,
//     入库值带 省/市 后缀,用 ILIKE 片段匹配)。
// 其余(city=深圳/成都…但坐标在杭州)→ 剔除。
//
// 全国 / 跨省视野不启用(bbox 过大或跨多参考框 → 返回空片段),保证
// zoom<=8 时深圳/成都徽章仍能按真实坐标画出。参考框是粗近似常量,
// 不读 DB、不依赖 geocode 输出,避免运行时数据耦合。纯函数便于单测,
// 与 companySitesSpatialSql 的占位符生成方式一致。
// ============================================================

export interface CityReferenceBox {
  /** 省标签 ILIKE 片段(如 '浙江');不匹配任何省则放行该字段 */
  province: string;
  /** 市内标签 ILIKE 片段(如 '杭州') */
  city: string;
  /** 该城市区域的粗参考框(WGS84) */
  box: ViewportBounds;
}

/**
 * 已纳入一致性裁剪的城市参考框。仅覆盖 Bug1 报告里出现的串味城市
 * (深圳/成都/北京/上海/广州/武汉)+ 杭州(主视野)。新增城市不需改逻辑,
 * 只需扩展此表。
 */
export const CITY_REFERENCE_BOXES: CityReferenceBox[] = [
  { province: '浙江', city: '杭州', box: { west: 118.3, south: 29.05, east: 120.8, north: 30.75 } },
  { province: '广东', city: '深圳', box: { west: 113.6, south: 22.4, east: 114.8, north: 23.0 } },
  { province: '广东', city: '广州', box: { west: 112.9, south: 22.6, east: 114.4, north: 23.9 } },
  { province: '四川', city: '成都', box: { west: 103.7, south: 30.3, east: 104.6, north: 31.1 } },
  { province: '北京', city: '北京', box: { west: 115.4, south: 39.4, east: 117.5, north: 41.0 } },
  { province: '上海', city: '上海', box: { west: 120.8, south: 30.65, east: 122.1, north: 32.0 } },
  { province: '湖北', city: '武汉', box: { west: 113.8, south: 29.9, east: 114.7, north: 31.0 } },
];

/**
 * 视口判定为「单一城市区域」的最大 bbox 面积(平方度,约 2°×3°)。
 * 超过此面积(全国/省际视野)→ 不做一致性裁剪,保留真实跨城。
 * 单个城市 zoom 9-13 视口面积约 0.02–4 sq.deg,远低于阈值。
 */
export const CITY_VIEW_MAX_AREA_SQ_DEG = 6;

function cityRefContains(ref: CityReferenceBox, lng: number, lat: number): boolean {
  const { west, south, east, north } = ref.box;
  // 半开区间避免相邻参考框在边界上重复命中。
  return lng >= west && lng < east && lat >= south && lat < north;
}

/**
 * bounds 中心点是否恰好落在某一个已知城市参考框内。
 * 落在 0 个(海上/未收录城市)→ null;落在 ≥2 个(相邻框重叠)→ null。
 */
export function singleCityReference(
  bounds: ViewportBounds | null | undefined,
): CityReferenceBox | null {
  if (!bounds) return null;
  const lngSpan = bounds.east - bounds.west;
  const latSpan = bounds.north - bounds.south;
  if (!Number.isFinite(lngSpan + latSpan) || lngSpan <= 0 || latSpan <= 0) return null;
  if (lngSpan * latSpan > CITY_VIEW_MAX_AREA_SQ_DEG) return null;
  const centerLng = (bounds.west + bounds.east) / 2;
  const centerLat = (bounds.south + bounds.north) / 2;
  const hits = CITY_REFERENCE_BOXES.filter((ref) => cityRefContains(ref, centerLng, centerLat));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * 单一城市视野下的 city↔bounds 一致性 WHERE 片段:
 * `AND (s.city IS NULL OR province ILIKE %浙江% OR city ILIKE %杭州%)`。
 * bounds 缺失 / 非单一城市视野 → 空片段(全国视野保留真实跨城)。占位符从 start 起。
 */
export function cityBoundsConsistencySql(
  bounds: ViewportBounds | null | undefined,
  start = 1,
): { sql: string; params: unknown[] } {
  const ref = singleCityReference(bounds);
  if (!ref) return { sql: '', params: [] };
  return {
    sql: ` AND (s.city IS NULL OR COALESCE(s.province, '') ILIKE $${start} OR COALESCE(s.city, '') ILIKE $${start + 1})`,
    params: [`%${ref.province}%`, `%${ref.city}%`],
  };
}

/** Envelope for ST_MakeEnvelope(west, south, east, north, 4326). */
export function envelopeArgs(bounds: ViewportBounds): [number, number, number, number] {
  return [bounds.west, bounds.south, bounds.east, bounds.north];
}

/**
 * company_sites WHERE fragment. Placeholders start at `start`.
 * Bounding box uses && (gist). Distance uses geography ST_DWithin.
 */
export function companySitesSpatialSql(
  clip: SpatialClip | undefined,
  start = 1,
): { sql: string; params: unknown[] } {
  if (!hasSpatialClip(clip)) return { sql: '', params: [] };

  const clauses: string[] = [];
  const params: unknown[] = [];
  let i = start;

  if (clip?.bounds) {
    const [west, south, east, north] = envelopeArgs(clip.bounds);
    clauses.push(`s.geom && ST_MakeEnvelope($${i}, $${i + 1}, $${i + 2}, $${i + 3}, 4326)`);
    params.push(west, south, east, north);
    i += 4;
  }

  if (clip?.origin && clip.radiusMeters && clip.radiusMeters > 0) {
    clauses.push(
      `ST_DWithin(s.geom::geography, ST_SetSRID(ST_MakePoint($${i}, $${i + 1}), 4326)::geography, $${i + 2})`,
    );
    params.push(clip.origin.lng, clip.origin.lat, clip.radiusMeters);
    i += 3;
  }

  const districts = knownHangzhouDistricts(clip?.districts);
  if (districts.length) {
    const parts: string[] = [];
    for (const district of districts) {
      const short = district.replace(/区$/, '');
      parts.push(`COALESCE(s.address, '') ILIKE $${i}`);
      params.push(`%${district}%`);
      i += 1;
      if (short !== district) {
        parts.push(`COALESCE(s.address, '') ILIKE $${i}`);
        params.push(`%${short}%`);
        i += 1;
      }
      const box = DISTRICT_BOXES[district];
      if (box) {
        parts.push(`s.geom && ST_MakeEnvelope($${i}, $${i + 1}, $${i + 2}, $${i + 3}, 4326)`);
        params.push(box.west, box.south, box.east, box.north);
        i += 4;
      }
    }
    clauses.push(`(${parts.join(' OR ')})`);
  }

  const city = clip?.city?.trim();
  if (city) {
    // 行政区划码精确匹配（'110000'），城市名 ILIKE 超集（'北京' 命中 '北京市'）。
    clauses.push(`(s.city_code = $${i} OR COALESCE(s.city, '') ILIKE $${i + 1})`);
    params.push(city, `%${bareCityName(city)}%`);
    i += 2;
  }

  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params };
}

export function parseDistanceKm(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
