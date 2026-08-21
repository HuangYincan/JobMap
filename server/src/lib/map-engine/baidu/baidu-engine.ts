// ============================================================
// 百度地图 GL(BMapGL)引擎 — MapEngine 适配层(ws-e)
//
// 本引擎是全计划唯一坐标分叉点:coordSystem = 'bd09'(百度原生坐标系),
// 适配层在**边界**做 gcj02↔bd09 换算(coord-utils 纯函数),内部一律
// bd09,对外一律 gcj02(规范坐标):
//   - 入参(gcj02)→ bd09:createMarker / createCircle / setCenter /
//     setBounds / flyTo / searchPOI(周边中心)
//   - 出参(bd09)→ gcj02:getState / getBounds / searchPOI 结果 /
//     fetchSuggestions / geocodeAddress / getCurrentPosition
// 漏转症状 ≈ 700m 偏移,测试 map-engine-baidu.test.mjs 必须钉住。
//
// vendor API 命名以官方文档核实为准(核实结论与文档链接见批次汇报
// reports/e.md):
//   - 快速上手(脚本 URL): https://lbs.baidu.com/faq/api?title=webgl/quick-start
//   - API 索引: https://lbs.baidu.com/faq/api?title=webgl/api
// 要点:BMapGL 俯仰 = setTilt(倾斜角 0-45)/旋转 = setHeading(0-360),
// 与 AMap 的 setPitch/setRotation 语义不同 → 适配器内部换算,接口签名
// 保持 types.ts 一致。
// ============================================================

import type {
  AmapSuggestion,
  DomainPOI,
  LngLat,
  MapBounds,
  MapCircle,
  MapCircleOptions,
  MapEngine,
  MapEngineId,
  MapMarker,
  MapMarkerOptions,
  MapSearchProvider,
  MapStyleId,
  MapView,
  MapViewCreateOptions,
  MapViewEvent,
  MapViewState,
} from '../types.ts';
import { bd09ToGcj02, gcj02ToBd09 } from '../coord-utils.ts';
import { loadScript } from '../script-loader.ts';

/** 百度 GL 全局命名空间名(与 engine-registry 描述一致) */
export const BAIDU_NAMESPACE = 'BMapGL';
/** 百度 AK 环境变量名(与 engine-registry 描述一致) */
export const BAIDU_KEY_VAR = 'NEXT_PUBLIC_BAIDU_AK';
/**
 * 官方脚本 URL(快速上手文档):
 * https://api.map.baidu.com/api?v=1.0&type=webgl&ak=<AK>
 * 注:官方亦支持 &callback=<fn> 异步回调参数;本实现用 script-loader 的
 * onload 模式(脚本同步定义 window.BMapGL,onload 即就绪,不依赖厂商回调,
 * 无挂起风险)。
 */
export const BAIDU_SCRIPT_URL = (ak: string): string =>
  `https://api.map.baidu.com/api?v=1.0&type=webgl&ak=${encodeURIComponent(ak)}`;

// ------------------------------------------------------------
// 厂商 API 最小类型面(项目无 @types/bmapgl;按官方文档核实的命名声明,
// 仅覆盖本适配层用到的成员)
// ------------------------------------------------------------

/** BMapGL.Point */
interface BPoint {
  lng: number;
  lat: number;
}

/** BMapGL.Size */
interface BSize {
  width: number;
  height: number;
}

/** BMapGL.Bounds */
interface BBounds {
  getSouthWest(): BPoint;
  getNorthEast(): BPoint;
}

/** BMapGL.Marker(覆盖物子集;方法命名按官方 SDK 核实:setZIndex 大写/show·hide/
 * addEventListener·removeEventListener/setIcon) */
interface BMarker {
  setPosition(point: BPoint): void;
  setContent?(html: string): void;
  setZIndex?(z: number): void;
  show?(): void;
  hide?(): void;
  setIcon?(icon: unknown): void;
  addEventListener?(event: string, cb: () => void): void;
  removeEventListener?(event: string, cb: () => void): void;
  remove?(): void;
}

