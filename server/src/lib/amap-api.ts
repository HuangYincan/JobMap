// ============================================================
// AMap JavaScript API v2.0 客户端封装
//
// 设计遵循 .claude/skills/amap-api-integration/skill.md：
// - 动态加载脚本 + 安全码配置
// - POI 搜索（关键词 / 周边）封装为 Promise
// - 返回规范化 DomainPOI
// ============================================================

import type { DomainPOI, PlaceReview, POILocation } from './types.ts';
import {
  AMAP_DEFAULT_RADIUS,
  AMAP_NEARBY_MAX_RADIUS,
  AMAP_PAGE_SIZE,
  AMAP_QPS,
  buildSearchQueue,
  DOMAIN_POI_HARD_CAP,
  fallbackTaskWindow,
  keywordsFor,
  mergePoisById,
  isCommonPoi,
  MORE_PAGE_SIZE,
  POI_HARD_CAP,
  POI_SOFT_CAP,
  searchRadiusMeters,
  zoomStrategy,
  type ViewportBounds,
} from './viewport-search.ts';

/** 全局声明：AMap 挂载在 window 上 */
declare global {
  interface Window {
    AMap?: any;
    _AMapSecurityConfig?: { securityJsCode: string };
  }
}

const AMAP_URL = 'https://webapi.amap.com/maps?v=2.0&key=';
const SCRIPT_ID = 'amap-jsapi-script';
/** 随主脚本预加载的插件（v2.0 支持 URL plugin 参数，避免 AMap.plugin 时序竞态） */
const AMAP_PLUGINS = 'AMap.PlaceSearch,AMap.AutoComplete,AMap.Geolocation,AMap.Geocoder';

/** 加载状态缓存，避免重复注入 */
let loadPromise: Promise<any> | null = null;

/** 是否已在运行环境（浏览器） */
function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

/**
 * 动态加载 AMap JS API。
 * 幂等：已加载直接返回，加载中复用同一个 Promise。
 * 需要 NEXT_PUBLIC_AMAP_KEY 与 NEXT_PUBLIC_AMAP_SECURITY_CODE。
 */
