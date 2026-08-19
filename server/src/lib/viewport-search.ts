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

/** Inclusive bbox. Invalid / inverted boxes match nothing. */
export function inBounds(
  loc: { lng: number; lat: number } | undefined,
  bounds: ViewportBounds | [number, number, number, number] | null | undefined,
): boolean {
  if (!loc || !bounds) return false;
  const box = Array.isArray(bounds)
    ? { west: bounds[0], south: bounds[1], east: bounds[2], north: bounds[3] }
    : bounds;
  if (box.west >= box.east || box.south >= box.north) return false;
  return loc.lng >= box.west && loc.lng <= box.east && loc.lat >= box.south && loc.lat <= box.north;
}

export function parseBoundsParam(raw: string | null | undefined): ViewportBounds | null {
  if (!raw) return null;
  // 空段(如 "118.3,29.1,,30.7")会经 Number('')→0 溜过 NaN 检查,
  // 生成 east=0 的非法 bbox 让 ST_MakeEnvelope 抛错。先拒空段再转数值。
  const segs = raw.split(',');
  if (segs.length !== 4 || segs.some((s) => s.trim() === '')) return null;
  const parts = segs.map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  const [west, south, east, north] = parts;
  if (west >= east || south >= north) return null;
  return { west, south, east, north };
}

export function boundsCenter(bounds: ViewportBounds): LngLat {
  return { lng: (bounds.west + bounds.east) / 2, lat: (bounds.south + bounds.north) / 2 };
}

/** 默认展示上限；「需要更多」可突破 */
export const POI_SOFT_CAP = 300;
/** 每次「需要更多」再扩这么多 */
export const MORE_PAGE_SIZE = 300;
/** 浏览器累计硬顶，防止无限堆 */
export const POI_HARD_CAP = 3000;
/** 兼容旧名：一轮网格搜索的目标增量 */
export const REFRESH_ADD_CAP = POI_SOFT_CAP;

/**
 * Domain 模式列表候选上限(tech/22):杭州内无限滚动每次 +50,直到 1000 封顶。
 * 与 POI_HARD_CAP(work 模式 3000)分离——测试硬编码
 * POI_SOFT_CAP/MORE_PAGE_SIZE/POI_HARD_CAP,这里只影响 domain 路径。
 */
export const DOMAIN_POI_HARD_CAP = 1000;
/**
 * Domain 模式本地库每批加载条数(tech/22):杭州内无限滚动每次 +50;
 * 杭州外回退高德每次 25 条(1 次 PlaceSearch)。与 MORE_PAGE_SIZE(work 300)
 * 分离——测试硬编码 MORE_PAGE_SIZE=300,这里只影响 domain 路径。
 */
export const DOMAIN_BATCH_SIZE = 50;
/**
 * 分类全量加载(poi-category-loading):domain-local 单页上限。
 * API limit 最大 300(hz-poi-store 钳制),分类全量用满页减少请求数
 * (1000 条最多 4 次请求:offset 0/300/600/900)。
 */
export const DOMAIN_POI_FULL_PAGE_SIZE = 300;
/** 分类全量加载:domain-local offset 上限(API 约束,offset > 1000 报错前钳制)。 */
export const DOMAIN_POI_OFFSET_CAP = 1000;
/** 杭州外回退高德:每次滚动仅 1 次 PlaceSearch(25 条) */
export const AMAP_FALLBACK_INITIAL_CALLS = 1;
/** 杭州 GCJ-02 数据范围框(含桐庐/建德/淳安等远郊),见 hz-poi-import.ts */
export const HANGZHOU_BBOX = { west: 118.3, south: 29.1, east: 120.8, north: 30.7 };

/** 杭州判定:中心点是否落在杭州数据范围框内 */
export function inHangzhouBox(loc: { lng: number; lat: number }): boolean {
  const { west, south, east, north } = HANGZHOU_BBOX;
  return loc.lng >= west && loc.lng <= east && loc.lat >= south && loc.lat <= north;
}

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

// ============================================================
// 工作模式视口按需加载(WS4,tech/18 §2.3)
//
// moveend/zoomend → 防抖 → GET /api/pois(当前 bounds + maxTier)
// → 增量合并进现有 catalog(不清空已有 marker)→ 更新 marker。
// 性能:同刻只有一个 in-flight;防抖窗口内事件合并为一次请求;
// 请求期间的新事件只保留「最新一次」,完成后立即补跑。
// Domain 模式保持刷新才更新,不走这里。
// ============================================================

import { haversineDistance, type FilterState, type MapMode, type POI, type RecruitmentPOI } from './types.ts';
import { withAlivePositions } from './position-alive.ts';