/** BMapGL.Circle(覆盖物子集) */
interface BCircle {
  setCenter?(center: BPoint): void;
  setRadius?(radius: number): void;
  remove?(): void;
}

/** BMapGL.Map 实例(方法子集,按官方 API 命名) */
interface BMapInstance {
  centerAndZoom(center: BPoint, zoom: number): unknown;
  setCenter(center: BPoint): unknown;
  setZoom(zoom: number): unknown;
  /** 俯仰角(0-45,即 AMap 语义的 pitch) */
  setTilt(tilt: number): unknown;
  /** 旋转角(0-360,即 AMap 语义的 rotation) */
  setHeading(heading: number): unknown;
  panTo(center: BPoint): unknown;
  setBounds(bounds: BBounds): unknown;
  setMapType(mapType: unknown): unknown;
  getCenter(): BPoint;
  getZoom(): number;
  getTilt?(): number;
  getHeading?(): number;
  getBounds?(): BBounds | null;
  getContainer?(): unknown;
  addOverlay?(overlay: unknown): unknown;
  removeOverlay?(overlay: unknown): unknown;
  addControl?(control: unknown): unknown;
  addEventListener?(event: string, cb: () => void): unknown;
  removeEventListener?(event: string, cb: () => void): unknown;
  destroy(): unknown;
}

/** BMapGL.PlaceSearch(服务子集) */
interface BPlaceSearch {
  search(keyword: string): unknown;
  searchNearby(keyword: string, center: BPoint, radius: number): unknown;
}

/** BMapGL.Geocoder(服务子集) */
interface BGeocoder {
  getPoint(address: string, callback: (result: { point?: BPoint } | null) => void, city?: string): unknown;
}

/** BMapGL.Geolocation(服务子集) */
interface BGeolocation {
  getCurrentPosition(callback: (result: { point?: BPoint } | null) => void): unknown;
}

/** BMapGL.Autocomplete(服务子集;官方为输入框 UI 组件,headless 需要 search) */
interface BAutocomplete {
  search(keyword: string): unknown;
}

/** BMapGL 命名空间(全局) */
interface BMapGLNamespace {
  Map: new (container: HTMLElement | string) => BMapInstance;
  Marker: new (point: BPoint, opts?: Record<string, unknown>) => BMarker;
  Circle: new (center: BPoint, radius: number, opts?: Record<string, unknown>) => BCircle;
  Point: new (lng: number, lat: number) => BPoint;
  Size: new (width: number, height: number) => BSize;
  Bounds: new (southWest: BPoint, northEast: BPoint) => BBounds;
  Icon?: new (url: string, size: BSize) => unknown;
  ScaleControl?: new () => unknown;
  PlaceSearch?: new (opts: Record<string, unknown>) => BPlaceSearch;
  Geocoder?: new () => BGeocoder;
  Geolocation?: new () => BGeolocation;
  Autocomplete?: new (opts: Record<string, unknown>) => BAutocomplete;
  [key: string]: unknown;
}

/** 读取全局 BMapGL 命名空间(浏览器 window === globalThis;node 测试装 globalThis) */
export function baiduNamespace(): BMapGLNamespace | undefined {
  return (globalThis as Record<string, unknown>)[BAIDU_NAMESPACE] as BMapGLNamespace | undefined;
}

/** 视图事件 → 厂商事件名(BMapGL 事件集:click/zoomend/moveend/tilesloaded) */
const EVENT_MAP: Record<MapViewEvent, string> = {
  click: 'click',
  zoomchange: 'zoomend',
  moveend: 'moveend',
  complete: 'tilesloaded',
};

/** 底图样式 → BMapGL MapType 常量名(官方:BMAPGL_NORMAL_MAP / BMAPGL_SATELLITE_MAP) */
const STYLE_CONSTANT: Record<'normal' | 'satellite', string> = {
  normal: 'BMAPGL_NORMAL_MAP',
  satellite: 'BMAPGL_SATELLITE_MAP',
};