export function loadAMap(): Promise<any> {
  if (!isBrowser()) {
    return Promise.reject(new Error('AMap is only available in the browser'));
  }
  if (window.AMap) return Promise.resolve(window.AMap);

  if (loadPromise) return loadPromise;

  const apiKey = process.env.NEXT_PUBLIC_AMAP_KEY;
  const securityCode = process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE;

  loadPromise = new Promise((resolve, reject) => {
    if (!apiKey || !securityCode) {
      reject(new Error('NEXT_PUBLIC_AMAP_KEY and NEXT_PUBLIC_AMAP_SECURITY_CODE are required'));
      return;
    }

    // 安全码必须在脚本加载前配置
    window._AMapSecurityConfig = { securityJsCode: securityCode };

    // 复用已存在的 script 标签
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.AMap));
      existing.addEventListener('error', () => reject(new Error('AMap script failed to load')));
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = `${AMAP_URL}${apiKey}&plugin=${AMAP_PLUGINS}`;
    script.async = true;
    script.onload = () => resolve(window.AMap);
    script.onerror = () => {
      loadPromise = null;
      // 移除失败标签:否则下次 loadAMap 走「复用 existing」分支,给一个
      // 已死且不会再触发 load/error 的标签挂监听,Promise 永不落定,
      // 后续所有 searchPOI/geocode 全部永久挂起(直到整页刷新)。
      script.remove();
      reject(new Error('AMap script failed to load'));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

/** 重置加载缓存（测试用） */
export function resetAMapLoader(): void {
  loadPromise = null;
}

/** POI 搜索参数 */
export interface POISearchParams {
  /** 搜索关键词 */
  keyword: string;
  /** 中心点（周边搜索）；缺省时用城市范围搜索 */
  center?: POILocation;
  /** 搜索半径（米），默认 5000 */
  radius?: number;
  /** 城市（中文名或 adcode） */
  city?: string;
  /** 分类筛选 */
  category?: string;
  /** 每页数量 1-25，默认 20 */
  pageSize?: number;
  /** 页码，默认 1 */
  page?: number;
}

/** 高德原始 POI 记录（只取我们需要的字段） */
interface AMapPOIRecord {
  id?: string;
  name?: string;
  /** v2.0：AMap.LngLat 对象（{lng, lat}）或 "lng,lat" 字符串 */
  location?: { lng?: number; lat?: number } | string;
  /** v1.x 风格：LngLat 对象 */
  lnglat?: { lng?: number; lat?: number };
  address?: string;
  type?: string; // "餐饮服务;中餐厅;..." 或 "餐饮服务"
  tel?: string;
  rating?: string;
  cost?: string; // 人均消费
  photos?: { url: string }[];
  open_time?: string;
  business_area?: string;
  comment?: string | number;
  reviews?: string | number | Array<{
    id?: string;
    username?: string;
    author?: string;
    rating?: string | number;
    content?: string;
    comment?: string;
    time?: string;
  }>;
  biz_ext?: { rating?: string; cost?: string; comment?: string | number };
}

/** 从高德 POI 记录解析坐标，返回 [lng, lat] 或 null */
function parseAMapCoords(raw: AMapPOIRecord): [number, number] | null {
  // v2.0：location 是 AMap.LngLat 对象
  if (raw.location && typeof raw.location === 'object' && typeof raw.location.lng === 'number' && typeof raw.location.lat === 'number') {
    return [raw.location.lng, raw.location.lat];
  }
  // v1.x：lnglat 是 LngLat 对象
  if (raw.lnglat && typeof raw.lnglat.lng === 'number' && typeof raw.lnglat.lat === 'number') {
    return [raw.lnglat.lng, raw.lnglat.lat];
  }
  // 兜底：location 是 "lng,lat" 字符串
  if (typeof raw.location === 'string' && raw.location.includes(',')) {
    const [lngStr, latStr] = raw.location.split(',');
    const lng = parseFloat(lngStr);
    const lat = parseFloat(latStr);
    if (!isNaN(lng) && !isNaN(lat)) return [lng, lat];
  }
  return null;
}

/** 将高德 POI 规范化成 DomainPOI */
export function normalizeAMapPOI(raw: AMapPOIRecord): DomainPOI | null {
  if (!raw?.name) return null;

  const coords = parseAMapCoords(raw);
  if (!coords) return null;
  const [lng, lat] = coords;

  // 解析高德 type："餐饮服务;中餐厅;火锅店" → category="餐饮服务", subcategory="中餐厅"
  const typeParts = (raw.type || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  const category = typeParts[0] || '其他';
  const subcategory = typeParts[1] || undefined;

  const ratingRaw = raw.rating || raw.biz_ext?.rating;
  const cost = raw.cost ? parseFloat(raw.cost) : raw.biz_ext?.cost ? parseFloat(raw.biz_ext.cost) : undefined;
  const reviewRaw = Array.isArray(raw.reviews)
    ? raw.reviews.length
    : raw.comment ?? (typeof raw.reviews === 'number' || typeof raw.reviews === 'string' ? raw.reviews : undefined) ?? raw.biz_ext?.comment;
  const reviewCount =
    reviewRaw !== undefined && reviewRaw !== '' ? Number.parseInt(String(reviewRaw), 10) : undefined;
  const reviews = parseAMapReviews(raw);

  // photos 可能缺失、为数组、或意外类型；仅接受数组
  const photoUrls = Array.isArray(raw.photos)
    ? raw.photos.map((p) => p?.url).filter((u): u is string => typeof u === 'string').slice(0, 3)
    : undefined;

  return {
    id: raw.id || `amap-${lng}-${lat}-${raw.name}`,
    kind: 'domain',
    name: raw.name,
    mode: 'domain',
    source: 'amap',
    location: {
      lng,
      lat,
      address: raw.address || raw.business_area || undefined,
    },
    category,
    subcategory,
    rating: ratingRaw ? parseFloat(String(ratingRaw)) : undefined,
    cost,
    priceLevel: cost && cost > 0 ? Math.min(4, Math.ceil(cost / 100)) : undefined,
    openHours: raw.open_time || undefined,
    tel: cleanTelCell(raw.tel),
    photos: photoUrls,
    reviewCount: Number.isFinite(reviewCount) && (reviewCount as number) > 0 ? reviewCount : reviews?.length,
    reviews,
  };
}

/** tel 清洗:空数组/空串/'[]' → undefined(AMap 空电话可能返回 [],truthy 会透传) */
function cleanTelCell(tel: string | undefined): string | undefined {
  if (Array.isArray(tel)) {
    const first = tel[0];
    const s = typeof first === 'string' ? first.trim() : '';
    return s || undefined;
  }
  const s = (tel ?? '').trim();
  return s && s !== '[]' && s !== '{}' ? s : undefined;
}

function parseAMapReviews(raw: AMapPOIRecord): PlaceReview[] | undefined {
  if (!Array.isArray(raw.reviews)) return undefined;
  const items = raw.reviews
    .map((item, index): PlaceReview | null => {
      const excerpt = String(item.content || item.comment || '').trim();
      if (!excerpt) return null;
      const rating = item.rating === undefined || item.rating === '' ? undefined : Number(item.rating);
      return {
        id: item.id || `${raw.id || raw.name}-review-${index}`,
        author: item.username || item.author || '用户',
        rating: Number.isFinite(rating) ? rating : undefined,
        excerpt,
        postedAt: item.time,
      };
    })
    .filter((item): item is PlaceReview => item !== null);
  return items.length ? items.slice(0, 5) : undefined;
}

/** 等待插件就绪（插件通过 URL plugin 参数随脚本预加载，此处只需轮询确认） */
function waitForPlugin(AMap: any, pluginName: string, timeoutMs = 8000): Promise<void> {
  // AMap.plugin() 的参数需要带 "AMap." 前缀（如 'AMap.PlaceSearch'），
  // 但插件挂载到 AMap 命名空间的属性不带前缀（AMap.PlaceSearch）。
  const qualifiedName = pluginName.startsWith('AMap.') ? pluginName : `AMap.${pluginName}`;
  const mountName = pluginName.startsWith('AMap.') ? pluginName.slice(5) : pluginName;

  return new Promise((resolve, reject) => {
    const start = Date.now();

    const check = () => typeof AMap[mountName] === 'function';

    // 立即检查（脚本 onload 时插件应已随主脚本注册）
    if (check()) {
      resolve();
      return;
    }

    // 兜底：如果 URL 预加载未生效，尝试显式 AMap.plugin 请求
    const requestPlugin = () => {
      try {
        AMap.plugin([qualifiedName], () => {});
      } catch {
        // 忽略；轮询会兜底
      }
    };

    requestPlugin();

    let attempts = 0;
    const interval = setInterval(() => {
      if (check()) {
        clearInterval(interval);
        resolve();
        return;
      }
      attempts++;
      requestPlugin();
      if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error(`AMap plugin ${pluginName} failed to load within ${timeoutMs}ms`));
      }
    }, 500);
  });
}

/** 个人开发者 JS API 约 3 次/秒；全局限速，禁止网格并发打爆配额 */
const AMAP_MIN_INTERVAL_MS = Math.ceil(1000 / AMAP_QPS);
let nextAmapSlot = 0;
let amapGate: Promise<void> = Promise.resolve();

function acquireAmapSlot(): Promise<void> {
  const scheduled = amapGate.then(async () => {
    const wait = Math.max(0, nextAmapSlot - Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    nextAmapSlot = Date.now() + AMAP_MIN_INTERVAL_MS;
  });
  amapGate = scheduled.catch(() => undefined);
  return scheduled;
}

/**
 * 搜索 POI。有 center 时走周边搜索，否则走关键词搜索。
 * 每次调用只打 1 页（pageSize ≤ 25）。翻页由调用方排队，遵守 3 次/秒。
 */
export async function searchPOI(
  params: POISearchParams
): Promise<{ pois: DomainPOI[]; total: number }> {
  const AMap = await loadAMap();
  await waitForPlugin(AMap, 'PlaceSearch');
  await acquireAmapSlot();

  const pageSize = Math.min(AMAP_PAGE_SIZE, params.pageSize || AMAP_PAGE_SIZE);
  const pageIndex = params.page || 1;
  const requested = params.radius ?? AMAP_DEFAULT_RADIUS;
  const radius =
    requested > AMAP_NEARBY_MAX_RADIUS || requested <= 0
      ? AMAP_DEFAULT_RADIUS
      : requested;

  const { records, total } = await new Promise<{ records: AMapPOIRecord[]; total: number }>((resolve) => {
    let placeSearch: any;
    try {
      placeSearch = new AMap.PlaceSearch({
        pageSize,
        pageIndex,
        city: params.city && params.city.length > 0 ? params.city : '全国',
        citylimit: false,
        extensions: 'all',
      });
    } catch {
      resolve({ records: [], total: 0 });
      return;
    }

    let settled = false;
    const done = (status: string, result: any) => {
      if (settled) return;
      settled = true;
      if (status === 'complete' && result?.poiList) {
        resolve({
          records: result.poiList.pois || [],
          total: result.poiList.count || 0,
        });
      } else {
        resolve({ records: [], total: 0 });
      }
    };

    if (params.center) {
      placeSearch.searchNearBy(
        params.keyword,
        [params.center.lng, params.center.lat],
        radius,
        done
      );
    } else {
      placeSearch.search(params.keyword, done);
    }
    placeSearch.on('complete', (e: any) => done('complete', e));
    placeSearch.on('error', () => done('error', null));
  });

  const seen = new Set<string>();
  const pois: DomainPOI[] = [];
  for (const raw of records) {
    const poi = normalizeAMapPOI(raw);
    if (!poi || seen.has(poi.id)) continue;
    seen.add(poi.id);
    pois.push(poi);
  }
  return { pois, total: total || pois.length };
}

/** 根据分类关键词搜索周边 POI（Domain 模式默认加载） */
export async function searchNearbyPOIs(
  center: POILocation,
  category: string,
  radius = 5000
): Promise<{ pois: DomainPOI[]; total: number }> {
  return searchPOI({ keyword: category, center, radius, pageSize: AMAP_PAGE_SIZE });
}

// ============================================================
// AutoComplete — 搜索建议（tech/10-search-filter.md + 高德 autocomplete）
// ============================================================

/** 搜索建议项 */
export interface AmapSuggestion {
  /** 高德 POI id（用于后续定位） */
  id?: string;
  /** 名称 */
  name: string;
  /** 分类 */
  type?: string;
  /** 经纬度（高德 POI 建议通常带，用于选中后定位） */
  location?: { lng: number; lat: number };
  /** 地址描述 */
  address?: string;
  /** 城市 */
  city?: string[];
  /** 区县 */
  district?: string;
}

/**
 * Turn an AutoComplete tip into a session DomainPOI so a list card exists.
 * AMap tips are not PlaceSearch records; they stay source:'amap' (not persistable).
 */
export function suggestionToDomainPoi(tip: {
  id?: string;
  name: string;
  subtitle?: string;
  location?: { lng: number; lat: number };
  type?: string;
  address?: string;
  district?: string;
}): DomainPOI | null {
  const name = tip.name?.trim();
  const loc = tip.location;
  if (!name || !loc || typeof loc.lng !== 'number' || typeof loc.lat !== 'number') return null;
  const category = (tip.type || tip.subtitle || '地点').split(/[;·]/)[0]?.trim() || '地点';
  const address = tip.address || tip.district || tip.subtitle;
  return {
    id: tip.id || `amap-${loc.lng}-${loc.lat}-${name}`,
    kind: 'domain',
    name,
    mode: 'domain',
    source: 'amap',
    location: { lng: loc.lng, lat: loc.lat, address },
    category,
  };
}

/**
 * 搜索建议（AutoComplete）。
 * 返回匹配的 POI 建议列表；无结果或失败返回空数组。
 */
export async function fetchSuggestions(
  keyword: string,
  city = '杭州'
): Promise<AmapSuggestion[]> {
  if (!keyword.trim()) return [];
  const AMap = await loadAMap();
  await waitForPlugin(AMap, 'AutoComplete');

  return new Promise((resolve) => {
    let auto: any;
    try {
      auto = new AMap.AutoComplete({ city });
    } catch {
      resolve([]);
      return;
    }

    auto.search(keyword, (status: string, result: any) => {
      if (status === 'complete' && Array.isArray(result?.tips)) {
        resolve(
          result.tips
            .filter((tip: any) => tip?.name)
            .map((tip: any): AmapSuggestion => {
              // 解析 "lng,lat" 字符串（AutoComplete 建议通常带经纬度）
              let location: { lng: number; lat: number } | undefined;
              if (typeof tip.location === 'string' && tip.location.includes(',')) {
                const [lngStr, latStr] = tip.location.split(',');
                const lng = parseFloat(lngStr);
                const lat = parseFloat(latStr);
                if (!isNaN(lng) && !isNaN(lat)) location = { lng, lat };
              }
              return {
                id: tip.id,
                name: tip.name,
                type: tip.typecode ? tip.type?.split(';')[0] : tip.type,
                location,
                address: tip.address,
                city: tip.cityname ? [tip.cityname] : undefined,
                district: tip.adname,
              };
            })
            .slice(0, 10)
        );
      } else {
        resolve([]);
      }
    });
    auto.on('error', () => resolve([]));
  });
}

// ============================================================
// Geolocation — 定位（精度圈 + 蓝点）
// ============================================================

/** 定位结果 */
export interface GeocodedPosition {
  /** 经纬度 */
  position: { lng: number; lat: number };
  /** 精度（米） */
  accuracy?: number;
  /** 是否转换到高德坐标 */
  converted?: boolean;
  /** 格式化地址（needAddress 时） */
  address?: string;
  /** 状态信息 */
  info?: string;
}

/**
 * 获取当前位置（AMap.Geolocation 插件）。
 * - 融合浏览器定位 / IP 定位 / SDK 辅助
 * - 自带精度圈 + 蓝点显示（需通过 map.addControl 绑定到地图，否则蓝点无处渲染）
 * 返回 null 表示定位失败（未授权 / 超时 / 不可用）。
 *
 * @param map AMap.Map 实例。Geolocation 是 Control，必须 addControl 到地图，
 *            定位成功后蓝点 marker 与精度圈才渲染在该地图上。
 */
export async function getCurrentPosition(map: any): Promise<GeocodedPosition | null> {
  const AMap = await loadAMap();
  await waitForPlugin(AMap, 'Geolocation');

  return new Promise((resolve) => {
    let geolocation: any;
    try {
      // 每个 map 复用同一个 Geolocation 实例（Control 只能 addControl 一次）
      let cached = geolocationByMap.get(map);
      if (!cached) {
        cached = new AMap.Geolocation({
          enableHighAccuracy: true,
          timeout: 8000,
          maximumAge: 30000,
          convert: true,
          needAddress: true,
          showButton: false,
          showCircle: true,
          showMarker: true,
          zoomToAccuracy: false,
          panToLocation: false,
        });
        if (map && typeof map.addControl === 'function') {
          map.addControl(cached);
        }
        geolocationByMap.set(map, cached);
      }
      geolocation = cached;
    } catch {
      resolve(null);
      return;
    }

    geolocation.getCurrentPosition((status: string, result: any) => {
      if (status === 'complete' && result?.position) {
        const pos = result.position;
        resolve({
          position: {
            lng: typeof pos.getLng === 'function' ? pos.getLng() : pos.lng,
            lat: typeof pos.getLat === 'function' ? pos.getLat() : pos.lat,
          },
          accuracy: result.accuracy,
          converted: !!result.isConverted,
          address: result.formattedAddress,
          info: result.info,
        });
      } else {
        resolve(null);
      }
    });
  });
}

/** 每地图复用的 Geolocation 实例缓存（WeakMap，map 销毁自动回收） */
const geolocationByMap = new WeakMap<object, any>();

// ============================================================
// Geocoder — 地址转经纬度
// ============================================================

const geocodeCache = new Map<string, POILocation>();

/**
 * 地址 → 经纬度（AMap.Geocoder）。
 * 失败返回 null；同一地址会缓存，避免反复打接口。
 */
export async function geocodeAddress(
  address: string,
  city?: string
): Promise<POILocation | null> {
  const key = `${city || ''}::${address.trim()}`;
  if (!address.trim()) return null;
  const cached = geocodeCache.get(key);
  if (cached) return cached;

  const AMap = await loadAMap();
  await waitForPlugin(AMap, 'Geocoder');

  return new Promise((resolve) => {
    let geocoder: any;
    try {
      geocoder = new AMap.Geocoder({
        city: city && city.length > 0 ? city : '全国',
      });
    } catch {
      resolve(null);
      return;
    }

    geocoder.getLocation(address, (status: string, result: any) => {
      const loc = result?.geocodes?.[0]?.location;
      if (status !== 'complete' || !loc) {
        resolve(null);
        return;
      }
      const lng = typeof loc.getLng === 'function' ? loc.getLng() : loc.lng;
      const lat = typeof loc.getLat === 'function' ? loc.getLat() : loc.lat;
      if (typeof lng !== 'number' || typeof lat !== 'number') {
        resolve(null);
        return;
      }
      const parsed: POILocation = { lng, lat, address };
      geocodeCache.set(key, parsed);
      resolve(parsed);
    });
  });
}

// ============================================================
// 视口 POI 搜索 — 网格采样 + 波次并行
// ============================================================

/** 高德 POI 分类（兼容旧调用） */
export const POI_CATEGORIES = [
  '餐饮服务',
  '购物服务',
  '风景名胜',
  '商务住宅',
  '科教文化服务',
  '交通设施服务',
  '金融保险服务',
  '体育休闲服务',
  '医疗保健服务',
  '住宿服务',
  '政府机构及社会团体',
  '公司企业',
] as const;

export interface ViewportSearchOptions {
  bounds?: ViewportBounds;
  center?: POILocation;
  zoom: number;
  /** 已有累计池，本轮往里增量合并，不整表替换 */
  existing?: DomainPOI[];
  /** 本轮最多新加多少（默认 POI_SOFT_CAP） */
  addCap?: number;
  /** PlaceSearch 页偏移：0=首页，1=第二页…「需要更多」时递增 */
  pageOffset?: number;
  /** 每找到一批就回调，用于缓慢堆出 POI */
  onBatch?: (pois: DomainPOI[]) => void;
  signal?: { cancelled: boolean };
}

/**
 * 视口 POI 搜索：从视野中心 searchNearBy，按分类轮询、限速翻页。
 * 空结果不回退假数据。
 */
export async function searchViewportPOIs(
  center: POILocation,
  zoom: number,
  categories?: readonly string[]
): Promise<DomainPOI[]> {
  return searchViewportPOIsIncremental({ center, zoom, categories });
}

export async function searchViewportPOIsIncremental(
  options: ViewportSearchOptions & { categories?: readonly string[] }
): Promise<DomainPOI[]> {
  const strategy = zoomStrategy(options.zoom);
  const center = options.center ?? { lng: 120.15, lat: 30.27 };
  const radius = searchRadiusMeters(options.zoom, center.lat);
  const keywords = options.categories?.length
    ? options.categories
    : keywordsFor(strategy.categories);
  const queue = buildSearchQueue(keywords, strategy.pages, options.pageOffset ?? 0);

  const existing = options.existing ?? [];
  const addCap = options.addCap ?? POI_SOFT_CAP;
  const room = Math.max(0, POI_HARD_CAP - existing.length);
  const thisRoundCap = existing.length + Math.min(addCap, room, MORE_PAGE_SIZE);
  let merged: DomainPOI[] = existing.slice();

  if (thisRoundCap <= existing.length) {
    options.onBatch?.(merged);
    return merged;
  }

  for (const task of queue) {
    if (options.signal?.cancelled) break;
    if (merged.length >= thisRoundCap) break;

    const result = await searchPOI({
      keyword: task.keyword,
      center,
      radius,
      pageSize: strategy.pageSize,
      page: task.page,
      city: strategy.city,
    });
    merged = mergePoisById(merged, result.pois.filter(isCommonPoi), thisRoundCap);
    options.onBatch?.(merged);
  }

  return merged;
}

/**
 * 杭州外回退高德(tech/22):省调用版视口搜索。
 * 默认只发 1 次 PlaceSearch(25 条);用户点「加载更多」每轮至多 +4 次
 * (≈100 条,mergePoisById 按 id 去重)。预算由 fallbackTaskWindow 切窗,
 * 窗口空(预算耗尽)→ 不再发请求。
 */
export async function searchViewportPOIsFallback(
  options: ViewportSearchOptions & { categories?: readonly string[] }
): Promise<DomainPOI[]> {
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
  const thisRoundCap = existing.length + Math.min(options.addCap ?? MORE_PAGE_SIZE, room, MORE_PAGE_SIZE);
  let merged: DomainPOI[] = existing.slice();

  for (const task of tasks) {
    if (options.signal?.cancelled) break;
    if (merged.length >= thisRoundCap) break;
    const result = await searchPOI({
      keyword: task.keyword,
      center,
      radius,
      pageSize: strategy.pageSize,
      page: task.page,
      city: strategy.city,
    });
    merged = mergePoisById(merged, result.pois.filter(isCommonPoi), thisRoundCap);
    options.onBatch?.(merged);
  }

  return merged;
}

/** 根据分类编码返回中文分类名（兼容旧调用） */
export function categoryName(category: string): string {
  return category;
}
