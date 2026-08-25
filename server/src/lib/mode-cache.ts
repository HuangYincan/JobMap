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
// v16（2026-08-22 geocode r4）：w9 城市中心重跑后 288 站落真实坐标（上海 376→347 等），
//   旧缓存含堆叠中心点，bump 使其失效重拉。
// v17（2026-08-22 geocode r5）：grader 放宽后再 16 站落真实坐标（腾讯北京总部大楼等）。
// 岗位（portal-feishu-*，校招+社招 ~1900 条，radar 聚合行被抑制）——旧缓存含
// radar 聚合行与示例岗位，bump 使其失效重拉。
// v13（2026-08-19 沪杭落点）：24 家 feishu 租户 10533 真实岗位 + 21 个沪杭真实
// 办公点（ATS address_list 精确打点，regeo 验证）——旧缓存缺坐标行，bump 重拉。
// v14（2026-08-20 全量加载修复）：work 改为首载全量取尽（672 公司 / ~1843 站点
// POI，无 bounds/maxTier），pageOffset 恒 0——旧缓存是视口部分池（跨会话还原
// 后 marker 不全且聚合计数漂移），bump 使其失效重拉一次全量。
// v18（2026-08-25 读路径语义两连修，fix/hide-center-pins + fix/server-catalog-semantics）：
//   ① 读路径排除城市中心钉（位置未知站点不再展示，work 目录条目 1046→617）；
//   ② work 裁剪未命中语义修正（DB 健康 + 裁剪/过滤后为空 = 空结果，不再回退
//   离线目录）——旧缓存（未过滤 1046 条目录 / 旧回退语义）与新语义不符，bump
//   使其失效重拉。
// v19（2026-08-26 r5 geocode 数据落地，commit 313fc61）：用户执行 r5 apply 后 135 站
//   占位/中心钉坐标落真实办公点（address/lng/lat 改写）——旧缓存含旧坐标，bump
//   使其失效重拉。
//
// 视野快照（v13 兼容字段，2026-08-19 ws1）：ModeCacheEntry.viewport 记录写入时的
// 地图视野（center+zoom+bounds），供刷新页面后的「挂载对齐加载」判断缓存目录是否
// 仍覆盖当前视野。旧缓存无此字段 → 调用方按「与当前视野不符」处理，触发一次对齐
// 加载后写入新快照。不 bump 版本：字段可选，旧缓存无需失效。
// ============================================================

import type { FilterState, MapMode, POI, POILocation } from './types.ts';
import { canonicalMode } from './modes.ts';
import type { ViewportBounds, ViewportSnapshot } from './viewport-search.ts';

export const MODE_CACHE_PREFIX = 'domain-map:mode-cache:v1:';
export const MODE_CACHE_VERSION = 19;
/** Local cache raw-value ceiling before JSON.parse (sessionStorage is local, not trusted). */
export const MODE_CACHE_RAW_MAX = 8 * 1024 * 1024;
/** Bound scalar/filter fields restored from storage; catalogs have their own app cap. */
export const MODE_QUERY_MAX = 200;
export const MODE_SORT_MAX = 100;
export const MODE_PAGE_OFFSET_MAX = 10_000;
export const FILTER_KEYS_MAX = 64;
export const FILTER_VALUES_MAX = 100;
export const FILTER_VALUE_MAX = 200;

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
  /** 写入时的地图视野快照(ws1 Bug1 挂载对齐加载);旧缓存无此字段 → 按不符处理 */
  viewport?: ViewportSnapshot;
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
  return (
    Number.isFinite(loc.lng) && Math.abs(loc.lng) <= 180 &&
    Number.isFinite(loc.lat) && Math.abs(loc.lat) <= 90
  );
}

function isPoi(value: unknown): value is POI {
  if (!value || typeof value !== 'object') return false;
  const poi = value as POI;
  return typeof poi.id === 'string' && typeof poi.name === 'string' && isLocation(poi.location);
}