/** Autocomplete headless 路径超时兜底(ms):厂商静默失败时避免 promise 挂起 */
const AUTOCOMPLETE_TIMEOUT_MS = 5000;

// ------------------------------------------------------------
// 默认控件防御:BMapGL createView 不禁默认控件(zoom 左上 / 版权右下,
// 2026-08-21 ws-4 诊断坐实)。BMapGL 无「构造选项禁用默认控件」形态,
// 默认控件实例也无法经 removeControl 摘除(那是 addControl 自建实例的反向)
// → 防御式 DOM 隐藏。版权 .BMap_cpyCtrl 由 map-shell CSS 隐藏(与 AMap 同款
// 模式);.BMap_scaleCtrl 为引擎 addControl 自建比例尺,不在此列。
// ------------------------------------------------------------

/**
 * BMapGL 默认控件 DOM 防御:创建后隐藏默认 zoom 控件与 3D 指北针。
 * - .BMap_omView:3D 指北针(z-index 1000 量级,盖过 sidebar/topTools 拦截点击)
 * - .BMap_zoomCtrl:默认缩放控件(左上,与 app 自带 zoomControls 重复)
 * 类名以 BMapGL 真实 DOM 核实为准,宽泛子串选择器防御多版本差异;
 * 有/无 getContainer/querySelectorAll 都不抛(控件缺失/异常形态静默跳过)。
 */
function hideBaiduDefaultControls(map: BMapInstance): void {
  const container = map.getContainer?.();
  if (!container || typeof (container as { querySelectorAll?: unknown }).querySelectorAll !== 'function') {
    return;
  }
  try {
    const nodes = (container as { querySelectorAll(sel: string): unknown }).querySelectorAll(
      '[class*="BMap_omView"], [class*="BMap_zoomCtrl"]',
    ) as Array<{ style: Record<string, string> }>;
    for (const el of nodes) {
      el.style.display = 'none';
      el.style.pointerEvents = 'none';
    }
  } catch {
    // DOM 探测失败静默:不影响主流程(防御式,不抛)
  }
}

/**
 * 解析厂商常量(BMAPGL_*):BMapGL 脚本以全局常量暴露(示例代码裸用
 * BMAPGL_NORMAL_MAP);命名空间上也可能存在 → 两处都找。
 */
function resolveGlobalConstant(name: string): unknown {
  const ns = baiduNamespace();
  if (ns && ns[name] !== undefined) return ns[name];
  return (globalThis as Record<string, unknown>)[name];
}

/** 样式 → setMapType;不支持的样式(whitesmoke 等)回退 normal + console.warn */
function applyMapStyle(map: BMapInstance, style: MapStyleId): void {
  if (style === 'normal' || style === 'satellite') {
    const constant = resolveGlobalConstant(STYLE_CONSTANT[style]);
    if (constant !== undefined) map.setMapType(constant);
    return;
  }
  console.warn(`[map-engine] baidu 不支持底图样式 ${style},回退 normal`);
  const normalConstant = resolveGlobalConstant(STYLE_CONSTANT.normal);
  if (normalConstant !== undefined) map.setMapType(normalConstant);
}

// ------------------------------------------------------------
// MapView — 百度地图实例的门面包装
// ------------------------------------------------------------

class BaiduMapView implements MapView {
  /** 厂商地图实例逃生舱 */
  readonly raw: unknown;
  readonly engine: MapEngine;
  private readonly map: BMapInstance;
  private readonly ns: BMapGLNamespace;
  private destroyed = false;

  // 注:不用 TS 参数属性(node 测试 strip-only 模式不支持,ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX)
  constructor(map: BMapInstance, ns: BMapGLNamespace, engine: MapEngine) {
    this.map = map;
    this.ns = ns;
    this.raw = map;
    this.engine = engine;
  }

  getState(): MapViewState {
    const map = this.map;
    const center = map.getCenter();
    const g = bd09ToGcj02(center.lng, center.lat);
    return {
      center: { lng: g.lng, lat: g.lat },
      zoom: map.getZoom(),
      pitch: map.getTilt?.() ?? 0,
      rotation: map.getHeading?.() ?? 0,
    };
  }

