// ============================================================
// POI 数据服务 — 按模式统一获取（插件化数据源）
//
// Domain：视口网格波次增量并入累计池，空结果不回退假数据。
// Internship / 工作：seed 岗位 + 地理编码校正坐标。
// 距离与列表裁剪由调用方用钉死的 origin 走 runPOIPipeline。
// ============================================================

import {
  geocodeAddress,
  searchPOI,
  searchViewportPOIsIncremental,
} from './amap-api.ts';
import { INTERNSHIP_SEED } from './seed-data.ts';
import { seedRecruitmentAdapter } from './recruitment-adapters/seed.ts';
import { collectRecruitmentPois } from './recruitment-source.ts';
import type { QueryPipeline } from './search.ts';
import { mergePoisById, isCommonPoi, POI_HARD_CAP, searchRadiusMeters, type ViewportBounds } from './viewport-search.ts';
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


/** Domain：往累计池里增量合并；找不到就不塞 seed */
async function fetchDomainPOIs(options: FetchPOIOptions): Promise<POI[]> {
  const center = options.center ?? { lng: 120.15, lat: 30.27 };
  const zoom = options.zoom ?? 13;
  const existing = (options.existing ?? []) as DomainPOI[];

  if (options.query) {
    try {
      const result = await searchPOI({
        keyword: options.query,
        center,
        radius: searchRadiusMeters(zoom, center.lat),
        pageSize: 25,
        page: (options.pageOffset ?? 0) + 1,
        city: zoom <= 8 ? '全国' : '',
      });
      const next = mergePoisById(existing, result.pois.filter((p) => isCommonPoi(p)), POI_HARD_CAP);
      options.onBatch?.(next);
      return next;
    } catch (err) {
      console.warn('[poi-service] domain keyword search failed:', err);
      options.onBatch?.(existing);
      return existing;
    }
  }

  const category =
    typeof options.filters?.category === 'string' && options.filters.category
      ? options.filters.category
      : undefined;

  try {
    const pois = await searchViewportPOIsIncremental({
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
    console.warn('[poi-service] AMap viewport search failed:', err);
    options.onBatch?.(existing);
    return existing;
  }
}

let geocodePromise: Promise<RecruitmentPOI[]> | null = null;

/** 用 Geocoder 校正 seed 里可能不准的大厂坐标 */
export async function resolveInternshipLocations(
  seed: RecruitmentPOI[] = INTERNSHIP_SEED
): Promise<RecruitmentPOI[]> {
  const resolved = await Promise.all(
    seed.map(async (poi) => {
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
  const fromAdapter = await collectRecruitmentPois([seedRecruitmentAdapter], 'seed');
  return fromAdapter.length ? fromAdapter : INTERNSHIP_SEED;
}

async function internshipSeedResolved(): Promise<RecruitmentPOI[]> {
  if (!geocodePromise) {
    geocodePromise = workSeedFromAdapters()
      .then((seed) => resolveInternshipLocations(seed))
      .catch((err) => {
        console.warn('[poi-service] geocode work seed failed:', err);
        geocodePromise = null;
        return INTERNSHIP_SEED;
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
