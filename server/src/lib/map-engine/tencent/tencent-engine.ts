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
//   setBaseMap、on/off、addControl(control)、destroy、getContainer()
// - 默认控件(SDK v1.8.0.2 源码核实):Map 构造 options `showControl: false` 时
//   不再创建 zoom/scale 默认控件(版权标识仍保留——ToS 署名要求);
//   setShowControl/getShowControl 仅读写标志,构造后调用不摘除已建控件 →
//   构造后补防御用 getControl(id)/removeControl(ctrl)(控件 id:zoom/scale)
// - 就绪事件:Map **无 ready 事件**;`idle` = 地图空闲事件(底层 moveend/zoomend
//   后 300ms debounce 触发,首次渲染完成后会触发)。无同步就绪 API →
//   createView 内监听 idle(预留 ready)等待就绪,1.5s 超时兜底不阻塞
//   (2026-08-21 ws-4:3s → 1.5s,idle 不触发时切换卡顿减半)
// - LatLngBounds(sw: LatLng, ne: LatLng);getWest/getSouth/getEast/getNorth
// - **createMarker 构造器多路径**(SDK v1.8.0.2 源码核实):`v=1.exp` 全局 TMap
//   命名空间**无单点 Marker**(导出表只有 MultiMarker/MarkerStyle 等聚合类)→
//   createMarker 按 typeof 分派:Marker 可用走单点路径,否则 MultiMarker 聚合路径
// - 单点 Marker(仅 npm SDK 形态):{ position, map, content, offset:{x,y}, zIndex };
//   移除 = setMap(null)(glMarker 标注点;无 remove 方法;zIndex → DOM overlay style.zIndex)
// - MultiMarker(v=1.exp 全局形态,2026-08-22 ws-6 批量化):
//   **单共享实例承载全部 geometry**(消灭旧实现「每 marker 一实例」的
//   「数据层过多」警告 + mousemove 监听泄漏;单实例内部方法面实测核实:
//   add(geos) 增量添加 / remove(ids) 按 id 摘除 / updateGeometries 按 id 更新 /
//   setStyles(styles) 全量替换 / getGeometryById / setMap(null) 移除 /
//   setZIndex·setVisible 实例级 / click 载荷 e.geometry.id);
//   geometry:{ id, position: LatLng, styleId? }(styleId 缺省 "default");
//   样式归组:icon/offset 签名 → styleId(dm-st-N),同签名共享,新签名 setStyles;
//   zIndex 实例级 → 取全部 marker 的 max 近似单 marker 语义;
//   setVisible 经 add/remove 摘挂单 geometry(隐藏即不在图层,不可点击);
//   MarkerStyle 仅图片 src,anchor 是唯一像素偏移(imageTopLeft = 屏幕位 - anchor),
//   geometry.content 仅 GL 文本标签(非 HTML)→ HTML content 降级为默认点 + 一次性 warn
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
/** 地图就绪等待超时(ms):TMap 异步初始化,无同步就绪 API;超时兜底不阻塞调用方。
 * 2026-08-21 ws-4:3s → 1.5s(idle 不触发/瓦片失败时切换冻结减半,仍保留兜底) */
const TENCENT_MAP_READY_TIMEOUT_MS = 1500;
/** Marker 默认 zIndex:未显式传入时的合理默认(底图之上可见;显式值优先) */
const TENCENT_MARKER_DEFAULT_ZINDEX = 10;
/** MultiMarker 默认 pin 样式锚点(SDK v1.8.0.2 核实:MarkerStyle 默认 src 图 34x50,
 * anchor 默认 (width/2, height)=(17,50);渲染公式 imageTopLeft = 屏幕位 - anchor,
 * style.offset 渲染器不消费 → anchor 是唯一像素偏移机制) */
const TENCENT_DEFAULT_MARKER_ANCHOR = { x: 17, y: 50 } as const;

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
// 就绪等待 / 默认控件禁用(TMap 异步初始化 + 默认控件遮挡防御)
// ------------------------------------------------------------

/**
 * 等待 TMap 地图就绪再返回(TMap 异步初始化:ready 前创建 Marker 可能丢失/不可见)。
 * SDK v1.8.0.2 核实:Map 无 ready 事件 → 监听 `idle`(首次渲染完成后触发,
 * 底层 moveend/zoomend 后 300ms debounce);`ready` 一并预留(未来版本);
 * 超时兜底 TENCENT_MAP_READY_TIMEOUT_MS 不阻塞调用方。事件系统不可用 → 立即放行。
 */