  getBounds(): MapBounds | null {
    const raw = this.map.getBounds?.() ?? null;
    if (!raw) return null;
    const sw = raw.getSouthWest();
    const ne = raw.getNorthEast();
    const swG = bd09ToGcj02(sw.lng, sw.lat);
    const neG = bd09ToGcj02(ne.lng, ne.lat);
    return { west: swG.lng, south: swG.lat, east: neG.lng, north: neG.lat };
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  setCenter(center: LngLat, animateMs?: number): void {
    const bd = gcj02ToBd09(center.lng, center.lat);
    const point = new this.ns.Point(bd.lng, bd.lat);
    if (animateMs && animateMs > 0) this.map.panTo(point); // BMapGL panTo 自带平移动画
    else this.map.setCenter(point);
  }

  setZoom(zoom: number, _animateMs?: number): void {
    this.map.setZoom(zoom); // BMapGL setZoom 无动画参数
  }

  setPitch(pitch: number, _animateMs?: number): void {
    // BMapGL 俯仰 = setTilt(倾斜角 0-45,官方文档范围);AMap 语义 pitch 可到
    // ~83 → 适配层把 pitch 语义钳制到 BMapGL 文档范围,防越界被厂商忽略/抛错
    this.map.setTilt(Math.min(45, Math.max(0, pitch)));
  }

  setRotation(rotation: number, _animateMs?: number): void {
    // BMapGL 旋转 = setHeading(朝向角 0-360);归一化到 [0,360) 防负值/超圈
    this.map.setHeading(((rotation % 360) + 360) % 360);
  }

  setBounds(bounds: MapBounds): void {
    const sw = gcj02ToBd09(bounds.west, bounds.south);
    const ne = gcj02ToBd09(bounds.east, bounds.north);
    this.map.setBounds(
      new this.ns.Bounds(new this.ns.Point(sw.lng, sw.lat), new this.ns.Point(ne.lng, ne.lat)),
    );
  }

  flyTo(opts: { center: LngLat; zoom?: number }): void {
    const bd = gcj02ToBd09(opts.center.lng, opts.center.lat);
    this.map.panTo(new this.ns.Point(bd.lng, bd.lat));
    if (opts.zoom !== undefined) this.map.setZoom(opts.zoom);
  }

  setStyle(style: MapStyleId): void {
    applyMapStyle(this.map, style);
  }

  on(event: MapViewEvent, cb: () => void): () => void {
    const vendorEvent = EVENT_MAP[event] ?? event;
    const map = this.map;
    // bind 保 this + 局部函数变量让 typeof 收窄在返回闭包内依然有效
    const addEventListener = map.addEventListener?.bind(map);
    const removeEventListener = map.removeEventListener?.bind(map);
    if (typeof addEventListener === 'function' && typeof removeEventListener === 'function') {
      const handler = () => cb();
      addEventListener(vendorEvent, handler);
      return () => removeEventListener(vendorEvent, handler);
    }
    // duck-typed 视图兜底(测试 mock 等):on(event, cb) → 返回解绑
    const off = (
      map as unknown as { on?: (e: string, c: () => void) => (() => void) | undefined }
    ).on?.(vendorEvent, cb);
    return off ?? (() => {});
  }

  createMarker(opts: MapMarkerOptions): MapMarker {
    const bd = gcj02ToBd09(opts.position.lng, opts.position.lat);
    const markerOpts: Record<string, unknown> = {};
    if (opts.offset) markerOpts.offset = new this.ns.Size(opts.offset[0], opts.offset[1]);
    if (opts.zIndex !== undefined) markerOpts.zIndex = opts.zIndex;
    const raw = new this.ns.Marker(new this.ns.Point(bd.lng, bd.lat), markerOpts);
    if (opts.content !== undefined) raw.setContent?.(opts.content);
    if (opts.onClick) raw.addEventListener?.('click', opts.onClick);
    // icon 规格(契约)→ BMapGL.Icon(官方构造:new BMapGL.Icon(url, size, opts?);
    // size 为必传第二参 → 缺省兜底 BMapGL 默认 marker 尺寸 21x21)
    if (opts.icon) {
      if (typeof raw.setIcon === 'function' && typeof this.ns.Icon === 'function') {
        const [w, h] = opts.icon.size ?? [21, 21];
        try {
          raw.setIcon(new this.ns.Icon(opts.icon.src, new this.ns.Size(w, h)));
        } catch (err) {
          console.warn('[map-engine] BMapGL Icon 构造失败,图标降级', err);
        }
      } else {
        console.warn('[map-engine] BMapGL Icon/setIcon 不可用,图标降级');
      }
    }
    this.map.addOverlay?.(raw); // BMapGL 覆盖物需 addOverlay 上地图
    return {
      raw,
      setPosition: (p: LngLat) => {
        const next = gcj02ToBd09(p.lng, p.lat);
        raw.setPosition(new this.ns.Point(next.lng, next.lat));
      },
      setContent: (html: string) => raw.setContent?.(html),
      // BMapGL 官方大写 setZIndex(与 AMap 小写 setzIndex 的差异在适配层吸收)
      setZIndex: (z: number) => {
        if (typeof raw.setZIndex === 'function') raw.setZIndex(z);
        else console.warn('[map-engine] BMapGL Marker 无 setZIndex,忽略 zIndex');
      },
      // BMapGL 官方 show()/hide()
      setVisible: (v: boolean) => {
        if (v) {
          if (typeof raw.show === 'function') raw.show();
          else console.warn('[map-engine] BMapGL Marker 无 show,忽略可见性');
        } else if (typeof raw.hide === 'function') {
          raw.hide();
        } else {
          console.warn('[map-engine] BMapGL Marker 无 hide,忽略可见性');
        }
      },
      // BMapGL 事件 = addEventListener/removeEventListener(官方;无 on/off)
      on: (event: 'click', cb: () => void) => {
        if (event !== 'click') return;
        if (typeof raw.addEventListener === 'function') raw.addEventListener('click', cb);
        else console.warn('[map-engine] BMapGL Marker 无 addEventListener,忽略事件注册');
      },
      off: (event: 'click', cb?: () => void) => {
        if (event !== 'click') return;
        if (typeof raw.removeEventListener !== 'function') {
          console.warn('[map-engine] BMapGL Marker 无 removeEventListener,忽略解绑');
          return;
        }
        if (cb) raw.removeEventListener('click', cb);
        // cb 缺省:BMapGL 无「按事件清空」形态 → 保留(调用方应传 cb 精确解绑)
      },
      remove: () => {
        this.map.removeOverlay?.(raw);
        raw.remove?.();
      },
    };
  }

  createCircle(opts: MapCircleOptions): MapCircle {
    const bd = gcj02ToBd09(opts.center.lng, opts.center.lat);
    // 视觉语义对齐 map-shell 现有 AMap Circle(stroke 实色 / fill 低透明)
    const raw = new this.ns.Circle(new this.ns.Point(bd.lng, bd.lat), opts.radius, {
      strokeColor: opts.color,
      strokeOpacity: 0.85,
      strokeWeight: 2,
      fillColor: opts.color,
      fillOpacity: 0.08,
    });
    this.map.addOverlay?.(raw);
    return {
      raw,
      remove: () => {
        this.map.removeOverlay?.(raw);
        raw.remove?.();
      },
    };
  }

  addControl(kind: 'scale'): void {
    if (kind !== 'scale') return;
    const Ctor = this.ns.ScaleControl;
    if (Ctor) this.map.addControl?.(new Ctor());
  }

  destroy(): void {
    this.destroyed = true;
    this.map.destroy();
  }
}

// ------------------------------------------------------------
// 搜索结果归一化(BMapGL Poi → 规范 DomainPOI / AmapSuggestion)
// ------------------------------------------------------------

interface BPlaceResult {
  getCurrentNumPois(): number;
  getPoi(index: number): unknown;
}

interface BPlacePoi {
  title?: unknown;
  point?: BPoint;
  address?: unknown;
  area?: unknown;
  tags?: unknown;
  type?: unknown;
  uid?: unknown;
}

/** BMapGL Poi → DomainPOI(规范化,坐标 bd09 → gcj02) */
function toDomainPoi(poi: unknown): DomainPOI | null {
  if (!poi || typeof poi !== 'object') return null;
  const p = poi as BPlacePoi;
  const name = typeof p.title === 'string' ? p.title.trim() : '';
  const pt = p.point;
  if (!name || !pt || typeof pt.lng !== 'number' || typeof pt.lat !== 'number') return null;
  const g = bd09ToGcj02(pt.lng, pt.lat);
  const address = typeof p.address === 'string' ? p.address : undefined;
  const category =
    typeof p.tags === 'string'
      ? (p.tags.split(/[;·]/)[0]?.trim() ?? '')
      : typeof p.type === 'string'
        ? p.type
        : '';
  const id =
    typeof p.uid === 'string' && p.uid
      ? `baidu-${p.uid}`
      : `baidu-${g.lng}-${g.lat}-${name}`;
  return {
    id,
    kind: 'domain',
    name,
    mode: 'domain',
    // source 如实标注百度引擎归一化(契约 BasePOI.source 已含 'baidu';
    // 与 amap 区分,避免持久化/数据源判定误导)
    source: 'baidu',
    location: { lng: g.lng, lat: g.lat, address },
    category: category || '地点',
  };
}

/** 收集 PlaceSearch 结果(失败/空 → []) */
function collectPois(result: unknown, limit: number): DomainPOI[] {
  if (!result || typeof (result as BPlaceResult).getCurrentNumPois !== 'function') return [];
  const r = result as BPlaceResult;
  const count = r.getCurrentNumPois();
  if (count === 0) return [];
  const pois: DomainPOI[] = [];
  for (let i = 0; i < Math.min(count, limit); i++) {
    const poi = toDomainPoi(r.getPoi(i));
    if (poi) pois.push(poi);
  }
  return pois;
}

/** DomainPOI → AmapSuggestion(建议列表形状对齐 amap-api) */
function toSuggestion(poi: DomainPOI): AmapSuggestion {
  const s: AmapSuggestion = {
    name: poi.name,
    location: { lng: poi.location.lng, lat: poi.location.lat },
    address: poi.location.address,
  };
  if (poi.category) s.type = poi.category;
  return s;
}

/** Autocomplete 结果 → AmapSuggestion(值/坐标均可选,防御式解析) */
function toSuggestionsFromAutocomplete(result: unknown): AmapSuggestion[] {
  if (!result) return [];
  const r = result as { getValues?: () => unknown[] };
  const items = typeof r.getValues === 'function' ? (r.getValues() ?? []) : Array.isArray(result) ? result : [];
  const out: AmapSuggestion[] = [];
  for (const item of items.slice(0, 10)) {
    const it = item as {
      value?: unknown;
      name?: unknown;
      city?: unknown;
      district?: unknown;
      point?: unknown;
      location?: unknown;
    };
    const name = typeof it.value === 'string' ? it.value : typeof it.name === 'string' ? it.name : '';
    if (!name) continue;
    const s: AmapSuggestion = { name };
    const pt = it.point ?? it.location;
    if (pt && typeof (pt as BPoint).lng === 'number' && typeof (pt as BPoint).lat === 'number') {
      const g = bd09ToGcj02((pt as BPoint).lng, (pt as BPoint).lat);
      s.location = { lng: g.lng, lat: g.lat };
    } else if (typeof it.location === 'string' && it.location.includes(',')) {
      const [lngStr, latStr] = it.location.split(',');
      const lng = parseFloat(lngStr);
      const lat = parseFloat(latStr);
      if (!Number.isNaN(lng) && !Number.isNaN(lat)) s.location = { lng, lat };
    }
    if (typeof it.city === 'string') s.city = [it.city];
    if (typeof it.district === 'string') s.district = it.district;
    out.push(s);
  }
  return out;
}

// ------------------------------------------------------------
// MapSearchProvider — BMapGL 官方服务适配
// ------------------------------------------------------------

class BaiduSearchProvider implements MapSearchProvider {
  private readonly engine: BaiduEngine;

