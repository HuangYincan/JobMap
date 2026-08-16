// ============================================================
// 收藏点地图叠加层（纯函数）
//
// 搜索列表仍只走 catalog 管线。叠加层只给地图：有坐标的收藏
// 转成可打点的 POI；catalog 命中用活数据（logo），否则用快照图钉。
// ============================================================

import type { SavedPlace } from './account.ts';
import { resolveSavedPoi } from './compare-saved.ts';
import type { DomainPOI, POI } from './types.ts';

export function savedPlaceToOverlayPoi(place: SavedPlace, catalog: POI[]): POI | undefined {
  const live = resolveSavedPoi(place, catalog);
  if (live) return live;
  if (typeof place.lng !== 'number' || typeof place.lat !== 'number') return undefined;
  const fallback: DomainPOI = {
    id: place.poiId,
    kind: 'domain',
    name: place.name,
    mode: place.mode === 'work' || place.mode === 'internship' ? 'work' : 'domain',
    source: 'api',
    location: { lng: place.lng, lat: place.lat, address: place.address },
    category: place.kind === 'recruitment' ? '公司企业' : '收藏',
  };
  return fallback;
}

export function savedPlacesToOverlay(places: SavedPlace[], catalog: POI[]): POI[] {
  const seen = new Set<string>();
  const out: POI[] = [];
  for (const place of places) {
    if (seen.has(place.poiId)) continue;
    const poi = savedPlaceToOverlayPoi(place, catalog);
    if (!poi) continue;
    seen.add(place.poiId);
    out.push(poi);
  }
  return out;
}

/** 搜索结果优先，再补上叠加层里还没出现的收藏点。 */
export function mergeMapPois(results: POI[], overlay: POI[], enabled: boolean): POI[] {
  if (!enabled || overlay.length === 0) return results;
  const byId = new Map<string, POI>();
  for (const poi of results) byId.set(poi.id, poi);
  for (const poi of overlay) {
    if (!byId.has(poi.id)) byId.set(poi.id, poi);
  }
  return Array.from(byId.values());
}

export const SAVED_OVERLAY_KEY = 'domain-map:saved-overlay';

export function readSavedOverlayPref(fallback = true): boolean {
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') return fallback;
  try {
    const raw = window.sessionStorage.getItem(SAVED_OVERLAY_KEY);
    if (raw === '0') return false;
    if (raw === '1') return true;
    return fallback;
  } catch {
    return fallback;
  }
}

export function writeSavedOverlayPref(on: boolean): void {
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') return;
  try {
    window.sessionStorage.setItem(SAVED_OVERLAY_KEY, on ? '1' : '0');
  } catch {
    // quota / private mode
  }
}

export function overlayBounds(pois: POI[]): { sw: { lng: number; lat: number }; ne: { lng: number; lat: number } } | null {
  if (pois.length === 0) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const poi of pois) {
    minLng = Math.min(minLng, poi.location.lng);
    minLat = Math.min(minLat, poi.location.lat);
    maxLng = Math.max(maxLng, poi.location.lng);
    maxLat = Math.max(maxLat, poi.location.lat);
  }
  if (!Number.isFinite(minLng)) return null;
  return { sw: { lng: minLng, lat: minLat }, ne: { lng: maxLng, lat: maxLat } };
}
