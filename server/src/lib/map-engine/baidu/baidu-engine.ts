// ============================================================
// 百度地图 GL(BMapGL)引擎 — MapEngine 适配层(ws-e)
//
// 本引擎是全计划唯一坐标分叉点:coordSystem = 'bd09'(百度原生坐标系),
// 适配层在**边界**做 gcj02↔bd09 换算(coord-utils 纯函数),内部一律
// bd09,对外一律 gcj02(规范坐标):
//   - 入参(gcj02)→ bd09:createMarker / createCircle / setCenter /
//     setBounds / flyTo / searchPOI(周边中心)
//   - 出参(bd09)→ gcj02:getState / getBounds / searchPOI 结果 /
//     fetchSuggestions / geocodeAddress / getCurrentPosition(SDK fallback
//     通道;主通道为浏览器 wgs84→gcj02,见 browserPosition 注释)
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
import { bd09ToGcj02, gcj02ToBd09, wgs84ToGcj02 } from '../coord-utils.ts';
import { loadScript, resetScriptLoader } from '../script-loader.ts';
import { isRemoteIconUrl, preflightRemoteIcon, remoteIconStatus } from '../icon-preflight.ts';
import type { ScriptConfig, ScriptInjection } from '../script-loader.ts';

/** 百度 GL 全局命名空间名(与 engine-registry 描述一致) */
export const BAIDU_NAMESPACE = 'BMapGL';
/** 百度 AK 环境变量名(与 engine-registry 描述一致) */
export const BAIDU_KEY_VAR = 'NEXT_PUBLIC_BAIDU_AK';
/** BMapGL 就绪轮询间隔(ms):getscript 同步定义命名空间,轮询为防御(半载/异常) */
const BAIDU_READY_POLL_MS = 50;
/** BMapGL 就绪轮询上限(40 × 50ms = 2s):超时抛「命名空间未就绪」,
 * switch 回滚契约依赖该错误(2026-08-22 ws-6 与 TMap 就绪超时同量级) */
const BAIDU_READY_MAX_POLLS = 40;
/** 地图就绪等待超时(ms):BMapGL 异步渲染,AK 被禁用时 SDK 内部异步失败——
 * Map 创建成功但不渲染、瓦片 403 走 4s×3 重试路径 → 就绪信号 1.5s 内不触发
 * → 超时抛「BMapGL 地图就绪超时」,switch 回滚契约依赖 createView 抛错
 * (绝不返回空图;2026-08-22 ws-7,与腾讯 TENCENT_MAP_READY_TIMEOUT_MS 1.5s
 * 同量级) */
const BAIDU_MAP_READY_TIMEOUT_MS = 1500;
/**
 * 官方 GL 加载器 URL(2026-08-22 ws-6 实测坐实,见 tech/23 回填):
 * **直连 getscript 本体,绕过 /api 包装器**。
 * 诊断:官方 /api 包装器(401B)内部 `document.write` 注入 getscript 子脚本
 * + bmap.css —— 运行时异步注入(SPA)时浏览器拦截 document.write
 * (Failed to execute 'write' on 'Document')→ 子脚本不加载 → BMapGL 永不
 * 就绪 → switchEngine 失败回滚(boss 冒烟坐实)。getscript 本体(实测 1.2MB,
 * 2026-08-22 抓取)grep 零 document.write,同步定义 window.BMapGL +
 * BMAPGL_* 常量 → 直连即绕开拦截。
 * 注 1:`v=3.0` 的 /api 包装器与 `v=1.0` 逐字节相同(实测)——升级版本号
 * 不解决 document.write,故沿用 getscript v=1.0(当前 GL 唯一真实入口)。
 * 注 2:官方文档 URL https://api.map.baidu.com/api?v=1.0&type=webgl&ak=<AK>
 * 仅用于浏览器地址栏同步解析场景;本引擎的运行时注入一律直连 getscript。
 */
export const BAIDU_SCRIPT_URL = (ak: string): string =>
  `https://api.map.baidu.com/getscript?type=webgl&v=1.0&ak=${encodeURIComponent(ak)}`;

/** 透明 1×1 GIF data URI:content 标记的锚点图标(r3 起为主路径——真实
 * BMapGL v1.0 Marker 无 setContent、自定义 Overlay 返回值不被挂载(见
 * createContentMarker 注释)→ content 视觉经厂商 BMap_Marker 点击目标 DOM
 * 注入,位置 = 屏幕位 + 契约 offset 由空白锚点图标 anchor=-offset 数学驱动,
 * 锚点必须由图标扛) */
const BAIDU_BLANK_ICON_DATA_URI =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// ------------------------------------------------------------
// 失败分类与可操作指引(bug 3 用户端「百度加载不了」诊断,2026-08-22 ws-c)
// 用户端加载不了 ≠ 代码回归(boss Playwright 实测正常):按失败阶段分类给出
// 可操作指引(硬刷新 / localhost:3000 / referer 白名单 / dev server 重启)。
// 分类依据诚实局限:离线沙箱无法核实 invalid-AK 的 getscript 响应形态,不做
// SDK 内部错误标记探测(无源码依据),保守按「失败阶段 + 命名空间/渲染信号」
// 分类;指引提示用户查看浏览器 console 的厂商原始错误作为补充通道。
// ------------------------------------------------------------

/** 百度引擎 load/createView 失败分类码(错误携带 + console 结构化输出) */
export type BaiduLoadErrorCode =
  | 'not-configured' // NEXT_PUBLIC_BAIDU_AK 缺失(env 问题)
  | 'script-load-failed' // script.onerror:网络/DNS/HTTP 失败(含 referer 被拒的 4xx)
  | 'script-blocked-by-client' // 请求被浏览器客户端拦截(广告拦截/隐私扩展,console 报 ERR_BLOCKED_BY_CLIENT)
  | 'namespace-not-ready' // 脚本已执行(HTTP 200)但 BMapGL.Map 未就绪:AK 无效/服务禁用/半载
  | 'map-ready-timeout' // Map 创建成功但渲染未就绪:AK 被禁用/瓦片被拒
  | 'unclassified';

/** 失败阶段 */
export type BaiduFailureStage = 'load' | 'createView';

/** 分类 → 可操作指引(用户可直接照做;覆盖 bug 3 排查清单四项假设 +
 * 2026-08-22 boss 坐实的 ERR_BLOCKED_BY_CLIENT 拦截根因) */
