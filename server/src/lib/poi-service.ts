// ============================================================
// POI 数据服务 — 按模式统一获取（插件化数据源）
//
// Domain：视口网格波次增量并入累计池，空结果不回退假数据。
// Internship / 工作：公开 catalog（导入行优先）+ 缺坐标时再地理编码。
// 距离与列表裁剪由调用方用钉死的 origin 走 runPOIPipeline。
// ============================================================

import {
  geocodeAddress,
  searchPOI,
  searchViewportPOIsFallback,
} from './amap-api.ts';
import { INTERNSHIP_SEED } from './seed-data.ts';
import { fetchWorkCatalogFromApi } from './recruitment-adapters/api.ts';
import type { QueryPipeline } from './search.ts';
import { mergePoisById, isCommonOrExactName, inHangzhouBox, DOMAIN_POI_HARD_CAP, MORE_PAGE_SIZE, searchRadiusMeters, type ViewportBounds } from './viewport-search.ts';
import type { DomainPOI, MapMode, POI, RecruitmentPOI } from './types.ts';
import { isRecruitmentMode } from './types.ts';

export interface FetchPOIOptions extends QueryPipeline {
  mode: MapMode;
  onlyActive?: boolean;
  zoom?: number;
  bounds?: ViewportBounds;
  /** 已累计的 POI，本轮往里合并，不整表替换 */
  existing?: POI[];
  /** 本轮最多新加多少 */
  addCap?: number;
  /** PlaceSearch 页偏移，「需要更多」时递增 */
  pageOffset?: number;
  /** 增量回调：每波次合并后调用（完整累计池） */
  onBatch?: (pois: POI[]) => void;
  signal?: { cancelled: boolean };
}

/** 获取指定模式的 POI */
export async function fetchPOIsForMode(options: FetchPOIOptions): Promise<POI[]> {
  const { mode, onlyActive = true } = options;

  if (onlyActive && mode !== 'domain' && !isRecruitmentMode(mode)) {
    return [];
  }

  if (mode === 'domain') {
    return fetchDomainPOIs(options);
  }

  return fetchWorkPOIs(options);
}


/** Domain：往累计池里增量合并；找不到就不塞 seed。
 *  tech/22：杭州内走本地 /api/pois/domain-local；杭州外回退高德（省调用，
 *  默认 1 次 25 条，加载更多 +100 条去重）。 */
async function fetchDomainPOIs(options: FetchPOIOptions): Promise<POI[]> {
  const center = options.center ?? { lng: 120.15, lat: 30.27 };
  const zoom = options.zoom ?? 13;
  const existing = (options.existing ?? []) as DomainPOI[];
  const inHz = inHangzhouBox(center);

  if (options.query) {
    if (inHz) {
      // 杭州内关键词搜索 → 本地库 name ILIKE
      return fetchLocalPois(options, existing, zoom, options.query);
    }
    try {
      const result = await searchPOI({
        keyword: options.query,
        center,
        radius: searchRadiusMeters(zoom, center.lat),
        pageSize: 25,
        page: (options.pageOffset ?? 0) + 1,
        city: zoom <= 8 ? '全国' : '',
      });
      // Exact-name hits survive isCommonPoi: the user asked for that place by
      // name, so a sparse-but-matching card beats "searched but no card".
      const next = mergePoisById(
        existing,
        result.pois.filter((p) => isCommonOrExactName(p, options.query || '')),
        DOMAIN_POI_HARD_CAP,
      );
      options.onBatch?.(next);
      return next;
    } catch (err) {
      console.warn('[poi-service] domain keyword search failed:', err);
      options.onBatch?.(existing);
      return existing;
    }
  }

  if (inHz) {
    // 杭州内浏览 → 本地库(全量分层,列表候选 300→+300→1000)
    return fetchLocalPois(options, existing, zoom);
  }

  const category =
    typeof options.filters?.category === 'string' && options.filters.category
      ? options.filters.category
      : undefined;

  // 杭州外 → 高德省调用回退:默认 1 次(25 条),加载更多每轮 +4 次(≈100 条)
  try {
    const pois = await searchViewportPOIsFallback({
      center,
      zoom,
      bounds: options.bounds,
      existing,
      addCap: options.addCap,
      pageOffset: options.pageOffset,
      signal: options.signal,
      categories: category ? [category] : undefined,
      onBatch: (batch) => {
        if (options.signal?.cancelled) return;
        options.onBatch?.(batch);
      },
    });
    return pois;
  } catch (err) {
    console.warn('[poi-service] AMap fallback search failed:', err);
    options.onBatch?.(existing);
    return existing;
  }
}