  // 注:不用 TS 参数属性(node 测试 strip-only 模式不支持)
  constructor(engine: BaiduEngine) {
    this.engine = engine;
  }

  /** 命名空间缺失时返回 undefined(调用方回退安全值,绝不同步抛错) */
  private ns(): BMapGLNamespace | undefined {
    return baiduNamespace();
  }

  searchPOI(opts: {
    keyword: string;
    city?: string;
    center?: LngLat;
    radius?: number;
    limit?: number;
  }): Promise<DomainPOI[]> {
    const ns = this.ns();
    if (!ns) return Promise.resolve([]);
    const keyword = opts.keyword?.trim();
    if (!keyword) return Promise.resolve([]);
    const limit = opts.limit && opts.limit > 0 ? opts.limit : 10;
    return new Promise((resolve) => {
      const PlaceSearch = ns.PlaceSearch;
      if (!PlaceSearch) {
        resolve([]);
        return;
      }
      try {
        // location = 检索区域(官方 PlaceSearch 构造选项,城市名/地图/坐标点);
        // 未提供 city 时不设,由厂商默认区域(全国)检索
        const placeOpts: Record<string, unknown> = {
          pageCapacity: limit,
          onSearchComplete: (result: unknown) => resolve(collectPois(result, limit)),
        };
        if (opts.city?.trim()) placeOpts.location = opts.city.trim();
        const place = new PlaceSearch(placeOpts);
        if (opts.center && opts.radius) {
          // 周边检索中心点 bd09 转换(漏转 ≈700m 偏移)
          const bd = gcj02ToBd09(opts.center.lng, opts.center.lat);
          place.searchNearby(keyword, new ns.Point(bd.lng, bd.lat), opts.radius);
        } else {
          place.search(keyword);
        }
      } catch {
        resolve([]);
      }
    });
  }

