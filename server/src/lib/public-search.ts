// Shared composition for GET /api/pois and POST /api/search.
// Routes stay thin; tests call this without Next aliases.

import { runPOIPipeline } from './search.ts';
import { knownHangzhouDistricts, parseDistanceKm, parseMaxTier, type SpatialClip } from './spatial-query.ts';
import { isRecruitmentMode, withDistance, type FilterState, type MapMode, type POI } from './types.ts';
import { boundsCenter, inBounds, parseBoundsParam } from './viewport-search.ts';

const HANGZHOU = { lng: 120.15, lat: 30.27 };

export interface PublicSearchInput {
  mode?: MapMode;
  q?: string;
  filters?: FilterState | Record<string, unknown>;
  sort?: string;
  bounds?: string | null;
  /** 距离排序圆心;缺省回退 bounds 中心,再回退杭州默认点。 */
  center?: { lng: number; lat: number };
  page?: number;
  pageSize?: number;
}

export interface PublicSearchResult {
  total: number;
  page: number;
  pageSize: number;
  results: POI[];
  aggregations: { industries: Record<string, number> };
}

export function clampPage(page: number | undefined): number {
  return Math.max(1, Math.floor(page || 1));
}

export function clampPageSize(pageSize: number | undefined): number {
  return Math.min(50, Math.max(1, Math.floor(pageSize || 20)));
}

export function spatialClipFromSearch(input: PublicSearchInput): SpatialClip | undefined {
  const bounds = parseBoundsParam(input.bounds);
  const km = parseDistanceKm(input.filters && (input.filters as FilterState).distance);
  const origin = bounds ? boundsCenter(bounds) : null;
  const districts = knownHangzhouDistricts(input.filters && (input.filters as FilterState).district);
  const filters = input.filters as FilterState | undefined;
  const city = typeof filters?.city === 'string' && filters.city.trim() ? filters.city.trim() : null;
  const maxTier = parseMaxTier(filters?.maxTier);
  const alive = filters?.alive === true || filters?.alive === 'true';
  const clip: SpatialClip = {
    bounds,
    origin: km && origin ? origin : null,
    radiusMeters: km ? km * 1000 : null,
    districts: districts.length ? districts : null,
    city,
    maxTier,
    alive: alive ? true : null,
  };
  if (
    !clip.bounds &&
    !clip.radiusMeters &&
    !clip.districts?.length &&
    !clip.city &&
    clip.maxTier == null &&
    !clip.alive
  ) {
    return undefined;
  }
  return clip;
}

/**
 * 公开列表/搜索是否写入 30s 进程缓存。
 * 招聘模式无 clip 且 0 条不得缓存:DB 故障曾被折叠成 [] 后,默认
 * `sort=distance` 首屏会把整图 POI 吃成空目录(浏览器 max-age=30 同罪)。
 * 带 clip 的真空仍可缓存(东海裁剪等合法空结果)。
 */
export function shouldWritePublicCatalogCache(
  mode: MapMode,
  clip: SpatialClip | undefined,
  total: number,
): boolean {
  if (total > 0) return true;
  if (!isRecruitmentMode(mode)) return true;
  return Boolean(clip);
}

function isFiniteCenter(value: unknown): value is { lng: number; lat: number } {
  if (!value || typeof value !== 'object') return false;
  const loc = value as { lng?: unknown; lat?: unknown };
  return typeof loc.lng === 'number' && Number.isFinite(loc.lng)
    && typeof loc.lat === 'number' && Number.isFinite(loc.lat);
}

export function searchPublicCatalog(pois: POI[], input: PublicSearchInput): PublicSearchResult {
  const mode = input.mode || 'work';
  const page = clampPage(input.page);
  const pageSize = clampPageSize(input.pageSize);
  const bounds = parseBoundsParam(input.bounds);
  const scoped = bounds ? pois.filter((poi) => inBounds(poi.location, bounds)) : pois;
  const center = isFiniteCenter(input.center)
    ? input.center
    : bounds
      ? boundsCenter(bounds)
      : HANGZHOU;
  const processed = runPOIPipeline(scoped, {
    query: input.q,
    filters: input.filters as FilterState | undefined,
    sort: input.sort,
    center,
  });
  const start = (page - 1) * pageSize;
  const industries: Record<string, number> = {};
  if (isRecruitmentMode(mode)) {
    for (const poi of processed) {
      if (poi.kind !== 'recruitment') continue;
      for (const ind of poi.company.industries) {
        industries[ind] = (industries[ind] || 0) + 1;
      }
    }
  }
  return {
    total: processed.length,
    page,
    pageSize,
    results: withDistance(processed.slice(start, start + pageSize), center),
    aggregations: { industries },
  };
}
