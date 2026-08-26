// ============================================================
// POI 数据服务 — 按模式统一获取（插件化数据源）
//
// Domain：视口网格波次增量并入累计池，空结果不回退假数据。
// Internship / 工作：DB catalog（/api/pois 读 Postgres，无本地示例数据）+ 缺坐标时再地理编码。
// 距离与列表裁剪由调用方用钉死的 origin 走 runPOIPipeline。
// ============================================================

import {
  geocodeAddress,
  searchPOI,
  searchViewportPOIsFallback,
} from './amap-api.ts';
import type { MapSearchProvider } from './map-engine/types.ts';
import { fetchWorkCatalogFromApi } from './recruitment-adapters/api.ts';
import type { QueryPipeline } from './search.ts';
import {
  DOMAIN_POI_HARD_CAP,
  DOMAIN_POI_FULL_PAGE_SIZE,
  DOMAIN_POI_OFFSET_CAP,
  DOMAIN_BATCH_SIZE,
  fallbackTaskWindow,
  inHangzhouBox,
  isCommonOrExactName,
  isCommonPoi,
  keywordsFor,
  mergePoisById,
  MORE_PAGE_SIZE,
  searchRadiusMeters,
  zoomStrategy,
  type ViewportBounds,
} from './viewport-search.ts';
import type { DomainPOI, MapMode, POI, RecruitmentPOI } from './types.ts';
import { isRecruitmentMode } from './types.ts';

/**
 * 活跃引擎的搜索能力(use-map-engine 挂载时注入,卸载时清空)。
 * 视口兜底搜索经它路由:引擎切换(腾讯/百度)后兜底不再硬绑 amap-api。
 * 未注入(SSR/测试/零配置)→ 回落 amap-api 直连,行为与迁移前一致。
 */
let activeSearchProvider: MapSearchProvider | null = null;

export function setActiveSearchProvider(provider: MapSearchProvider | null): void {
  activeSearchProvider = provider;
}

/** 视口兜底搜索:活跃引擎优先;未注入回落 amap-api searchViewportPOIsFallback(同参数语义)。 */
async function viewportFallbackSearch(
  options: Parameters<typeof searchViewportPOIsFallback>[0]
): Promise<DomainPOI[]> {
  const provider = activeSearchProvider;
  if (!provider) {
    return searchViewportPOIsFallback(options);
  }
  // 与 amap-api searchViewportPOIsFallback 同一窗口策略:按 zoom 切关键词窗口,
  // 窗口空(预算耗尽)→ 不再发请求;每批按 id 去重合并,onBatch 增量回调。
  const strategy = zoomStrategy(options.zoom);
  const center = options.center ?? { lng: 120.15, lat: 30.27 };
  const radius = searchRadiusMeters(options.zoom, center.lat);
  const keywords = options.categories?.length
    ? options.categories
    : keywordsFor(strategy.categories);
  const tasks = fallbackTaskWindow(keywords, strategy.pages, options.pageOffset ?? 0);
  if (tasks.length === 0) return options.existing ?? [];

  const existing = options.existing ?? [];
  const room = Math.max(0, DOMAIN_POI_HARD_CAP - existing.length);
  const thisRoundCap =
    existing.length + Math.min(options.addCap ?? MORE_PAGE_SIZE, room, MORE_PAGE_SIZE);
  let merged: DomainPOI[] = existing.slice();

  for (const task of tasks) {
    if (options.signal?.cancelled) break;
    if (merged.length >= thisRoundCap) break;
    // page 是引擎分页的 duck-type 扩展(契约 MapSearchProvider.searchPOI 未含;
    // AMap 引擎透传到 PlaceSearch pageIndex,与 amap-api searchViewportPOIsFallback 同语义)
    const pois = await provider.searchPOI({
      keyword: task.keyword,
      center,
      radius,
      limit: strategy.pageSize,
      page: task.page,
      city: strategy.city,
    } as Parameters<MapSearchProvider['searchPOI']>[0]);
    merged = mergePoisById(merged, pois.filter(isCommonPoi), thisRoundCap);
    options.onBatch?.(merged);
  }

  return merged;
}

