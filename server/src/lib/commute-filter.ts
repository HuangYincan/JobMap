// 客户端通勤粗筛:用 commute.ts 直线估算,不对每个 POI 发 plan 请求。
// 未知 filter key 不写入 /api/pois;本模块状态与 FilterState 分离。

import { estimateMinutes, type CommuteMode } from './commute.ts';
import { haversineDistance, type POI } from './types.ts';

export const COMMUTE_SLIDER_MIN = 15;
export const COMMUTE_SLIDER_MAX = 120;
export const COMMUTE_SLIDER_DEFAULT = 45;
export const COMMUTE_COMPARE_MIN = 2;
export const COMMUTE_COMPARE_MAX = 5;

export type CommuteBucket = 'strict' | 'near';

export interface CommuteHit {
  poi: POI;
  meters: number;
  minutes: number;
  bucket: CommuteBucket;
}

export interface CommuteFilterResult {
  strict: CommuteHit[];
  near: CommuteHit[];
  closest: CommuteHit | null;
}

export function clampCommuteMinutes(value: number): number {
  if (!Number.isFinite(value)) return COMMUTE_SLIDER_DEFAULT;
  return Math.min(COMMUTE_SLIDER_MAX, Math.max(COMMUTE_SLIDER_MIN, Math.round(value)));
}

export function poiCommuteHit(
  poi: POI,
  origin: { lng: number; lat: number },
  mode: CommuteMode,
  maxMinutes: number,
): CommuteHit | null {
  const loc = poi.location;
  if (!loc || !Number.isFinite(loc.lng) || !Number.isFinite(loc.lat)) return null;
  const meters = haversineDistance(origin, loc);
  const minutes = estimateMinutes(meters, mode);
  const cap = clampCommuteMinutes(maxMinutes);
  return {
    poi,
    meters,
    minutes,
    bucket: minutes <= cap ? 'strict' : 'near',
  };
}

/**
 * 粗筛当前列表。strict = 不超过上限;near = 超过上限(按分钟升序)。
 * 严格 0 命中时 strict 为空,closest 仍给出最近一条,不得把超限画成命中。
 */
export function filterByCommuteEstimate(
  pois: POI[],
  origin: { lng: number; lat: number } | null,
  mode: CommuteMode,
  maxMinutes: number,
): CommuteFilterResult {
  if (!origin || !Array.isArray(pois) || pois.length === 0) {
    return { strict: [], near: [], closest: null };
  }
  const hits: CommuteHit[] = [];
  for (const poi of pois) {
    const hit = poiCommuteHit(poi, origin, mode, maxMinutes);
    if (hit) hits.push(hit);
  }
  hits.sort((a, b) => a.minutes - b.minutes || a.meters - b.meters);
  const strict = hits.filter((h) => h.bucket === 'strict');
  const near = hits.filter((h) => h.bucket === 'near');
  return {
    strict,
    near,
    closest: hits[0] ?? null,
  };
}

export function listedCommuteHits(
  result: CommuteFilterResult,
  tab: CommuteBucket,
): CommuteHit[] {
  return tab === 'strict' ? result.strict : result.near;
}

export function toggleCommuteCompare(
  current: string[],
  poiId: string,
  max = COMMUTE_COMPARE_MAX,
): string[] {
  if (!poiId) return current.slice();
  const next = current.filter((id) => id !== poiId);
  if (next.length !== current.length) return next;
  const added = [...current, poiId];
  return added.length > max ? added.slice(added.length - max) : added;
}

export function estimatePath(
  origin: { lng: number; lat: number },
  destination: { lng: number; lat: number },
): Array<{ lng: number; lat: number }> {
  return [
    { lng: origin.lng, lat: origin.lat },
    { lng: destination.lng, lat: destination.lat },
  ];
}
