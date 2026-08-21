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

/** 透明 1×1 GIF data URI:content 标记的锚点图标(仅**回退路径**使用——
 * SDK 无 Overlay/DOM 能力时 content 走 setContent 渲染进 msTarget DOM,
 * 锚点必须由图标扛;主路径 content = 自定义 Overlay DOM 渲染,无图标,
 * 见 createMarker 注释) */
const BAIDU_BLANK_ICON_DATA_URI =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** content overlay 定位 API 缺失一次性告警标记(防御:老 SDK 无
 * pointToOverlayPixel/pointToContainerPixel 时 draw 跳过,不刷屏) */
let baiduOverlayProjectWarned = false;

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
 * 样式 → 厂商底图(ws-a 2026-08-22):
 * - normal/satellite → setMapType(常量经 resolveGlobalConstant 解析,缺失静默
 *   跳过不抛);离开深色时先 setMapStyleV2({styleJson: []}) 复位自定义样式
 *   (SDK 核实:config.style 对象持续生效,setMapType 不清理 → 必须显式复位);
 * - whitesmoke(UI 图层面板「深色」)→ 深色 styleJson(setMapStyleV2;API 缺失
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
   * content 存在 → **自定义 Overlay DOM 渲染**(2026-08-22 ws-pinfix2)。
   * 背景:BMapGL v1.0 getscript 实包源码核实 `Marker.setContent` 是空操作
   * (`setContent:function(e){this.content=e||""}` 只存字符串,msTarget DOM
   * 渲染在 GL 版本不存在)→ content 标记(agent 蓝点/POI 徽章/聚合徽章)
   * 在百度底图只渲染 1×1 透明图标,目标点完全不可见(bug 实锤)。
   * 修复:content 走官方**自定义 Overlay 机制**(继承 BMapGL.Overlay,SDK
   * 生命周期 initialize(建 DOM)/draw(定位)):
   *   - initialize(map):创建 div,content 原文注入 innerHTML(转义边界:
   *     content 是引擎调用方可信的 HTML,与 amap 同语义,原样注入——既有契约);
   *     zIndex → div style.zIndex;click 绑 div(内容子元素冒泡可达,与
   *     amap/旧 msTarget 同语义);返回 div(SDK 自动加入覆盖物容器);
   *   - draw():`lngLat 转容器像素(pointToOverlayPixel,bd09 点)` →
   *     div 左上角 = 像素 - 契约 offset(锚定一致性:content 左上角 - offset
   *     元组,与 amap 语义对齐;agent 蓝点 offset [-10,-10] → 圆心对准坐标);
   *     SDK 在相机变化时自动重调 draw()(无需自绑地图事件);
   *   - 移除:removeOverlay + div 摘除(SDK removeOverlay 亦会调用本类
   *     remove(),幂等);raw 带 setMap(null)/remove 供 map-shell 摘除分派。
   * 锚点语义:div 左上角 = 屏幕位 - offset(无 offset → 左上角钉坐标,与
   * AMap 无 offset content 同语义)。content 与 icon 并存时 **content 为渲染
   * 主机制,icon 不参与**(内容 HTML 自包含;icon 路径仅无 content 场景——
   * 避免徽章双渲染,见 createPlainMarker)。
   * 防御性守卫:SDK 无 Overlay 能力 / 无 DOM → 回退 createContentFallbackMarker
   * (旧 setContent + 透明锚点图标路径,不抛错)。
   */
  private createContentMarker(opts: MapMarkerOptions): MapMarker {
    const bd = gcj02ToBd09(opts.position.lng, opts.position.lat);
    const fallback = () => this.createContentFallbackMarker(opts, bd);
    const OverlayBase = this.ns.Overlay;
    if (typeof OverlayBase !== 'function') return fallback();
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      return fallback();
    }
    const map = this.map;
    const offset = opts.offset;
    const clickHandlers: Array<() => void> = [];
    if (opts.onClick) clickHandlers.push(opts.onClick);
    let point = new this.ns.Point(bd.lng, bd.lat);
    let el: HTMLElement | null = null;
    // 点击不冒泡到地图(与 amap marker click 不触发 map click 同语义;
    // 徽章/蓝点点击不得清选中);div click 冒泡自内容子元素可达
    const onClick = (e: { stopPropagation?: () => void }) => {
      e.stopPropagation?.();
      for (const cb of clickHandlers) cb();
    };
    const overlay = new (class extends (OverlayBase as unknown as new () => object) {
      _map: BMapInstance | null = null;
      /** SDK 生命周期:创建 content DOM 并返回(自动加入覆盖物容器) */
      initialize(m: BMapInstance): HTMLElement {
        this._map = m;
        const div = document.createElement('div');
        div.style.position = 'absolute';
        if (opts.zIndex !== undefined) div.style.zIndex = String(opts.zIndex);
        const extras = opts as unknown as { cursor?: string };
        if (extras.cursor) div.style.cursor = extras.cursor;
        // content 原文注入(可信 HTML 契约)
        div.innerHTML = opts.content ?? '';
        div.addEventListener('click', onClick);
        el = div;
        this.draw();
        return div;
      }
      /** SDK 生命周期:相机变化时重定位(div 左上角 = 容器像素 - offset) */
      draw(): void {
        if (!el || !this._map) return;
        const px =
          this._map.pointToOverlayPixel?.(point) ?? this._map.pointToContainerPixel?.(point);
        if (px && typeof px.x === 'number' && typeof px.y === 'number') {
          el.style.left = `${px.x - (offset?.[0] ?? 0)}px`;
          el.style.top = `${px.y - (offset?.[1] ?? 0)}px`;
          return;
        }
        if (!baiduOverlayProjectWarned && typeof this._map.pointToOverlayPixel !== 'function') {
          baiduOverlayProjectWarned = true;
          console.warn('[map-engine] BMapGL 无 pointToOverlayPixel/pointToContainerPixel,content 标记无法定位');
        }
      }
      /** 防御:SDK removeOverlay / map-shell setMap(null) 分派可能调用;幂等摘除 */
      remove(): void {
        if (this._map && typeof this._map.removeOverlay === 'function') {
          try {
            this._map.removeOverlay(this);
          } catch {
            // removeOverlay 异常不阻断 DOM 摘除
          }
        }
        if (el) {
          try {
            el.parentNode?.removeChild(el);
          } catch {
            // 已脱离 DOM:忽略
          }
          try {
            el.removeEventListener('click', onClick);
          } catch {
            // 解绑失败不影响摘除语义
          }
          el = null;
        }
      }
      /** map-shell 摘除分派(setMap(null) 形态):null → 摘除;其他值忽略 */
      setMap(next: unknown): void {
        if (!next) this.remove();
      }
    })();
    this.map.addOverlay?.(overlay); // SDK 在此调用 initialize(map)(建 DOM + 首绘)
    return {
      raw: overlay,
      setPosition: (p: LngLat) => {
        const next = gcj02ToBd09(p.lng, p.lat);
        point = new this.ns.Point(next.lng, next.lat);
        overlay.draw();
      },
      setContent: (html: string) => {
        if (el) el.innerHTML = html;
      },
      setZIndex: (z: number) => {
        if (el) el.style.zIndex = String(z);
      },
      setVisible: (v: boolean) => {
        if (el) el.style.display = v ? '' : 'none';
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
      remove: () => {
        this.map.removeOverlay?.(overlay);
        overlay.remove?.();
      },
    };
  }

  /**
   * content 回退路径(SDK 无 Overlay/DOM 能力时,行为与旧实现逐字一致):
   * Marker + setContent(msTarget DOM;GL 版本为空操作,视觉=透明 1×1 图标,
   * 即修复前的缺陷形态——仅在无法走 DOM overlay 的极端环境兜底,不抛错)
   * + 透明 1×1 图标扛锚点(icon.anchor = -契约 offset)。icon 存在且可用时
   * 仍走真图标(与旧实现同语义)。
   */
  private createContentFallbackMarker(opts: MapMarkerOptions, bd: { lng: number; lat: number }): MapMarker {
    const markerOpts: Record<string, unknown> = {};
    if (opts.zIndex !== undefined) markerOpts.zIndex = opts.zIndex;
    const raw = new this.ns.Marker(new this.ns.Point(bd.lng, bd.lat), markerOpts);
    if (opts.content !== undefined) raw.setContent?.(opts.content);
    if (opts.onClick) raw.addEventListener?.('click', opts.onClick);
    const ax = opts.offset ? -opts.offset[0] : 0;
    const ay = opts.offset ? -opts.offset[1] : 0;
    if (opts.icon && this.resolveIconUsable(opts.icon)) {
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
    } else if (opts.content !== undefined) {
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
    this.map.addOverlay?.(raw);
    return {
      raw,
      setPosition: (p: LngLat) => {
        const next = gcj02ToBd09(p.lng, p.lat);
        raw.setPosition(new this.ns.Point(next.lng, next.lat));
      },
      setContent: (html: string) => raw.setContent?.(html),
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
