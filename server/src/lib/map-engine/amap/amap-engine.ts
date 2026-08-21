// ============================================================
// AMap(高德)引擎实现 — ws-c
//
// 把 map-shell 对 `window.AMap` 的直连迁移到 MapEngine/MapView 契约:
// - load():复用 amap-api.loadAMap(同一 SCRIPT_ID 与 securityJsCode 流程,不双脚本);
// - createView():迁移 map-shell 旧构造参数(viewMode:'3D'/pitch/showLabel/
//   mapStyle/rotateEnable:false),style 映射:normal→'amap://styles/normal'、
//   whitesmoke→'amap://styles/whitesmoke'、satellite→AMap.TileLayer.Satellite;
// - search:转发 amap-api 现有 searchPOI/fetchSuggestions/getCurrentPosition/
//   geocodeAddress(行为零改动,仅输出形态适配契约);
// - 视图方法:setCenter/setZoom/setPitch/setRotation(animateMs→AMap 动画参数)/
//   setBounds(内部构造 AMap.Bounds)/flyTo(setZoomAndCenter 同款)/
//   on(注册返回解绑)/createMarker(offset 元组→AMap.Pixel)/createCircle/
//   addControl('scale'→AMap.Scale,位置/偏移 duck-type 透传)/destroy。
//
// 注册方式:本模块被引用(use-map-engine 副作用 import)即把完整实现装配进
// engine-registry 的骨架对象(engine-registry 保持厂商无关,不反向依赖本模块)。
// ============================================================

import {
  fetchSuggestions as amapFetchSuggestions,
  geocodeAddress as amapGeocodeAddress,
  getCurrentPosition as amapGetCurrentPosition,
  loadAMap,
  searchPOI as amapSearchPOI,
} from '../../amap-api.ts';
import type { DomainPOI } from '../../types.ts';
import { AMAP_ENGINE } from '../engine-registry.ts';
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
} from '../types.ts';

/** style 映射表(契约 MapStyleId → AMap mapStyle;satellite 由瓦片层承载) */
const STYLE_URL: Record<Exclude<MapStyleId, 'satellite'>, string> = {
  normal: 'amap://styles/normal',
  whitesmoke: 'amap://styles/whitesmoke',
};

/** 比例尺控件选项(AMap 专属,契约 addControl 只保证 kind;调用方 duck-type 传入) */
interface ScaleControlOptions {
  position?: string;
  offset?: [number, number];
}

/** 经 view.createMarker duck-type 透传的 AMap 专属 marker 选项(契约 MapMarkerOptions 未含) */
type MarkerExtras = { cursor?: string; bubble?: boolean };

// ---------------------------------------------------------------------------
// 视图实现
// ---------------------------------------------------------------------------

class AmapView implements MapView {
  readonly raw: unknown;
  readonly engine: MapEngine;

  private AMap: any;
  private map: any;
  private currentStyle: MapStyleId;
  private satelliteLayer: any = null;
  private destroyedFlag = false;
  /** 比例尺控件(移除重建路径) */
  private scaleControl: any = null;
  private scaleWaiters: Array<(control: any) => void> = [];
  private scaleEnsuring = false;
  private scaleOpts: ScaleControlOptions = {};

  constructor(AMap: any, map: any, style: MapStyleId, engine: MapEngine) {
    this.AMap = AMap;
    this.map = map;
    this.raw = map;
    this.engine = engine;
    this.currentStyle = style;
    if (style === 'satellite') this.ensureSatelliteLayer();
  }

  getState(): MapViewState {
    const c = this.map.getCenter();
    return {
      center: { lng: c.getLng(), lat: c.getLat() },
      zoom: this.map.getZoom(),
      pitch: this.map.getPitch(),
      rotation: this.map.getRotation(),
    };
  }

  getBounds(): MapBounds | null {
    const b = typeof this.map.getBounds === 'function' ? this.map.getBounds() : null;
    if (!b) return null;
    const sw = b.getSouthWest?.() ?? b.southwest;
    const ne = b.getNorthEast?.() ?? b.northeast;
    const west = sw?.getLng?.() ?? sw?.lng;
    const south = sw?.getLat?.() ?? sw?.lat;
    const east = ne?.getLng?.() ?? ne?.lng;
    const north = ne?.getLat?.() ?? ne?.lat;
    if ([west, south, east, north].every((n) => typeof n === 'number')) {
      return { west, south, east, north };
    }
    return null;
  }

