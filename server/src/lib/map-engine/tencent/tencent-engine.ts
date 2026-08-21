// ============================================================
// 腾讯地图引擎 — TMap JS API GL 适配(MapEngine 契约完整实现)
//
// 「只配腾讯一家也可用」:key(NEXT_PUBLIC_TENCENT_JSAPI_KEY)就绪后
// load/createView/search 全链路可用;坐标原生 gcj02,零转换。
//
// vendor API 核实依据(官方文档,2026-08-21):
// - 引入脚本:https://map.qq.com/api/gljs?v=1.exp&key=<KEY>[&callback=onTMapScriptLoad]
//   (lbs.qq.com/webApiCenter/glAPI/glAPI — 快速开始;callback 异步加载模式)
// - 地图:new TMap.Map(container, { center, zoom, pitch, rotation, baseMap })
//   TMap.LatLng(lat, lng) —— **纬度在前**(glMap 地图展示)
// - 视图方法:setCenter/getCenter、setZoom/getZoom、setPitch/getPitch、
//   setRotation/getRotation、setBounds(LatLngBounds)、flyTo({center,zoom,duration})、
//   setBaseMap、on/off、addControl(control)、destroy
// - LatLngBounds(sw: LatLng, ne: LatLng);getWest/getSouth/getEast/getNorth
// - Marker:{ position, map, content, offset:{x,y}, zIndex };移除 = setMap(null)
//   (glMarker 标注点;无 remove 方法)
// - Circle:{ center, radius, map, strokeColor, fillColor, fillOpacity }(glCircle)
// - 底图样式:vector=标准、raster=栅格(卫星);暗色 styleType:'dark' 存在但契约
//   MapStyleId 无此项 → 不暴露(glMap 底图)
// - 事件:click/zoom/dragend/idle 等;无原生 moveend/zoomchange/complete →
//   就近映射(见 EVENT_NAME_MAP)
// - 服务:JS API GL 无内置搜索类,POI 搜索/建议/地理编码走配套 WebService API
//   (lbs.qq.com/webApiCenter/webServiceGuide — /ws/place/v1/search、
//   /ws/place/v1/suggestion、/ws/geocoder/v1/;响应 {status:0,...} 成功;
//   坐标同为 gcj02)
// - 定位:GL 核心无定位服务 → 浏览器 Geolocation(WGS84)→ wgs84ToGcj02 换算
//   (coord-utils;境外零偏移)
// ============================================================

import type {
  LngLat,
  MapBounds,
  MapCircle,
  MapCircleOptions,
  MapEngine,
  MapMarker,
  MapMarkerOptions,
  MapSearchProvider,
  MapStyleId,
  MapView,
  MapViewCreateOptions,
  MapViewEvent,
  MapViewState,
  DomainPOI,
  AmapSuggestion,
} from '../types.ts';
import { loadScript } from '../script-loader.ts';
import { wgs84ToGcj02 } from '../coord-utils.ts';

/** 腾讯 JS API GL 脚本地址(官方文档:快速开始) */
const TENCENT_SCRIPT_BASE = 'https://map.qq.com/api/gljs?v=1.exp';
/** 异步加载回调名(loader 回调模式:脚本执行后调用全局回调) */
const TENCENT_SCRIPT_CALLBACK = 'onTMapScriptLoad';
/** 配套 WebService API 基址(搜索/建议/地理编码) */
const TENCENT_WS_BASE = 'https://apis.map.qq.com/ws';
const TENCENT_KEY_VAR = 'NEXT_PUBLIC_TENCENT_JSAPI_KEY';
/** 周边搜索默认半径(米),与 amap-api 的 AMAP_DEFAULT_RADIUS 对齐 */
const TENCENT_DEFAULT_RADIUS = 5000;
/** WebService 单页上限(官方文档 page_size 1-20) */
const TENCENT_PAGE_SIZE_MAX = 20;

function getKey(): string {
  // 裸字面量:Next 构建期只做静态替换,process.env 括号动态访问浏览器端恒 undefined
  return (process.env.NEXT_PUBLIC_TENCENT_JSAPI_KEY ?? '').trim();
}