function waitForMapReady(raw: any): Promise<void> {
  if (typeof raw?.on !== 'function') return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      try {
        raw.off?.('ready', done);
        raw.off?.('idle', done);
      } catch {
        // 解绑失败不影响就绪语义
      }
      resolve();
    };
    try {
      raw.on('ready', done);
      raw.on('idle', done);
    } catch {
      // 事件系统异常:无法等待 → 直接放行(不阻塞 createView)
      done();
      return;
    }
    timer = setTimeout(done, TENCENT_MAP_READY_TIMEOUT_MS);
  });
}

/**
 * DOM 兜底:隐藏 TMap 控件层 + 解除 canvas/覆盖物面板点击拦截;版权标识保留可见。
 * 2026-08-21 ws-4 覆盖面补:canvas 与 marker/overlay 面板层。TMap GL 的事件/
 * 命中检测绑定在 container 元素(pointer-events:none 不阻断 SDK 手势与 raycast),
 * 但这些面板若带高 z-index 会拦截 app UI 点击 → 一律 pointer-events:none
 * (不 display:none:canvas 仍需渲染底图,marker 面板留给 SDK 渲染)。
 */
function hideControlDom(raw: any): void {
  const container = raw?.getContainer?.();
  if (!container || typeof container.querySelectorAll !== 'function') return;
  try {
    // 交互控件(缩放/比例尺/旋转等):整体隐藏
    const interactive = container.querySelectorAll(
      '[class*="control"], [class*="zoom"], [class*="scale"], [class*="rotate"]',
    );
    for (const el of interactive) {
      el.style.display = 'none';
      el.style.pointerEvents = 'none';
    }
    // 版权/logo:保留可见(ToS 署名),只解除点击拦截
    const attribution = container.querySelectorAll(
      '[class*="copyright"], [class*="logo"], [class*="attribution"]',
    );
    for (const el of attribution) el.style.pointerEvents = 'none';
    // canvas 与 marker/overlay 面板层(TMap GL DOM 类名 tencent-map-*;宽泛选择器
    // 防御,含裸 canvas 元素):解除点击拦截,防面板 z-index 挡 app UI
    const panels = container.querySelectorAll(
      'canvas, [class*="tencent-map-pane"], [class*="tencent-map-marker"], [class*="tencent-map-overlay"], [class*="tencent-map-canvas"]',
    );
    for (const el of panels) el.style.pointerEvents = 'none';
  } catch {
    // DOM 探测失败静默:不影响主流程
  }
}

/**
 * 禁用 TMap 默认控件(缩放按钮等内部 DOM z-index 高于 map-shell UI,遮挡/拦截点击)。
 * ⚠️ 必须在地图就绪(waitForMapReady)之后调用:TMap 异步初始化,控件 DOM 在
 * ready 后才建立,提前调用 getControl/hideControlDom 扫空 DOM 全部空转(ws-4 时序修复)。
 * 多路径防御:
 * 1) 构造 options 传 showControl:false(官方核实:不再创建 zoom/scale,版权保留)
 * 2) 构造后 getControl('zoom'|'scale') + removeControl 摘除(老 SDK 忽略构造选项时)
 * 3) setShowControl(false) 阻止后续默认控件重建
 * 4) DOM 兜底隐藏控件层
 */
function disableDefaultControls(raw: any): void {
  try {
    if (typeof raw?.getControl === 'function' && typeof raw?.removeControl === 'function') {
      for (const id of ['zoom', 'scale']) {
        const ctrl = raw.getControl(id);
        if (ctrl) raw.removeControl(ctrl);
      }
    }
  } catch (err) {
    console.warn('[map-engine] TMap 默认控件摘除失败(removeControl)', err);
  }
  try {
    if (typeof raw?.setShowControl === 'function') raw.setShowControl(false);
  } catch (err) {
    console.warn('[map-engine] TMap setShowControl(false) 失败', err);
  }
  hideControlDom(raw);
}

// ------------------------------------------------------------
// 视图门面:MapView 契约 → TMap.Map 实例
// ------------------------------------------------------------

