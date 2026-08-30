// ============================================================
// 远程图标 CORS 预检(2026-08-22 ws-e,fix/icon-cors-preflight;ws-f,fix/icon-preflight-silent)
//
// 背景(boss 真机实测实锤,bug 1/7 用户症状):favicon.im 等公司 logo 候选
// 不返回 CORS 头,TMap GL 是 WebGL 渲染——marker 图标作为 GPU 纹理加载,
// 纹理必须 CORS-clean → 远程无 CORS 头的图标**恒加载失败**,SDK 疯狂刷
// 「Image加载失败」并降级 SDK 默认 marker(单次引擎加载 179-190 errors)。
// AMap LabelMarker 与 TMap MultiMarker 同走 WebGL 纹理;百度公司 POI 走
// content DOM 覆盖层(HTML <img> 无需 CORS)。本模块服务 **icon 纹理路径**
// (AMap LabelMarker / TMap MarkerStyle src / BMapGL Icon url)。
//
// 策略(幂等 + 失败记忆化):
// - data: URI → 本地安全,恒 'data',不预检;
// - 远程 URL 首次遇到 → 'unknown':消费方先降级本地 dataURL 徽章,同时
//   preflightRemoteIcon 后台 new Image() 预检;
//   - 成功(有 CORS 头 + 网络通 + 图像可解码)→ 'ok',后续渲染用真 logo;
//   - 失败(无 ACAO 头 / 网络错 / 不可解码)→ 'fail',记忆化,同会话不重试;
//   - 进行中(pending)不重复发起,同 URL 并发安全;
// - 预检成功后不原地升级已渲染 marker,下次重建/LOD 重渲染自然升级
//   (favicon.im 在 TMap 上恒失败,升级路径为未来 CORS 合规图源预留)。
//
// 降噪(ws-f,fix/icon-preflight-silent):
// - fetch(src, {mode:'cors'}) → new Image() + crossOrigin='anonymous' +
//   referrerPolicy='no-referrer':语义等价(CORS 拒绝 → onerror,与 WebGL
//   纹理加载路径同源),但 console 噪音减半——fetch 在无 ACAO 头时报 2 行
//   (CORS policy + net::ERR_FAILED),Image 只报 1 行 net::ERR_FAILED;
// - 失败 URL 记入 sessionStorage(单次写入合并防抖,不逐 URL 一写);
//   remoteIconStatus / preflightRemoteIcon 先查 sessionStorage 失败清单 →
//   同会话刷新/切引擎不再预检已知失败 URL,噪音只在首次会话出现一次。
//
// 静态跳过(2026-08-30,fix/icon-cors-skip-favicon-im):
// - favicon.im / *.favicon.im **实测从不返回 ACAO**(且常 302 到 CDN),
//   浏览器对 crossOrigin=anonymous 的 Image 每 URL 刷 2 行 CORS +
//   ERR_FAILED。全国目录每家公司一个唯一 favicon.im URL → 首会话
//   控制台被预检打满。已知恒失败的源不再探测:remoteIconStatus='fail',
//   preflightRemoteIcon 不 new Image。HTML <img>(无 crossOrigin)不受影响
//   (卡片/详情/百度 content 仍可显示 favicon.im);GL 纹理链立刻推进到
//   icon.horse(ACAO:*)。
//
// 纯模块:无 React / 引擎依赖,node 可直接测试。Image 以全局存在为前提
// (浏览器;Node 需 mock 或缺失时 no-op——保持 unknown,消费方继续降级,
// 绝不抛错)。sessionStorage 读写全部 try/catch(隐私模式可能禁用 → 放弃
// 持久化,内存记忆照常,绝不抛错)。
// ============================================================

/** 预检状态:data=本地 data URI;ok=已预检成功;fail=已预检失败;unknown=未预检。 */
export type IconPreflightStatus = 'data' | 'ok' | 'fail' | 'unknown';

/** 预检状态很小，但远程 URL 数量不可信；LRU 保持会话内存有界。 */
export const ICON_PREFLIGHT_CACHE_MAX = 128;
/** 未决 Image 持有浏览器加载资源；超限时跳过本轮，后续渲染自然重试。 */
export const MAX_PENDING_ICON_PREFLIGHTS = 128;
/** 持久失败清单也必须有界；保留最近失败项，避免唯一冷门 URL 无限增长。 */
export const ICON_PREFLIGHT_FAIL_LIST_MAX = 256;
/** 远程 URL 长度上限；超长值不是有效图标源，也不应进入缓存/预检。 */
export const ICON_PREFLIGHT_URL_MAX = 2048;
/** sessionStorage 原文超过配额级上限时按损坏处理，避免先解析超大不可信文本。 */
export const ICON_PREFLIGHT_FAIL_RAW_MAX = 64 * 1024;