/** 当前 TMap 命名空间(window 未就绪 / 未加载 → null) */
function getTMapOrNull(): any {
  if (typeof window === 'undefined') return null;
  return (window as unknown as Record<string, any>).TMap ?? null;
}

// ------------------------------------------------------------
// 坐标适配:TMap.LatLng 构造参数纬度在前(lat, lng),契约规范为 {lng, lat}
// ------------------------------------------------------------

function toTMapLatLng(tmap: any, p: LngLat): unknown {
  return new tmap.LatLng(p.lat, p.lng);
}

function fromTMapLatLng(ll: any): LngLat | null {
  if (!ll || typeof ll.lng !== 'number' || typeof ll.lat !== 'number') return null;
  return { lng: ll.lng, lat: ll.lat };
}

// ------------------------------------------------------------
// 底图样式:MapStyleId → TMap baseMap(glMap 底图:vector 标准 / raster 卫星)
// 契约无暗色项;styleType:'dark' 存在但暂不暴露(有需要时经 MapStyleId 扩展)
// ------------------------------------------------------------

function styleToBaseMap(style: MapStyleId): { type: string } {
  return { type: style === 'satellite' ? 'raster' : 'vector' };
}

/** 契约事件 → TMap 事件名(glMap 事件;无 moveend/zoomchange/complete,就近映射) */
const EVENT_NAME_MAP: Record<MapViewEvent, string> = {
  click: 'click',
  zoomchange: 'zoom',
  moveend: 'idle',
  complete: 'idle',
};

// ------------------------------------------------------------
// 视图门面:MapView 契约 → TMap.Map 实例
// ------------------------------------------------------------

class TencentView implements MapView {
  readonly raw: any;
  readonly engine: MapEngine;
  private readonly tmap: any;
  private destroyed = false;

  constructor(tmap: any, raw: any, engine: MapEngine) {
    this.tmap = tmap;
    this.raw = raw;
    this.engine = engine;
  }

  getState(): MapViewState {
    const center = fromTMapLatLng(this.raw.getCenter?.());
    return {
      center: center ?? { lng: 0, lat: 0 },
      zoom: this.raw.getZoom?.() ?? 0,
      pitch: this.raw.getPitch?.() ?? 0,
      rotation: this.raw.getRotation?.() ?? 0,
    };
  }

