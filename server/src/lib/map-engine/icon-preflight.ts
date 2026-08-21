// ============================================================
// 远程图标 CORS 预检(2026-08-22 ws-e,fix/icon-cors-preflight;ws-f,fix/icon-preflight-silent)
//
// 背景(boss 真机实测实锤,bug 1/7 用户症状):favicon.im 等公司 logo 候选
// 不返回 CORS 头,TMap GL 是 WebGL 渲染——marker 图标作为 GPU 纹理加载,
// 纹理必须 CORS-clean → 远程无 CORS 头的图标**恒加载失败**,SDK 疯狂刷
// 「Image加载失败」并降级 SDK 默认 marker(单次引擎加载 179-190 errors)。
// AMap 是 DOM 渲染(<img> 无需 CORS),百度公司 POI 走 content DOM 覆盖层,
// 均不受影响——本模块只服务 **icon 纹理路径**的引擎(TMap MarkerStyle src、
// BMapGL Icon url),AMap/BMapGL content 路径不消费。
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
// 纯模块:无 React / 引擎依赖,node 可直接测试。Image 以全局存在为前提
// (浏览器;Node 需 mock 或缺失时 no-op——保持 unknown,消费方继续降级,
// 绝不抛错)。sessionStorage 读写全部 try/catch(隐私模式可能禁用 → 放弃
// 持久化,内存记忆照常,绝不抛错)。
// ============================================================

/** 预检状态:data=本地 data URI;ok=已预检成功;fail=已预检失败;unknown=未预检。 */
export type IconPreflightStatus = 'data' | 'ok' | 'fail' | 'unknown';

/** 会话级缓存:URL → 预检结果。成功与失败均记忆化(失败不重试,同会话幂等)。 */
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

/**
 * 是否是需要 CORS 预检的远程 URL(http/https)。
 * data:/blob:/相对路径等其余形态同源或本地,纹理加载天然 CORS-clean,
 * 恒安全直通,不预检(防御接入时先过此闸,避免对相对路径误触发预检)。
 */
export function isRemoteIconUrl(src: string): boolean {
  return /^https?:\/\//i.test(src);
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
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []);
  } catch {
    return null;
  }
}

/** 失败 URL 记入防抖缓冲(不逐 URL 写 sessionStorage)。 */
function rememberFail(src: string): void {
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
    for (const url of failWriteBuffer) merged.add(url);
    failWriteBuffer.clear();
    try {
      globalThis.sessionStorage?.setItem(FAIL_KEY, JSON.stringify([...merged]));
    } catch {
      // 隐私模式写入被拒 → 静默放弃(内存记忆照常,绝不抛错)
    }
  });
}

/**
 * 查询远程图标的预检状态。
 * - 'data':data: URI,本地安全,无需预检;
 * - 'ok':已预检成功(可作纹理/图标真 src);
 * - 'fail':已预检失败(CORS/网络/不可解码,含 sessionStorage 会话记忆);
 * - 'unknown':未预检(调用方应先降级,再触发 preflightRemoteIcon)。
 * 内存未命中时回退 sessionStorage 失败清单(同会话刷新后仍在)。
 */
export function remoteIconStatus(src: string): IconPreflightStatus {
  if (src.startsWith('data:')) return 'data';
  const cached = resultCache.get(src);
  if (cached) return cached;
  // 内存未命中 → 回退 sessionStorage 会话记忆
  const knownFail = readFailSet();
  if (knownFail && knownFail.has(src)) {
    resultCache.set(src, 'fail');
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
 * 记忆)直接记 fail 不再发起网络。data: URI 与已缓存 URL 直接 no-op;无全局
 * Image(异常环境)或构造异常时 no-op,保持 unknown,消费方继续降级,绝不抛错。
 */
export function preflightRemoteIcon(src: string): void {
  if (src.startsWith('data:')) return;
  if (resultCache.has(src) || pending.has(src)) return;
  if (typeof Image !== 'function') return;
  // 会话内已知失败(本页刷新前的记忆)→ 直接 fail,不再发起网络(噪音只在首次)
  const knownFail = readFailSet();
  if (knownFail && knownFail.has(src)) {
    resultCache.set(src, 'fail');
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
      resultCache.set(src, 'ok');
      pending.delete(src);
    };
    img.onerror = () => {
      // CORS 拒绝 / 网络失败 / 不可解码 → 纹理加载必失败,记忆化 fail 不重试
      resultCache.set(src, 'fail');
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