function isBox(value: unknown): value is ViewportBounds {
  if (!value || typeof value !== 'object') return false;
  const b = value as Partial<ViewportBounds>;
  return (
    typeof b.west === 'number' && Number.isFinite(b.west) &&
    typeof b.south === 'number' && Number.isFinite(b.south) &&
    typeof b.east === 'number' && Number.isFinite(b.east) &&
    typeof b.north === 'number' && Number.isFinite(b.north) &&
    b.west < b.east &&
    b.south < b.north
  );
}

function isFilterValue(value: unknown): boolean {
  if (typeof value === 'string') return value.length <= FILTER_VALUE_MAX;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    if (value.length > FILTER_VALUES_MAX) return false;
    return value.every((item) =>
      (typeof item === 'string' && item.length <= FILTER_VALUE_MAX) || Number.isFinite(item)
    );
  }
  return false;
}

function parseFilters(raw: unknown): FilterState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const filters: FilterState = {};
  for (const [key, value] of Object.entries(raw).slice(0, FILTER_KEYS_MAX)) {
    if (key.length <= FILTER_VALUE_MAX && isFilterValue(value)) filters[key] = value as FilterState[string];
  }
  return filters;
}

function parsePageOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return 0;
  return Math.min(value, MODE_PAGE_OFFSET_MAX);
}

function boundedText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/**
 * 解析旧缓存里的视野快照(ws1 Bug1):center+zoom 非法或缺失 → undefined,
 * 调用方按「与当前视野不符」处理触发一次对齐加载。
 */
function parseCachedViewport(raw: unknown): ViewportSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const vp = raw as Partial<ViewportSnapshot>;
    if (!isLocation(vp.center) || typeof vp.zoom !== 'number' || !Number.isFinite(vp.zoom)) return undefined;
  return {
    center: vp.center,
    zoom: vp.zoom,
    ...(isBox(vp.bounds) ? { bounds: vp.bounds } : {}),
  };
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
    if (!raw || raw.length > MODE_CACHE_RAW_MAX) return null;
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
      pageOffset: parsePageOffset(parsed.pageOffset),
      searchOrigin: isLocation(parsed.searchOrigin) ? parsed.searchOrigin : null,
      query: boundedText(parsed.query, MODE_QUERY_MAX),
      filters: parseFilters(parsed.filters),
      sort: boundedText(parsed.sort, MODE_SORT_MAX),
      savedAt: typeof parsed.savedAt === 'number' && Number.isFinite(parsed.savedAt) ? parsed.savedAt : 0,
      viewport: parseCachedViewport(parsed.viewport),
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

/**
 * 以「当前最新 filters + 当前池」同步重写会话缓存(2026-08-22 ws1 独角兽残留修复)。
 *
 * 背景:主加载只在 load() 内写缓存,而其 effect 依赖刻意不含 filters(非 category
 * 筛选变更不重搜,minRating/price 纯客户端过滤)——某次 load 时 filters 含 unicorn
 * (如点 #独角兽 建议)连目录写进缓存后,用户面板取消勾选 → setFilters 无重载 →
 * 缓存仍残留 scale:['unicorn'],F5/重开经 useModeCacheRestore 全量还原即「莫名复活」。
 *
 * 本函数在每次 filters 变更时以「写缓存时刻的最新 filters + 当前池」重写,
 * 保证缓存快照恒与面板状态一致。viewport 为 null(地图未就绪)时跳过:
 * 写成 undefined 会破坏挂载对齐判定(旧缓存无快照一律按「与当前视野不符」处理,
 * 触发一次多余对齐加载)。
 */
export function syncModeCache(input: {
  mode: MapMode;
  catalog: POI[];
  pageOffset: number;
  searchOrigin: POILocation | null;
  query: string;
  filters: FilterState;
  sort: string;
  viewport: ViewportSnapshot | null;
}): void {
  if (!input.viewport) return;
  writeModeCache({ ...input, viewport: input.viewport });
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