  isDestroyed(): boolean {
    return this.destroyedFlag || (typeof this.map.isDestroyed === 'function' && this.map.isDestroyed());
  }

  setCenter(center: LngLat, animateMs?: number): void {
    if (animateMs === undefined) this.map.setCenter([center.lng, center.lat]);
    else this.map.setCenter([center.lng, center.lat], false, animateMs);
  }

  setZoom(zoom: number, animateMs?: number): void {
    if (animateMs === undefined) this.map.setZoom(zoom);
    else this.map.setZoom(zoom, false, animateMs);
  }

  setPitch(pitch: number, animateMs?: number): void {
    if (animateMs === undefined) this.map.setPitch(pitch);
    else this.map.setPitch(pitch, false, animateMs);
  }

  setRotation(rotation: number, animateMs?: number): void {
    if (animateMs === undefined) this.map.setRotation(rotation);
    else this.map.setRotation(rotation, false, animateMs);
  }

  setBounds(bounds: MapBounds): void {
    // 内部构造厂商 Bounds(与旧 map-shell `new AMap.Bounds(...)` 同语义)
    this.map.setBounds(new this.AMap.Bounds([bounds.west, bounds.south], [bounds.east, bounds.north]));
  }

  flyTo(opts: { center: LngLat; zoom?: number }): void {
    if (opts.zoom !== undefined) {
      try {
        // 与旧 flyToLocation 同款:setZoomAndCenter(zoom, [lng, lat], false, 600)
        this.map.setZoomAndCenter(opts.zoom, [opts.center.lng, opts.center.lat], false, 600);
        return;
      } catch {
        // 老版本 API 缺失:退化为 setZoom + setCenter(旧代码同款兜底)
      }
      this.map.setZoom(opts.zoom);
      this.map.setCenter([opts.center.lng, opts.center.lat]);
      return;
    }
    this.map.setCenter([opts.center.lng, opts.center.lat]);
  }

  /** 不支持的地图样式 → 回退 normal + console.warn(契约语义;AMap 三样式全支持) */
  setStyle(style: MapStyleId): void {
    if (style === 'satellite') {
      // 卫星:normal 底图 + Satellite 瓦片层(沿用旧用法 new AMap.TileLayer.Satellite({ map }))
      this.map.setMapStyle(STYLE_URL.normal);
      this.ensureSatelliteLayer();
      this.satelliteLayer?.show();
    } else {
      this.satelliteLayer?.hide();
      this.map.setMapStyle(STYLE_URL[style]);
    }
    this.currentStyle = style;
  }

  private ensureSatelliteLayer(): void {
    if (this.satelliteLayer) return;
    if (!this.AMap?.TileLayer?.Satellite) return; // 卫星瓦片未就绪:仅回退 normal 底图
    try {
      this.satelliteLayer = new this.AMap.TileLayer.Satellite({ map: this.map });
    } catch {
      this.satelliteLayer = null;
    }
  }