/** 杭州本地查询：GET /api/pois/domain-local。offset=pageOffset*300，cap 1000。 */
async function fetchLocalPois(
  options: FetchPOIOptions,
  existing: DomainPOI[],
  zoom: number,
  q?: string,
): Promise<POI[]> {
  const bounds = options.bounds;
  const offset = (options.pageOffset ?? 0) * MORE_PAGE_SIZE;
  const params = new URLSearchParams();
  if (bounds) {
    params.set('bounds', `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`);
  }
  params.set('zoom', String(Math.max(1, Math.floor(zoom))));
  params.set('limit', String(MORE_PAGE_SIZE));
  params.set('offset', String(offset));
  if (q) params.set('q', q);
  const url = `/api/pois/domain-local?${params.toString()}`;

  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`domain-local ${res.status}`);
    const data = await res.json();
    const rows = (data.results ?? []) as DomainPOI[];
    const next = mergePoisById(existing, rows, DOMAIN_POI_HARD_CAP);
    options.onBatch?.(next);
    return next;
  } catch (err) {
    // 库未导入 / 网络错 → 回退高德 fallback（杭州内兜底），不白屏
    console.warn('[poi-service] local domain POIs failed, fallback to AMap:', err);
    try {
      const pois = await searchViewportPOIsFallback({
        center: options.center,
        zoom,
        bounds: options.bounds,
        existing,
        addCap: options.addCap,
        pageOffset: options.pageOffset,
        signal: options.signal,
        onBatch: (batch) => {
          if (options.signal?.cancelled) return;
          options.onBatch?.(batch);
        },
      });
      return pois;
    } catch (fallbackErr) {
      options.onBatch?.(existing);
      return existing;
    }
  }
}

let geocodePromise: Promise<RecruitmentPOI[]> | null = null;

function hasPlausibleCoord(poi: RecruitmentPOI): boolean {
  const { lng, lat } = poi.location;
  return Number.isFinite(lng) && Number.isFinite(lat) && !(lng === 0 && lat === 0);
}

/** 用 Geocoder 校正缺坐标或 (0,0) 的办公点；已有坐标不打高德。 */
export async function resolveInternshipLocations(
  seed: RecruitmentPOI[] = INTERNSHIP_SEED
): Promise<RecruitmentPOI[]> {
  const resolved = await Promise.all(
    seed.map(async (poi) => {
      if (hasPlausibleCoord(poi)) return poi;
      const address = poi.location.address;
      if (!address) return poi;
      try {
        const loc = await geocodeAddress(`${address} ${poi.name}`, '杭州');
        if (!loc) return poi;
        return {
          ...poi,
          location: {
            ...poi.location,
            lng: loc.lng,
            lat: loc.lat,
            address: poi.location.address,
          },
        };
      } catch {
        return poi;
      }
    })
  );
  return resolved;
}

async function workSeedFromAdapters(): Promise<RecruitmentPOI[]> {
  try {
    const fromApi = await fetchWorkCatalogFromApi();
    if (fromApi.length) return fromApi;
  } catch {
    // Relative /api/pois is browser-only; tests and SSR take the empty path.
  }
  // No scaffold fallback: example seed jobs are development scaffolding and must
  // not appear on the map (2026-08-17). Offline work mode shows an empty list.
  return [];
}

async function internshipSeedResolved(): Promise<RecruitmentPOI[]> {
  if (!geocodePromise) {
    geocodePromise = workSeedFromAdapters()
      .then((seed) => resolveInternshipLocations(seed))
      .catch((err) => {
        console.warn('[poi-service] geocode work seed failed:', err);
        geocodePromise = null;
        return [];
      });
  }
  return geocodePromise;
}

async function fetchWorkPOIs(options: FetchPOIOptions): Promise<POI[]> {
  const immediate = (await workSeedFromAdapters()) as POI[];
  options.onBatch?.(immediate);

  const seeded = (await internshipSeedResolved()) as POI[];
  options.onBatch?.(seeded);
  return seeded;
}
