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
// - 滚轮缩放(SDK v1.8.0.2 实包核实,2026-08-22 ws-b):**无 smoothWheelZoom 选项**
//   (全包 0 处命中;Leaflet 2D 适配层的 scrollWheelZoom 与 GL 无关);Map 选项
//   `scrollable`(默认 true,运行期 setScrollable 切换)启用内建滚轮处理器:
//   wheel(鼠标滚轮)→ zoomTo({duration:200, smoothEasing:true}) 平滑动画;
//   trackpad(触控板/像素增量)→ duration:0 即时应答(SDK 设计)。滚轮平滑
//   = SDK 内建,构造传 scrollable:true 显式启用(自文档化 + 防默认漂移)
// - 就绪事件:Map **无 ready 事件**;`idle` = 地图空闲事件(底层 moveend/zoomend
//   后 300ms debounce 触发,首次渲染完成后会触发)。无同步就绪 API →
//   createView 内监听 idle(预留 ready)等待就绪,1.5s 超时兜底不阻塞
//   (2026-08-21 ws-4:3s → 1.5s,idle 不触发时切换卡顿减半)
// - LatLngBounds(sw: LatLng, ne: LatLng);getWest/getSouth/getEast/getNorth
// - **createMarker 构造器多路径**(SDK v1.8.0.2 源码核实):`v=1.exp` 全局 TMap
//   命名空间**无单点 Marker**(导出表只有 MultiMarker/MarkerStyle 等聚合类)→
//   createMarker 按 typeof 分派:content 存在**且无 icon** → **DOM overlay**
//   (容器 div,见 createContentOverlay——ws-pinfix2 目标场景:agent 蓝点等
//   无 icon 的 HTML 形态);**content+icon 并存(公司 POI 徽章/聚合徽章)与
//   有 icon → 走 icon 路径**(MultiMarker 纹理,ws-c 修正锚点 = -contract
//   offset;content 不写 geometry,2026-08-22 ws-h 收窄:content 不再无条件
//   走 DOM overlay——DOM 定位在真实 SDK 全堆叠 bug 根因,见 tech/23 ws-h);
//   无 content 无 icon:Marker 可用走单点路径,否则 MultiMarker 聚合路径
//   (2026-08-22 ws-pinfix2:agent 的 content+offset 无 icon 样式被
//   resolveMultiStyle 生成无 src/width/height 的 MarkerStyle → GL 校验
//   「width 属性无效」拒绝渲染 + content 降级 = 目标点不可见根因)
// - 单点 Marker(仅 npm SDK 形态):{ position, map, content, offset:{x,y}, zIndex };
//   移除 = setMap(null)(glMarker 标注点;无 remove 方法;zIndex → DOM overlay style.zIndex)
// - **content 语义(2026-08-22 ws-h 收窄)**:content 存在**且无 icon** → 引擎层
//   DOM 覆盖物渲染 HTML(div 注入地图容器,定位 = 容器像素投影 - offset;
//   **真实 SDK v1.8.0.2 实测(ws-h,真机 Chromium)**:`lngLatToContainerPoint`
//   **不存在**于 Map 原型(导出面 = projectToContainer/unprojectFromContainer/
//   projectToWorldPlane 等,`typeof map.lngLatToContainerPoint === 'undefined'`)
//   —— ws-pinfix2 假定的官方命名 API 不存在 → DOM overlay 全部不定位 →
//   堆叠(用户「POI 各种奇怪 bug」根因);`projectToContainer(latLng)` 实测
//   返回容器像素 {x,y}(center → 精确容器中心,偏移点方向/量级正确)——
//   引擎定位链 = lngLatToContainerPoint(兼容/测试) → projectToContainer
//   (真实 SDK 兜底);与 amap content 原生渲染、baidu DOM 注入同语义);
//   content+icon 并存 → icon 为渲染主机制(MultiMarker 纹理,content 不渲染
//   —— HTML 双渲染会叠印);MultiMarker 的 icon 化路径兼服务无 content marker,
//   content-only 仅 DOM 不可用时回退(降级 warn)。
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
//   MarkerStyle 仅图片 src,anchor 是唯一像素偏移(imageTopLeft = 屏幕位 - anchor);
//   **SDK 默认 anchor 是常量 (17,50),不随 width/height 归一化**(ws-a 源码核实:
//   MarkerStyle 构造 iconAnchor:[t.anchor&&t.anchor.x||17, ...])——自定义尺寸
//   图标必须显式传 anchor,否则锚点错位 → 缩放漂移 + 点击命中区与视觉不一致;
//   geometry.content 仅 GL 文本标签(非 HTML)→ HTML content 降级为默认点 + 一次性 warn
// - Circle:{ center, radius, map, strokeColor, fillColor, fillOpacity }(glCircle)
// - 底图样式:baseMap.type vector=标准 / satellite=卫星(影像+道路注记,
//   features 缺省回退 DEFAULT_BASEMAP.satellite = [base, road]);暗色 = Map 选项
//   mapStyleId(SDK v1.8.0.2 源码核实:STYLE_ID 常量 {DEFAULT:0, DARK:1,
//   LIGHT:2, GAME:3},'DARK' → 矢量暗色底图层 Tencent.Normal.Dark;
//   **baseMap 无 styleType 字段**,旧注释「styleType:'dark' 存在」有误);
//   运行期 setMapStyleId(id) 切底图层。契约 MapStyleId 语义不变:
//   whitesmoke(UI「深色」/系统深色偏好的 value)在本引擎映射为暗色矢量底图
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
/** MultiMarker 默认 pin 样式锚点(SDK v1.8.0.2 源码核实,ws-a 2026-08-22):
 * MarkerStyle 构造 `iconAnchor:[t.anchor&&t.anchor.x||17, t.anchor&&t.anchor.y||50]`
 * —— 默认锚点是**常量 (17,50)**(34x50 默认 pin 的底部中心),**不随 width/height
 * 归一化**:自定义尺寸图标(60x60 徽章等)不显式传 anchor 就会锚点错位 →
 * 缩放级别变化时表现为视觉漂移(锚点像素偏移不随地图比例联动)。
 * 渲染公式(双路径同语义):DOM 2d-adapter `marginLeft/Top = -anchor`;
 * GL 实例 `instanceInfos.xy = (width/2 - anchor.x, height/2 - anchor.y)` →
 * imageTopLeft = 屏幕位 - anchor;style.offset 渲染器不消费 → anchor 是唯一
 * 像素偏移机制(契约 offset 合并见 resolveTMapMarkerAnchor)。
 * ⚠️ ws-c(2026-08-22)修正:该默认常量只作用于**未显式传 anchor 的样式**
 * (styleId 'default' / 兜底路径);resolveMultiStyle 恒显式传 anchor,与默认
 * 常量无关。 */