  fetchSuggestions(keyword: string, city?: string): Promise<AmapSuggestion[]> {
    const ns = this.ns();
    if (!ns) return Promise.resolve([]);
    const clean = keyword?.trim();
    if (!clean) return Promise.resolve([]);
    // BMapGL.Autocomplete 官方是输入框 UI 组件(需 input 元素绑定);若暴露
    // 编程式 search 则优先(headless 可用),否则回退 PlaceSearch 顶部结果。
    const autoCtor = ns.Autocomplete;
    const hasHeadlessSearch =
      typeof autoCtor === 'function' &&
      typeof (autoCtor as unknown as { prototype?: { search?: unknown } }).prototype?.search ===
        'function';
    if (hasHeadlessSearch) {
      return new Promise((resolve) => {
        // Autocomplete 官方是输入框 UI 组件(需 input 元素绑定),headless 构造可能
        // 静默失败而不回调 → 超时兜底,防止消费方 promise 永久挂起
        const timer = setTimeout(() => resolve([]), AUTOCOMPLETE_TIMEOUT_MS);
        try {
          const auto = new (autoCtor as new (opts: Record<string, unknown>) => BAutocomplete)({
            location: city ?? '全国',
            onSearchComplete: (result: unknown) => {
              clearTimeout(timer);
              resolve(toSuggestionsFromAutocomplete(result));
            },
          });
          auto.search(clean);
        } catch {
          clearTimeout(timer);
          resolve([]);
        }
      });
    }
    return this.searchPOI({ keyword: clean, city, limit: 10 }).then((pois) => pois.map(toSuggestion));
  }