class TencentView implements MapView {
  readonly raw: any;
  readonly engine: MapEngine;
  private readonly tmap: any;
  private destroyed = false;
  /** MultiMarker 路径 marker id 递增序列(dm-mk-1...) */
  private multiMarkerSeq = 0;
  /** 自定义样式 id 递增序列(dm-st-1...):icon/offset 签名 → styleId 归组 */
  private multiStyleSeq = 0;
  /** HTML content 降级告警一次性标记(多 marker 不刷屏) */
  private multiContentWarned = false;
  /** MultiMarker setZIndex 降级告警一次性标记(老 SDK 无 setZIndex 时,防刷屏) */
  private multiZIndexWarned = false;
  /** MultiMarker setStyles 降级告警一次性标记(老 SDK 无 setStyles → 归组样式降级) */
  private multiStylesWarned = false;
  /** 单点 Marker setIcon 降级告警一次性标记(npm SDK 老形态无 setIcon) */
  private singleIconWarned = false;
  /** 共享 MultiMarker 实例(批量化核心:单实例承载全部 geometry;首次 createMarker 惰性创建) */
  private multiMarker: any = null;
  /** id → 活 geometry 引用(setPosition 原地改 position 后 updateGeometries,保留 styleId) */
  private multiGeometries = new Map<string, { id: string; position: unknown; styleId: string }>();
  /** id → 当前 zIndex(实例 zIndex = max;契约单 marker 层级语义的批量化近似) */
  private multiZIndexes = new Map<string, number>();
  /** 样式签名 → styleId(同签名 marker 共享样式;icon 规格 + offset 归组) */
  private multiStyleBySignature = new Map<string, string>();
  /** styleId → MarkerStyle 实例(累积;新样式经 setStyles 全量替换上实例) */
  private multiStyles: Record<string, unknown> = {};
  /** 当前挂载在共享实例上的 id 集(setVisible 摘挂经 add/remove 维护) */
  private multiAttached = new Set<string>();
  /** MultiMarker click 解绑簿记:契约 cb → { id, handler(带 geometry.id 过滤) }。
   * id 关联是共享实例下精确解绑的前提(off 缺省 cb 只解本 marker) */
  private multiClickHandlers = new Map<() => void, { id: string; handler: (e: any) => void }>();

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
    // 构造器多路径解析(v=1.exp 全局 TMap 无单点 Marker → MultiMarker 聚合标注;
    // npm SDK 有 Marker → 单点路径;两者皆无 → 诊断 + throw,保留 addMarker 簿记语义)
    if (typeof this.tmap.Marker === 'function') return this.createSingleMarker(opts);
    if (typeof this.tmap.MultiMarker === 'function') return this.createMultiMarker(opts);
    console.error('[map-engine] TMap 无 Marker/MultiMarker,命名空间:', Object.keys(this.tmap || {}));
    throw new Error('[map-engine] TMap 无 Marker/MultiMarker,无法创建 marker');
  }

  /** 单点 Marker 路径(npm SDK / 全局版含 Marker 时;原实现原样保留) */
  private createSingleMarker(opts: MapMarkerOptions): MapMarker {
    let raw: any;
    try {
      raw = new this.tmap.Marker({
        position: toTMapLatLng(this.tmap, opts.position),
        ...(opts.content !== undefined ? { content: opts.content } : {}),
        // 契约 offset 为 [x, y] 元组 → TMap offset 对象 {x, y}(glMarker 标注偏移)
        ...(opts.offset ? { offset: { x: opts.offset[0], y: opts.offset[1] } } : {}),
        // zIndex 显式给合理默认(TMap DOM overlay marker 未传时层级不可控;
        // 保证纯 position POI 在底图之上可见;显式 zIndex 仍优先)
        zIndex: opts.zIndex ?? TENCENT_MARKER_DEFAULT_ZINDEX,
        map: this.raw,
      });
    } catch (err) {
      // 构造失败必须可观测(map-markers 的 try/catch 会吞掉异常)→ 打日志后
      // rethrow,保留 addMarker 的簿记语义(remove 记账仍由调用方处理)
      console.error('[map-engine] TMap Marker 创建失败', err);
      throw err;
    }
    if (opts.onClick) raw.on('click', opts.onClick);
    // icon 规格(契约)→ 单点 Marker setIcon(npm SDK 形态;无 setIcon → 一次性
    // warn 降级不抛;有则按 src/width/height 形状传入,构造失败亦降级)
    if (opts.icon) {
      if (typeof raw.setIcon === 'function') {
        const iconSpec: Record<string, unknown> = { src: opts.icon.src };
        if (opts.icon.size) {
          iconSpec.width = opts.icon.size[0];
          iconSpec.height = opts.icon.size[1];
        }
        try {
          raw.setIcon(iconSpec);
        } catch (err) {
          console.warn('[map-engine] TMap Marker setIcon 失败,图标降级', err);
        }
      } else {
        this.warnSingleIconDegraded();
      }
    }
    return {
      raw,
      setPosition: (p: LngLat) => raw.setPosition(toTMapLatLng(this.tmap, p)),
      setContent: (html: string) => raw.setContent(html),
      setZIndex: (z: number) => {
        if (typeof raw.setZIndex === 'function') raw.setZIndex(z);
        else console.warn('[map-engine] TMap Marker 无 setZIndex,忽略 zIndex');
      },
      setVisible: (v: boolean) => {
        if (typeof raw.setVisible === 'function') raw.setVisible(v);
        else console.warn('[map-engine] TMap Marker 无 setVisible,忽略可见性');
      },
      on: (event: 'click', cb: () => void) => {
        if (event !== 'click') return;
        if (typeof raw.on === 'function') raw.on('click', cb);
        else console.warn('[map-engine] TMap Marker 无 on,忽略事件注册');
      },
      off: (event: 'click', cb?: () => void) => {
        if (event !== 'click') return;
        if (typeof raw.off !== 'function') {
          console.warn('[map-engine] TMap Marker 无 off,忽略解绑');
          return;
        }
        if (cb) raw.off('click', cb);
        // cb 缺省:TMap 无「按事件清空」形态 → 保留(调用方应传 cb 精确解绑)
      },
      // GL Marker 无 remove();官方移除方式为 setMap(null)
      remove: () => raw.setMap(null),
    };
  }

  /**
   * MultiMarker 批量路径(v=1.exp 全局版;SDK v1.8.0.2 源码核实)。
   * **单共享实例承载全部 geometry**(2026-08-22 ws-6 批量化):旧实现每 marker
   * 一个 MultiMarker 实例 → ~145 数据层(TMap 连续警告「数据层过多,影响点击
   * 拾取」)+ MaxListenersExceededWarning(mousemove 监听泄漏)。批量化后:
   * - 首次 createMarker 惰性构造共享实例(带首批 geometry/归组样式/zIndex);
   * - 后续 marker:raw.add([geometry]) 增量添加,新样式经 setStyles 归组;
   * - 身份映射:multiGeometries(id → 活 geometry)+ multiAttached(挂载集);
   * - zIndex 实例级(overlay layer rank)→ max(全部 marker)近似契约语义;
   * - setVisible 经 remove/add 摘挂单 geometry(隐藏 = 不在图层,不可点击);
   * - 事件:单实例 click 按 e.geometry.id 过滤分发(ws-1 模式扩展)。
   */
  private createMultiMarker(opts: MapMarkerOptions): MapMarker {
    const tmap = this.tmap;
    // id 递增唯一(SDK 核实:geometry.id 缺失会自动生成,但显式传更可控;
    // 共享实例内必须全局唯一)
    const id = `dm-mk-${++this.multiMarkerSeq}`;
    // 活 geometry 引用:setPosition 原地改 position 后 updateGeometries
    // (SDK 核实:updateGeometries 按 id 整体替换 raw geometry → 必须携带
    // styleId,故用同一对象;styleId 由样式归组解析)
    const geometry: { id: string; position: unknown; styleId: string } = {
      id,
      position: toTMapLatLng(tmap, opts.position),
      styleId: this.resolveMultiStyle(opts),
    };
    this.multiGeometries.set(id, geometry);
    this.multiZIndexes.set(id, opts.zIndex ?? TENCENT_MARKER_DEFAULT_ZINDEX);
    // HTML content:MultiMarker 无 HTML 渲染(SDK 核实:geometry.content 是 GL
    // 文本标签,MarkerStyle 仅图片 src)→ 降级默认点 + 一次性 warn。
    // **icon 存在时不降级**(ws-a,bug 1/6):icon → MarkerStyle(src) 真图标路径
    // 才是 TMap 渲染形态;content 只是 AMap 等引擎的 HTML 形态(公司 icon /
    // 聚合徽章 dataURL 图标均同时传 content+icon,契约 icon 缺省才走默认点)
    if (opts.content !== undefined && !opts.icon) this.warnMultiMarkerContentDegraded();

    let raw = this.multiMarker;
    if (!raw) {
      // 首个 marker:构造共享实例(首批 geometry + 已归组样式 + zIndex)
      const mmOpts: Record<string, unknown> = {
        map: this.raw,
        geometries: [geometry],
        // SDK 核实:overlay zIndex → layer rank 排序(越大越靠上)
        zIndex: opts.zIndex ?? TENCENT_MARKER_DEFAULT_ZINDEX,
      };
      if (Object.keys(this.multiStyles).length > 0) mmOpts.styles = this.multiStyles;
      try {
        raw = new tmap.MultiMarker(mmOpts);
      } catch (err) {
        // 与单点路径同语义:可观测 + rethrow(保留 addMarker 簿记语义)
        console.error('[map-engine] TMap MultiMarker 创建失败', err);
        throw err;
      }
      this.multiMarker = raw;
    } else {
      // 增量添加(SDK 核实:add 跳过已存在 id;新样式已在 resolveMultiStyle
      // 经 setStyles 上实例,必须先于 add——geometry 引用的 styleId 不能缺失)
      raw.add([geometry]);
      this.maybeUpdateMultiZIndex();
    }
    this.multiAttached.add(id);
    if (opts.onClick) this.bindMultiMarkerClick(raw, id, opts.onClick);
    return {
      // 逃生舱 = 共享 MultiMarker 实例(契约「厂商 marker 实例」语义不变)
      raw,
      setPosition: (p: LngLat) => {
        geometry.position = toTMapLatLng(tmap, p);
        raw.updateGeometries([geometry]);
      },
      setContent: (_html: string) => {
        // content 变更对 MultiMarker 无效(无 HTML 渲染);有 icon 时视觉不受影响
        // (icon 才是 TMap 渲染形态),仅无 icon 的纯 HTML 形态才告警降级
        if (!opts.icon) this.warnMultiMarkerContentDegraded();
      },
      // zIndex 实例级(overlay layer rank):批量化下取全部 marker 的 max——
      // 选中(100)/高亮(80)整体抬升图层、普通(10/20)回落;共享实例内单
      // marker 精确层级不可达(SDK 无 per-geometry zIndex),max 为近似。
      // 老 SDK 无 setZIndex → 一次性 warn 降级不抛(防刷屏)
      setZIndex: (z: number) => {
        this.multiZIndexes.set(id, z);
        this.maybeUpdateMultiZIndex();
      },
      // 可见性:隐藏 = 从共享实例摘除该 geometry(remove([id])),显示 = 重新
      // 挂载(add)——隐藏 marker 不在图层,天然不可点击/不参与渲染/零开销;
      // 实例级 setVisible 会误伤全部 marker,不可用(ws-6 批量化设计)
      setVisible: (v: boolean) => {
        if (!this.multiMarker) return;
        if (v) {
          if (!this.multiAttached.has(id)) {
            this.multiMarker.add([geometry]);
            this.multiAttached.add(id);
          }
        } else if (this.multiAttached.has(id)) {
          this.multiMarker.remove([id]);
          this.multiAttached.delete(id);
        }
      },
      on: (event: 'click', cb: () => void) => {
        if (event !== 'click') return;
        this.bindMultiMarkerClick(raw, id, cb);
      },
      off: (event: 'click', cb?: () => void) => {
        if (event !== 'click') return;
        if (!this.multiMarker) return;
        if (cb) {
          const entry = this.multiClickHandlers.get(cb);
          if (entry && entry.id === id) {
            this.multiMarker.off?.('click', entry.handler);
            this.multiClickHandlers.delete(cb);
          }
        } else {
          // cb 缺省 = 解绑本 marker 全部 click(共享实例必须按 id 过滤,
          // 不能清全量——会误伤其他 marker 的回调)
          for (const [cbKey, entry] of [...this.multiClickHandlers]) {
            if (entry.id === id) {
              this.multiMarker.off?.('click', entry.handler);
              this.multiClickHandlers.delete(cbKey);
            }
          }
        }
      },
      // 移除 = 摘除该 geometry + 清理全部簿记(共享实例保留挂图)
      remove: () => {
        if (!this.multiMarker) return;
        if (this.multiAttached.has(id)) {
          this.multiMarker.remove([id]);
          this.multiAttached.delete(id);
        }
        this.multiGeometries.delete(id);
        this.multiZIndexes.delete(id);
        for (const [cbKey, entry] of [...this.multiClickHandlers]) {
          if (entry.id === id) {
            this.multiMarker.off?.('click', entry.handler);
            this.multiClickHandlers.delete(cbKey);
          }
        }
        this.maybeUpdateMultiZIndex();
      },
    };
  }

  /**
   * 样式归组解析:icon 规格 + offset 签名 → styleId。
   * - 无 icon 无 offset → 'default'(SDK 内建默认 pin,零样式注入);
   * - 有 icon/offset → 签名查表;首见创建 MarkerStyle + 分配 dm-st-N;
   *   同签名后续 marker 复用同一 styleId(共享实例样式字典不膨胀);
   * - 新样式在共享实例已存在时经 setStyles 全量替换上实例(**必须先于
   *   add geometry**:geometry 引用的 styleId 在实例上不能缺失);
   * - **SDK 类名核实(ws-a,2026-08-22)**:GL API **无 IconStyle 类**——MultiMarker
   *   图片样式类就是 `MarkerStyle`,内嵌 `{ src, width, height, anchor }`(src 可
   *   为 dataURL 数据图或远程 URL);公司 icon / 聚合徽章走本路径真图标渲染;
   * - 契约 icon 缺省 → 默认 pin;icon 存在 → 真图标;content 与 icon 并存时
   *   icon 优先(TMap 无 HTML 渲染,content 不写入 geometry);
   * - MarkerStyle 仅图片 src 形态;契约 offset [x,y] → anchor 平移(渲染公式
   *   imageTopLeft = 屏幕位 - anchor,Δanchor = -(x,y) 即整图位移 (x,y);
   *   style.offset 渲染器不消费)。
   */
  private resolveMultiStyle(opts: MapMarkerOptions): string {
    if (!opts.offset && !opts.icon) return 'default';
    const iconW = opts.icon?.size?.[0] ?? TENCENT_DEFAULT_MARKER_ANCHOR.x * 2;
    const iconH = opts.icon?.size?.[1] ?? TENCENT_DEFAULT_MARKER_ANCHOR.y;
    const signature = `${opts.icon?.src ?? ''}|${iconW}|${iconH}|${opts.offset?.[0] ?? 0}|${opts.offset?.[1] ?? 0}`;
    const existing = this.multiStyleBySignature.get(signature);
    if (existing) return existing;
    const styleId = `dm-st-${++this.multiStyleSeq}`;
    const styleOpts: Record<string, unknown> = {
      anchor: new this.tmap.Point(iconW / 2 - (opts.offset?.[0] ?? 0), iconH - (opts.offset?.[1] ?? 0)),
    };
    if (opts.icon) {
      styleOpts.src = opts.icon.src;
      styleOpts.width = iconW;
      styleOpts.height = iconH;
    }
    this.multiStyles[styleId] = new this.tmap.MarkerStyle(styleOpts);
    this.multiStyleBySignature.set(signature, styleId);
    if (this.multiMarker) {
      if (typeof this.multiMarker.setStyles === 'function') {
        this.multiMarker.setStyles({ ...this.multiStyles });
      } else {
        this.warnMultiMarkerStylesDegraded();
      }
    }
    return styleId;
  }

  /**
   * 实例 zIndex 收敛为 max(全部 marker zIndex)。SDK 核实:overlay zIndex →
   * layer rank(越大越靠上);共享实例只占一个 rank,max 让选中/高亮整体抬升、
   * 移除后回落;值未变不调用(避免无谓 setZIndex)。老 SDK 无 setZIndex →
   * 一次性 warn 降级不抛。
   */
  private maybeUpdateMultiZIndex(): void {
    const raw = this.multiMarker;
    if (!raw) return;
    let max = 0;
    for (const z of this.multiZIndexes.values()) {
      if (z > max) max = z;
    }
    if (raw.zIndex === max) return;
    if (typeof raw.setZIndex === 'function') {
      raw.setZIndex(max);
    } else {
      this.warnMultiMarkerZIndexDegraded();
    }
  }

  /**
   * MultiMarker click 绑定(SDK 核实:点击载荷 { ...mapEvent, geometry, type,
   * target } → 按 geometry.id 过滤;共享实例下所有 marker 的 handler 注册在
   * 同一实例,id 过滤等价实例隔离,互不误触)。
   * handler 注册进 multiClickHandlers(id 关联),供 off/remove 精确解绑。
   */
  private bindMultiMarkerClick(raw: any, id: string, cb: () => void): void {
    if (typeof raw.on !== 'function') return;
    const handler = (e: any) => {
      if (e?.geometry?.id === id) cb();
    };
    this.multiClickHandlers.set(cb, { id, handler });
    raw.on('click', handler);
  }

  /** MultiMarker setZIndex 降级告警(一次性;正常 SDK 经 GeometryOverlay 继承存在,仅老/异常形态缺失时触发) */
  private warnMultiMarkerZIndexDegraded(): void {
    if (this.multiZIndexWarned) return;
    this.multiZIndexWarned = true;
    console.warn('[map-engine] TMap MultiMarker 无 setZIndex,zIndex 变更降级忽略');
  }

  /** MultiMarker setStyles 降级告警(一次性;老 SDK 无 setStyles → 后续归组样式不生效,降级默认点) */
  private warnMultiMarkerStylesDegraded(): void {
    if (this.multiStylesWarned) return;
    this.multiStylesWarned = true;
    console.warn('[map-engine] TMap MultiMarker 无 setStyles,新样式归组降级为默认点');
  }

  /** 单点 Marker setIcon 降级告警(一次性;npm SDK 老形态无 setIcon) */
  private warnSingleIconDegraded(): void {
    if (this.singleIconWarned) return;
    this.singleIconWarned = true;
    console.warn('[map-engine] TMap Marker 无 setIcon,图标降级为默认');
  }

  /** HTML content 降级告警(一次性;MultiMarker 无 HTML 渲染) */
  private warnMultiMarkerContentDegraded(): void {
    if (this.multiContentWarned) return;
    this.multiContentWarned = true;
    console.warn('[map-engine] TMap MultiMarker 不支持 HTML content,徽章降级为默认点');
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
    // 控件命名空间双路径兜底(TMap GL 存在 control/Control 两种形态;缺失时降级
    // 不抛——map-shell 的调用是 duck-type,返回 void 即跳过,比例尺缺失不炸地图)。
    // 参考 baidu 引擎 L348-351 的防御风格:先存在性检查,再构造控件。
    const ctrlNs = (this.tmap.control ?? this.tmap.Control) as
      | { ScaleControl?: new (opts?: unknown) => unknown }
      | undefined;
    if (!ctrlNs?.ScaleControl) {
      console.warn('[map-engine] TMap ScaleControl 不可用,比例尺降级');
      return;
    }
    this.raw.addControl(new ctrlNs.ScaleControl({ position: 'bottomRight' }));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // 共享 MultiMarker 显式摘除(双保险:地图销毁时覆盖物随之销毁;清理簿记
    // 防 view 复用残留)
    if (this.multiMarker && typeof this.multiMarker.setMap === 'function') {
      try {
        this.multiMarker.setMap(null);
      } catch {
        // 销毁路径不抛
      }
    }
    this.multiMarker = null;
    this.multiGeometries.clear();
    this.multiZIndexes.clear();
    this.multiStyleBySignature.clear();
    this.multiStyles = {};
    this.multiAttached.clear();
    this.multiClickHandlers.clear();
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
      // 禁用 TMap 默认控件(SDK v1.8.0.2 核实:false 时不创建 zoom/scale 默认
      // 控件,版权标识保留):避免其内部 DOM z-index 高于 map-shell UI 遮挡点击
      showControl: false,
    });
    // 先等地图就绪,再禁用/隐藏默认控件(2026-08-21 ws-4 时序修复):TMap 异步
    // 初始化,new TMap.Map() 立即返回、控件 DOM 异步才建立——ready 前执行
    // disableDefaultControls,getControl/hideControlDom 扫空 DOM 全部空转
    // (诊断坐实);ready 后控件 DOM 已建立,摘除/隐藏才真正生效。
    await waitForMapReady(raw);
    disableDefaultControls(raw);
    return new TencentView(tmap, raw, TENCENT_ENGINE);
  },
  search: searchProvider,
};
