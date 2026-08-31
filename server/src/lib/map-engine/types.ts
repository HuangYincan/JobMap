// ============================================================
// MapEngine 公共契约 — 地图引擎内核层
//
// 「一切地图引擎皆插件」:AMap(高德)/TMap(腾讯)/BMapGL(百度)统一实现
// 本文件的 MapEngine 接口;业务组件只依赖本契约,不直接触碰厂商 API。
//
// 坐标规范:除特别标注外一律 **gcj02**(高德/腾讯原生坐标系;百度引擎
// 适配层负责 bd09→gcj02 换算,见 coord-utils.ts)。
//
// 本文件是全批次(ws-c/d/e 引擎实现、ws-f UI 切换)的公共契约,签名
// 变更必须同步本目录测试与 tech/ 文档。
// ============================================================

import type { DomainPOI } from '../types.ts';
import type { AmapSuggestion } from '../amap-api.ts';

// 供引擎实现与消费方从本文件统一导入(只读引用,不改动来源文件)
export type { DomainPOI, AmapSuggestion };

/** 引擎标识:与 ENGINE_PRIORITY / namespace / keyVar 一一对应 */
export type MapEngineId = 'amap' | 'tencent' | 'baidu';

/** 底图样式 id:normal 标准 / satellite 卫星 / whitesmoke 浅色 */
export type MapStyleId = 'normal' | 'satellite' | 'whitesmoke';

/** 规范坐标 = gcj02(除特别标注外,所有接口入参/出参均为 gcj02) */
export interface LngLat {
  lng: number;
  lat: number;
}

/** 视口矩形边界(经纬度) */
export interface MapBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** 创建地图视图的选项 */
export interface MapViewCreateOptions {
  container: HTMLElement;
  center: LngLat;
  zoom: number;
  pitch?: number;
  rotation?: number;
  style: MapStyleId;
}

/** 地图视图当前相机状态 */
export interface MapViewState {
  center: LngLat;
  zoom: number;
  pitch: number;
  rotation: number;
}

/** 地图视图事件名 */
export type MapViewEvent = 'click' | 'zoomchange' | 'moveend' | 'complete';

/** marker 选项 */
export interface MapMarkerOptions {
  position: LngLat;
  content?: string;
  /** 像素偏移 [x, y](相对锚点,元组形态) */
  offset?: [number, number];
  zIndex?: number;
  /** 图标规格(src 必填;size 缺省用厂商默认尺寸)。替代控制器侧 new Icon/Size,适配层转厂商图标 */
  icon?: { src: string; size?: [number, number] };
  onClick?: () => void;
}

export interface MapMarker {
  /** 厂商 marker 实例逃生舱(未迁移代码直连用,标注 TODO 限期迁移) */
  raw: unknown;
  setPosition(p: LngLat): void;
  setContent?(html: string): void;
  /**
   * 图标规格(与 create 时 `opts.icon` 同形)。WebGL 海量点(AMap LabelMarker /
   * TMap MultiMarker)以 icon 为渲染主机制,选中/高亮换图走本方法;HTML
   * content 引擎可省略。
   */
  setIcon?(icon: { src: string; size?: [number, number] }): void;
  remove(): void;
  /** 统一 zIndex 语义:AMap 小写 setzIndex / TMap·BMapGL 大写 setZIndex 差异由适配层吸收 */
  setZIndex?(z: number): void;
  /** 统一可见性语义:AMap·BMapGL show()/hide() 与 TMap setVisible 差异由适配层吸收 */
  setVisible?(v: boolean): void;
  /** 统一事件注册(仅 'click';AMap·TMap .on 与 BMapGL addEventListener 差异由适配层吸收) */
  on?(event: 'click', cb: () => void): void;
  /** 统一事件解绑(cb 缺省 = 解绑该事件全部回调) */
  off?(event: 'click', cb?: () => void): void;
  /**
   * 厂商侧是否仍挂在地图/共享层上(被外部删除时返回 false;不支持探测的
   * 适配层可省略本方法,控制器 sync 对 undefined 跳过)。探测必须走适配层
   * 可判定的挂载状态(如厂商 getMap / 适配层挂载簿记),控制器自身绝不直
   * 碰厂商裸实例。
   */
  isAttached?(): boolean;
}