  getCurrentPosition(): Promise<LngLat | null> {
    const ns = this.ns();
    if (!ns) return Promise.resolve(null);
    return new Promise((resolve) => {
      const Geolocation = ns.Geolocation;
      if (!Geolocation) {
        resolve(null);
        return;
      }
      try {
        const geo = new Geolocation();
        geo.getCurrentPosition((result) => {
          const pt = result?.point;
          if (pt && typeof pt.lng === 'number' && typeof pt.lat === 'number') {
            const g = bd09ToGcj02(pt.lng, pt.lat);
            resolve({ lng: g.lng, lat: g.lat });
          } else {
            resolve(null);
          }
        });
      } catch {
        resolve(null);
      }
    });
  }

  geocodeAddress(address: string, city?: string): Promise<LngLat | null> {
    const ns = this.ns();
    if (!ns) return Promise.resolve(null);
    const clean = address?.trim();
    if (!clean) return Promise.resolve(null);
    return new Promise((resolve) => {
      const Geocoder = ns.Geocoder;
      if (!Geocoder) {
        resolve(null);
        return;
      }
      try {
        const geocoder = new Geocoder();
        geocoder.getPoint(
          clean,
          (result) => {
            const pt = result?.point;
            if (pt && typeof pt.lng === 'number' && typeof pt.lat === 'number') {
              const g = bd09ToGcj02(pt.lng, pt.lat);
              resolve({ lng: g.lng, lat: g.lat });
            } else {
              resolve(null);
            }
          },
          city,
        );
      } catch {
        resolve(null);
      }
    });
  }
}

// ------------------------------------------------------------
// MapEngine — 百度引擎本体
// ------------------------------------------------------------

class BaiduEngine implements MapEngine {
  readonly id: MapEngineId = 'baidu';
  readonly label = '百度地图';
  readonly namespace = 'BMapGL';
  readonly coordSystem: 'gcj02' | 'bd09' = 'bd09';
  readonly keyVar = 'NEXT_PUBLIC_BAIDU_AK' as const;
  readonly search: MapSearchProvider;