  getBounds(): MapBounds | null {
    const b = this.raw.getBounds?.();
    if (!b) return null;
    const west = b.getWest?.();
    const south = b.getSouth?.();
    const east = b.getEast?.();
    const north = b.getNorth?.();
    if ([west, south, east, north].every((v) => typeof v === 'number')) {
      return { west, south, east, north };
    }
    return null;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  setCenter(center: LngLat, animateMs?: number): void {
    const ll = toTMapLatLng(this.tmap, center);
    if (animateMs && animateMs > 0) {
      this.raw.flyTo({ center: ll, duration: animateMs });
    } else {
      this.raw.setCenter(ll);
    }
  }

  setZoom(zoom: number, animateMs?: number): void {
    if (animateMs && animateMs > 0) {
      this.raw.flyTo({ zoom, duration: animateMs });
    } else {
      this.raw.setZoom(zoom);
    }
  }

  setPitch(pitch: number): void {
    this.raw.setPitch(pitch);
  }

  setRotation(rotation: number): void {
    this.raw.setRotation(rotation);
  }

  setBounds(bounds: MapBounds): void {
    // LatLngBounds(西南角, 东北角);LatLng 纬度在前
    const sw = new this.tmap.LatLng(bounds.south, bounds.west);
    const ne = new this.tmap.LatLng(bounds.north, bounds.east);
    this.raw.setBounds(new this.tmap.LatLngBounds(sw, ne));
  }

  flyTo(opts: { center: LngLat; zoom?: number }): void {
    const viewport: Record<string, unknown> = {
      center: toTMapLatLng(this.tmap, opts.center),
    };
    if (opts.zoom !== undefined) viewport.zoom = opts.zoom;
    this.raw.flyTo(viewport);
  }

  setStyle(style: MapStyleId): void {
    if (style !== 'normal' && style !== 'satellite') {
      console.warn(`[map-engine] tencent 不支持底图样式 "${style}",回退 normal`);
    }
    this.raw.setBaseMap(styleToBaseMap(style));
  }

  on(event: MapViewEvent, cb: () => void): () => void {
    const vendorEvent = EVENT_NAME_MAP[event] ?? event;
    const handler = () => cb();
    // TMap.on 无返回值;engine-mock 的 on 返回解绑函数 → 直通
    const off = this.raw.on(vendorEvent, handler);
    return typeof off === 'function' ? off : () => this.raw.off(vendorEvent, handler);
  }

  createMarker(opts: MapMarkerOptions): MapMarker {
    const raw = new this.tmap.Marker({
      position: toTMapLatLng(this.tmap, opts.position),
      ...(opts.content !== undefined ? { content: opts.content } : {}),
      // 契约 offset 为 [x, y] 元组 → TMap offset 对象 {x, y}(glMarker 标注偏移)
      ...(opts.offset ? { offset: { x: opts.offset[0], y: opts.offset[1] } } : {}),
      ...(opts.zIndex !== undefined ? { zIndex: opts.zIndex } : {}),
      map: this.raw,
    });
    if (opts.onClick) raw.on('click', opts.onClick);
    return {
      raw,
      setPosition: (p: LngLat) => raw.setPosition(toTMapLatLng(this.tmap, p)),
      setContent: (html: string) => raw.setContent(html),
      // GL Marker 无 remove();官方移除方式为 setMap(null)
      remove: () => raw.setMap(null),
    };
  }

  createCircle(opts: MapCircleOptions): MapCircle {
    const raw = new this.tmap.Circle({
      center: toTMapLatLng(this.tmap, opts.center),
      radius: opts.radius,
      map: this.raw,
      ...(opts.color ? { strokeColor: opts.color, fillColor: opts.color } : {}),
      fillOpacity: 0.2,
    });
    return { raw, remove: () => raw.setMap(null) };
  }

  addControl(kind: 'scale'): void {
    if (kind !== 'scale') return;
    this.raw.addControl(new this.tmap.control.ScaleControl({ position: 'bottomRight' }));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.raw.destroy();
  }
}

// ------------------------------------------------------------
// 搜索服务:JS API GL 无内置搜索 → WebService API(与脚本同 key,控制台
// 需同时勾选 JS API GL + WebServiceAPI 产品)。engine-mock 场景下优先走
// 厂商命名空间内的 search 对象(测试可注入),真实环境回落 WebService。
// 结果归一化为 gcj02 DomainPOI / AmapSuggestion(与 amap-api 对齐)。
// ------------------------------------------------------------

/** 腾讯 WebService POI 记录(只取需要的字段;location 为 {lat, lng}) */
interface TencentPOIRecord {
  id?: string;
  title?: string;
  address?: string;
  category?: string;
  type?: string;
  tel?: string;
  location?: { lat?: number; lng?: number };
  ad_info?: { city?: string; district?: string };
}

/** 坐标合法(lng/lat 有限数字;NaN/Infinity 视为非法记录),收窄为 number */
function isFiniteLngLat(loc: { lng?: unknown; lat?: unknown }): loc is { lng: number; lat: number } {
  return Number.isFinite(loc.lng) && Number.isFinite(loc.lat);
}

/** 腾讯 WebService POI → 规范化 DomainPOI(坐标 gcj02 直通,零转换) */
export function normalizeTencentPOI(raw: TencentPOIRecord): DomainPOI | null {
  const name = raw?.title?.trim();
  const loc = raw?.location;
  if (!name || !loc || !isFiniteLngLat(loc)) return null;
  const category = (raw.category || raw.type || '地点').split(/[;·]/)[0]?.trim() || '地点';
  const tel = (raw.tel ?? '').trim();
  const poi: DomainPOI = {
    // 与 amap-api.suggestionToDomainPoi 同款兜底 id 规则(前缀换 tencent-)
    id: raw.id || `tencent-${loc.lng}-${loc.lat}-${name}`,
    kind: 'domain',
    name,
    mode: 'domain',
    // source 如实标注腾讯引擎归一化(契约 BasePOI.source 已含 'tencent';
    // 与 amap 区分,避免持久化/数据源判定误导)
    source: 'tencent',
    location: { lng: loc.lng, lat: loc.lat, ...(raw.address ? { address: raw.address } : {}) },
    category,
  };
  if (tel) poi.tel = tel;
  return poi;
}

/** 腾讯 WebService 建议项 → AmapSuggestion 形状(与 amap-api fetchSuggestions 对齐) */
export function normalizeTencentSuggestion(raw: TencentPOIRecord): AmapSuggestion | null {
  const name = raw?.title?.trim();
  const loc = raw?.location;
  if (!name || !loc || !isFiniteLngLat(loc)) return null;
  const out: AmapSuggestion = {
    name,
    location: { lng: loc.lng, lat: loc.lat },
  };
  if (raw.id) out.id = raw.id;
  if (raw.category || raw.type) out.type = raw.category || raw.type;
  if (raw.address) out.address = raw.address;
  if (raw.ad_info?.city) out.city = [raw.ad_info.city];
  if (raw.ad_info?.district) out.district = raw.ad_info.district;
  return out;
}

/** 厂商命名空间内 search 服务(engine-mock 提供;真实 GL 无 → 返回 null 走 WebService) */
function vendorSearch<T>(method: string): ((...args: unknown[]) => Promise<T>) | null {
  const svc = getTMapOrNull()?.search;
  return svc && typeof svc[method] === 'function' ? svc[method].bind(svc) : null;
}

async function wsGet(path: string, params: Record<string, string>): Promise<any> {
  const key = getKey();
  if (!key) {
    throw new Error(`[map-engine] tencent 未配置:${TENCENT_KEY_VAR} 缺失`);
  }
  if (typeof fetch !== 'function') {
    throw new Error('[map-engine] tencent WebService 需要浏览器 fetch');
  }
  const query = new URLSearchParams({ ...params, key }).toString();
  const res = await fetch(`${TENCENT_WS_BASE}${path}?${query}`);
  if (!res.ok) {
    throw new Error(`[map-engine] tencent WebService ${path} HTTP ${res.status}`);
  }
  return res.json();
}

/** 失败安全兜底:WebService 调用失败 → 空结果/空数组(不向消费方抛错) */
async function wsSafe<T>(path: string, params: Record<string, string>): Promise<any> {
  try {
    return await wsGet(path, params);
  } catch (err) {
    console.warn(`[map-engine] tencent WebService ${path} 调用失败:`, err);
    return null;
  }
}

/** 关键词搜索(WebService /ws/place/v1/search,boundary=nearby 或 region) */
async function wsSearchPOI(opts: {
  keyword: string;
  city?: string;
  center?: LngLat;
  radius?: number;
  limit?: number;
}): Promise<TencentPOIRecord[]> {
  const boundary = opts.center
    ? `nearby(${opts.center.lat},${opts.center.lng},${opts.radius ?? TENCENT_DEFAULT_RADIUS})`
    : `region(${opts.city ?? '全国'},0)`;
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), TENCENT_PAGE_SIZE_MAX);
  const json = await wsSafe('/place/v1/search', {
    keyword: opts.keyword,
    boundary,
    page_size: String(limit),
  });
  return json?.status === 0 ? (json.data ?? []) : [];
}

