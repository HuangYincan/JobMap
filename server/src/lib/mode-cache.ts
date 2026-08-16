// ============================================================
// 浏览器端 POI 会话缓存（sessionStorage，不进服务端）
//
// 按模式记住累计池 / 页偏移 / 搜索原点。切模式回来直接还原，
// 只有用户点刷新才清掉该模式缓存再打高德。
//
// 版本：数据修正（如 2026-08-17 坐标审计修正 11 个 pin）后 bump
// MODE_CACHE_VERSION，旧会话缓存自动失效并重新拉取。
// ============================================================

import type { FilterState, MapMode, POI, POILocation } from './types.ts';
import { canonicalMode } from './modes.ts';

export const MODE_CACHE_PREFIX = 'domain-map:mode-cache:v1:';
export const MODE_CACHE_VERSION = 2;

export interface ModeCacheEntry {
  version: number;
  mode: MapMode;
  catalog: POI[];
  pageOffset: number;
  searchOrigin: POILocation | null;
  query: string;
  filters: FilterState;
  sort: string;
  savedAt: number;
}

export function modeCacheKey(mode: MapMode): string {
  return `${MODE_CACHE_PREFIX}${canonicalMode(mode)}`;
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

function isLocation(value: unknown): value is POILocation {
  if (!value || typeof value !== 'object') return false;
  const loc = value as POILocation;
  return typeof loc.lng === 'number' && typeof loc.lat === 'number';
}

function isPoi(value: unknown): value is POI {
  if (!value || typeof value !== 'object') return false;
  const poi = value as POI;
  return typeof poi.id === 'string' && typeof poi.name === 'string' && isLocation(poi.location);
}

export function readModeCache(mode: MapMode): ModeCacheEntry | null {
  if (!canUseStorage()) return null;
  try {
    let raw = window.sessionStorage.getItem(modeCacheKey(mode));
    // 旧会话把工作模式写在 internship 键上，读 work 时回退一次
    if (!raw && canonicalMode(mode) === 'work') {
      raw = window.sessionStorage.getItem(`${MODE_CACHE_PREFIX}internship`);
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ModeCacheEntry;
    if (parsed?.version !== MODE_CACHE_VERSION) return null;
    if (canonicalMode(parsed.mode) !== canonicalMode(mode) || !Array.isArray(parsed.catalog)) return null;
    const catalog = parsed.catalog.filter(isPoi);
    if (catalog.length === 0) return null;
    return {
      version: MODE_CACHE_VERSION,
      mode: canonicalMode(mode),
      catalog,
      pageOffset: typeof parsed.pageOffset === 'number' ? parsed.pageOffset : 0,
      searchOrigin: isLocation(parsed.searchOrigin) ? parsed.searchOrigin : null,
      query: typeof parsed.query === 'string' ? parsed.query : '',
      filters: parsed.filters && typeof parsed.filters === 'object' ? parsed.filters : {},
      sort: typeof parsed.sort === 'string' ? parsed.sort : '',
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export function writeModeCache(entry: Omit<ModeCacheEntry, 'version' | 'savedAt'>): void {
  if (!canUseStorage()) return;
  if (entry.catalog.length === 0) return;
  const payload: ModeCacheEntry = {
    ...entry,
    mode: canonicalMode(entry.mode),
    version: MODE_CACHE_VERSION,
    savedAt: Date.now(),
  };
  try {
    window.sessionStorage.setItem(modeCacheKey(entry.mode), JSON.stringify(payload));
    if (canonicalMode(entry.mode) === 'work') {
      window.sessionStorage.removeItem(`${MODE_CACHE_PREFIX}internship`);
    }
  } catch {
    // quota / private mode — 内存 catalog 仍在，忽略即可
  }
}

export function clearModeCache(mode: MapMode): void {
  if (!canUseStorage()) return;
  try {
    window.sessionStorage.removeItem(modeCacheKey(mode));
    if (canonicalMode(mode) === 'work') {
      window.sessionStorage.removeItem(`${MODE_CACHE_PREFIX}internship`);
    }
  } catch {
    // ignore
  }
}
