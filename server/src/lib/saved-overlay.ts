// ============================================================
// 收藏图层（纯函数,2026-08-22 互斥语义修订）
//
// 互斥语义（用户决策）:开 = 地图只显示收藏点 pin + Explore 列表切为
// 收藏列表;关 = 恢复搜索管线。搜索列表不再与叠加层「并集显示」。
//
// 池/可见性分工:
// - mergeMapPois 只负责 marker「池」——catalog 结果全量保留(空批次不
//   置空、池只增不删,关时秒恢复),enabled 时把 catalog 未命中的收藏点
//   快照补进池(实例保留);关时池回到 catalog 本体;
// - 互斥的「只显示收藏点」在可见性层落地:mutexVisibleIds 在开时返回
//   只含收藏点 id 的可见集(普通 POI 全部排除,marker 实例不销毁),
//   关时返回 null 走正常 LOD/聚合可见性。
// ============================================================

import type { SavedPlace } from './account.ts';
import { resolveSavedPoi } from './compare-saved.ts';
import type { DomainPOI, MapMode, POI, RecruitmentPOI } from './types.ts';
import { canonicalMode } from './modes.ts';

export function savedPlaceToOverlayPoi(place: SavedPlace, catalog: POI[]): POI | undefined {
  const live = resolveSavedPoi(place, catalog);
  if (live) return live;
  if (typeof place.lng !== 'number' || typeof place.lat !== 'number') return undefined;
  if (place.kind === 'recruitment') {
    // 工作收藏兜底必须是 recruitment 形态，否则无岗位图钉会以 domain 样式
    // 混进工作地图(点击打开无 JD 的域详情卡)。岗位列表留空,靠 live catalog 补。
    const fallback: RecruitmentPOI = {
      id: place.poiId,
      kind: 'recruitment',
      name: place.name,
      mode: canonicalMode(place.mode),
      source: 'api',
      location: { lng: place.lng, lat: place.lat, address: place.address },
      company: { name: place.name, industries: [], scale: 'startup' },
      positions: [],
    };
    return fallback;
  }
  const fallback: DomainPOI = {
    id: place.poiId,
    kind: 'domain',
    name: place.name,
    mode: place.mode === 'work' || place.mode === 'internship' ? 'work' : 'domain',
    source: 'api',
    location: { lng: place.lng, lat: place.lat, address: place.address },
    category: '收藏',
  };
  return fallback;
}

/**
 * 收藏叠加层按当前模式过滤(2026-08-19, 工作/地点收藏区分):
 * - work(含 internship)只显示 place.mode ∈ {work, internship} 的工作收藏;
 * - domain 只显示 place.mode === 'domain' 的地点收藏;
 * - mode 缺省时不过滤(向后兼容,测试/旧调用语义)。
 */
export function savedPlacesToOverlay(places: SavedPlace[], catalog: POI[], mode?: MapMode): POI[] {
  const target = mode ? canonicalMode(mode) : null;
  const seen = new Set<string>();
  const out: POI[] = [];
  for (const place of places) {
    if (target === 'work' && canonicalMode(place.mode) !== 'work') continue;
    if (target === 'domain' && canonicalMode(place.mode) !== 'domain') continue;
    if (seen.has(place.poiId)) continue;
    const poi = savedPlaceToOverlayPoi(place, catalog);
    if (!poi) continue;
    seen.add(place.poiId);
    out.push(poi);
  }
  return out;
}

/**
 * marker 池构建（互斥语义,2026-08-22）:池永远保留 catalog 结果全量
 * （marker 实例只增不删,关时秒恢复、不触发重查）;enabled 时把 catalog
 * 未命中的收藏点快照补进池,关时池回到 catalog 本体。
 * 「开 = 只显示收藏点」由调用方用 mutexVisibleIds 在可见性层落地,本函数
 * 不做并集显示。
 */
export function mergeMapPois(results: POI[], overlay: POI[], enabled: boolean): POI[] {
  if (!enabled || overlay.length === 0) return results;
  const byId = new Map<string, POI>();
  for (const poi of results) byId.set(poi.id, poi);
  for (const poi of overlay) {
    if (!byId.has(poi.id)) byId.set(poi.id, poi);
  }
  return Array.from(byId.values());
}

/**
 * 互斥可见性（2026-08-22 用户决策）:开 = 地图只显示收藏点 pin。
 * enabled 时返回「当前该显示谁的 id」——只保留 overlay id,普通 POI 全部
 * 排除(按 id 排除而非清空池:marker 实例保留,关时恢复显示零重查);
 * disabled 返回 null = 调用方走正常 LOD/聚合可见性。
 */
export function mutexVisibleIds(pool: POI[], overlayIds: Set<string>, enabled: boolean): string[] | null {
  if (!enabled) return null;
  return pool.filter((p) => overlayIds.has(p.id)).map((p) => p.id);
}

export const SAVED_OVERLAY_KEY = 'domain-map:saved-overlay';
export const MAP_STYLE_KEY = 'domain-map:map-style';

export type BasemapStyle = 'normal' | 'satellite' | 'whitesmoke';

export function parseMapStyle(raw: string | null | undefined): BasemapStyle | null {
  if (raw === 'normal' || raw === 'satellite' || raw === 'whitesmoke') return raw;
  return null;
}

export function readMapStylePref(fallback: BasemapStyle = 'normal'): BasemapStyle {
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') return fallback;
  try {
    return parseMapStyle(window.sessionStorage.getItem(MAP_STYLE_KEY)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeMapStylePref(style: BasemapStyle): void {
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') return;
  try {
    window.sessionStorage.setItem(MAP_STYLE_KEY, style);
  } catch {
    // quota / private mode
  }
}

export function amapStyleUrl(style: Exclude<BasemapStyle, 'satellite'>): string {
  return style === 'whitesmoke' ? 'amap://styles/whitesmoke' : 'amap://styles/normal';
}

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

/** 收藏行点中：catalog / seed 活数据优先，再叠加层图钉。 */
export function resolveSavedForFly(place: { poiId: string; lng?: number; lat?: number }, live: POI[]): POI | undefined {
  return live.find((poi) => poi.id === place.poiId);
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