const BAIDU_FAILURE_GUIDANCE: Record<BaiduLoadErrorCode, string> = {
  'not-configured':
    '在 server/.env.local 配置 NEXT_PUBLIC_BAIDU_AK 后重启 dev server',
  'script-load-failed':
    '脚本拉取失败(网络/广告拦截/referer 被拒):若 console 该请求显示 net::ERR_BLOCKED_BY_CLIENT → 浏览器扩展/广告拦截器拦截,将 api.map.baidu.com 加入白名单或禁用拦截扩展;否则 1) 硬刷新(Cmd+Shift+R)清旧 bundle;2) 确认访问地址为 http://localhost:3000(非 localhost 会被百度 referer 白名单拒绝);3) lbsyun.console.baidu.com 的 referer 白名单加入当前访问地址;4) 确认改过 .env.local 后 dev server 已重启',
  'script-blocked-by-client':
    '浏览器扩展/广告拦截器拦截了百度脚本(console 该请求显示 net::ERR_BLOCKED_BY_CLIENT,2026-08-22 用户真机坐实):将 api.map.baidu.com 加入拦截器白名单/允许列表,或禁用拦截扩展后刷新;可用无痕窗口(默认无扩展)快速验证',
  'namespace-not-ready':
    '脚本已加载但 BMapGL 未就绪:多为 AK 无效/服务被禁用或脚本半载——1) 硬刷新(Cmd+Shift+R);2) lbsyun.console.baidu.com 确认 AK 有效、JS 服务已启用、referer 白名单含当前访问地址;3) 查看浏览器 console 的厂商错误信息',
  'map-ready-timeout':
    '地图创建成功但渲染未就绪:AK 被禁用或瓦片被拒(非 localhost:3000 访问时瓦片/SDK 会被拒)——确认 AK 服务状态与 referer 白名单;查看浏览器 console 厂商错误(如 APP Referer校验失败)',
  unclassified:
    '未知失败:查看浏览器 console 的厂商错误信息后重试;仍失败请回报错误原文',
};

/** 探测「客户端拦截」(广告拦截/隐私扩展,Chrome console 报 ERR_BLOCKED_BY_CLIENT):
 * 被拦截的请求**从未发出** → Resource Timing 里没有该 URL 的 entry;网络层失败
 * (断网/DNS/连接拒绝)会留下 entry(时长≈0)→ 用 entry 存在性区分。
 * 诚实标注的局限:performance 被清空/不可用时无法区分(回退 script-load-failed,
 * 其指引文本已同时覆盖拦截分支);同一 URL 历史成功 entry 存在时可能误判为
 * 网络失败(保守方向:归网络类,指引含拦截分支)。
 * 2026-08-22 boss 证据:用户 console `GET ...getscript... net::ERR_BLOCKED_BY_CLIENT`
 * —— 浏览器扩展拦截,非服务器拒绝、非 key 问题;Playwright 干净浏览器加载正常。 */
function isLikelyClientBlocked(url: string): boolean {
  try {
    const perf = globalThis.performance;
    if (typeof perf?.getEntriesByType !== 'function') return false;
    const entries = perf.getEntriesByType('resource') as Array<{ name?: string }>;
    return !entries.some((entry) => entry.name?.includes(url));
  } catch {
    return false;
  }
}

/** 结构化失败:Error + code/stage/guidance 属性(引擎层 failBaidu 抛出;mount
 * 路径原样上抛、分类可达 hook;switch 路径被 switch.ts 重包装,分类仅留在
 * 引擎层 console 输出) */
export interface BaiduFailure extends Error {
  code: BaiduLoadErrorCode;
  stage: BaiduFailureStage;
  guidance: string;
}

/** 构造并抛出带分类/指引的失败:console.error 结构化输出 + message 保留原始
 * 细节文本(switch 回滚契约与既有测试按子串匹配,不得改写) */
function failBaidu(
  code: BaiduLoadErrorCode,
  stage: BaiduFailureStage,
  detail: string,
  cause?: unknown,
): never {
  const err = new Error(`[map-engine] baidu ${stage} 失败(${code}):${detail}`) as BaiduFailure;
  err.code = code;
  err.stage = stage;
  err.guidance = BAIDU_FAILURE_GUIDANCE[code];
  if (cause !== undefined) (err as { cause?: unknown }).cause = cause;
  console.error('[map-engine] baidu 加载失败分类', {
    code,
    stage,
    detail,
    guidance: err.guidance,
    cause: cause instanceof Error ? cause.message : cause,
  });
  throw err;
}

/** 脚本加载失败标记(幂等恢复,2026-08-22 ws-c):load 中脚本加载成功(HTTP 200)
 * 但命名空间未就绪时置位——loadScript 的 URL 缓存留下已 resolve 的 promise,
 * 残缺/占位命名空间(BMapGL={} truthy)又命中 loadScript 全局短路 → 重试被
 * 双重绕过、不再注入,每次切换白烧 2s 轮询后失败且永不恢复。置位后下次
 * load 先恢复现场再重注入(重试即重新探测 AK 有效性)。 */
let baiduScriptLoadBroken = false;

/** 恢复脚本加载现场:删残缺/占位命名空间 + 清 loader URL 缓存 → 下次 load
 * 重新注入。resetScriptLoader 清三家缓存,仅在本引擎上次加载失败后调用——
 * 并发窗口极小,且各引擎 load 前有命名空间短路,重复注入无害(script-loader
 * 注释标注「测试用」,本处为生产恢复场景的刻意复用,见 tech/23 ws-c 回填)。 */
function recoverBaiduScriptLoad(): void {
  delete (globalThis as Record<string, unknown>)[BAIDU_NAMESPACE];
  resetScriptLoader();
}

// ------------------------------------------------------------
// BMapGL 脚本注入(Baidu 专用同步注入器 + 就绪轮询)
// ------------------------------------------------------------

/**
 * BMapGL 同步注入器:script.async=false + 无 defer + 挂 document.head 最前。
 * - script-loader 默认注入器是 async=true(AMap/TMap 场景);BMapGL 不走默认
 *   路径 —— getscript 同步执行,onload 时 window.BMapGL 已完整定义。
 * - 不再依赖厂商 callback 参数(官方 /api 包装器即便带 &callback= 也绕不开
 *   内部 document.write 拦截),onload 即就绪。
 */
function injectBaiduScript(
  conf: ScriptConfig,
  hooks: { onload: () => void; onerror: (err?: unknown) => void },
): ScriptInjection | null {
  if (typeof document === 'undefined') {
    hooks.onerror(new Error('[map-engine] document is not available for script injection'));
    return null;
  }
  const script = document.createElement('script');
  script.src = conf.url;
  script.async = false;
  script.defer = false;
  script.onload = () => hooks.onload();
  script.onerror = () => hooks.onerror(new Error(`${conf.globalVar} script failed to load`));
  // head 最前:同步注入语义下尽可能先于页面其他脚本执行(防执行序竞态)
  const head = document.head;
  if (head?.firstChild) head.insertBefore(script, head.firstChild);
  else head?.appendChild(script);
  return { element: script };
}

/** 包装器第二支 document.write 的等价物:bmap.css 幂等注入(控件样式;
 * 底图 canvas 渲染不依赖,失败静默降级) */
