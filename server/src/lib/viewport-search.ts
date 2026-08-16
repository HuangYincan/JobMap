// ============================================================
// 单中心周边搜索 + 增量合并（纯函数，无 AMap 依赖）
//
// 个人开发者 JS API 约 3 次/秒。从用户位置（刷新后改视野中心）
// searchNearBy，按分类轮询、按页翻。半径 = 图上 1cm × 30，
// 超过 50km 回落高德默认 3000m。
// ============================================================

export interface LngLat {
  lng: number;
  lat: number;
}

export interface ViewportBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** 默认展示上限；「需要更多」可突破 */
export const POI_SOFT_CAP = 300;
/** 每次「需要更多」再扩这么多 */
export const MORE_PAGE_SIZE = 300;
/** 浏览器累计硬顶，防止无限堆 */
export const POI_HARD_CAP = 3000;
/** 兼容旧名：一轮网格搜索的目标增量 */
export const REFRESH_ADD_CAP = POI_SOFT_CAP;

/** 低层级只搜地标，避免全国铺满杂店 */
export const LANDMARK_KEYWORDS = [
  '风景名胜',
  '高等院校',
  '机场',
  '火车站',
  '市政府',
] as const;

export const CORE_KEYWORDS = [
  '风景名胜',
  '高等院校',
  '购物服务',
  '交通设施服务',
  '公司企业',
] as const;

export const ALL_KEYWORDS = [
  '餐饮服务',
  '购物服务',
  '风景名胜',
  '科教文化服务',
  '交通设施服务',
  '体育休闲服务',
  '医疗保健服务',
  '住宿服务',
  '公司企业',
] as const;

export type CategorySet = 'landmark' | 'core' | 'all';

export interface ZoomStrategy {
  categories: CategorySet;
  pages: number;
  pageSize: number;
  /** PlaceSearch city：全国 / 空（不锁杭州） */
  city: string;
  cityLimit: boolean;
  maxPois: number;
}

/**
 * 个人开发者 JS API 配额约 3 次/秒。
 * 单中心 + 单分类翻页，不要铺网格并发。
 */
export const AMAP_QPS = 3;
export const AMAP_PAGE_SIZE = 25;

/** 缩放策略：只决定分类集和半径所依赖的 zoom，不再拆格 */
export function zoomStrategy(zoom: number): ZoomStrategy {
  if (zoom <= 5) {
    return {
      categories: 'landmark',
      pages: 4,
      pageSize: AMAP_PAGE_SIZE,
      city: '全国',
      cityLimit: false,
      maxPois: POI_SOFT_CAP,
    };
  }
  if (zoom <= 8) {
    return {
      categories: 'core',
      pages: 4,
      pageSize: AMAP_PAGE_SIZE,
      city: '全国',
      cityLimit: false,
      maxPois: POI_SOFT_CAP,
    };
  }
  return {
    categories: 'all',
    pages: 4,
    pageSize: AMAP_PAGE_SIZE,
    city: '',
    cityLimit: false,
    maxPois: POI_SOFT_CAP,
  };
}

export function keywordsFor(set: CategorySet): readonly string[] {
  if (set === 'landmark') return LANDMARK_KEYWORDS;
  if (set === 'core') return CORE_KEYWORDS;
  return ALL_KEYWORDS;
}

/** 在视口内取 cols×rows 个单元格中心点（默认 16） */
export function sampleViewportGrid(
  bounds: ViewportBounds,
  cols = 4,
  rows = 4
): LngLat[] {
  const points: LngLat[] = [];
  const { west, south, east, north } = normalizeBounds(bounds);
  const lngSpan = east - west;
  const latSpan = north - south;
  if (lngSpan <= 0 || latSpan <= 0) return [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      points.push({
        lng: west + ((c + 0.5) / cols) * lngSpan,
        lat: south + ((r + 0.5) / rows) * latSpan,
      });
    }
  }
  return points;
}

export function normalizeBounds(bounds: ViewportBounds): ViewportBounds {
  return {
    west: Math.min(bounds.west, bounds.east),
    east: Math.max(bounds.west, bounds.east),
    south: Math.min(bounds.south, bounds.north),
    north: Math.max(bounds.south, bounds.north),
  };
}

/** 高德 searchNearBy 半径上限 50km；再大按默认值 */
export const AMAP_NEARBY_MAX_RADIUS = 50_000;
/** 高德 searchNearBy 默认半径（超上限时回落） */
export const AMAP_DEFAULT_RADIUS = 3_000;
/** 大比例尺：图上 1cm 实地距离 × 此倍数 */
export const SCALE_RADIUS_MULTIPLIER = 30;
const PX_PER_CM_96DPI = 96 / 2.54;

/** Web Mercator 米/像素 */
export function metersPerPixel(zoom: number, latitude: number): number {
  const lat = clamp(latitude, -85, 85);
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** Math.max(zoom, 0);
}