/** 关键词建议(WebService /ws/place/v1/suggestion) */
async function wsSuggestions(keyword: string, city?: string): Promise<TencentPOIRecord[]> {
  const params: Record<string, string> = { keyword };
  if (city) params.region = city;
  const json = await wsSafe('/place/v1/suggestion', params);
  return json?.status === 0 ? (json.data ?? []) : [];
}

/** 地理编码(WebService /ws/geocoder/v1/;result.location 即 gcj02) */
async function wsGeocode(address: string, city?: string): Promise<LngLat | null> {
  const params: Record<string, string> = { address };
  if (city) params.region = city;
  const json = await wsSafe('/geocoder/v1/', params);
  const loc = json?.status === 0 ? json?.result?.location : null;
  if (loc && typeof loc.lng === 'number' && typeof loc.lat === 'number') {
    return { lng: loc.lng, lat: loc.lat };
  }
  return null;
}

/** 浏览器定位:Geolocation(WGS84)→ gcj02(coord-utils;境外零偏移) */
function browserPosition(): Promise<LngLat | null> {
  return new Promise((resolve) => {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (!nav?.geolocation) {
      resolve(null);
      return;
    }
    nav.geolocation.getCurrentPosition(
      (pos) => resolve(wgs84ToGcj02(pos.coords.longitude, pos.coords.latitude)),
      () => resolve(null),
      { timeout: 8000, maximumAge: 60000 },
    );
  });
}