const TENCENT_DEFAULT_MARKER_ANCHOR = { x: 17, y: 50 } as const;

/**
 * 计算 MultiMarker MarkerStyle 锚点(契约偏移语义,ws-c 2026-08-22 修正)。
 * - 锚点 = 图片局部坐标(原点左上、y 向下)中与地理点屏幕位重合的点;
 *   SDK 渲染:imageTopLeft = 屏幕位 - anchor(GL 与 DOM 双路径同语义);
 * - **契约 offset 语义 = AMap content 路径**:内容元素左上角置于
 *   `屏幕位 + offset`(imageTopLeft = 屏幕位 + offset;AMap content div /
 *   百度 ws-c SDK 源码核实 `icon.anchor = -契约 offset` 同款)→ 两式联立:
 *   `anchor = -offset = (-ox, -oy)`,**与图标尺寸无关**。
 * - 三个生产形态的锚点落点(与高德逐像素一致):
 *   图钉 32×40 + offset [-16,-40] → anchor (16,40) 底尖钉地理点;
 *   徽章 40×40 + offset [-20,-20] → anchor (20,20) 中心钉地理点;
 *   聚合徽章 54×54 + offset [-27,-27] → anchor (27,27) 中心钉地理点;
 * - 无 offset → anchor (0,0)(左上角,AMap 无 offset 语义一致,百度同款);
 * - 缩放级别变化不影响 anchor(纯像素常量,与地图比例无关,S库
 *   relativeZoomScale 默认关闭)→ 锚点钉死地理点不漂移。
 * @param iconW 图标渲染宽度(px;锚点计算不依赖尺寸,保留入参仅为与
 *   MarkerStyle width/height 同源调用,防调用方尺寸与样式脱节)
 * @param iconH 图标渲染高度(px;同上)
 * @param offset 契约像素偏移 [x, y](元组形态;无 = 左上角锚点)
 */
export function resolveTMapMarkerAnchor(
  iconW: number,
  iconH: number,
  offset: [number, number] | undefined,
): { x: number; y: number } {
  // 0 - x 而非 -x:避免无 offset 时产出 -0(deepEqual 0 ≠ -0)
  return {
    x: offset ? 0 - offset[0] : 0,
    y: offset ? 0 - offset[1] : 0,
  };
}

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
// 底图样式:MapStyleId → TMap baseMap + mapStyleId(glMap 底图)
// SDK v1.8.0.2 实包源码核实(2026-08-22 ws-b + ws-d):
// - baseMap.type 合法值仅 vector/satellite/traffic/handdraw/oversea
//   (MAP_TYPE 常量 o={vector,satellite,traffic,handdraw,oversea}),
//   **无 styleType 字段**(旧注释「styleType:'dark' 存在」有误)、
//   **无 'raster' 值**(v1.8.0.2 全包 2.2MB 零处 'raster' 字符串,ws-d 坐实);
// - **卫星底图正确形态 = `{ type: 'satellite' }`**(ws-d,2026-08-22):
//   卫星判定 oc(t) = t.type === MAP_TYPE.satellite(hasSatellite 用);
//   features 缺省回退 DEFAULT_BASEMAP.satellite = [satellite_base, road]
//   (影像 + 道路注记,审图号 GS(2025)5644号);旧实现传 'raster' 是非值 →
//   Vl() 回退查 DEFAULT_BASEMAP['raster'] = undefined → features 空 →
//   不建任何底图层 → 瓦片请求不发、地图全白(boss 真机坐实 2026-08-22);
//   运行期 setBaseMap({type:'satellite'}) 与构造期 baseMap 同路径
//   (layerResource.setBaseMap → _initBaseLayer);
// - 暗色 = 独立 Map 选项 mapStyleId(STYLE_ID 常量 {DEFAULT:0,DARK:1,LIGHT:2,
//   GAME:3},'DARK' → 矢量暗色底图层 Tencent.Normal.Dark,见
//   _addLayerByBaseMapInfo);运行期经 setMapStyleId(id) 切换底图层;
// - 契约 MapStyleId 语义不变:whitesmoke(UI「深色」按钮 / 系统深色偏好的
//   value,见 map-shell layers-panel 样式行)在本引擎映射为暗色矢量底图
// ------------------------------------------------------------

function styleToBaseMap(style: MapStyleId): { type: string } {
  return { type: style === 'satellite' ? 'satellite' : 'vector' };
}

/** 暗色样式 → TMap mapStyleId 选项(见上注释;返回 undefined = 不传,SDK 默认) */
function styleToMapStyleId(style: MapStyleId): string | undefined {
  return style === 'whitesmoke' ? 'DARK' : undefined;
}