function injectBaiduCss(): void {
  if (typeof document === 'undefined') return;
  const href = 'https://api.map.baidu.com/res/webgl/10/bmap.css';
  try {
    if (typeof document.querySelector === 'function' && document.querySelector(`link[href="${href}"]`)) {
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head?.appendChild(link);
  } catch {
    // CSS 注入失败静默:控件样式降级,不影响地图渲染
  }
}

/**
 * BMapGL 命名空间是否**功能就绪**:getscript 在脚本开头即 `window.BMapGL={}`
 * 占位,半载/异常时命名空间残缺(有对象但无 Map 构造器)——以核心构造器
 * Map 可用为准(比「存在」严格;engine-mock 安装的 ns 同样含 Map,兼容)。
 */
function baiduNamespaceReady(): boolean {
  const ns = baiduNamespace();
  return !!ns && typeof ns.Map === 'function';
}

/**
 * 轮询等待 BMapGL 功能就绪(带超时上限;静默返回,由调用方抛错)。
 * 迭代计数而非墙钟:mock.timers 可确定性快进(不依赖 Date.now 被 mock)。
 */
async function waitForBaiduNamespace(): Promise<void> {
  for (let i = 0; i < BAIDU_READY_MAX_POLLS; i++) {
    if (baiduNamespaceReady()) return;
    await new Promise((resolve) => setTimeout(resolve, BAIDU_READY_POLL_MS));
  }
}

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
  /**
   * 厂商 marker 的点击目标 DOM(markerMouseTarget pane,模块源码
   * _msTargetRender/_addDom 核实):GL 下恒创建、默认空容器、尺寸=图标尺寸、
   * 位置=屏幕位 + 契约 offset(经空白锚点图标 anchor=-offset 数学);
   * 子元素事件冒泡可达(点击命中)。真实 SDK v1.0 Marker 无 setContent →
   * content 注入兜底的目标(见 scheduleMarkerContentInjection)。
   */
  domElement?: HTMLElement | null;
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
  /**
   * 自定义底图样式(2026-08-22 SDK v1.0 源码核实,ws-a):
   * setMapStyleV2(opts) → setOptions({style: opts}) → getStyleJson 直接消费
   * opts.styleJson 数组(styleId 为服务端拉取形态,不采用);**空数组 = 默认
   * 渲染**(离开深色时的复位路径,与腾讯 setMapStyleId('DEFAULT') 同语义)。
   */
  setMapStyleV2?(opts: { styleJson: BMapStyleItem[] }): unknown;
  /**
   * 经纬度 → 覆盖物像素坐标(自定义 Overlay draw() 定位用,官方 API;
   * BMapGL 与经典 BMap 同命名)。pointToContainerPixel 为等价兜底。
   */
  pointToOverlayPixel?(point: BPoint): { x: number; y: number } | null;
  pointToContainerPixel?(point: BPoint): { x: number; y: number } | null;
  /**
   * 滚轮缩放开关(2026-08-22 SDK 源码核实):Map config 默认
   * `enableWheelZoom: !H.apiVersionIsGL()` → GL 恒 false(经典 BMap 恒 true),
   * mouseWheel 处理器 `if(!mw.config.enableWheelZoom){return}` 静默忽略 →
   * **BMapGL 默认禁用滚轮缩放**,必须显式 enableScrollWheelZoom() 启用。
   */
  enableScrollWheelZoom?(): unknown;
  /** BMapGL 2.0 官方就绪回调注册(2026-08-22 SDK 源码核实:**v1.0 getscript
   * 不存在此 API**,0 处命中——保留仅作升级兼容,真实就绪信号见
   * BAIDU_READY_EVENTS;一次性回调,无需解绑) */
  setMapReadyCallback?(cb: () => void): unknown;
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
  /** 自定义覆盖物基类(content 标记 DOM overlay 路径;官方 Overlay 文档形态:
   * 继承并实现 initialize(map)/draw() 两方法) */
  Overlay?: new () => object;
  Icon?: new (url: string, size: BSize, opts?: Record<string, unknown>) => unknown;
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

/**
 * 底图样式 → BMapGL MapType 常量名(2026-08-22 SDK v1.0 源码核实,ws-a;
 * getscript 本体 1.2MB 抓取 grep):
 *   window.BMAP_NORMAL_MAP="B_NORMAL_MAP"; window.BMAPGL_NORMAL_MAP="B_NORMAL_MAP";
 *   window.BMAP_SATELLITE_MAP="B_SATELLITE_MAP"; window.BMAP_HYBRID_MAP="B_HYBRID_MAP"
 * - **`BMAPGL_SATELLITE_MAP` 不存在**(0 命中)——旧常量名解析 undefined →
 *   setMapType 被静默跳过 → 卫星切换无效果(用户 bug 1「百度卫星没实现」根因);
 * - BMAPGL_NORMAL_MAP 仅为 normal 的别名(同值),normal 用主名 BMAP_NORMAL_MAP;
 * - setMapType 按常量字符串值解析 MapTypeId(ev()→kO 注册表,卫星
 *   compatType:"BMAP_SATELLITE_MAP",源码见批次汇报 ws-a)。
 */
const STYLE_CONSTANT: Record<'normal' | 'satellite', string> = {
  normal: 'BMAP_NORMAL_MAP',
  satellite: 'BMAP_SATELLITE_MAP',
};

/** BMapGL 自定义样式项(官方 styleJson 格式;SDK styleJson2styleStringV2 映射
 * featureType→t / elementType→e / stylers{color→c,visibility→v,opacity→o,...}) */
interface BMapStyleItem {
  featureType: string;
  elementType: string;
  stylers: Record<string, string>;
}

/**
 * BMapGL 深色自定义样式(styleJson,ws-a 2026-08-22)。以官方暗色示例为基
 * (BMapGL 自定义样式文档 featureType 词表:background/water/land/green/
 * building/highway/arterial/local/railway/subway/boundary/label;elementType
 * 词表 SDK 核实:geometry(.fill/.stroke)/labels(.text.fill/.text.stroke)等)。
 * 分层保可读:基底深蓝黑,水系/绿地低饱和低亮,道路逐级提亮(高速>主干>次干),
 * 标注文字高亮浅蓝 + 深色描边(暗底可读),行政边界中亮描边。
 */
const BAIDU_DARK_STYLE_JSON: BMapStyleItem[] = [
  { featureType: 'background', elementType: 'all', stylers: { color: '#0b1524' } },
  { featureType: 'land', elementType: 'all', stylers: { color: '#0b1524' } },
  { featureType: 'water', elementType: 'all', stylers: { color: '#0d2236' } },
  { featureType: 'green', elementType: 'all', stylers: { color: '#0c2b28' } },
  { featureType: 'building', elementType: 'all', stylers: { color: '#13293e' } },
  { featureType: 'building', elementType: 'geometry.stroke', stylers: { color: '#1d3d57' } },
  { featureType: 'highway', elementType: 'geometry.fill', stylers: { color: '#20587e' } },
  { featureType: 'highway', elementType: 'geometry.stroke', stylers: { color: '#0b1524' } },
  { featureType: 'arterial', elementType: 'geometry.fill', stylers: { color: '#174568' } },
  { featureType: 'local', elementType: 'geometry.fill', stylers: { color: '#12344f' } },
  { featureType: 'railway', elementType: 'geometry.fill', stylers: { color: '#0e2c42' } },
  { featureType: 'subway', elementType: 'geometry.fill', stylers: { color: '#1d5f8a' } },
  { featureType: 'boundary', elementType: 'geometry.stroke', stylers: { color: '#2a5c7e' } },
  { featureType: 'label', elementType: 'labels.text.fill', stylers: { color: '#9fc6e0' } },
  { featureType: 'label', elementType: 'labels.text.stroke', stylers: { color: '#0b1524' } },
];

/**
 * 已应用自定义 styleJson 的地图实例(WeakSet;ws-a)。SDK 核实:自定义样式存于
 * config.style(对象),**setMapType 不清理**——离开深色必须显式
 * setMapStyleV2({styleJson: []}) 复位,否则暗色样式残留到 normal/卫星底图
 * (与腾讯「切回标准/卫星:复位暗色」同契约)。
 */
const styleJsonApplied = new WeakSet<BMapInstance>();

// ------------------------------------------------------------
// content 标记 DOM 注入(2026-08-22 ws-e 初版;r3 重写:主路径 + 零定时器)
//
// 实测根因(SDK marker 模块 marker_crvckn 源码 + 真机 Chromium 坐实):**真实
// BMapGL v1.0 的 Marker 类没有 setContent 方法**(原型 0 处命中;构造函数
// _config 也无 content 选项)——适配层旧实现 `raw.setContent?.(html)` 静默
// no-op → 单点级 POI(图钉/公司徽章)content 路径不渲染:DOM 0 个徽章、无视觉、
// 无点击反馈(boss Playwright 实测 2026-08-22;聚合级走 dataURL icon 纹理正常)。
//
// r3 新增实证(2026-08-22 真机 Chromium + 真实 SDK,详见 reports/ws-f.md):
// **自定义 Overlay 主路径(ws-pinfix2)在真实 SDK 上是静默失效路径**——
// Map.addOverlay 只调用 overlay._i(map)(getscript 源码坐实:
// `addOverlay=function(i){if(i&&cs(i._i)){...;i._i(this);...}}`);Overlay 基类
// bb 的 _i 实现为 `this.domElement=this.initialize(mw)` 后**不把返回值插入任何
// pane**(无 appendChild)——经典 BMap「initialize 返回 div、SDK 自动挂载」契约
// 在 GL v1.0 不成立。引擎 Overlay 子类实测:initialize 被调、div 已定位
// (left/top 正确),但 parentNode 恒 null → 徽章 0 个 + 聚合图标 0 个 + 无
// overlay 节点(boss「标记全部消失」实锤根因;1000+ 无主 div 且 SDK 长期持有
// domElement 引用 → 内存随会话膨胀,叠加合成器负载)。Overlay 主路径已删除。
//
// 兜底姿势(现为主路径):厂商 marker 在 markerMouseTarget pane 恒创建
// BMap_Marker 点击目标 DOM(模块源码 _addDom/_msTargetRender 核实;GL 下为唯一
// DOM,空容器承载点击),**addOverlay 同步创建**(r3 实测 ms 级就绪),位置 =
// 屏幕位 + 契约 offset(由空白锚点图标 anchor = -offset 数学驱动,与 AMap
// content 路径逐像素同语义)→ 把 content HTML 注入该 DOM:
//   - 视觉:徽章/图钉按契约锚点渲染(内容负 margin 补偿跨状态零漂移);
//   - 点击:子元素事件冒泡到该 DOM → 厂商 click 事件 → 适配层 onClick;
//   - 生命周期:hide/show/remove 由厂商 DOM 管理,注入内容跟随;
//   - 注入时机:addOverlay 后同步命中;未命中走**微任务 4 轮 + rAF 3 帧快速
//     路径 + 定时器兜底**(首 tick 100ms 后每 250ms,上限 80 tick ≈ 20s,
//     自终止、低频率)——r4 实证:重负载/慢首帧下 rAF 链会停摆(8× CPU 节流
//     实测 addOverlay 后 domElement 迟至 1-10s 才创建,期间 rAF 帧不回调,
//     零定时器版注入链静默悬挂 → 徽章永久缺失(boss 主树复验 136 警告 +
//     0 徽章);定时器兜底不依赖帧调度,domElement 一旦就绪即注入。
// 仅当厂商 Marker 无 setContent 时启用(测试 mock / 未来 SDK 形态仍走原路径)。
// ------------------------------------------------------------

/** raw marker → 最新 content HTML(注入重入/延迟注入读取用) */
const markerContentDom = new WeakMap<object, string>();
/** 待注入 marker 登记表(各重试链自终止判定 + remove 清理;注入成功即摘除) */
const pendingContentInjection = new Set<BMarker>();
/** 快速路径上限(微任务 4 轮 + rAF 3 帧;常规时序下 addOverlay 后同步/数帧就绪) */
const CONTENT_DOM_MICRO_MAX_ATTEMPTS = 4;
const CONTENT_DOM_RAF_MAX_ATTEMPTS = 3;
/** 定时器兜底参数(首 tick 100ms,之后 250ms 步进,80 tick ≈ 20s 上限) */
const CONTENT_DOM_TIMER_FIRST_MS = 100;
const CONTENT_DOM_TIMER_STEP_MS = 250;
const CONTENT_DOM_TIMER_MAX_ATTEMPTS = 80;

/** 单次注入尝试:domElement 存在 → innerHTML 更新(内容变化才写,防闪动) */
function injectMarkerContent(raw: BMarker): boolean {
  const el = (raw as { domElement?: HTMLElement | null }).domElement;
  if (!el) return false;
  const html = markerContentDom.get(raw);
  if (html !== undefined && el.innerHTML !== html) el.innerHTML = html;
  return true;
}

/** 注入完成/标记已摘除 → 从登记表摘除并终止各重试链 */
function finishContentInjection(raw: BMarker): void {
  pendingContentInjection.delete(raw);
}

/** rAF 快速路径(下一帧起 ≤3 帧;rAF 在重负载下可能停摆 → 定时器兜底接管) */
function injectRetryByFrames(raw: BMarker): void {
  if (typeof requestAnimationFrame !== 'function') return;
  let frames = 0;
  const frame = (): void => {
    frames++;
    // 先查登记(已摘除/已注入 → 终止),再尝试注入(避免向已摘除 marker 写入)
    if (!pendingContentInjection.has(raw) || injectMarkerContent(raw)) {
      finishContentInjection(raw);
      return;
    }
    if (frames < CONTENT_DOM_RAF_MAX_ATTEMPTS) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** 定时器兜底(不依赖 rAF/帧调度;低频率、自终止、约 20s 上限后一次性 warn) */
function injectRetryByTimers(raw: BMarker): void {
  let ticks = 0;
  const tick = (): void => {
    ticks++;
    if (!pendingContentInjection.has(raw) || injectMarkerContent(raw)) {
      finishContentInjection(raw);
      return;
    }
    if (ticks >= CONTENT_DOM_TIMER_MAX_ATTEMPTS) {
      finishContentInjection(raw);
      console.warn('[map-engine] BMapGL content 标记 DOM 注入超时(domElement 未就绪),徽章可能不渲染');
      return;
    }
    setTimeout(tick, ticks === 1 ? CONTENT_DOM_TIMER_FIRST_MS : CONTENT_DOM_TIMER_STEP_MS);
  };
  setTimeout(tick, CONTENT_DOM_TIMER_FIRST_MS);
}

/** 注入调度:立即尝试;失败 → 登记 + 微任务/rAF 快速路径 + 定时器兜底。
 * r4(2026-08-22):r3「零定时器 5 帧」窗口在重负载下失效(主树复验 136 警告 +
 * 0 徽章;真机 8× CPU 节流坐实 domElement 迟至 1-10s 才创建且 rAF 帧停摆),
 * 定时器兜底保证 domElement 一旦就绪即注入;频率低(100ms 首 tick + 250ms
 * 步进)、每 marker 独立自终止、内容不变不重写(防闪动/防渲染抖动)。 */
function scheduleMarkerContentInjection(raw: BMarker): void {
  if (injectMarkerContent(raw)) return;
  pendingContentInjection.add(raw);
  if (typeof queueMicrotask === 'function') {
    let attempts = 0;
    const retry = (): void => {
      attempts++;
      // 先查登记(已摘除/已注入 → 终止),再尝试注入
      if (!pendingContentInjection.has(raw) || injectMarkerContent(raw)) {
        finishContentInjection(raw);
        return;
      }
      if (attempts < CONTENT_DOM_MICRO_MAX_ATTEMPTS) queueMicrotask(retry);
    };
    queueMicrotask(retry);
  }
  injectRetryByFrames(raw);
  injectRetryByTimers(raw);
}

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

/**
 * 样式 → 厂商底图(ws-a 2026-08-22;ws-e 深色+卫星组合修复):
 * - normal/satellite → setMapType(常量经 resolveGlobalConstant 解析,缺失静默
 *   跳过不抛);离开深色时先 setMapStyleV2({styleJson: []}) 复位自定义样式
 *   (SDK 核实:config.style 对象持续生效,setMapType 不清理 → 必须显式复位);
 * - whitesmoke(UI 图层面板「深色」)→ 先强制 setMapType(normal) 切回 vector,
 *   再应用深色 styleJson(setMapStyleV2)——深色自定义样式只对 vector 底图生效,
 *   卫星→深色不先切回则停在卫星无变化(2026-08-22 真机实测坐实);API 缺失
 *   时 warn 降级 normal,与腾讯无 setMapStyleId 降级同契约);
 * - 其他不支持的样式回退 normal + console.warn。
 */
function applyMapStyle(map: BMapInstance, style: MapStyleId): void {
  if (style === 'whitesmoke') {
    if (typeof map.setMapStyleV2 !== 'function') {
      console.warn('[map-engine] baidu 无 setMapStyleV2,深色样式降级 normal');
      styleJsonApplied.delete(map);
      const normalConstant = resolveGlobalConstant(STYLE_CONSTANT.normal);
      if (normalConstant !== undefined) map.setMapType(normalConstant);
      return;
    }
    // 深色自定义样式只对 **vector** 底图生效(2026-08-22 boss 真机实测 + 本 WS
    // 真机复测):卫星底图 + setMapStyleV2 时 config.style 已写入但瓦片无变化
    // (亮度/色彩不变,停在卫星)——深色切换必须先把底图强制切回 vector
    // (BMAP_NORMAL_MAP),再应用 styleJson;标准→深色路径同样先切(幂等)。
    const normalConstant = resolveGlobalConstant(STYLE_CONSTANT.normal);
    if (normalConstant !== undefined) map.setMapType(normalConstant);
    map.setMapStyleV2({ styleJson: BAIDU_DARK_STYLE_JSON });
    styleJsonApplied.add(map);
    return;
  }
  if (style === 'normal' || style === 'satellite') {
    // 离开深色:显式复位自定义样式(空 styleJson = 默认渲染;仅在应用过时调用,
    // 避免每次 setStyle 触发一次自定义样式管线加载)
    if (styleJsonApplied.has(map)) {
      if (typeof map.setMapStyleV2 === 'function') map.setMapStyleV2({ styleJson: [] });
      styleJsonApplied.delete(map);
    }
    const constant = resolveGlobalConstant(STYLE_CONSTANT[style]);
    if (constant !== undefined) map.setMapType(constant);
    return;
  }
  console.warn(`[map-engine] baidu 不支持底图样式 ${style},回退 normal`);
  const normalConstant = resolveGlobalConstant(STYLE_CONSTANT.normal);
  if (normalConstant !== undefined) map.setMapType(normalConstant);
}

// ------------------------------------------------------------
// 地图就绪等待(BMapGL 异步渲染;AK 被禁用时 SDK 内部异步失败不触发信号)
// ------------------------------------------------------------

/**
 * BMapGL v1.0 真实就绪事件(2026-08-22 SDK 源码核实,getscript?type=webgl&v=1.0
 * 直连本体 1.2MB,见 tech/23-map-engines.md 回填):
 *   - `onfirsttilesloaded` / `onfirsttileloaded`:首帧瓦片批加载完成(GL 路径
 *     map 级 `_checkTilesLoaded` 派发;第一相机操作后才可能触发)
 *   - `tilesloaded`:当前视野瓦片全部完成(80ms 稳定期后派发;SDK 派发名为
 *     `ontilesloaded`,gd.BaseClass.addEventListener 注册名自动补 "on" 前缀,
 *     注册 `tilesloaded` 与派发串归一后同键命中——注册原名以兼容无前缀
 *     归一化的测试双面)
 *   - `onstyle_loaded`:底图样式配置加载完成(样式层初始化早期派发,早于瓦片)
 * setMapReadyCallback 是 BMapGL **2.0** API,v1.0 不存在(0 处命中),仅作
 * 升级兼容保留。
 */
const BAIDU_READY_EVENTS = ['onfirsttilesloaded', 'tilesloaded', 'onstyle_loaded'] as const;

/**
 * 等待 BMapGL 地图就绪再返回(BMapGL 异步渲染:`new Map()` 立即返回,首帧
 * 渲染完成才派发就绪事件)。就绪信号**多通道**,任一先到即就绪:
 *   1. setMapReadyCallback(BMapGL 2.0 官方就绪回调;v1.0 不存在,保留兼容)
 *   2. BAIDU_READY_EVENTS(v1.0 真实派发事件,见上)
 * **AK 被禁用/渲染失败时 SDK 内部异步失败——瓦片请求走 4s×3 重试路径,1.5s
 * 内无任何信号 → BAIDU_MAP_READY_TIMEOUT_MS 超时 reject(文案含「BMapGL 地图
 * 就绪超时」),switch.ts 回滚契约依赖 createView 抛错(绝不返回空图)。
 * ⚠️ 就绪事件只在**相机操作之后**才可能派发(GL 构造不设默认视图、底图图层
 * 在 centerAndZoomIn 内才创建,见 createView 注释)→ 本函数必须晚于相机应用。
 * 事件系统/回调通道均不可用 → 立即放行(测试 mock/异常形态不阻塞);
 * 就绪/超时均解绑全部就绪监听。
 */
function waitForMapReady(map: BMapInstance): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let channels = 0;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      for (const event of BAIDU_READY_EVENTS) {
        try {
          map.removeEventListener?.(event, onReady);
        } catch {
          // 解绑失败不影响就绪/超时语义
        }
      }
    };
    const onReady = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onTimeout = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          `[map-engine] baidu BMapGL 地图就绪超时(${BAIDU_MAP_READY_TIMEOUT_MS}ms):AK 可能被禁用或渲染失败`,
        ),
      );
    };
    try {
      if (typeof map.setMapReadyCallback === 'function') {
        map.setMapReadyCallback(onReady);
        channels++;
      }
    } catch {
      // 注册异常静默:事件通道兜底
    }
    try {
      if (typeof map.addEventListener === 'function' && typeof map.removeEventListener === 'function') {
        for (const event of BAIDU_READY_EVENTS) {
          map.addEventListener(event, onReady);
          channels++;
        }
      }
    } catch {
      // 注册异常静默:回调通道兜底(或直接超时)
    }
    if (channels === 0) {
      onReady(); // 事件系统不可用 → 立即放行(不阻塞 createView)
      return;
    }
    timer = setTimeout(onTimeout, BAIDU_MAP_READY_TIMEOUT_MS);
  });
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
    if (opts.content !== undefined) return this.createContentMarker(opts);
    return this.createPlainMarker(opts);
  }

  /**
   * content 存在 → **厂商 Marker + 点击目标 DOM 内容注入**(2026-08-22 r3 重写)。
   * 背景(真机实证,详见模块注释):BMapGL v1.0 的 Marker **无 setContent**;
   * 自定义 Overlay 主路径(ws-pinfix2)被 SDK 静默丢弃——`Map.addOverlay` 只调
   * `overlay._i(map)`,基类 `_i` 把 `initialize(map)` 返回值存入 `this.domElement`
   * 后**不挂载到任何 pane**(initialize 被调、div 已定位,parentNode 恒 null →
   * 全级别 0 徽章 + 0 聚合图标,boss 实测)。两条旧路径都不渲染 → 主路径 =
   * ws-e 验证过的「厂商 Marker 自带 BMap_Marker 点击目标 DOM 注入」:
   *   - 有 setContent(测试 mock / 未来 SDK 形态)→ 直调原契约路径;
   *   - 无 setContent(真实 SDK)→ content HTML 注入 markerMouseTarget pane 的
   *     BMap_Marker 点击目标 DOM(addOverlay **同步创建**,r3 实测 ms 级就绪;
   *     位置 = 屏幕位 + 契约 offset 由空白锚点图标 anchor=-offset 数学驱动,
   *     与 AMap content 路径逐像素同语义);
   *   - 点击:marker 模块把 click 绑在该 DOM 上,内容子元素事件冒泡可达;
   *   - 生命周期:hide/show/remove 由厂商管理,注入内容跟随。
   * 锚点语义:icon.anchor = -契约 offset(透明 1×1 图标;无 offset → (0,0)
   * 左上角,与 AMap 无 offset content 同语义)。content 与 icon 并存时
   * **icon 为渲染主机制、content 不注入**(聚合徽章 dataURL 图标纹理即视觉,
   * 注入会双渲染;远程 icon 未预检先回落 content 注入,成功后下次重建升级,
   * 见 resolveIconUsable)。
   */
  private createContentMarker(opts: MapMarkerOptions): MapMarker {
    const bd = gcj02ToBd09(opts.position.lng, opts.position.lat);
    // 锚点语义(2026-08-22 SDK v1.0 源码核实:getscript 本体 + marker/mapgl 模块):
    // - **Marker 构造 offset 选项不参与渲染定位**(仅 getPoint/infoWindow 数学
    //   用;marker 模块 _getPixPos 与 mapgl 纹理 quad 均不含它)→ 不再传入;
    // - 定位公式:GL 纹理 quad `imageTopLeft = 屏幕位 - icon.anchor`(lA 顶点
    //   (-aw, ah-h);mapgl 模块按 icon.anchor 建 quad);DOM content(msTarget)
    //   `= 屏幕位 + marker.offset - icon.anchor`(_getPixPos)→ 双路径一致
    //   要求 **icon.anchor = -契约 offset**(imageTopLeft = 屏幕位 + offset,
    //   AMap 同款契约:content/icon 左上角相对屏幕位的偏移);
    // - Icon 的 anchor === offset 构造选项,默认 (w/2,h/2) = 图标中心(lA 源码);
    // - 点击:marker 模块把 click 绑在 markerMouseTarget DOM 上,内容子元素
    //   事件冒泡可达(注入后同语义)。
    const markerOpts: Record<string, unknown> = {};
    if (opts.zIndex !== undefined) markerOpts.zIndex = opts.zIndex;
    const raw = new this.ns.Marker(new this.ns.Point(bd.lng, bd.lat), markerOpts);
    const content = opts.content;
    if (content !== undefined) {
      // 最新 content 先入账(DOM 注入延迟读取;wrapper.setContent 重入更新)
      markerContentDom.set(raw, content);
      // 真实 BMapGL v1.0 Marker **无 setContent**(SDK 源码 + 真机实测,ws-e):
      // 有则走原契约路径(测试 mock / 未来 SDK 形态),无则注入厂商 marker 自带
      // 的 BMap_Marker 点击目标 DOM(位置/点击/生命周期语义见模块注释)。
      if (typeof raw.setContent === 'function') raw.setContent(content);
    }
    if (opts.onClick) raw.addEventListener?.('click', opts.onClick);
    const ax = opts.offset ? -opts.offset[0] : 0;
    const ay = opts.offset ? -opts.offset[1] : 0;
    // icon 路径 CORS 防御(2026-08-22 ws-e,fix/icon-cors-preflight):
    // BMapGL 同为 WebGL 渲染,`new Icon(url)` 的远程纹理必须 CORS-clean——
    // favicon.im 等候选无 CORS 头时纹理恒加载失败(与 TMap 同病)。核查结论:
    // baidu-engine 确有 icon 路径接收远程 URL(下方 Icon 构造),故同样接
    // icon-preflight 预检防御:data URI / 已预检 ok → 真 src 原样;远程未
    // 预检/已失败 → 回退 content 锚点路径(厂商 marker DOM 渲染,<img> 无需
    // CORS;content 已入账(有 setContent 直调,无则 DOM 注入兜底),此处只补
    // 透明 1×1 锚点图标)——仅防御,content 路径行为零改动;未预检时后台触发
    // 预检,成功后下次重建自然升级。当前业务方无人给 BMapGL 传远程 icon
    // (公司 POI 走 content,蓝点/聚合徽章均为 dataURL),本分支纯防御性接入。
    const icon = opts.icon;
    const iconRenders = Boolean(icon && this.resolveIconUsable(icon));
    if (iconRenders && icon) {
      // icon 规格(契约)→ BMapGL.Icon(url, size, { offset: anchor });size 为
      // 必传第二参 → 缺省兜底 BMapGL 默认 marker 尺寸 21x21
      if (typeof raw.setIcon === 'function' && typeof this.ns.Icon === 'function') {
        const [w, h] = icon.size ?? [21, 21];
        try {
          raw.setIcon(
            new this.ns.Icon(icon.src, new this.ns.Size(w, h), {
              offset: new this.ns.Size(ax, ay),
            }),
          );
        } catch (err) {
          console.warn('[map-engine] BMapGL Icon 构造失败,图标降级', err);
        }
      } else {
        console.warn('[map-engine] BMapGL Icon/setIcon 不可用,图标降级');
      }
    } else if (content !== undefined) {
      // content 标记:透明 1×1 图标扛锚点(位置 = 屏幕位 + 契约 offset)
      if (typeof raw.setIcon === 'function' && typeof this.ns.Icon === 'function') {
        try {
          raw.setIcon(
            new this.ns.Icon(BAIDU_BLANK_ICON_DATA_URI, new this.ns.Size(1, 1), {
              offset: new this.ns.Size(ax, ay),
            }),
          );
        } catch (err) {
          console.warn('[map-engine] BMapGL content 锚点图标构造失败,位置可能偏移', err);
        }
      } else {
        console.warn('[map-engine] BMapGL Icon/setIcon 不可用,content 标记锚点无法对齐');
      }
    }
    this.map.addOverlay?.(raw); // SDK 同步创建点击目标 DOM(_i → initialize)
    // 无 setContent → DOM 注入(icon 主机制时不注入,防双渲染);addOverlay 后
    // 同步命中,失败走微任务 + rAF 有界重试(零定时器)
    if (content !== undefined && typeof raw.setContent !== 'function' && !iconRenders) {
      scheduleMarkerContentInjection(raw);
    }
    return {
      raw,
      setPosition: (p: LngLat) => {
        const next = gcj02ToBd09(p.lng, p.lat);
        raw.setPosition(new this.ns.Point(next.lng, next.lat));
      },
      setContent: (html: string) => {
        markerContentDom.set(raw, html);
        if (typeof raw.setContent === 'function') raw.setContent(html);
        // icon 主机制(content 不注入,防双渲染;图标纹理为静态视觉)
        else if (!iconRenders) scheduleMarkerContentInjection(raw);
      },
      setZIndex: (z: number) => {
        if (typeof raw.setZIndex === 'function') raw.setZIndex(z);
        else console.warn('[map-engine] BMapGL Marker 无 setZIndex,忽略 zIndex');
      },
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
        pendingContentInjection.delete(raw); // 摘除 → 终止注入重试链
        this.map.removeOverlay?.(raw);
        raw.remove?.();
      },
    };
  }

  /** icon CORS 防御决策(ws-e,2026-08-22):远程 URL 未预检/已失败 → 不可用
   * (回退 content 锚点路径);data URI / 相对路径恒可用;未预检时后台触发预检。 */
  private resolveIconUsable(icon: { src: string } | undefined): boolean {
    if (!icon) return false;
    if (!isRemoteIconUrl(icon.src)) return true;
    const status = remoteIconStatus(icon.src);
    if (status === 'ok' || status === 'data') return true;
    if (status === 'unknown') preflightRemoteIcon(icon.src);
    return false;
  }

  /** 无 content 路径(纯 position/offset/icon 场景):行为与既有实现一致。
   * icon 可用 → 真图标 GL 纹理;不可用/缺失 → 默认图钉。 */
  private createPlainMarker(opts: MapMarkerOptions): MapMarker {
    const bd = gcj02ToBd09(opts.position.lng, opts.position.lat);
    // 锚点语义(2026-08-22 SDK v1.0 源码核实:getscript 本体 + marker/mapgl 模块):
    // - **Marker 构造 offset 选项不参与渲染定位**(仅 getPoint/infoWindow 数学
    //   用;marker 模块 _getPixPos 与 mapgl 纹理 quad 均不含它)→ 不再传入;
    // - 定位公式:GL 纹理 quad `imageTopLeft = 屏幕位 - icon.anchor`(lA 顶点
    //   (-aw, ah-h);mapgl 模块按 icon.anchor 建 quad);DOM content(msTarget)
    //   `= 屏幕位 + marker.offset - icon.anchor`(_getPixPos)→ 双路径一致
    //   要求 **icon.anchor = -契约 offset**(imageTopLeft = 屏幕位 + offset,
    //   AMap 同款契约:content/icon 左上角相对屏幕位的偏移);
    // - Icon 的 anchor === offset 构造选项,默认 (w/2,h/2) = 图标中心(lA 源码);
    // - 点击:marker 模块把 click 绑在 msTarget 上,内容子元素事件冒泡可达。
    const markerOpts: Record<string, unknown> = {};
    if (opts.zIndex !== undefined) markerOpts.zIndex = opts.zIndex;
    const raw = new this.ns.Marker(new this.ns.Point(bd.lng, bd.lat), markerOpts);
    if (opts.onClick) raw.addEventListener?.('click', opts.onClick);
    // 契约 offset [x,y] → BMapGL Icon anchor = (-x, -y)(锚点从图标左上角
    // 量起;缺省 (0,0) = 左上角,与 AMap 无 offset 语义一致)
    const ax = opts.offset ? -opts.offset[0] : 0;
    const ay = opts.offset ? -opts.offset[1] : 0;
    // icon 路径 CORS 防御(2026-08-22 ws-e,fix/icon-cors-preflight):
    // BMapGL 同为 WebGL 渲染,`new Icon(url)` 的远程纹理必须 CORS-clean——
    // favicon.im 等候选无 CORS 头时纹理恒加载失败(与 TMap 同病)。核查结论:
    // baidu-engine 确有 icon 路径接收远程 URL(下方 Icon 构造),故同样接
    // icon-preflight 预检防御:data URI / 已预检 ok → 真 src 原样;远程未
    // 预检/已失败 → 默认图钉(无 content 可回退;content+icon 场景由
    // createContentMarker 的 DOM overlay 承载,不经本路径)。
    if (opts.icon && this.resolveIconUsable(opts.icon)) {
      // icon 规格(契约)→ BMapGL.Icon(url, size, { offset: anchor });size 为
      // 必传第二参 → 缺省兜底 BMapGL 默认 marker 尺寸 21x21
      if (typeof raw.setIcon === 'function' && typeof this.ns.Icon === 'function') {
        const [w, h] = opts.icon.size ?? [21, 21];
        try {
          raw.setIcon(
            new this.ns.Icon(opts.icon.src, new this.ns.Size(w, h), {
              offset: new this.ns.Size(ax, ay),
            }),
          );
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
      setContent: (html: string) => {
        markerContentDom.set(raw, html);
        if (typeof raw.setContent === 'function') raw.setContent(html);
        else scheduleMarkerContentInjection(raw);
      },
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
        pendingContentInjection.delete(raw); // 摘除 → 终止注入重试链
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

/** 浏览器高精度定位(wgs84 → gcj02;2026-08-22 ws-b,bug 5 真实化)。
 * 不经 BMapGL 命名空间:浏览器 Geolocation 与 SDK 无关,引擎未加载也可用
 * (调用方在视图存在时才调用,语义等价)。失败/被拒/无 API → null(不抛),
 * 由 getCurrentPosition 转 SDK Geolocation fallback。 */
function browserPosition(): Promise<LngLat | null> {
  return new Promise((resolve) => {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (!nav?.geolocation) {
      resolve(null);
      return;
    }
    try {
      nav.geolocation.getCurrentPosition(
        (pos) => {
          const lng = pos?.coords?.longitude;
          const lat = pos?.coords?.latitude;
          if (typeof lng === 'number' && typeof lat === 'number') {
            resolve(wgs84ToGcj02(lng, lat));
          } else {
            resolve(null);
          }
        },
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
      );
    } catch {
      resolve(null);
    }
  });
}

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

  /**
   * 浏览器高精度定位(wgs84 → gcj02;2026-08-22 ws-b,bug 5 真实化):
   * - BMapGL.Geolocation 默认走 **IP 定位**(城市级精度,不是真实位置)——用户
   *   bug 5「定位不是真实位置」根因;对齐 AMap(`AMap.Geolocation` 高精度)与
   *   腾讯(browserPosition)模式,改用浏览器 `navigator.geolocation` 高精度;
   * - 坐标链:wgs84 → gcj02(引擎契约输出 gcj02;蓝点/相机经 createMarker /
   *   setCenter 的 gcj02→bd09 落到 bd09 底图 = wgs84→gcj02→bd09,恰为百度
   *   官方 wgs84→bd09 的两步式 → 蓝点落在真实位置;若这里直接输出 bd09 会被
   *   契约当 gcj02 再转一次 → 引入 ~700m 二次偏移);
   * - `enableHighAccuracy: true`(GPS)+ `maximumAge: 0`(禁止缓存旧位,腾讯
   *   此前 60000ms 缓存旧位同类问题)+ `timeout: 8000`;
   * - SDK Geolocation 保留为 fallback(浏览器定位失败/被拒时,见
   *   sdkCurrentPosition)。
   */
  getCurrentPosition(): Promise<LngLat | null> {
    return browserPosition().then((pos) => (pos ? Promise.resolve(pos) : this.sdkCurrentPosition()));
  }

  /** SDK Geolocation fallback:IP 定位(城市级,bd09)→ gcj02;命名空间缺失/
   * 构造失败/无结果 → null(绝不抛错,调用方回退安全值)。 */
  private sdkCurrentPosition(): Promise<LngLat | null> {
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
    // 功能就绪判定(比「命名空间存在」严格):getscript 脚本开头即 BMapGL={}
    // 占位,残缺命名空间(无 Map)视为未就绪(半载/异常可被 load 轮询捕获)
    return baiduNamespaceReady();
  }

  async load(): Promise<void> {
    if (this.isLoaded()) return;
    const ak = process.env.NEXT_PUBLIC_BAIDU_AK?.trim();
    if (!ak) {
      failBaidu('not-configured', 'load', `未配置 ${BAIDU_KEY_VAR}`);
    }
    // 幂等恢复(2026-08-22 ws-c 核查结论):上次「脚本已加载但命名空间未就绪」
    // 失败后,URL 缓存留有已 resolve 的 promise + 残缺/占位命名空间 truthy
    // 短路 → 重试不注入、只白烧 2s 轮询 → 每次切换都失败且永不恢复。恢复
    // 现场后重注入(重试即重新探测 AK 有效性)。
    if (baiduScriptLoadBroken) {
      baiduScriptLoadBroken = false;
      recoverBaiduScriptLoad();
    }
    // 同步注入(async=false + head 最前)直连 getscript 本体:getscript 零
    // document.write(2026-08-22 实测),同步执行保证 onload 即完整命名空间;
    // 不用默认 async 注入器(AMap/TMap 场景)与厂商 callback 参数。
    try {
      await loadScript(
        { url: BAIDU_SCRIPT_URL(ak), globalVar: BAIDU_NAMESPACE },
        { inject: injectBaiduScript },
      );
    } catch (err) {
      // 客户端拦截判定(bug 3,boss 证据 2026-08-22):onerror 的底层错误码
      // (ERR_BLOCKED_BY_CLIENT)浏览器不暴露给 JS → 用 Resource Timing 启发式
      // 区分「请求未发出(被拦截)」与「网络层失败(有 entry)」;无 performance
      // 时保守归 script-load-failed(其指引文本已含拦截分支)
      if (isLikelyClientBlocked(BAIDU_SCRIPT_URL(ak))) {
        failBaidu('script-blocked-by-client', 'load', String((err as Error)?.message ?? err), err);
      }
      failBaidu('script-load-failed', 'load', String((err as Error)?.message ?? err), err);
    }
    // 轮询就绪(带超时):onload 后命名空间可能残缺(脚本异常/半载)——
    // 就绪轮询兜底,超时抛错(switch 回滚契约依赖该错误文案)
    await waitForBaiduNamespace();
    if (!baiduNamespaceReady()) {
      // 置位:下次 load 必须重新注入(见 recoverBaiduScriptLoad),否则被
      // 「URL 缓存 + 命名空间 truthy」双重短路,永不恢复
      baiduScriptLoadBroken = true;
      failBaidu('namespace-not-ready', 'load', 'BMapGL 脚本加载完成但命名空间未就绪');
    }
    baiduScriptLoadBroken = false;
    // 包装器第二支 document.write 的等价物(控件样式;幂等,失败静默)
    injectBaiduCss();
  }

  async createView(opts: MapViewCreateOptions): Promise<MapView> {
    const ns = baiduNamespace();
    if (!ns) {
      failBaidu('unclassified', 'createView', 'BMapGL 未就绪:先调用 load()');
    }
    const map = new ns.Map(opts.container);
    // 默认控件 DOM 防御(BMapGL 同步建 DOM,构造后立即隐藏 zoom/指北针;
    // 版权由 map-shell CSS 隐藏;有/无控件 API 均不抛)
    hideBaiduDefaultControls(map);
    // 滚轮缩放显式启用(bug 6,2026-08-22 用户反馈「百度无法中间滚动视角」;
    // SDK 源码核实:Map config 默认 enableWheelZoom = !H.apiVersionIsGL() →
    // GL 恒 false,mouseWheel 处理器 if(!config.enableWheelZoom){return} 静默
    // 忽略;enableScrollWheelZoom() 置 true;API 缺失静默(旧 SDK 兼容))
    try {
      (map as BMapInstance & { enableScrollWheelZoom?: () => unknown }).enableScrollWheelZoom?.();
    } catch {
      // 启用失败静默:滚轮缩放降级为不可用(不影响底图渲染)
    }
    // **先应用相机,再等就绪**(2026-08-22 SDK 源码核实的 v1.0 GL 时序):
    // GL 构造器跳过默认视图初始化(仅非 GL 分支 centerAndZoomIn 默认中心),
    // 底图图层在 centerAndZoomIn 内才创建(`if(!this.loaded){_addTileLayer}`
    // + `this.loaded=true`)→ 构造后不操作相机 = 零瓦片请求 = 就绪事件永不
    // 派发 = 必然 1.5s 超时回滚(旧实现的稳定失败,与 AK 有效与否无关)。
    // 相机先行后:健康路径首帧瓦片数十 ms 内完成 → onfirsttilesloaded 就绪;
    // 禁用 AK → 瓦片 403 走 4s×3 重试 → 1.5s 无信号 → 超时销毁并抛错(回滚
    // 契约保持)。SDK 无任何异步初始化重置相机(已核实:GL 不应用
    // _initViewport、注册插件不动相机)——「等就绪后再应用相机」的旧时序
    // 与「相机先行」冲突的担忧无 SDK 依据。
    const c = gcj02ToBd09(opts.center.lng, opts.center.lat);
    map.centerAndZoom(new ns.Point(c.lng, c.lat), opts.zoom);
    if (opts.pitch) map.setTilt(opts.pitch);
    if (opts.rotation) map.setHeading(opts.rotation);
    // 就绪等待(BMapGL 异步渲染):AK 被禁用/渲染失败时 SDK 内部异步失败——
    // Map 创建成功但不渲染、1.5s 内无就绪信号 → 超时抛错,switch.ts 回滚
    // 契约依赖 createView 抛错(绝不返回空图;2026-08-22 ws-7)。超时先销毁
    // 未渲染的 Map(容器交还回滚视图),再抛「BMapGL 地图就绪超时」。
    try {
      await waitForMapReady(map);
    } catch (err) {
      try {
        map.destroy?.();
      } catch {
        // 销毁失败不阻断抛错语义(容器由回滚视图接管)
      }
      // 分类输出(AK 被禁用/瓦片被拒):message 保留「BMapGL 地图就绪超时」
      // 原文(switch 回滚契约 + 既有断言按子串匹配)
      failBaidu('map-ready-timeout', 'createView', String((err as Error)?.message ?? err), err);
    }
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