const searchProvider: MapSearchProvider = {
  searchPOI: async (opts) => {
    const viaVendor = vendorSearch<TencentPOIRecord[]>('searchPOI');
    const raw = viaVendor ? await viaVendor(opts) : await wsSearchPOI(opts);
    return raw.map(normalizeTencentPOI).filter((p): p is DomainPOI => p !== null);
  },
  fetchSuggestions: async (keyword, city) => {
    const viaVendor = vendorSearch<TencentPOIRecord[]>('fetchSuggestions');
    const raw = viaVendor ? await viaVendor(keyword, city) : await wsSuggestions(keyword, city);
    return raw.map(normalizeTencentSuggestion).filter((s): s is AmapSuggestion => s !== null);
  },
  getCurrentPosition: async () => {
    const viaVendor = vendorSearch<LngLat | null>('getCurrentPosition');
    if (viaVendor) return viaVendor();
    return browserPosition();
  },
  geocodeAddress: async (address, city) => {
    const viaVendor = vendorSearch<LngLat | null>('geocodeAddress');
    if (viaVendor) return viaVendor(address, city);
    return wsGeocode(address, city);
  },
};

// ------------------------------------------------------------
// 引擎单例(与 engine-registry 骨架同名导出;接入注册表由后续轮次统一处理)
// ------------------------------------------------------------

export const TENCENT_ENGINE: MapEngine = {
  id: 'tencent',
  label: '腾讯地图',
  namespace: 'TMap',
  coordSystem: 'gcj02',
  keyVar: TENCENT_KEY_VAR,
  isConfigured: () => getKey().length > 0,
  isLoaded: () => getTMapOrNull() !== null,
  load: async () => {
    const key = getKey();
    if (!key) {
      throw new Error(`[map-engine] tencent 未配置:${TENCENT_KEY_VAR} 缺失`);
    }
    // script-loader 语义:幂等(同 URL 只注入一次)+ 失败清理(移除标签+清缓存,可重试)
    await loadScript({
      url: `${TENCENT_SCRIPT_BASE}&key=${encodeURIComponent(key)}&callback=${TENCENT_SCRIPT_CALLBACK}`,
      globalVar: 'TMap',
      callbackName: TENCENT_SCRIPT_CALLBACK,
    });
  },
  createView: async (opts: MapViewCreateOptions): Promise<MapView> => {
    await TENCENT_ENGINE.load();
    const tmap = getTMapOrNull();
    if (!tmap) {
      throw new Error('[map-engine] tencent 脚本加载后 TMap 命名空间不可用');
    }
    const raw = new tmap.Map(opts.container, {
      center: toTMapLatLng(tmap, opts.center),
      zoom: opts.zoom,
      pitch: opts.pitch ?? 0,
      rotation: opts.rotation ?? 0,
      baseMap: styleToBaseMap(opts.style),
    });
    return new TencentView(tmap, raw, TENCENT_ENGINE);
  },
  search: searchProvider,
};
