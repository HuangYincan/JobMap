// ============================================================
// AMap JavaScript API v2.0 客户端封装
//
// 设计遵循 .claude/skills/amap-api-integration/skill.md：
// - 动态加载脚本 + 安全码配置
// - POI 搜索（关键词 / 周边）封装为 Promise
// - 返回规范化 DomainPOI
// ============================================================

import type { DomainPOI, POILocation } from './types.ts';

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
const AMAP_PLUGINS = 'AMap.PlaceSearch,AMap.AutoComplete,AMap.Geolocation';

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

  const cost = raw.cost ? parseFloat(raw.cost) : undefined;

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
    rating: raw.rating ? parseFloat(raw.rating) : undefined,
    priceLevel: cost && cost > 0 ? Math.min(4, Math.ceil(cost / 100)) : undefined,
    openHours: raw.open_time || undefined,
    tel: raw.tel || undefined,
    photos: photoUrls,
  };
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

/**
 * 搜索 POI（支持分页拉取）。
 * 有 center 时走周边搜索（around），否则走关键词搜索。
 *
 * 高德 PlaceSearch 每页最多 25 条；要获取更多，需并行拉取多页后合并去重。
 * 默认拉取 4 页（最多 100 条），每页独立 HTTP 请求，开销可控（符合免费配额）。
 * 若要全量导入（如城市级 10K+），应由数据导入管线（DB + crawler）实现。
 *
 * 返回值已规范化为 DomainPOI，并附上去重后的实际数量。
 */
export async function searchPOI(
  params: POISearchParams,
  maxPages = 4
): Promise<{ pois: DomainPOI[]; total: number }> {
  const AMap = await loadAMap();

  // 等待 PlaceSearch 插件就绪（带轮询兜底，避免 onload 竞态）
  await waitForPlugin(AMap, 'PlaceSearch');

  const pageSize = Math.min(25, params.pageSize || 25);
  const startPage = params.page || 1;

  /** 单页搜索，返回 {records, total}；失败返回空 */
  function searchPage(pageIndex: number): Promise<{ records: AMapPOIRecord[]; total: number }> {
    return new Promise((resolve) => {
      let placeSearch: any;
      try {
        placeSearch = new AMap.PlaceSearch({
          pageSize,
          pageIndex,
          city: params.city || '杭州',
          extensions: 'all', // 返回详情（电话、评分、图片）
        });
      } catch {
        resolve({ records: [], total: 0 });
        return;
      }

      const done = (status: string, result: any) => {
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
          params.radius || 5000,
          done
        );
      } else {
        placeSearch.search(params.keyword, done);
      }
      placeSearch.on('complete', (e: any) => done('complete', e));
      placeSearch.on('error', () => resolve({ records: [], total: 0 }));
    });
  }

  // 并行拉取多页
  const pages = await Promise.all(
    Array.from({ length: maxPages }, (_, i) => searchPage(startPage + i))
  );

  // 合并去重（按 id 去重，多页可能有边界重复）
  const seen = new Set<string>();
  const pois: DomainPOI[] = [];
  for (const page of pages) {
    for (const raw of page.records) {
      const poi = normalizeAMapPOI(raw);
      if (!poi) continue;
      if (seen.has(poi.id)) continue;
      seen.add(poi.id);
      pois.push(poi);
    }
  }

  const total = pages.find((p) => p.total > 0)?.total || pois.length;
  return { pois, total };
}

/** 根据分类关键词搜索周边 POI（Domain 模式默认加载） */
export async function searchNearbyPOIs(
  center: POILocation,
  category: string,
  radius = 5000,
  maxPages = 4
): Promise<{ pois: DomainPOI[]; total: number }> {
  return searchPOI({ keyword: category, center, radius, pageSize: 25 }, maxPages);
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
 * - 自带精度圈 + 蓝点显示
 * 返回 null 表示定位失败（未授权 / 超时 / 不可用）。
 */
export async function getCurrentPosition(): Promise<GeocodedPosition | null> {
  const AMap = await loadAMap();
  await waitForPlugin(AMap, 'Geolocation');

  return new Promise((resolve) => {
    let geolocation: any;
    try {
      geolocation = new AMap.Geolocation({
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

// ============================================================
// 视口 POI 搜索 — 按缩放层级 + 重要性均匀铺满
// ============================================================

/** 高德 POI 分类编码（主分类） */
export const POI_CATEGORIES = [
  '餐饮服务',       // 050000
  '购物服务',       // 060000
  '风景名胜',       // 110000
  '商务住宅',       // 120000
  '科教文化服务',   // 140000
  '交通设施服务',   // 150000
  '金融保险服务',   // 160000
  '体育休闲服务',   // 080000
  '医疗保健服务',   // 090000
  '住宿服务',       // 100000
  '政府机构及社会团体', // 170000
  '公司企业',       // 070000
] as const;

/**
 * 视口 POI 搜索（制图学策略）。
 * - 按当前 zoom 确定搜索半径：zoom 大 → 半径小、更密集；zoom 小 → 半径大、覆盖广
 * - 按重要性筛选：高德搜索按综合权重排序（越重要的越靠前），取每分类前 N
 * - 多分类并行搜索 → 合并去重 → 按评分降序
 *
 * @param center 视口中心
 * @param zoom 当前缩放级别（决定半径与数量）
 * @param categories 分类列表；缺省用全部主分类
 * @returns 均匀铺满视口的 POI（合并去重、重要性优先）
 */
export async function searchViewportPOIs(
  center: POILocation,
  zoom: number,
  categories: readonly string[] = POI_CATEGORIES
): Promise<DomainPOI[]> {
  // 半径随 zoom 变化：13 级约 5km，15 级约 2km，17 级约 800m
  const radius = Math.max(800, Math.round(50000 / Math.pow(2, zoom - 10)));
  // 每分类取的数量随 zoom：看全城时每类少取（重要性前），放大时每类多取
  const perCategoryPages = zoom <= 13 ? 1 : zoom <= 15 ? 2 : 3;
  const pageSize = 25;

  // 用 allSettled：单个分类失败不影响整体（首次插件刚就绪时避免整体回退 seed）
  const settled = await Promise.allSettled(
    categories.slice(0, 12).map((category) =>
      searchPOI({ keyword: category, center, radius, pageSize }, perCategoryPages)
    )
  );

  // 合并去重（按 id），保留高德返回顺序（= 重要性排序）；忽略失败项
  const seen = new Set<string>();
  const merged: DomainPOI[] = [];
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    for (const poi of r.value.pois) {
      if (seen.has(poi.id)) continue;
      seen.add(poi.id);
      merged.push(poi);
    }
  }

  // 按评分降序（评分越高越重要），无评分的放后面
  return merged.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
}

/** 根据分类编码返回中文分类名（兼容旧调用） */
export function categoryName(category: string): string {
  return category;
}
