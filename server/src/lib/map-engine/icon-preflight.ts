// ============================================================
// 远程图标 CORS 预检(2026-08-22 ws-e,fix/icon-cors-preflight)
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
//   preflightRemoteIcon 后台 fetch(src, { mode: 'cors' }) 预检;
//   - 成功(2xx 且 CORS 放行)→ 'ok',后续渲染用真 logo;
//   - 失败(无 ACAO 头 / 网络错 / 非 2xx)→ 'fail',记忆化,同会话不重试;
//   - 进行中(pending)不重复发起,同 URL 并发安全;
// - 预检成功后不原地升级已渲染 marker,下次重建/LOD 重渲染自然升级
//   (favicon.im 在 TMap 上恒失败,升级路径为未来 CORS 合规图源预留)。
//
// 纯模块:无 React / 引擎依赖,node 可直接测试。fetch 以全局存在为前提
// (浏览器 / Node 18+);缺失时 no-op(保持 unknown,消费方继续降级,不抛错)。
// ============================================================

/** 预检状态:data=本地 data URI;ok=已预检成功;fail=已预检失败;unknown=未预检。 */
export type IconPreflightStatus = 'data' | 'ok' | 'fail' | 'unknown';

/** 会话级缓存:URL → 预检结果。成功与失败均记忆化(失败不重试,同会话幂等)。 */
const resultCache = new Map<string, 'ok' | 'fail'>();
/** 进行中的预检集合:同一 URL 未决期间不重复发起。 */
const pending = new Set<string>();

/**
 * 是否是需要 CORS 预检的远程 URL(http/https)。
 * data:/blob:/相对路径等其余形态同源或本地,纹理加载天然 CORS-clean,
 * 恒安全直通,不预检(防御接入时先过此闸,避免对相对路径误触发 fetch)。
 */
export function isRemoteIconUrl(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

/**
 * 查询远程图标的预检状态。
 * - 'data':data: URI,本地安全,无需预检;
 * - 'ok':已预检成功(可作纹理/图标真 src);
 * - 'fail':已预检失败(CORS/网络/非 2xx),应降级;
 * - 'unknown':未预检(调用方应先降级,再触发 preflightRemoteIcon)。
 */
export function remoteIconStatus(src: string): IconPreflightStatus {
  if (src.startsWith('data:')) return 'data';
  return resultCache.get(src) ?? 'unknown';
}

/**
 * 后台 CORS 预检(幂等):`fetch(src, { mode: 'cors' })`——服务端未返回
 * ACAO 头时 fetch 直接 reject,即 CORS/网络失败;非 2xx 也记 fail。
 * 结果写入模块级缓存,同会话同 URL 不重复;pending 期间不重复发起。
 * data: URI 与已缓存 URL 直接 no-op;无全局 fetch(异常环境)时 no-op,
 * 保持 unknown,消费方继续降级,绝不抛错。
 */
export function preflightRemoteIcon(src: string): void {
  if (src.startsWith('data:')) return;
  if (resultCache.has(src) || pending.has(src)) return;
  if (typeof fetch !== 'function') return;
  pending.add(src);
  fetch(src, { mode: 'cors' })
    .then((res) => {
      resultCache.set(src, res.ok ? 'ok' : 'fail');
    })
    .catch(() => {
      // CORS 拒绝 / 网络失败 → 纹理加载必失败,记忆化 fail 同会话不重试
      resultCache.set(src, 'fail');
    })
    .finally(() => {
      pending.delete(src);
    });
}

/**
 * 清空会话缓存与进行中集合(仅测试使用,生产不调用)。
 * node 测试需要模拟 ok/fail 状态迁移,必须能重置模块级状态。
 */
export function resetIconPreflightCache(): void {
  resultCache.clear();
  pending.clear();
}