export interface MapCircleOptions {
  center: LngLat;
  radius: number;
  color?: string;
}

export interface MapCircle {
  raw: unknown;
  remove(): void;
}

/**
 * 路线折线(gcj02)。点数须在 2..MAX_POLYLINE_POINTS;非法/空路径不挂图,
 * 返回 no-op remove。dashed 给 estimate 直线;可信道路几何用实线。
 */
export interface MapPolylineOptions {
  path: Array<{ lng: number; lat: number }>;
  color?: string;
  dashed?: boolean;
  weight?: number;
}

export interface MapPolyline {
  raw: unknown;
  remove(): void;
}

/** 与 navigation MAX_GEOMETRY_POINTS 对齐;适配层不得挂超长路径 */
export const MAX_POLYLINE_POINTS = 10_000;

/** POI 搜索能力(引擎各自适配厂商 SDK,统一返回规范化 DomainPOI) */
export interface MapSearchProvider {
  searchPOI(opts: {
    keyword: string;
    city?: string;
    center?: LngLat;
    radius?: number;
    limit?: number;
  }): Promise<DomainPOI[]>;
  fetchSuggestions(keyword: string, city?: string): Promise<AmapSuggestion[]>;
  getCurrentPosition(): Promise<LngLat | null>;
  geocodeAddress(address: string, city?: string): Promise<LngLat | null>;
}

/** 地图引擎统一契约 */
export interface MapEngine {
  readonly id: MapEngineId;
  readonly label: string;
  readonly namespace: 'AMap' | 'TMap' | 'BMapGL';
  readonly coordSystem: 'gcj02' | 'bd09';
  readonly keyVar:
    | 'NEXT_PUBLIC_AMAP_KEY'
    | 'NEXT_PUBLIC_TENCENT_JSAPI_KEY'
    | 'NEXT_PUBLIC_BAIDU_AK';
  /** 运行时读 process.env(Next 构建期内联;测试可直接操控 env) */
  isConfigured(): boolean;
  /** 幂等脚本注入 + 厂商 namespace 就绪(可重复调用) */
  load(): Promise<void>;
  /** 厂商 namespace 是否已挂载到 window */
  isLoaded(): boolean;
  createView(opts: MapViewCreateOptions): Promise<MapView>;
  readonly search: MapSearchProvider;
}

/** 地图视图(厂商地图实例的引擎统一包装) */
export interface MapView {
  /** 厂商实例逃生舱:未迁移的 AMap 专属代码直连用(标注 TODO 限期迁移) */
  readonly raw: unknown;
  readonly engine: MapEngine;
  getState(): MapViewState;
  getBounds(): MapBounds | null;
  isDestroyed(): boolean;
  setCenter(center: LngLat, animateMs?: number): void;
  setZoom(zoom: number, animateMs?: number): void;
  setPitch(pitch: number, animateMs?: number): void;
  setRotation(rotation: number, animateMs?: number): void;
  setBounds(bounds: MapBounds): void;
  flyTo(opts: { center: LngLat; zoom?: number }): void;
  /** 不支持的地图样式 → 回退 normal + console.warn */
  setStyle(style: MapStyleId): void;
  /** 注册事件;返回解绑函数 */
  on(event: MapViewEvent, cb: () => void): () => void;
  createMarker(opts: MapMarkerOptions): MapMarker;
  createCircle(opts: MapCircleOptions): MapCircle;
  createPolyline(opts: MapPolylineOptions): MapPolyline;
  addControl?(kind: 'scale'): void;
  destroy(): void;
}