/** 有界会话缓存:URL → 预检结果。成功与失败均记忆化(失败不重试,同会话幂等)。 */
const resultCache = new Map<string, 'ok' | 'fail'>();
/**
 * 进行中的预检集合:URL → 进行中的 Image 对象。同一 URL 未决期间不重复发起;
 * Map 值持有 Image 引用(防 GC 在 onload/onerror 触发前回收,回调永不丢)。
 */
const pending = new Map<string, HTMLImageElement>();

/** sessionStorage 失败清单 key(同会话刷新/切引擎复用,噪音只在首次)。 */
const FAIL_KEY = 'domain-map:icon-preflight-fail';

/** 待写失败 URL 缓冲 + 防抖标记:同一微任务批次内多次失败合并为一次 setItem。 */
const failWriteBuffer = new Set<string>();
let failWriteScheduled = false;

function touchResultCache(src: string, status: 'ok' | 'fail'): void {
  resultCache.delete(src);
  while (resultCache.size >= ICON_PREFLIGHT_CACHE_MAX) {
    const oldest = resultCache.keys().next().value;
    if (oldest === undefined) break;
    resultCache.delete(oldest);
  }
  resultCache.set(src, status);
}

/**
 * 是否是需要 CORS 预检的远程 URL(http/https)。
 * data:/blob:/相对路径等其余形态同源或本地,纹理加载天然 CORS-clean,
 * 恒安全直通,不预检(防御接入时先过此闸,避免对相对路径误触发预检)。
 */
export function isRemoteIconUrl(src: string): boolean {
  return src.length <= ICON_PREFLIGHT_URL_MAX && /^https?:\/\//i.test(src);
}

/**
 * 已知对 WebGL 纹理恒 CORS 失败的图源(不探测、不刷控制台)。
 * HTML `<img>` 无 crossOrigin 仍可加载这些 URL;本闸只服务预检/纹理路径。
 */
export function isKnownCorsIncompatibleIconUrl(src: string): boolean {
  if (!isRemoteIconUrl(src)) return false;
  try {
    const host = new URL(src).hostname.toLowerCase();
    return host === 'favicon.im' || host.endsWith('.favicon.im');
  } catch {
    return false;
  }
}

/**
 * 读 sessionStorage 失败清单。
 * 返回 null 表示 sessionStorage 不可用(隐私模式禁用 / 内容损坏 → 无记忆,
 * 调用方按"无记忆"处理,不抛错);否则返回失败 URL 集合(可能为空)。
 */
function readFailSet(): Set<string> | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(FAIL_KEY);
    if (!raw) return new Set();
    if (raw.length > ICON_PREFLIGHT_FAIL_RAW_MAX) return new Set();
    const arr = JSON.parse(raw);
    const urls = Array.isArray(arr)
      ? arr
          .filter((x): x is string => typeof x === 'string' && isRemoteIconUrl(x))
          .slice(-ICON_PREFLIGHT_FAIL_LIST_MAX)
      : [];
    return new Set(urls);
  } catch {
    return null;
  }
}

/** 失败 URL 记入防抖缓冲(不逐 URL 写 sessionStorage)。 */
function rememberFail(src: string): void {
  if (!isRemoteIconUrl(src)) return;
  failWriteBuffer.add(src);
  scheduleWriteFailSet();
}

/** 合并防抖写入:同一微任务批次内累积的失败合并为一次 setItem(读改写合并旧清单)。 */
function scheduleWriteFailSet(): void {
  if (failWriteScheduled) return;
  failWriteScheduled = true;
  queueMicrotask(() => {
    failWriteScheduled = false;
    if (failWriteBuffer.size === 0) return;
    const merged = readFailSet();
    if (!merged) {
      // sessionStorage 不可用(隐私模式)→ 放弃持久化,内存记忆照常
      failWriteBuffer.clear();
      return;
    }
    for (const url of failWriteBuffer) {
      if (isRemoteIconUrl(url)) merged.add(url);
    }
    failWriteBuffer.clear();
    // Set 保持插入序；旧项在前，新失败项在后。超限时从最旧一侧裁剪。
    const urls = [...merged].slice(-ICON_PREFLIGHT_FAIL_LIST_MAX);
    try {
      globalThis.sessionStorage?.setItem(FAIL_KEY, JSON.stringify(urls));
    } catch {
      // 隐私模式写入被拒 → 静默放弃(内存记忆照常,绝不抛错)
    }
  });
}