/**
 * 批次模式守卫(2026-08-18, poi-mixing 修复):
 * 视口/主加载的 onBatch 在写入 catalog 前必须确认模式未切换。
 * 否则旧模式在飞的批次(工作公司 / 地图 POI)会在切换后落进新模式,
 * 表现为「公司 POI 混入地图 POI」——marker 与列表双双被污染,
 * 且 handleModeChange 会把被污染的 catalog 写进新模式缓存,跨会话粘住。
 * 口径与 modes.canonicalMode 一致(internship → work);本地实现避免
 * modes → spatial-filters → viewport-search 的循环导入。
 */
function canonicalForGuard(mode: MapMode | null | undefined): MapMode | null {
  return mode === 'internship' ? 'work' : (mode ?? null);
}

export function batchMatchesCurrentMode(
  currentMode: MapMode | null | undefined,
  batchMode: MapMode,
): boolean {
  return canonicalForGuard(currentMode) === canonicalForGuard(batchMode);
}

/** moveend/zoomend 防抖时长 */
export const VIEWPORT_DEBOUNCE_MS = 800;
/** 视口请求每页大小(服务端 pageSize 上限) */
export const WORK_VIEWPORT_PAGE_SIZE = 50;

export interface WorkViewportQuery {
  /** 当前视野;缺省时不带 bounds 参数(服务端返回整库首页,仅首屏兜底) */
  bounds?: ViewportBounds;
  /** 缩放级别 → 档位上限(见 lod.ts;服务端忽略前按现有数据工作) */
  maxTier?: number;
  /** 用户筛选(industry/scale/onlyOpen…;maxTier 由本模块并入) */
  filters?: FilterState;
  q?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
  /**
   * 从 page 起连取几页。首屏/刷新取前几页填满视野(默认 4 页=200),
   * 视口增量加载只取 1 页(默认)。
   */
  maxPages?: number;
}

export interface LoadWorkViewportOptions extends WorkViewportQuery {
  /** 已累计的 POI,本轮往里增量合并(不清空) */
  existing: POI[];
  /**
   * 累计池硬顶(wsv):work 视口去上限传 Infinity/大值(视野内取尽);
   * 缺省 POI_HARD_CAP(3000,主加载/加载更多默认)。
   */
  cap?: number;
  signal?: { cancelled: boolean };
  /** 每页合并后回调(完整累计池,可多次) */
  onBatch?: (pois: POI[]) => void;
  /** 注入 fetcher(测试用);缺省用全局 fetch */
  fetcher?: typeof fetch;
}

/** 首屏/刷新最多连取几页,避免全库翻页轰服务端 */
export const WORK_INITIAL_MAX_PAGES = 4;

// ============================================================
// 挂载对齐加载(ws1 Bug1 视口)
//
// mode 级会话缓存还原的是「上次会话视野」的目录(可能是别的城市)。刷新页面后
// 地图初始化固定在杭州 zoom 13,geolocation 被拒时不产生任何 moveend——若缓存
// 视野快照与当前地图视野显著不符,调用方(组件契约)应主动调度一次当前视野的
// 视口加载,不再等用户手动拖动。旧缓存没有快照字段 → 一律按「不符」处理。
// ============================================================

/** 缓存视野快照与当前视野「显著不符」的中心距离阈值(km) */
export const VIEWPORT_ALIGN_CENTER_KM = 25;
/** 缓存视野快照与当前视野「显著不符」的 zoom 差阈值 */
export const VIEWPORT_ALIGN_ZOOM_DELTA = 2;

/** 缓存写入时的地图视野快照(center+zoom,bounds 可选;与 ModeCacheEntry.viewport 对应) */
export interface ViewportSnapshot {
  center: LngLat;
  zoom: number;
  bounds?: ViewportBounds | null;
}

/**
 * 缓存视野快照与当前地图视野是否「显著不符」:
 * - 无快照(旧缓存 / 字段非法)→ 视为不符,触发一次对齐加载;
 * - 中心距离 > centerKm 或 zoom 差 > zoomDelta → 不符。
 */
export function needsViewportAlign(
  snapshot: ViewportSnapshot | null | undefined,
  liveCenter: LngLat,
  liveZoom: number,
  centerKm = VIEWPORT_ALIGN_CENTER_KM,
  zoomDelta = VIEWPORT_ALIGN_ZOOM_DELTA,
): boolean {
  if (!snapshot || !snapshot.center || !Number.isFinite(snapshot.zoom)) return true;
  if (haversineDistance(snapshot.center, liveCenter) / 1000 > centerKm) return true;
  if (Math.abs(snapshot.zoom - liveZoom) > zoomDelta) return true;
  return false;
}

function isRecruitmentPoi(value: unknown): value is RecruitmentPOI {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<RecruitmentPOI>;
  return (
    row.kind === 'recruitment' &&
    typeof row.id === 'string' &&
    !!row.company &&
    Array.isArray(row.positions)
  );
}