  constructor() {
    this.search = new BaiduSearchProvider(this);
  }

  isConfigured(): boolean {
    // 裸字面量:Next 构建期只做静态替换,process.env 括号动态访问浏览器端恒 undefined
    return Boolean(process.env.NEXT_PUBLIC_BAIDU_AK?.trim());
  }

  isLoaded(): boolean {
    return baiduNamespace() !== undefined;
  }

  async load(): Promise<void> {
    if (this.isLoaded()) return;
    const ak = process.env.NEXT_PUBLIC_BAIDU_AK?.trim();
    if (!ak) {
      throw new Error(`[map-engine] baidu 未配置 ${BAIDU_KEY_VAR}`);
    }
    await loadScript({ url: BAIDU_SCRIPT_URL(ak), globalVar: BAIDU_NAMESPACE });
    if (!this.isLoaded()) {
      throw new Error('[map-engine] BMapGL 脚本加载完成但命名空间未就绪');
    }
  }

  async createView(opts: MapViewCreateOptions): Promise<MapView> {
    const ns = baiduNamespace();
    if (!ns) {
      throw new Error('[map-engine] baidu BMapGL 未就绪:先调用 load()');
    }
    const map = new ns.Map(opts.container);
    // 默认控件 DOM 防御(BMapGL 同步建 DOM,构造后立即隐藏 zoom/指北针;
    // 版权由 map-shell CSS 隐藏;有/无控件 API 均不抛)
    hideBaiduDefaultControls(map);
    // 初始中心点 bd09 转换(漏转 ≈700m 偏移)
    const c = gcj02ToBd09(opts.center.lng, opts.center.lat);
    map.centerAndZoom(new ns.Point(c.lng, c.lat), opts.zoom);
    if (opts.pitch) map.setTilt(opts.pitch);
    if (opts.rotation) map.setHeading(opts.rotation);
    const view = new BaiduMapView(map, ns, this);
    view.setStyle(opts.style);
    return view;
  }
}

/** 新建百度引擎实例(测试用;每次新实例,互不共享状态) */
export function createBaiduEngine(): MapEngine {
  return new BaiduEngine();
}

/** 百度引擎单例(merger 接线 engine-registry 时替换骨架用) */
export const BAIDU_MAP_ENGINE: MapEngine = createBaiduEngine();
