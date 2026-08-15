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
const AMAP_PLUGINS = 'AMap.PlaceSearch';

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
 * 搜索 POI。
 * 有 center 时走周边搜索（around），否则走关键词搜索。
 * 返回值已规范化为 DomainPOI，并附上原始数量用于聚合。
 */
export async function searchPOI(
  params: POISearchParams
): Promise<{ pois: DomainPOI[]; total: number }> {
  const AMap = await loadAMap();

  // 等待 PlaceSearch 插件就绪（带轮询兜底，避免 onload 竞态）
  await waitForPlugin(AMap, 'PlaceSearch');

  return new Promise((resolve) => {
    let placeSearch: any;
    try {
      placeSearch = new AMap.PlaceSearch({
        pageSize: params.pageSize || 20,
        pageIndex: params.page || 1,
        city: params.city || '杭州',
        extensions: 'all', // 返回详情（电话、评分、图片）
      });
    } catch (err) {
      console.warn('[amap-api] PlaceSearch construct failed:', err);
      resolve({ pois: [], total: 0 });
      return;
    }

    const done = (status: string, result: any) => {
      if (status === 'complete' && result?.poiList) {
        const rawList: AMapPOIRecord[] = result.poiList.pois || [];
        const pois = rawList
          .map(normalizeAMapPOI)
          .filter((p): p is DomainPOI => p !== null);
        resolve({ pois, total: result.poiList.count || pois.length });
      } else {
        resolve({ pois: [], total: 0 });
      }
    };

    const fail = () => resolve({ pois: [], total: 0 });

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
    // PlaceSearch v2.0 的事件回调式 API
    placeSearch.on('complete', (e: any) => done('complete', e));
    placeSearch.on('error', fail);
  });
}

/** 根据分类关键词搜索周边 POI（Domain 模式默认加载） */
export async function searchNearbyPOIs(
  center: POILocation,
  category: string,
  radius = 5000
): Promise<{ pois: DomainPOI[]; total: number }> {
  return searchPOI({ keyword: category, center, radius, pageSize: 25 });
}