  /** 注册事件;返回解绑函数。运行时转发任意厂商事件(契约联合之外的事件由调用方经 any 收口) */
  on(event: MapViewEvent | string, cb: () => void): () => void {
    this.map.on(event, cb);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      this.map.off(event, cb);
    };
  }

  createMarker(opts: MapMarkerOptions): MapMarker {
    const markerOpts: Record<string, unknown> = {
      position: [opts.position.lng, opts.position.lat],
      map: this.map,
    };
    if (opts.content !== undefined) markerOpts.content = opts.content;
    if (opts.offset) markerOpts.offset = new this.AMap.Pixel(opts.offset[0], opts.offset[1]);
    if (opts.zIndex !== undefined) markerOpts.zIndex = opts.zIndex;
    // AMap 专属扩展选项(cursor/bubble 等,契约未含):duck-type 透传,行为保真
    const extras = opts as unknown as MarkerExtras;
    if (extras.cursor !== undefined) markerOpts.cursor = extras.cursor;
    if (extras.bubble !== undefined) markerOpts.bubble = extras.bubble;

    const marker = new this.AMap.Marker(markerOpts);
    if (typeof opts.onClick === 'function') {
      marker.on('click', () => opts.onClick?.());
    }
    // icon 规格(契约)→ AMap.Icon(官方:new AMap.Icon({ size, image, imageSize });
    // size = 显示尺寸,imageSize = 图片实际尺寸;data URI SVG 两者一致,与旧 buildIcon 同款)
    if (opts.icon && typeof marker.setIcon === 'function') {
      if (typeof this.AMap.Icon === 'function') {
        const iconOpts: Record<string, unknown> = { image: opts.icon.src };
        if (opts.icon.size) {
          const [w, h] = opts.icon.size;
          const size = new this.AMap.Size(w, h);
          iconOpts.size = size;
          iconOpts.imageSize = size;
        }
        try {
          marker.setIcon(new this.AMap.Icon(iconOpts));
        } catch (err) {
          console.warn('[map-engine] AMap Icon 构造失败,图标降级', err);
        }
      } else {
        console.warn('[map-engine] AMap.Icon 不可用,图标降级');
      }
    }
    return {
      raw: marker,
      setPosition: (p: LngLat) => {
        marker.setPosition([p.lng, p.lat]);
      },
      setContent: (html: string) => {
        marker.setContent(html);
      },
      // 统一大小写语义:AMap 官方小写 setzIndex(适配层兜住大写契约)
      setZIndex: (z: number) => {
        if (typeof marker.setzIndex === 'function') marker.setzIndex(z);
        else console.warn('[map-engine] AMap Marker 无 setzIndex,忽略 zIndex');
      },
      // 统一可见性:AMap 官方 show()/hide();老 SDK 缺失时回退 setVisible
      setVisible: (v: boolean) => {
        if (v) {
          if (typeof marker.show === 'function') {
            marker.show();
            return;
          }
        } else if (typeof marker.hide === 'function') {
          marker.hide();
          return;
        }
        if (typeof marker.setVisible === 'function') marker.setVisible(v);
        else console.warn('[map-engine] AMap Marker 无 show/hide,忽略可见性');
      },
      on: (event: 'click', cb: () => void) => {
        if (event !== 'click') return;
        if (typeof marker.on === 'function') marker.on('click', cb);
        else console.warn('[map-engine] AMap Marker 无 on,忽略事件注册');
      },
      off: (event: 'click', cb?: () => void) => {
        if (event !== 'click') return;
        if (typeof marker.off !== 'function') {
          console.warn('[map-engine] AMap Marker 无 off,忽略解绑');
          return;
        }
        if (cb) marker.off('click', cb);
        // cb 缺省:AMap off 无「按事件清空」形态 → 保留(调用方应传 cb 精确解绑)
      },
      remove: () => {
        try {
          marker.setMap(null);
        } catch {
          // 地图已销毁等场景:忽略
        }
      },
    };
  }

  /** 距离圈(L1067 同款参数:strokeColor/strokeOpacity/strokeWeight/fillColor/fillOpacity/bubble/zIndex) */
  createCircle(opts: MapCircleOptions): MapCircle {
    const circle = new this.AMap.Circle({
      center: [opts.center.lng, opts.center.lat],
      radius: opts.radius,
      strokeColor: opts.color ?? '#007AFF',
      strokeOpacity: 0.85,
      strokeWeight: 2,
      fillColor: opts.color ?? '#007AFF',
      fillOpacity: 0.08,
      bubble: true,
      zIndex: 20,
    });
    this.map.add(circle);
    return {
      raw: circle,
      remove: () => {
        try {
          circle.setMap(null);
        } catch {
          // 地图已销毁等场景:忽略
        }
      },
    };
  }

  /**
   * 比例尺控件。位置/偏移是 AMap 专属选项(契约只保证 kind),调用方 duck-type
   * 传入;重复调用 = 摘除旧控件按新参数重建(断点/尺寸变化重放路径)。
   * 返回 Promise:AMap.Scale 是插件,就绪后 resolve 原始控件(失败 resolve null)。
   */
  addControl(kind: 'scale', opts?: ScaleControlOptions): Promise<unknown> | null {
    if (kind !== 'scale' || this.destroyedFlag) return null;
    this.scaleOpts = opts ?? {};
    if (this.scaleControl) {
      try {
        this.map.removeControl(this.scaleControl);
      } catch {
        // 忽略:销毁竞态等
      }
      this.scaleControl = null;
    }
    return new Promise((resolve) => {
      this.scaleWaiters.push(resolve);
      this.ensureScaleControl();
    });
  }

  private ensureScaleControl(): void {
    if (this.scaleEnsuring) return;
    this.scaleEnsuring = true;
    const create = () => {
      this.scaleEnsuring = false;
      if (this.destroyedFlag) return; // 销毁后不再创建;waiters 由 destroy 清空
      const waiters = this.scaleWaiters;
      this.scaleWaiters = [];
      if (waiters.length === 0) return;
      try {
        const control = new this.AMap.Scale({
          position: this.scaleOpts?.position ?? 'LB',
          offset: this.scaleOpts?.offset ?? [10, 10],
        });
        this.map.addControl(control);
        this.scaleControl = control;
        for (const w of waiters) w(control);
      } catch {
        for (const w of waiters) w(null);
      }
    };
    if (typeof this.AMap.Scale === 'function') {
      create();
      return;
    }
    if (typeof this.AMap.plugin === 'function') {
      try {
        this.AMap.plugin(['AMap.Scale'], create);
      } catch {
        create();
      }
      return;
    }
    create(); // 无 plugin 环境(测试):构造失败走 catch 分支
  }

  destroy(): void {
    this.destroyedFlag = true;
    const waiters = this.scaleWaiters;
    this.scaleWaiters = [];
    for (const w of waiters) w(null);
    try {
      this.map.destroy();
    } catch {
      // 已销毁等场景:忽略
    }
    if (this.satelliteLayer) {
      try {
        this.satelliteLayer.destroy();
      } catch {
        // 忽略
      }
      this.satelliteLayer = null;
    }
    this.scaleControl = null;
  }
}