/** 比例尺档位(SDK v1.8.0.2 Eo 常量:按 zoom 取整索引的「米」档位,z>22 → 1) */
const TENCENT_SCALE_NICE_METERS = [
  2e6, 2e6, 2e6, 2e6, 1e6, 5e5, 2e5, 1e5, 5e4, 2e4, 1e4, 5e3, 2e3, 1e3,
  500, 200, 100, 50, 20, 10, 5, 2, 1,
] as const;
/** 比例尺每像素米数基数(SDK v1.8.0.2 Oo 公式常量:156543.04 = 6378137·2π/256) */
const TENCENT_SCALE_RESOLUTION_BASE = 156543.04;

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
    // 版权/logo:隐藏(用户 2026-08-22 明确要求去掉腾讯水印;ToS 署名权衡见
    // tech/23 ws-b 节)。水印 DOM 经 SDK v1.8.0.2 源码核实:img[src*=
    // "logo_def.png"](logo 控件首子元素)+ div.logo-text(©2026 Tencent -
    // GS(2026)1190号 文字)。display:none 只摘控件自身,不影响 canvas 与
    // 覆盖物渲染;自有样式(.dm-cluster 等)不在 copyright/logo/attribution
    // 类名命中之列,不受影响。
    const attribution = container.querySelectorAll(
      '[class*="copyright"], [class*="logo"], [class*="attribution"]',
    );
    for (const el of attribution) {
      el.style.display = 'none';
      el.style.pointerEvents = 'none';
    }
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
  /** MultiMarker setMap 缺失告警一次性标记(SDK v1.8.0.2 恒有 setMap,仅极老形态缺失) */
  private multiSetMapWarned = false;
  /** 单点 Marker setIcon 降级告警一次性标记(npm SDK 老形态无 setIcon) */
  private singleIconWarned = false;
  /** 共享 MultiMarker 实例(批量化核心:单实例承载全部 geometry;首次 createMarker 惰性创建) */
  private multiMarker: any = null;
  /** content DOM 覆盖物注册表(全部活覆盖物;destroy/相机变化统一刷新/摘除) */
  private contentOverlays: Array<{ el: HTMLDivElement; redraw: () => void }> = [];
  /** content 覆盖物重定位的地图事件解绑(懒注册一次:zoom/drag/dragend/idle) */
  private contentOverlayOffs: Array<() => void> = [];
  /** 地图事件是否已注册(content 覆盖物重定位,幂等标记) */
  private contentOverlayEventsBound = false;
  /** lngLatToContainerPoint 缺失一次性告警标记(防御:老 SDK 无法定位) */
  private contentOverlayProjectWarned = false;
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
  /** MultiMarker click 绑定簿记(数组,ws-a 2026-08-22):契约 cb → { id, handler
   * (带 geometry.id 过滤) } 的**绑定记录数组**。id 关联是共享实例下精确解绑的
   * 前提(off 缺省 cb 只解本 marker);**用数组而非 Map<cb,...>**——同一 cb 注册到
   * 多个 marker 时(调用方复用回调),Map 会被后注册覆盖导致 off/remove 解绑错位 */
  private multiClickBindings: Array<{ cb: () => void; id: string; handler: (e: any) => void }> = [];
  /** 自绘比例尺 DOM(SDK 无公共 ScaleControl 的降级路径;见 addControl) */
  private scaleEl: HTMLDivElement | null = null;
  /** 自绘比例尺事件解绑簿记(zoom_changed/scale_changed/zoomend/idle) */
  private scaleOffs: Array<() => void> = [];
  /** 自绘比例尺降级说明一次性标记(防 resize 重建刷屏) */
  private scaleFallbackWarned = false;

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
    this.redrawContentOverlays(); // 程序化相机变化 → content 覆盖物重定位
  }

  setZoom(zoom: number, animateMs?: number): void {
    if (animateMs && animateMs > 0) {
      this.raw.flyTo({ zoom, duration: animateMs });
    } else {
      this.raw.setZoom(zoom);
    }
    this.redrawContentOverlays();
  }

  setPitch(pitch: number): void {
    this.raw.setPitch(pitch);
    this.redrawContentOverlays();
  }

  setRotation(rotation: number): void {
    this.raw.setRotation(rotation);
    this.redrawContentOverlays();
  }

  setBounds(bounds: MapBounds): void {
    // LatLngBounds(西南角, 东北角);LatLng 纬度在前
    const sw = new this.tmap.LatLng(bounds.south, bounds.west);
    const ne = new this.tmap.LatLng(bounds.north, bounds.east);
    this.raw.setBounds(new this.tmap.LatLngBounds(sw, ne));
    this.redrawContentOverlays();
  }

  flyTo(opts: { center: LngLat; zoom?: number }): void {
    const viewport: Record<string, unknown> = {
      center: toTMapLatLng(this.tmap, opts.center),
    };
    if (opts.zoom !== undefined) viewport.zoom = opts.zoom;
    this.raw.flyTo(viewport);
    this.redrawContentOverlays();
  }

  setStyle(style: MapStyleId): void {
    // SDK v1.8.0.2 核实:baseMap.type 无暗色(styleType 字段不存在);暗色 = 独立
    // Map 选项 mapStyleId('DARK' → 矢量暗色底图层 Tencent.Normal.Dark)。
    // 顺序:先 setBaseMap(存底图),再 setMapStyleId(清底图层 + 按新 styleId 重建,
    // 见 layerResource.setMapStyleId)。whitesmoke(UI「深色」)→ 暗色,不告警。
    this.raw.setBaseMap(styleToBaseMap(style));
    const styleId = styleToMapStyleId(style);
    if (styleId !== undefined) {
      if (typeof this.raw.setMapStyleId === 'function') {
        this.raw.setMapStyleId(styleId);
      } else {
        console.warn(`[map-engine] tencent 无 setMapStyleId,深色样式降级 normal`);
      }
    } else if (typeof this.raw.setMapStyleId === 'function') {
      // 切回标准/卫星:复位暗色,防暗色底图层残留
      this.raw.setMapStyleId('DEFAULT');
    }
  }

  on(event: MapViewEvent, cb: () => void): () => void {
    const vendorEvent = EVENT_NAME_MAP[event] ?? event;
    const handler = () => cb();
    // TMap.on 无返回值;engine-mock 的 on 返回解绑函数 → 直通
    const off = this.raw.on(vendorEvent, handler);
    return typeof off === 'function' ? off : () => this.raw.off(vendorEvent, handler);
  }

  createMarker(opts: MapMarkerOptions): MapMarker {
    // content 存在**且无 icon** → DOM overlay 渲染 HTML(2026-08-22 ws-pinfix2):
    // agent 蓝点等无 icon 内容形态;不走 MultiMarker(无 HTML 渲染 + 无 icon 样式
    // 被 GL 拒绝 = 目标点不可见根因)。
    // **content+icon 并存(公司 POI 徽章 / 聚合徽章)与有 icon → 既有 icon 路径**
    // (2026-08-22 ws-h 收窄:ws-pinfix2 曾让全部 content(含 content+icon
    // 并存)走 DOM overlay → 真实 SDK lngLatToContainerPoint 定位失效,POI
    // 全部堆叠;回归 ws-c 语义:icon 是 TMap 渲染形态(纹理),content 不参与,
    // 避免 HTML 双渲染叠印)。无 content 无 icon 走构造器多路径(单点 Marker /
    // MultiMarker 聚合;v=1.exp 全局 TMap 无单点 Marker → MultiMarker)
    if (opts.content !== undefined && !opts.icon) return this.createContentOverlay(opts);
    if (typeof this.tmap.Marker === 'function') return this.createSingleMarker(opts);
    if (typeof this.tmap.MultiMarker === 'function') return this.createMultiMarker(opts);
    console.error('[map-engine] TMap 无 Marker/MultiMarker,命名空间:', Object.keys(this.tmap || {}));
    throw new Error('[map-engine] TMap 无 Marker/MultiMarker,无法创建 marker');
  }

  /**
   * content → DOM 覆盖物渲染(TMap 容器内绝对定位 div;项目实证可用机制:
   * 自绘比例尺 ensureFallbackScale 同路径——直接 appendChild 到
   * getContainer(),生产坐实可用)。
   * - 定位:`lngLatToContainerPoint(lngLat)` → **真实 SDK 缺此 API(v1.8.0.2
   *   实测 ws-h)→ 兜底 `projectToContainer(latLng)`**(均返回容器像素 {x,y})
   *   → 容器像素 - 契约 offset(div 左上角 = 屏幕位 - offset;锚定一致性,
   *   与 amap content 语义对齐;agent 蓝点 offset [-10,-10] → 圆心对准坐标);
   * - 内容原样注入 innerHTML(转义边界:content 是引擎调用方可信的 HTML,与
   *   amap 同语义,原样注入——既有契约);
   * - click 绑 div(内容子元素冒泡可达)+ stopPropagation(不触发地图 click,
   *   与 amap marker click 不冒泡同语义;徽章/蓝点点击不得清选中);
   * - 相机变化重定位双通道:地图事件(zoom/drag/dragend/idle,兜底用户交互)
   *   + 视图相机方法(setCenter 等,兜底程序化相机;idle 为 debounce 收敛);
   * - 移除 = div 摘除 + 注册表清理;raw 带 setMap(null)/remove 供 map-shell
   *   摘除分派(badgeCleanupHandle);
   * - **仅无 icon 的 content 到达本路径**(ws-h 收窄):content+icon 并存时
   *   icon 为渲染主机制(MultiMarker 纹理,见 createMultiMarker)——icon 不
   *   参与 DOM overlay(content HTML 双渲染会与 icon 纹理叠印;回归 ws-a/
   *   ws-c 语义:icon 是 TMap 渲染形态)。
   * 防御性守卫:无 DOM/容器 → createContentFallback(单点 Marker 原生 content /
   * MultiMarker icon 化降级,不抛错)。
   */
  private createContentOverlay(opts: MapMarkerOptions): MapMarker {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      return this.createContentFallback(opts);
    }
    const container = this.raw.getContainer?.();
    if (!container || typeof container.appendChild !== 'function') {
      return this.createContentFallback(opts);
    }
    const tmap = this.tmap;
    const offset = opts.offset;
    const clickHandlers: Array<() => void> = [];
    if (opts.onClick) clickHandlers.push(opts.onClick);
    let position = opts.position;
    const el = document.createElement('div');
    // 类名避开 hideControlDom 的 tencent-map-* 选择器(pointer-events 解除面)
    el.className = 'dm-engine-content';
    el.style.position = 'absolute';
    el.style.zIndex = String(opts.zIndex ?? TENCENT_MARKER_DEFAULT_ZINDEX);
    const extras = opts as unknown as { cursor?: string };
    if (extras.cursor) el.style.cursor = extras.cursor;
    el.innerHTML = opts.content ?? ''; // 原样注入(可信 HTML 契约)
    const onClick = (e: { stopPropagation?: () => void }) => {
      e.stopPropagation?.();
      for (const cb of clickHandlers) cb();
    };
    el.addEventListener('click', onClick);
    container.appendChild(el);
    const project = () => {
      // 定位 API 双路径(2026-08-22 ws-h 真机实测):真实 SDK v1.8.0.2 Map 原型
      // **无 lngLatToContainerPoint**(`typeof === 'undefined'`,ws-pinfix2 假定
      // 的官方命名不存在 → 判空失败 → 全部覆盖物不定位 → 堆叠根因);实测
      // **projectToContainer(latLng) 返回容器像素 {x,y}**(center → 精确容器
      // 中心;容器契约点偏移正向)。优先走既有名(测试双面/未来 SDK 兼容),
      // 兜底 projectToContainer(真实 SDK 适配);两者皆无 → 一次性 warn + 跳过
      const proj = this.raw.lngLatToContainerPoint ?? this.raw.projectToContainer;
      if (typeof proj !== 'function') {
        if (!this.contentOverlayProjectWarned) {
          this.contentOverlayProjectWarned = true;
          console.warn('[map-engine] TMap 无 lngLatToContainerPoint/projectToContainer,content 标记无法定位');
        }
        return null;
      }
      return proj.call(this.raw, toTMapLatLng(tmap, position));
    };
    const redraw = () => {
      const px = project();
      if (!px || typeof px.x !== 'number' || typeof px.y !== 'number') return;
      el.style.left = `${px.x - (offset?.[0] ?? 0)}px`;
      el.style.top = `${px.y - (offset?.[1] ?? 0)}px`;
    };
    this.contentOverlays.push({ el, redraw });
    this.ensureContentOverlayEvents();
    redraw();
    let attached = true;
    const detach = () => {
      if (!attached) return;
      attached = false;
      this.contentOverlays = this.contentOverlays.filter((o) => o.el !== el);
      try {
        if (el.parentNode && typeof el.parentNode.removeChild === 'function') {
          el.parentNode.removeChild(el);
        }
      } catch {
        // 已脱离 DOM:忽略
      }
      try {
        el.removeEventListener('click', onClick);
      } catch {
        // 解绑失败不影响移除语义
      }
    };
    const overlayObj = {
      el,
      map: this.raw,
      getMap: () => (attached ? this.raw : null),
      // map-shell 摘除分派(setMap(null) 形态;徽章清理句柄收敛为 wrapper.remove)
      setMap: (next: unknown) => {
        if (!next) detach();
      },
      remove: detach,
    };
    return {
      raw: overlayObj,
      setPosition: (p: LngLat) => {
        position = p;
        redraw();
      },
      setContent: (html: string) => {
        el.innerHTML = html;
        redraw();
      },
      setZIndex: (z: number) => {
        el.style.zIndex = String(z);
      },
      setVisible: (v: boolean) => {
        el.style.display = v ? '' : 'none';
      },
      on: (event: 'click', cb: () => void) => {
        if (event !== 'click') return;
        clickHandlers.push(cb);
      },
      off: (event: 'click', cb?: () => void) => {
        if (event !== 'click') return;
        if (cb) {
          const i = clickHandlers.indexOf(cb);
          if (i >= 0) clickHandlers.splice(i, 1);
        }
        // cb 缺省:保留(与既有引擎 off 语义一致,调用方应传 cb 精确解绑)
      },
      remove: detach,
    };
  }

  /** content 回退路径(无 DOM/容器):既有行为不变——单点 Marker 原生 content
   * (npm SDK 形态)或 MultiMarker icon 化降级(一次性 warn;SDK 无 HTML 渲染) */
  private createContentFallback(opts: MapMarkerOptions): MapMarker {
    if (typeof this.tmap.Marker === 'function') return this.createSingleMarker(opts);
    if (typeof this.tmap.MultiMarker === 'function') return this.createMultiMarker(opts);
    console.error('[map-engine] TMap 无 Marker/MultiMarker,命名空间:', Object.keys(this.tmap || {}));
    throw new Error('[map-engine] TMap 无 Marker/MultiMarker,无法创建 marker');
  }

  /** 内容 DOM 覆盖物重定位(相机变化统一入口:地图事件 + 视图相机方法) */
  private redrawContentOverlays(): void {
    for (const o of this.contentOverlays) o.redraw();
  }

  /** 懒注册地图事件(content 覆盖物首次创建时):相机变化 → 重定位。
   * TMap 事件集:zoom(缩放)/drag·dragend(拖拽)/idle(移动缩放后 debounce
   * 收敛)——用户交互(不经视图方法)的重定位兜底。 */
  private ensureContentOverlayEvents(): void {
    if (this.contentOverlayEventsBound) return;
    this.contentOverlayEventsBound = true;
    const redraw = () => this.redrawContentOverlays();
    for (const ev of ['zoom', 'drag', 'dragend', 'idle']) {
      const off = this.raw.on?.(ev, redraw);
      this.contentOverlayOffs.push(typeof off === 'function' ? off : () => this.raw.off?.(ev, redraw));
    }
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
    // HTML content:main dispatch 仅把 **content 且无 icon** 交给
    // createContentOverlay(DOM overlay)承载;本方法在 content+icon 并存(公司
    // POI 徽章/聚合徽章,icon 为渲染主机制,ws-h 收窄回归 ws-c)与 **DOM 不可用
    // 回退**时接收 content —— MultiMarker 无 HTML 渲染(SDK 核实:geometry.content
    // 是 GL 文本标签,MarkerStyle 仅图片 src)→ 降级默认点 + 一次性 warn。
    // **icon 存在时不降级**(ws-a,bug 1/6):icon → MarkerStyle(src) 真图标路径
    // 才是 TMap 渲染形态;content 只是 AMap 等引擎的 HTML 形态(公司 icon /
    // 聚合徽章 dataURL 图标均同时传 content+icon,契约 icon 缺省才走默认点)
    if (opts.content !== undefined && !opts.icon) this.warnMultiMarkerContentDegraded();

    let raw = this.multiMarker;
    if (!raw) {
      // 首个 marker:构造共享实例(首批 geometry + 已归组样式 + zIndex)
      // ⚠️ **构造不传 map,构造后显式 setMap 挂图**(ws-i 2026-08-23)。
      // SDK v1.8.0.2 实包源码 + 浏览器实测(两种形态都验证过):
      // - GeometryOverlay 构造器内部先执行 `_setGeometryType()`(置
      //   `_layerType="MARKER"`)→ 再 `e.map ? i.setMap(e.map)`;因此**无论
      //   构造传不传 map,layer.type 都是 "MARKER"、layer.level 都是 7
      //   (OVERLAY_NAA)**——原「构造时序导致 level=4 被标注层盖住」的推断
      //   不成立(实包源码核实 + 页面内双形态实验均 level 7;layerResource
      //   实测排序 rank 70020 > 底图 POI 标注层 vector_top_poi rank 60000
      //   → 徽章恒在文字标注之上);
      // - 统一「构造后 setMap」仅为形态收敛(与 destroy 的 setMap(null)
      //   对称、调用点单一),层级语义与构造传 map 完全等价;
      // - **真正问题(ws-i 实测)**:初始渲染竞态 —— geometry 数据经 geojson
      //   source(worker 异步)推送,与地图 idle/GL 初始化时序竞争,data 事件
      //   可能错过渲染管线 → 首帧 0 个徽章,直到用户交互(缩放/平移触发
      //   LOD 摘挂)才全部出现;实测 `setGeometries(全量重推)` 后视口内徽章
      //   立即全部渲染 → 挂图后补一次重推消除竞态(见下方)。
      const mmOpts: Record<string, unknown> = {
        geometries: [geometry],
        // SDK 核实:overlay zIndex → layer rank 排序(越大越靠上;同一 level 内)
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
      // 构造后挂图(见上注释:修复 SDK 构造顺序 bug 的必需步骤;destroy 摘除
      // 已依赖 setMap(null),此处同款可用性)。老 SDK 无 setMap → 一次性 warn
      // 降级不抛(实例挂不上图,由调用方可见性逻辑兜底)。
      if (typeof raw.setMap === 'function') {
        raw.setMap(this.raw);
      } else {
        this.warnMultiMarkerSetMapDegraded();
      }
      // 初始渲染竞态修复(ws-i 2026-08-23 实测):GeometryOverlay 的
      // geometry_changed → layer 重建链在页面初始(地图 idle/渲染管线未稳)
      // 可能整体错过 → 首帧 0 个徽章(用户交互/缩放后 LOD 摘挂才全部出现;
      // 实测对共享实例做**全量** setGeometries 重推 → 视口内徽章立即全部
      // 渲染)。setTimeout(0) 让本次同步批量(数百 add)先完成,再一次性
      // 重推全量 —— 此刻重推的是完整 geometry 集,数据事件重触发渲染管线。
      // setGeometries 传引用相同数组时 SDK guard 直接返回,必须传副本。
      // 老 SDK 无 setGeometries → 跳过(用户交互兜底)。
      if (typeof raw.setGeometries === 'function' && typeof setTimeout === 'function') {
        const mm = raw;
        setTimeout(() => {
          mm.setGeometries(mm.geometries?.slice?.() ?? []);
        }, 0);
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
        // 仅挂载态 updateGeometries(ws-a SDK 源码核实):SDK updateGeometries 对
        // **不在 _idSet 的 id 会重新 add**(geometry 被 LOD 摘除后)→ 隐藏期
        // setPosition 会把该 geometry 重新挂回图层(可见 + 可点),破坏可见性
        // 状态;隐藏期只原地改共享 geometry 对象,重新挂载(add)时自然带新位置。
        if (this.multiAttached.has(id) && this.multiMarker) {
          raw.updateGeometries([geometry]);
        }
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
      // 实例级 setVisible 会误伤全部 marker,不可用(ws-6 批量化设计)。
      // remove() 之后(geometry 已从 multiGeometries 注销)setVisible 置空
      // no-op,防僵尸重挂(ws-a)。
      setVisible: (v: boolean) => {
        if (!this.multiMarker) return;
        if (!this.multiGeometries.has(id)) return;
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
        // 按绑定记录解绑:cb 给定时只解「本 marker 上该 cb」的绑定(同一 cb 注册
        // 到多个 marker 时互不影响,ws-a 数组簿记);cb 缺省 = 解绑本 marker 全部
        // click(共享实例必须按 id 过滤,不能清全量——会误伤其他 marker 的回调)
        const rest = [];
        for (const binding of this.multiClickBindings) {
          const match = binding.id === id && (cb === undefined || binding.cb === cb);
          if (match) this.multiMarker.off?.('click', binding.handler);
          else rest.push(binding);
        }
        this.multiClickBindings = rest;
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
        const rest = [];
        for (const binding of this.multiClickBindings) {
          if (binding.id === id) this.multiMarker.off?.('click', binding.handler);
          else rest.push(binding);
        }
        this.multiClickBindings = rest;
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
   *   为 dataURL 数据图或远程 URL);公司 icon / 聚合徽章走本路径真图标渲染
   *   (content+icon 并存时 icon 为渲染主机制,ws-h 收窄回归 ws-c——content
   *   由 createContentOverlay DOM overlay 承载仅限无 icon 的内容形态);
   * - 契约 icon 缺省 → 默认 pin;icon 存在 → 真图标;content 不写入 geometry
   *   (主路径 content 不经本方法;回退路径 MultiMarker 无 HTML 渲染);
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
    // anchor 按契约 offset 计算(ws-c 修正,纯函数 resolveTMapMarkerAnchor):
    // 契约 offset = AMap content 语义(左上角置于 屏幕位+offset)→ SDK 锚点
    // = -offset,与图标尺寸无关(旧公式 (w/2-ox, h-oy) 把徽章/图钉整图上移
    // 左上,表现为「POI 坐标偏移」bug 3——见 tech/23 ws-c 回填)。三形态落点:
    // 图钉 [-16,-40]→(16,40) 底尖、徽章 [-20,-20]→(20,20) 中心、
    // 聚合 [-s/2,-s/2]→(s/2,s/2) 中心,与高德/百度逐像素一致。
    const anchor = resolveTMapMarkerAnchor(iconW, iconH, opts.offset);
    const styleOpts: Record<string, unknown> = {
      anchor: new this.tmap.Point(anchor.x, anchor.y),
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
   * 绑定记录 push 进 multiClickBindings(数组,支持同一 cb 注册到多个 marker
   * 的精确解绑);同 (cb, id) 重复注册去重(防 on 两次双触发)。
   */
  private bindMultiMarkerClick(raw: any, id: string, cb: () => void): void {
    if (typeof raw.on !== 'function') return;
    if (this.multiClickBindings.some((b) => b.cb === cb && b.id === id)) return;
    const handler = (e: any) => {
      if (e?.geometry?.id === id) cb();
    };
    this.multiClickBindings.push({ cb, id, handler });
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

  /** MultiMarker setMap 缺失告警(一次性;SDK v1.8.0.2 实包核实 GeometryOverlay 恒有
   * setMap,仅异常/极老形态缺失;缺失时共享实例挂不上图,降级不抛) */
  private warnMultiMarkerSetMapDegraded(): void {
    if (this.multiSetMapWarned) return;
    this.multiSetMapWarned = true;
    console.warn('[map-engine] TMap MultiMarker 无 setMap,实例无法挂图(层 rank 修复降级)');
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

  addControl(
    kind: 'scale',
    opts?: { position?: string; offset?: [number, number] },
  ): Promise<{ hide: () => void; show: () => void } | null> | null {
    if (kind !== 'scale' || this.destroyed) return null;
    // 控件命名空间双路径兜底(TMap 未来版本/兼容形态存在 control/Control 时;
    // 位置用官方文档字符串形态,SDK 内部枚举见 CONTROL_POSITION.BOTTOM_RIGHT=8)。
    // 缺失时不再仅 warn 降级——v1.8.0.2 公共命名空间恒缺失(见下注释),走自绘
    // 比例尺,让比例尺真实可用。
    const ctrlNs = (this.tmap.control ?? this.tmap.Control) as
      | { ScaleControl?: new (opts?: unknown) => unknown }
      | undefined;
    if (ctrlNs?.ScaleControl) {
      this.raw.addControl(new ctrlNs.ScaleControl({ position: 'bottomRight' }));
      return null;
    }
    // SDK v1.8.0.2 源码核实(2026-08-22 ws-b):公共命名空间装配表(Yd)只含
    // Map/LatLng/MultiMarker/MarkerStyle/constants 等,**无 control/Control/
    // ScaleControl**(v=1.exp 全局形态)→ 双路径必失败,旧实现比例尺恒缺失。
    // 降级:自绘 SDK 内部比例尺同款 DOM(tmap-scale-control/line/text 类名),
    // 按 SDK 官方公式与档位渲染,监听 zoom_changed/scale_changed/zoomend/idle
    // 自动更新 —— 与高德一致(右下/左下角、随 zoom 更新)。
    return Promise.resolve(this.ensureFallbackScale(opts));
  }

  /**
   * 自绘比例尺(降级路径)。SDK 内部比例尺(Control 基类派生)类不公开,无法
   * addControl 构造;按内部实现(Oo/Mo 模块)等价复刻:
   * - 每像素米数 m/px = 156543.04 / scale · cos(lat·π/180) / 2^zoom(Oo 公式);
   * - 档位 TENCENT_SCALE_NICE_METERS(Eo 常量,按 zoom 取整索引);
   *   g < 1000 → "N 米",否则 "N 公里"(vo 常量 米/公里);
   * - 条宽 = round(g / m/px) − 10(To 公式),下限 12px;
   * - 自动更新:内部控件只挂 zoom_changed/scale_changed,补 zoomend/idle
   *   防低版本事件漏发。
   * opts 位置/偏移与 AMap 引擎同语义(map-shell duck-type 透传):
   * 'LT' 左上 / 'LB' 左下(默认)/ 'RT' 右上 / 'RB' 右下。
   */
  private ensureFallbackScale(opts?: {
    position?: string;
    offset?: [number, number];
  }): { hide: () => void; show: () => void } | null {
    if (typeof document === 'undefined') return null;
    const container = this.raw.getContainer?.();
    if (!container || typeof container.appendChild !== 'function') return null;
    this.removeFallbackScale();
    const el = document.createElement('div');
    el.className = 'tmap-scale-control';
    el.style.cssText = 'position:absolute;width:100px;height:35px;pointer-events:none;z-index:1000;';
    const pos = opts?.position ?? 'LB';
    const offset = opts?.offset ?? [10, 10];
    if (pos === 'LT') {
      el.style.left = `${offset[0]}px`;
      el.style.top = `${offset[1]}px`;
    } else if (pos === 'RT') {
      el.style.right = `${offset[0]}px`;
      el.style.top = `${offset[1]}px`;
    } else if (pos === 'RB') {
      el.style.right = `${offset[0]}px`;
      el.style.bottom = `${offset[1]}px`;
    } else {
      // 'LB'(默认,与 AMap 引擎默认一致)与未知取值
      el.style.left = `${offset[0]}px`;
      el.style.bottom = `${offset[1]}px`;
    }
    const line = document.createElement('div');
    line.className = 'tmap-scale-line';
    line.style.cssText = 'position:absolute;bottom:8px;left:0;height:7px;background:#333;';
    const text = document.createElement('div');
    text.className = 'tmap-scale-text';
    text.style.cssText =
      'position:absolute;bottom:16px;left:0;font-size:11px;color:#333;' +
      'text-shadow:0 0 3px #fff,0 0 6px #fff;white-space:nowrap;';
    el.appendChild(line);
    el.appendChild(text);
    container.appendChild(el);
    this.scaleEl = el;
    const update = () => this.updateFallbackScale(line, text);
    for (const ev of ['zoom_changed', 'scale_changed', 'zoomend', 'idle']) {
      const off = this.raw.on?.(ev, update);
      this.scaleOffs.push(typeof off === 'function' ? off : () => this.raw.off?.(ev, update));
    }
    update();
    if (!this.scaleFallbackWarned) {
      this.scaleFallbackWarned = true;
      console.info('[map-engine] TMap SDK 无公共 ScaleControl(v1.exp),使用自绘比例尺(SDK 同款公式/档位)');
    }
    return {
      hide: () => {
        el.style.display = 'none';
      },
      show: () => {
        el.style.display = '';
      },
    };
  }

  /** 自绘比例尺刷新(SDK Oo/Mo 同款公式与 Eo 档位;中心/zoom 缺失时不刷新) */
  private updateFallbackScale(line: HTMLDivElement, text: HTMLDivElement): void {
    const c = this.raw.getCenter?.();
    const z = this.raw.getZoom?.();
    const s = this.raw.getScale?.();
    if (!c || typeof c.lat !== 'number' || typeof z !== 'number') return;
    const mpp =
      Math.abs((TENCENT_SCALE_RESOLUTION_BASE / (s ?? 1)) * Math.cos((c.lat * Math.PI) / 180)) /
      Math.pow(2, z);
    const g = z > 22 ? 1 : (TENCENT_SCALE_NICE_METERS[Math.round(z)] ?? 1);
    const px = Math.max(12, Math.round(g / mpp) - 10);
    line.style.width = `${px}px`;
    text.textContent = g < 1000 ? `${g} 米` : `${g / 1000} 公里`;
  }

  /** 摘除自绘比例尺 DOM 并解绑事件(resize 重建 / destroy 共用) */
  private removeFallbackScale(): void {
    if (this.scaleEl) {
      try {
        this.scaleEl.parentNode?.removeChild(this.scaleEl);
      } catch {
        // 已脱离 DOM:忽略
      }
      this.scaleEl = null;
    }
    for (const off of this.scaleOffs) {
      try {
        off();
      } catch {
        // 解绑失败不影响主流程
      }
    }
    this.scaleOffs = [];
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // 自绘比例尺摘除(降级路径 DOM + 事件解绑)
    this.removeFallbackScale();
    // content DOM 覆盖物摘除(div 直挂容器,销毁必须手动清理,防 DOM 泄漏)
    for (const o of this.contentOverlays) {
      try {
        if (o.el.parentNode && typeof o.el.parentNode.removeChild === 'function') {
          o.el.parentNode.removeChild(o.el);
        }
      } catch {
        // 已脱离 DOM:忽略
      }
    }
    this.contentOverlays = [];
    for (const off of this.contentOverlayOffs) {
      try {
        off();
      } catch {
        // 解绑失败不影响销毁语义
      }
    }
    this.contentOverlayOffs = [];
    this.contentOverlayEventsBound = false;
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
    this.multiClickBindings = [];
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
      // 参数对齐 AMap.Geolocation:高精度(GPS)定位;maximumAge 0 禁用位置缓存,
      // 每次定位都重新请求 → 「定位 = 真实当前位置」(60s 缓存会让移动后重复定位返回旧位)
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
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
    // ws-b(2026-08-22):暗色 = 独立 Map 选项 mapStyleId(SDK v1.8.0.2 核实无
    // styleType 字段);初始样式 whitesmoke(UI「深色」/系统深色偏好)→ 构造期
    // 即暗色矢量底图(仅当初始样式为暗色时透传,normal/satellite 不传)
    const initialStyleId = styleToMapStyleId(opts.style);
    const raw = new tmap.Map(opts.container, {
      center: toTMapLatLng(tmap, opts.center),
      zoom: opts.zoom,
      pitch: opts.pitch ?? 0,
      rotation: opts.rotation ?? 0,
      baseMap: styleToBaseMap(opts.style),
      ...(initialStyleId ? { mapStyleId: initialStyleId } : {}),
      // 禁用 TMap 默认控件(SDK v1.8.0.2 核实:false 时不创建 zoom/scale 默认
      // 控件,版权标识保留):避免其内部 DOM z-index 高于 map-shell UI 遮挡点击
      showControl: false,
      // 滚轮缩放显式启用(2026-08-22 ws-b,bug 2「滚轮不丝滑」SDK 核实):
      // - **smoothWheelZoom 选项不存在**(SDK v1.8.0.2 实包 2.2MB 全包 0 处命中;
      //   Leaflet 2D 适配层的 scrollWheelZoom 是另一地图路径,与 GL 无关);
      // - 滚轮平滑是 **SDK 内建行为**:Map 选项 `scrollable`(MAP_3D/MAP_2D
      //   默认均为 true)启用滚轮处理器,输入分类 wheel(鼠标滚轮)→
      //   zoomTo({duration:200, smoothEasing:true}) 平滑动画,trackpad(触控板/
      //   像素增量)→ duration:0 即时应答(SDK 设计,与 mapbox 同源);
      //   运行期可用 setScrollable(bool) 切换;
      // - 显式传 scrollable:true 自文档化 + 防御未来 SDK 默认值漂移
      //   (测试断言构造选项含此键)。
      scrollable: true,
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