function boundsParam(bounds: ViewportBounds): string {
  return [bounds.west, bounds.south, bounds.east, bounds.north].join(',');
}

export interface WorkViewportPage {
  /** alive 过滤后的本页 POI(未合并) */
  pois: POI[];
  /** 服务端 total(整查询命中数;缺省 -1 → 调用方用短页/本地长度判定) */
  total: number;
}

/**
 * 按当前视口拉取一页工作 catalog:GET /api/pois?mode=work&bounds=…&filters={…,maxTier}&page=…
 * 返回 alive 过滤后的本页 POI(未合并;调用方用 mergePoisById 并入累计池)。
 * fetcher 可注入,便于测试。
 * 失败(!ok)一律抛错——「错误 ≠ 没有更多」,调用方据此可重试,
 * 而不是把失败当短页置 noMore 永久停哨兵(poi-loading A/D)。
 */
export async function fetchWorkViewportPage(
  query: WorkViewportQuery,
  fetcher: typeof fetch = fetch
): Promise<WorkViewportPage> {
  const params = new URLSearchParams();
  params.set('mode', 'work');
  if (query.bounds) params.set('bounds', boundsParam(query.bounds));
  params.set('page', String(query.page ?? 1));
  params.set('pageSize', String(query.pageSize ?? WORK_VIEWPORT_PAGE_SIZE));
  if (query.q) params.set('q', query.q);
  if (query.sort) params.set('sort', query.sort);
  const filters = query.maxTier
    ? { ...query.filters, maxTier: query.maxTier }
    : { ...(query.filters ?? {}) };
  if (Object.keys(filters).length > 0) params.set('filters', JSON.stringify(filters));
  const url = `/api/pois?${params.toString()}`;
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`/api/pois failed: ${res.status}`);
  const payload = (await res.json()) as { results?: unknown[]; total?: unknown };
  const alive: POI[] = [];
  for (const row of payload.results ?? []) {
    if (!isRecruitmentPoi(row)) continue;
    const kept = withAlivePositions(row);
    if (kept) alive.push(kept);
  }
  return {
    pois: alive,
    total: typeof payload.total === 'number' ? payload.total : -1,
  };
}

export interface LoadWorkViewportResult {
  /** 合并后的累计池 */
  pois: POI[];
  /** 数据源是否到底(本页不满页即停):true = 已加载全部 */
  noMore: boolean;
  /**
   * 本次请求是否取回 0 条(首取页即空,未并入任何新行)。空批次≠到底
   * (noMore 仍为 false)——滤波/层级 maxTier 裁剪可致整页为空,不代表
   * 数据源已取尽。仅供调用方做空批次三态(真空清空 vs 保留旧目录,ws1 Bug1)。
   */
  vacant: boolean;
}

/**
 * 旧目录是否仍有 POI 落在给定视野 bounds 内(ws1 Bug1 空批次三态):
 * 请求成功但 0 条时——true → 保留旧目录(收藏 fitToPins 退化视野/部分覆盖,
 * 清空会闪没,由 VIEWPORT_SUPPRESS_MS 兜底);false → 视为真空,可清空走空态。
 */
export function catalogCoversView(
  catalog: readonly POI[],
  bounds: ViewportBounds | null | undefined,
): boolean {
  return catalog.some((poi) => inBounds(poi.location, bounds));
}

/**
 * 工作模式视口加载:从 page 起连取 maxPages 页(默认 1 页) → 每页 alive 过滤
 * → 按 poi.id 增量合并进现有池(不清空已有 marker;重复 id 跳过;
 * POI_HARD_CAP 防无限堆)。每页合并后回调 onBatch(完整累计池)。
 * 页数取完或某页不满页即停。
 *
 * 返回值 { pois, noMore, vacant }:noMore 表示数据源到底(短页 break / total
 * 取尽),供调用方停止哨兵并显示「没有更多结果」;空页不置 noMore(空批次≠
 * 到底,ws1 Bug1),vacant 标记「整个请求 0 条」供空批次三态判定。
 * 取消时不置位 noMore(状态未知)。
 */