// ---------------------------------------------------------------------------
// 引擎实现
// ---------------------------------------------------------------------------

/** 最近一次 createView 的原始 map(Geolocation 蓝点需绑定到具体地图;无视图时传 null 退化纯定位) */
let latestRawMap: any = null;

async function load(): Promise<void> {
  if (!AMAP_ENGINE.isConfigured()) {
    throw new Error('NEXT_PUBLIC_AMAP_KEY is required');
  }
  // 复用 amap-api.loadAMap:同一 SCRIPT_ID 与 securityJsCode 流程,绝不双脚本
  await loadAMap();
}

function isLoaded(): boolean {
  return typeof window !== 'undefined' && Boolean((window as unknown as Record<string, unknown>).AMap);
}

async function createView(opts: MapViewCreateOptions): Promise<MapView> {
  const AMap = await loadAMap();
  const style = opts.style ?? 'normal';
  const map = new AMap.Map(opts.container, {
    zoom: opts.zoom,
    center: [opts.center.lng, opts.center.lat],
    viewMode: '3D',
    pitch: opts.pitch ?? 0,
    rotation: opts.rotation ?? 0,
    showLabel: true,
    mapStyle: style === 'satellite' ? STYLE_URL.normal : STYLE_URL[style],
    rotateEnable: false, // 禁用默认的右键旋转(旧 map-shell 同款)
  });
  latestRawMap = map;
  return new AmapView(AMap, map, style, AMAP_ENGINE);
}

const search: MapSearchProvider = {
  async searchPOI(opts): Promise<DomainPOI[]> {
    // page 是分页的 duck-type 扩展(契约 MapSearchProvider.searchPOI 未含;
    // 视口兜底「加载更多」需要 PlaceSearch pageIndex,与 amap-api 直连同语义)
    const extra = opts as unknown as { page?: number };
    const result = await amapSearchPOI({
      keyword: opts.keyword,
      ...(opts.center ? { center: { lng: opts.center.lng, lat: opts.center.lat } } : {}),
      ...(opts.city ? { city: opts.city } : {}),
      ...(opts.radius ? { radius: opts.radius } : {}),
      ...(opts.limit ? { pageSize: opts.limit } : {}),
      ...(extra.page ? { page: extra.page } : {}),
    });
    return result.pois;
  },
  fetchSuggestions: (keyword: string, city?: string) => amapFetchSuggestions(keyword, city),
  async getCurrentPosition(): Promise<LngLat | null> {
    const loc = await amapGetCurrentPosition(latestRawMap);
    return loc ? { lng: loc.position.lng, lat: loc.position.lat } : null;
  },
  geocodeAddress: (address: string, city?: string) => amapGeocodeAddress(address, city),
};

/**
 * 把完整实现装配进注册表骨架(engine-registry 保持厂商无关,不反向依赖本模块)。
 * 幂等:重复调用只覆盖同值。use-map-engine 以副作用 import 本模块即完成注册。
 * 注:search 等字段在契约里 readonly(Object.assign 运行时赋值,TS 只读为编译期约束)。
 */
export function registerAmapEngine(): MapEngine {
  Object.assign(AMAP_ENGINE, { load, isLoaded, createView, search });
  return AMAP_ENGINE;
}

/** 已装配的完整引擎(测试直接断言用;与注册表同一对象) */
export const AMAP_ENGINE_IMPL: MapEngine = registerAmapEngine();