/** 96dpi 下图上 1cm 代表的实地米数（比例尺大小） */
export function mapScaleMetersPerCm(zoom: number, latitude: number): number {
  return metersPerPixel(zoom, latitude) * PX_PER_CM_96DPI;
}

/**
 * searchNearBy 半径：比例尺大小 × 30。
 * 取值 0–50000；算出来大于 50000 时用默认 3000。
 */
export function searchRadiusMeters(zoom: number, latitude: number): number {
  const raw = mapScaleMetersPerCm(zoom, latitude) * SCALE_RADIUS_MULTIPLIER;
  if (!Number.isFinite(raw) || raw <= 0) return AMAP_DEFAULT_RADIUS;
  if (raw > AMAP_NEARBY_MAX_RADIUS) return AMAP_DEFAULT_RADIUS;
  return Math.round(raw);
}

/** @deprecated 改用 searchRadiusMeters(zoom, lat) */
export function viewportRadiusMeters(bounds: ViewportBounds): number {
  const b = normalizeBounds(bounds);
  return searchRadiusMeters(13, (b.south + b.north) / 2);
}

/** @deprecated 网格已废弃 */
export function cellRadiusMeters(
  bounds: ViewportBounds,
  _cols = 4,
  _rows = 4
): number {
  return viewportRadiusMeters(bounds);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function mergePoisById<T extends { id: string }>(
  existing: T[],
  incoming: T[],
  cap = POI_HARD_CAP
): T[] {
  const seen = new Set(existing.map((p) => p.id));
  const out = existing.slice(0, cap);
  for (const poi of incoming) {
    if (out.length >= cap) break;
    if (!poi?.id || seen.has(poi.id)) continue;
    seen.add(poi.id);
    out.push(poi);
  }
  return out;
}

/**
 * 单中心串行任务：分类轮询 × 页码。
 * pageOffset=0 从第 1 页起，每个分类先打一页（尽快出点），再翻后续页。
 */
export interface SearchTask {
  keyword: string;
  page: number;
}

export function buildSearchQueue(
  keywords: readonly string[],
  pages = 4,
  pageOffset = 0
): SearchTask[] {
  if (keywords.length === 0 || pages <= 0) return [];
  const start = pageOffset + 1;
  const queue: SearchTask[] = [];
  for (let p = 0; p < pages; p++) {
    for (const keyword of keywords) {
      queue.push({ keyword, page: start + p });
    }
  }
  return queue;
}

/** @deprecated 网格波次已废弃，转成单中心队列 */
export function buildSearchWaves(
  _pointCount: number,
  keywords: readonly string[],
  pageOffset = 0
): SearchTask[][] {
  const queue = buildSearchQueue(keywords, 1, pageOffset);
  return queue.length ? [queue] : [];
}

/** UI 分类值 → 高德 type 前缀（筛选匹配用） */
export const CATEGORY_TO_AMAP: Record<string, string> = {
  food: '餐饮',
  shopping: '购物',
  entertainment: '体育休闲',
  transport: '交通',
  public: '政府机构',
  hotel: '住宿',
  sport: '体育休闲',
  hospital: '医疗',
  school: '科教',
  company: '公司',
  all: '',
};

export function categoryMatches(poiCategory: string, filterValue: string): boolean {
  if (!filterValue || filterValue === 'all') return true;
  const mapped = CATEGORY_TO_AMAP[filterValue] ?? filterValue;
  return poiCategory.includes(mapped) || mapped.includes(poiCategory);
}

/**
 * 人气分：评论数优先；否则用照片数 + 地标加权。
 * 故意不直接用 rating，避免和「评分最高」撞车。
 */
export function popularityScore(poi: {
  reviewCount?: number;
  photos?: string[];
  category?: string;
  viewCount?: number;
}): number {
  if (typeof poi.viewCount === 'number' && poi.viewCount > 0) return poi.viewCount;
  if (typeof poi.reviewCount === 'number' && poi.reviewCount > 0) return poi.reviewCount;
  const photos = poi.photos?.length ?? 0;
  const cat = poi.category || '';
  const landmark =
    /风景|高校|大学|机场|车站|政府|商场|购物/.test(cat) ? 80 : 15;
  return photos * 40 + landmark;
}

/** 丢掉没有评分、评论、照片的小众店；地标类放宽 */
export function isCommonPoi(poi: {
  rating?: number;
  reviewCount?: number;
  photos?: string[];
  category?: string;
}): boolean {
  const cat = poi.category || '';
  if (/风景|高校|大学|机场|车站|政府|地铁|火车站/.test(cat)) return true;
  if (typeof poi.rating === 'number' && poi.rating > 0) return true;
  if (typeof poi.reviewCount === 'number' && poi.reviewCount > 0) return true;
  if ((poi.photos?.length ?? 0) > 0) return true;
  return false;
}