/**
 * 查询远程图标的预检状态。
 * - 'data':data: URI,本地安全,无需预检;
 * - 'ok':已预检成功(可作纹理/图标真 src);
 * - 'fail':已预检失败(CORS/网络/不可解码,含 sessionStorage 会话记忆,
 *   以及已知无 CORS 的 favicon.im 静态失败);
 * - 'unknown':未预检(调用方应先降级,再触发 preflightRemoteIcon)。
 * 内存未命中时回退 sessionStorage 失败清单(同会话刷新后仍在)。
 */
export function remoteIconStatus(src: string): IconPreflightStatus {
  if (src.startsWith('data:')) return 'data';
  // 已知无 CORS 的图源:不进缓存/sessionStorage,避免把唯一 URL 填满失败清单
  if (isKnownCorsIncompatibleIconUrl(src)) return 'fail';
  const cached = resultCache.get(src);
  if (cached) {
    touchResultCache(src, cached);
    return cached;
  }
  // 内存未命中 → 回退 sessionStorage 会话记忆
  const knownFail = readFailSet();
  if (knownFail && knownFail.has(src)) {
    touchResultCache(src, 'fail');
    return 'fail';
  }
  return 'unknown';
}

/**
 * 后台 CORS 预检(幂等):`new Image()` + `crossOrigin='anonymous'` + `referrerPolicy
 * ='no-referrer'`——服务端未返回 ACAO 头时浏览器拒绝加载,onerror 即 CORS/网络
 * 失败(与 WebGL 纹理加载路径同源,且 console 只报 1 行,优于 fetch 的 2 行);
 * onload 表示图像可解码(2xx + 有效图像数据,纹理可用)。结果写入模块级缓存,
 * 同会话同 URL 不重复;pending 期间不重复发起;会话内已知失败(sessionStorage
 * 记忆)直接记 fail 不再发起网络。**favicon.im / *.favicon.im 静态 fail,不
 * new Image**(已知无 ACAO,探测只会刷 CORS 控制台)。data: URI 与已缓存 URL
 * 直接 no-op;无全局 Image(异常环境)或构造异常时 no-op,保持 unknown,消费方
 * 继续降级,绝不抛错。
 */
export function preflightRemoteIcon(src: string): void {
  if (src.startsWith('data:')) return;
  if (!isRemoteIconUrl(src)) return;
  if (isKnownCorsIncompatibleIconUrl(src)) return;
  if (resultCache.has(src) || pending.has(src)) return;
  if (pending.size >= MAX_PENDING_ICON_PREFLIGHTS) return;
  if (typeof Image !== 'function') return;
  // 会话内已知失败(本页刷新前的记忆)→ 直接 fail,不再发起网络(噪音只在首次)
  const knownFail = readFailSet();
  if (knownFail && knownFail.has(src)) {
    touchResultCache(src, 'fail');
    return;
  }
  let img: HTMLImageElement;
  try {
    img = new Image();
    pending.set(src, img); // 防 GC:onload/onerror 触发前保持 Image 引用
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      // 有 CORS 头 + 网络通 + 图像可解码 → 纹理可用
      touchResultCache(src, 'ok');
      pending.delete(src);
    };
    img.onerror = () => {
      // CORS 拒绝 / 网络失败 / 不可解码 → 纹理加载必失败,记忆化 fail 不重试
      touchResultCache(src, 'fail');
      pending.delete(src);
      rememberFail(src);
    };
    img.src = src;
  } catch {
    // Image 构造/赋值异常(极端环境)→ 放弃本次预检,保持 unknown,绝不抛错
    pending.delete(src);
  }
}

/**
 * 清空会话缓存与进行中集合(仅测试使用,生产不调用)。
 * node 测试需要模拟 ok/fail 状态迁移,必须能重置模块级状态。
 * 注意:不清理 sessionStorage(那是跨 reset 的持久层,测试按需自装 mock)。
 */
export function resetIconPreflightCache(): void {
  resultCache.clear();
  pending.clear();
  failWriteBuffer.clear();
  failWriteScheduled = false;
}
