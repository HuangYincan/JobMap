// ============================================================
// 浏览器端 POI 会话缓存（sessionStorage，不进服务端）
//
// 按模式记住累计池 / 页偏移 / 搜索原点。切模式回来直接还原，
// 只有用户点刷新才清掉该模式缓存再打高德。
//
// 版本：数据修正（如 2026-08-17 坐标审计修正 11 个 pin）后 bump
// MODE_CACHE_VERSION，旧会话缓存自动失效并重新拉取。
// v4（2026-08-17 WS4）：work 累计池改为视口增量合并，岗位为在招过滤后的
// 子集——旧缓存含过期岗位，bump 使其失效重拉。
// v5（2026-08-17 WS5）：Domain 模式杭州内改走本地 /api/pois/domain-local，
// catalog 可能含 source:'api' 行——旧缓存含高德行，bump 使其失效重拉。
// v6（2026-08-18 poi-mixing 修复）：视口 onBatch 缺模式守卫时，模式切换的
// 在飞批次会把工作公司写进 domain 缓存——bump 使被污染的缓存失效重拉。
// v7（2026-08-19 分类门控）：domain 浏览改为「无分类不加载、选类按类全量」，
// 旧缓存是无分类的全量浏览目录——按新语义不应还原，bump 使其失效。
// v9（2026-08-19 坐标修正）：tencent-hangzhou 曾钉在滨江区网商路599号（网易
// 杭州地址，LLM 质检发现）；已改回西湖区文二西路712号西溪乐谷并清除坐标待重
// 解析——旧缓存含错误 pin，bump 使其失效。
// v10（2026-08-19 上海试点）：15 家试点 -shanghai 站点全部落真实上海办公点
// （geocode:apply AMap→Baidu 兜底 + 官方地址 override）+ 多城市站点坐标——
// 旧缓存全是 city-text 站点的离线快照，bump 使其失效重拉。
// v11（2026-08-19 数据源顺序修复）：import plan 真实 drops 优先于 seed 脚手架
// （deepseek tier 12→1、tencent 坐标 120.155→西溪乐谷）——旧缓存按 seed 元数据
// 渲染（高 zoom 才显示），bump 使其失效重拉。
// v12（2026-08-19 官方 ATS 直爬）：得物/智元机器人/禾赛科技 官方 drops 全量真实
// 岗位（portal-feishu-*，校招+社招 ~1900 条，radar 聚合行被抑制）——旧缓存含
// radar 聚合行与示例岗位，bump 使其失效重拉。
// v13（2026-08-19 沪杭落点）：24 家 feishu 租户 10533 真实岗位 + 21 个沪杭真实
// 办公点（ATS address_list 精确打点，regeo 验证）——旧缓存缺坐标行，bump 重拉。
// ============================================================

import type { FilterState, MapMode, POI, POILocation } from './types.ts';
import { canonicalMode } from './modes.ts';

export const MODE_CACHE_PREFIX = 'domain-map:mode-cache:v1:';
export const MODE_CACHE_VERSION = 13;

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

/**
 * 缓存 kind 守卫(2026-08-19):recruitment 模式缓存只接受 kind:'recruitment',
 * domain 只接受 kind:'domain'。work 缓存里混入 domain 行(高德 POI 污染)时
 * 整条作废,避免被污染缓存跨会话还原。
 */
function kindMatchesMode(mode: MapMode, poi: POI): boolean {
  const canonical = canonicalMode(mode);
  if (canonical === 'work') return poi.kind === 'recruitment';
  if (canonical === 'domain') return poi.kind === 'domain';
  return true;
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
    if (catalog.some((poi) => !kindMatchesMode(mode, poi))) return null;
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