export interface FetchPOIOptions extends QueryPipeline {
  mode: MapMode;
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

export interface FetchPOIResult {
  pois: POI[];
  /**
   * 服务端 total 判定的「数据到底」(domain-local 带 total 时)。
   * undefined → 调用方回退本地长度比较(高德回退/关键词路径)。
   * 注意:失败一律 throw,绝不静默 return existing(poi-loading A)——
   * 「错误 ≠ 没有更多」,失败可重试,不污染 noMore。
   */
  noMore?: boolean;
}

/** 获取指定模式的 POI。失败抛错(错误信号),成功返回 { pois, noMore? }。 */
export async function fetchPOIsForMode(options: FetchPOIOptions): Promise<FetchPOIResult> {
  const { mode } = options;

  if (mode !== 'domain' && !isRecruitmentMode(mode)) {
    return { pois: [] };
  }

  if (mode === 'domain') {
    return fetchDomainPOIs(options);
  }

  return fetchWorkPOIs(options);
}


/** Domain：往累计池里增量合并；找不到就不塞 seed。
 *  tech/22：杭州内走本地 /api/pois/domain-local；杭州外回退高德（省调用，
 *  默认 1 次 25 条，加载更多 +100 条去重）。 */
async function fetchDomainPOIs(options: FetchPOIOptions): Promise<FetchPOIResult> {
  const center = options.center ?? { lng: 120.15, lat: 30.27 };
  const zoom = options.zoom ?? 13;
  const existing = (options.existing ?? []) as DomainPOI[];
  const inHz = inHangzhouBox(center);

  if (options.query) {
    if (inHz) {
      // 杭州内关键词搜索 → 先试本地库 name ILIKE;本地 0 命中(如搜外地词)
      // 或库不可用(null)再回退高德 searchPOI,避免「北京天安门」在杭州库
      // 查不到就空白/返回无关分类 POI。
      const local = await fetchLocalPois(options, existing, zoom, options.query);
      if (local !== null && local.pois.length > existing.length) return local;
    }
    try {
      // 关键词回退与视口兜底同口径(ws-5 修):活跃引擎优先——引擎切换(腾讯/百度)
      // 后关键词搜索不再硬绑 amap-api;未注入(SSR/测试/零配置)→ 回落 amap-api
      // searchPOI,行为与迁移前一致(AMap 引擎 searchPOI 本就走 amap-api 同语义)。
      const provider = activeSearchProvider;
      const pois = provider
        ? await provider.searchPOI({
            keyword: options.query,
            center,
            radius: searchRadiusMeters(zoom, center.lat),
            limit: 25,
            page: (options.pageOffset ?? 0) + 1,
            city: zoom <= 8 ? '全国' : '',
          } as Parameters<MapSearchProvider['searchPOI']>[0])
        : (await searchPOI({
            keyword: options.query,
            center,
            radius: searchRadiusMeters(zoom, center.lat),
            pageSize: 25,
            page: (options.pageOffset ?? 0) + 1,
            city: zoom <= 8 ? '全国' : '',
          })).pois;
      // Exact-name hits survive isCommonPoi: the user asked for that place by
      // name, so a sparse-but-matching card beats "searched but no card".
      const next = mergePoisById(
        existing,
        pois.filter((p) => isCommonOrExactName(p, options.query || '')),
        DOMAIN_POI_HARD_CAP,
      );
      options.onBatch?.(next);
      return { pois: next };
    } catch (err) {
      // 失败 = 错误信号(可重试),不是「没有更多」;绝不静默 return existing
      throw new Error(`domain keyword search failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 分类驱动加载(poi-category-loading):filters.category 从「过滤已加载目录」
  // 变为「驱动加载」——浏览(无关键词)时按类拉取;搜索路径豁免,不发 categories。
  const category =
    typeof options.filters?.category === 'string' && options.filters.category
      ? options.filters.category
      : undefined;

  if (inHz) {
    // 杭州内浏览 → 本地库(全量分层,列表候选 300→+300→1000);
    // 分类已选(poi-category-loading)时按类全量循环拉取;
    // 库不可用时内部已回退高德 fallback,null 兜底为现有池
    const local = await fetchLocalPois(
      options,
      existing,
      zoom,
      undefined,
      category ? [category] : undefined,
    );
    return local ?? { pois: existing };
  }

  // 杭州外 → 高德省调用回退:每次滚动 1 次 PlaceSearch(25 条),窗口耗尽即停
  try {
    const pois = await viewportFallbackSearch({
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
    return { pois };
  } catch (err) {
    // 失败 = 错误信号,不置 noMore(poi-loading A)
    throw new Error(`AMap fallback search failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 杭州本地查询：GET /api/pois/domain-local。每批 DOMAIN_BATCH_SIZE(50)，cap 1000。
 *  带关键词时库不可用 → 返回 null(调用方改走高德 searchPOI 带词搜索);
 *  浏览(无关键词)时库不可用 → 内部回退高德 fallback 兜底,不白屏。
 *  分类已选(poi-category-loading)且无关键词 → 全量循环(见 fetchLocalPoisAll)。
 *  成功返回 { pois, noMore }——noMore 用服务端 total 判定(poi-loading D)。 */
async function fetchLocalPois(
  options: FetchPOIOptions,
  existing: DomainPOI[],
  zoom: number,
  q?: string,
  categories?: string[],
): Promise<FetchPOIResult | null> {
  // 分类门控下的「全量」加载:循环 offset 拉完当前视图该类别的所有 POI
  if (categories?.length && !q) {
    return fetchLocalPoisAll(options, existing, zoom, categories);
  }
  const bounds = options.bounds;
  const offset = (options.pageOffset ?? 0) * DOMAIN_BATCH_SIZE;
  const params = new URLSearchParams();
  if (bounds) {
    params.set('bounds', `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`);
  }
  params.set('zoom', String(Math.max(1, Math.floor(zoom))));
  params.set('limit', String(DOMAIN_BATCH_SIZE));
  params.set('offset', String(offset));
  if (q) params.set('q', q);
  const url = `/api/pois/domain-local?${params.toString()}`;

  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`domain-local ${res.status}`);
    const data = await res.json();
    const rows = (data.results ?? []) as DomainPOI[];
    const next = mergePoisById(existing, rows, DOMAIN_POI_HARD_CAP);
    const total = typeof data.total === 'number' ? data.total : -1;
    // 服务端 total 判定到底:已取到 total 之后,或本轮 0 行(越过 offset 上限);
    // 过滤(common/筛选)导致可见列表不变不再误判「没有更多」
    const noMore = total >= 0 ? offset + rows.length >= total : rows.length === 0;
    options.onBatch?.(next);
    return { pois: next, noMore };
  } catch (err) {
    // 库未导入 / 网络错 → 浏览路径回退高德 fallback(杭州内兜底),不白屏;
    // 关键词路径返回 null 让调用方走 searchPOI(带词,而不是无关分类 POI)。
    if (q) return null;
    console.warn('[poi-service] local domain POIs failed, fallback to AMap:', err);
    try {
      const pois = await viewportFallbackSearch({
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
      return { pois };
    } catch (fallbackErr) {
      // 本地库 + 高德兜底都失败 = 错误信号,不静默 return existing(poi-loading A)
      throw new Error(
        `local domain POIs failed: ${err instanceof Error ? err.message : String(err)}; ` +
          `fallback also failed: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`,
      );
    }
  }
}

/**
 * 分类全量加载(poi-category-loading):循环 offset 拉完当前视图该类别所有 POI。
 * - 每页 limit=DOMAIN_POI_FULL_PAGE_SIZE(300,API 上限),offset 0→300→600→900;
 * - 停止:服务端 total 已取到 / 短页(rows < limit)→ noMore=true;
 *   累计到 DOMAIN_POI_HARD_CAP(1000)→ 停;offset 越过 API 上限
 *   DOMAIN_POI_OFFSET_CAP(1000)→ 停——「全量」= 尽力全量,受容量保护
 *   (汇报/tech/16 记录该取舍);
 * - 每页回调 onBatch(累计池,视口 replace 语义下逐页填充);
 * - 库不可用/网络错 → 回退高德 fallback(带 categories,已支持),不白屏。
 */
async function fetchLocalPoisAll(
  options: FetchPOIOptions,
  existing: DomainPOI[],
  zoom: number,
  categories: string[],
): Promise<FetchPOIResult | null> {
  const bounds = options.bounds;
  const baseParams = () => {
    const params = new URLSearchParams();
    if (bounds) {
      params.set('bounds', `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`);
    }
    params.set('zoom', String(Math.max(1, Math.floor(zoom))));
    params.set('limit', String(DOMAIN_POI_FULL_PAGE_SIZE));
    params.set('categories', categories.join(','));
    return params;
  };
  let merged = existing.slice();
  let noMore = false;
  try {
    for (
      let offset = 0;
      offset <= DOMAIN_POI_OFFSET_CAP;
      offset += DOMAIN_POI_FULL_PAGE_SIZE
    ) {
      if (options.signal?.cancelled) break;
      if (merged.length >= DOMAIN_POI_HARD_CAP) break; // 硬顶保护,不再发请求
      const params = baseParams();
      params.set('offset', String(offset));
      const res = await fetch(`/api/pois/domain-local?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`domain-local ${res.status}`);
      const data = await res.json();
      const rows = (data.results ?? []) as DomainPOI[];
      const total = typeof data.total === 'number' ? data.total : -1;
      merged = mergePoisById(merged, rows, DOMAIN_POI_HARD_CAP);
      options.onBatch?.(merged);
      noMore =
        total >= 0 ? offset + rows.length >= total : rows.length < DOMAIN_POI_FULL_PAGE_SIZE;
      if (rows.length < DOMAIN_POI_FULL_PAGE_SIZE) break; // 短页 → 到底
      if (noMore) break; // 服务端 total 已取到 → 到底
    }
    return { pois: merged, noMore };
  } catch (err) {
    // 库未导入 / 网络错 → 回退高德 fallback(带 categories),不白屏
    console.warn('[poi-service] local category POIs failed, fallback to AMap:', err);
    try {
      const pois = await viewportFallbackSearch({
        center: options.center,
        zoom,
        bounds: options.bounds,
        existing,
        addCap: options.addCap,
        pageOffset: options.pageOffset,
        signal: options.signal,
        categories,
        onBatch: (batch) => {
          if (options.signal?.cancelled) return;
          options.onBatch?.(batch);
        },
      });
      return { pois };
    } catch (fallbackErr) {
      // 本地库 + 高德兜底都失败 = 错误信号,不静默 return existing(poi-loading A)
      throw new Error(
        `local category POIs failed: ${err instanceof Error ? err.message : String(err)}; ` +
          `fallback also failed: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`,
      );
    }
  }
}

let geocodePromise: Promise<RecruitmentPOI[]> | null = null;

function hasPlausibleCoord(poi: RecruitmentPOI): boolean {
  const { lng, lat } = poi.location;
  return Number.isFinite(lng) && Number.isFinite(lat) && !(lng === 0 && lat === 0);
}

/** 用 Geocoder 校正缺坐标或 (0,0) 的办公点；已有坐标不打高德。
 *  seed 已归档(tech/backup/seed-data),调用方传入 DB catalog / 真实 drop。 */
export async function resolveInternshipLocations(
  seed: RecruitmentPOI[]
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

let workSeedPromise: Promise<RecruitmentPOI[]> | null = null;

async function workSeedFromAdapters(): Promise<RecruitmentPOI[]> {
  if (!workSeedPromise) {
    workSeedPromise = (async () => {
      try {
        const fromApi = await fetchWorkCatalogFromApi();
        if (fromApi.length) return fromApi;
      } catch {
        // Relative /api/pois is browser-only; tests and SSR take the empty path.
      }
      return [];
    })();
  }
  return workSeedPromise;
}

async function internshipSeedResolved(): Promise<RecruitmentPOI[]> {
  if (!geocodePromise) {
    geocodePromise = workSeedFromAdapters()
      .then((seed) => resolveInternshipLocations(seed))
      .catch((err) => {
        console.warn('[poi-service] geocode work catalog failed:', err);
        geocodePromise = null;
        return [];
      });
  }
  return geocodePromise;
}

async function fetchWorkPOIs(options: FetchPOIOptions): Promise<FetchPOIResult> {
  const immediate = (await workSeedFromAdapters()) as POI[];
  options.onBatch?.(immediate);

  const seeded = (await internshipSeedResolved()) as POI[];
  options.onBatch?.(seeded);
  return { pois: seeded };
}