export async function loadWorkViewport(
  options: LoadWorkViewportOptions,
): Promise<LoadWorkViewportResult> {
  const { existing, onBatch, signal } = options;
  const startPage = options.page ?? 1;
  const maxPages = options.maxPages ?? 1;
  const pageSize = options.pageSize ?? WORK_VIEWPORT_PAGE_SIZE;
  const cap = options.cap ?? POI_HARD_CAP;
  // 客户端 kind 守卫(2026-08-19):work 累计池只允许 recruitment 行。
  // 服务端已过滤,这里兜底清掉被污染缓存/历史残留的 domain 行,
  // 避免「高德 POI 混进工作列表」跨会话粘住。
  let merged: POI[] = existing.filter(isRecruitmentPoi);
  let noMore = false;
  let vacant = false;
  for (let p = 0; p < maxPages; p += 1) {
    if (signal?.cancelled) return { pois: merged, noMore: false, vacant };
    const page = await fetchWorkViewportPage(
      { ...options, page: startPage + p },
      options.fetcher,
    );
    if (signal?.cancelled) return { pois: merged, noMore: false, vacant };
    const offset = (startPage + p - 1) * pageSize;
    merged = mergePoisById(merged, page.pois, cap);
    onBatch?.(merged);
    // 空批次(0 条)≠ 到底(ws1 Bug1 视口):滤波/层级 maxTier 裁剪可致整页为空,
    // 不代表数据源已取尽——不闩锁 noMore,保留无限滚动重试与下一次视口刷新的
    // 恢复能力,避免「整城无 POI」时粘滞「没有更多结果」(恢复只能等 moveend)。
    if (page.pois.length === 0) {
      // 真空标记仅对「整个请求 0 条」(首取页即空)成立;若前面页已并入行,
      // 只是本轮追加无新增(加载更多越过上限),不算真空。
      vacant = p === 0;
      noMore = false;
      break;
    }
    // 本页不满页 → 没有更多数据,提前停(避免白打请求);同时上报 noMore
    if (page.pois.length < pageSize) {
      noMore = true;
      break;
    }
    // 服务端 total 判定:已取到 total 之后 → 数据到底(poi-loading D)。
    // 「过滤导致可见列表不变」不再误判;无 total(-1)时保持短页判定。
    if (page.total >= 0 && offset + page.pois.length >= page.total) {
      noMore = true;
      break;
    }
  }
  return { pois: merged, noMore, vacant };
}

export interface ViewportLoader {
  /** 视口事件入口:重置防抖计时器;in-flight 期间只记「最新一次」 */
  schedule(): void;
  /** 取消计时器与 pending,不再触发任何加载 */
  dispose(): void;
  /** 还有待触发的防抖 / pending / in-flight 吗(测试用) */
  pending(): boolean;
}

export interface ViewportLoaderOptions {
  delayMs: number;
  load: () => Promise<void> | void;
}

/**
 * 防抖 + 请求合并加载器(纯逻辑,不依赖 AMap/React):
 * - schedule():每次事件重置防抖计时器,窗口内只发一次请求;
 * - 请求进行中收到的新事件只替换 pending;当前请求完成后立即补跑
 *   「最新一次」(中间态丢弃,不会堆积);
 * - dispose():清空计时器与 pending,不再触发。
 */
export function createViewportLoader(options: ViewportLoaderOptions): ViewportLoader {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let pending = false;
  let disposed = false;

  const runPending = () => {
    if (disposed || inFlight || !pending) return;
    pending = false;
    inFlight = true;
    Promise.resolve()
      .then(() => options.load())
      .catch(() => {
        // load 的错误由调用方自己处理;这里兜底避免 inFlight 卡死
      })
      .finally(() => {
        inFlight = false;
        if (pending) runPending();
      });
  };

  return {
    schedule() {
      if (disposed) return;
      pending = true;
      if (inFlight) return; // 当前请求完成后自动补跑最新一次
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        runPending();
      }, options.delayMs);
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = false;
    },
    pending() {
      return timer !== null || pending || inFlight;
    },
  };
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

/**
 * 杭州外回退高德的预算窗口(tech/22):无限滚动每次只发 1 次 PlaceSearch(25 条)。
 * 按 buildSearchQueue 的展开顺序消费:pageOffset=0 → 第 1 个任务,
 * pageOffset=N → 第 N+1 个任务。预算耗尽(窗口空)→ 返回 [] 表示无更多。
 */
export function fallbackTaskWindow(
  keywords: readonly string[],
  pages = 4,
  pageOffset = 0,
): SearchTask[] {
  const full = buildSearchQueue(keywords, pages, 0);
  return full.slice(pageOffset, pageOffset + AMAP_FALLBACK_INITIAL_CALLS);
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

/**
 * Keyword-search gate: a sparse POI still makes the card when its name equals
 * the query (whitespace-insensitive) — the user asked for that place by name,
 * so "searched but no card" is worse than an uncommon card.
 */
export function isCommonOrExactName(
  poi: { name?: string; rating?: number; reviewCount?: number; photos?: string[]; category?: string },
  query: string,
): boolean {
  if (isCommonPoi(poi)) return true;
  const exact = (query || '').trim().replace(/\s+/g, '');
  return Boolean(exact && (poi.name || '').replace(/\s+/g, '') === exact);
}
