// ============================================================
// 通用幂等脚本加载器 — MapEngine 内核(script-loader)
//
// 语义(复刻 amap-api.ts L94-100 的失败恢复):
// - 幂等:同 URL 只注入一次(模块级 Promise 缓存),并发调用共享同一 Promise
// - 全局已就绪(window[globalVar] 存在)→ 直接成功,不再注入
// - 失败:移除 script 标签 + 清缓存 → 下次调用可重新注入(可重试)
// - 两种就绪模式:
//   onload 模式(AMap):script.onload → 成功
//   callback 模式(腾讯/百度):window[callbackName] 先注册,厂商脚本加载后调用
// - inject 可 DI:测试注入 fake(返回 onload/onerror 语义),不依赖真实 DOM
// ============================================================

export interface ScriptConfig {
  /** 脚本完整 URL(含 key / 回调参数) */
  url: string;
  /** 厂商全局命名空间名(如 'AMap' / 'TMap' / 'BMapGL'),用于就绪短路 */
  globalVar: string;
  /** 回调模式:厂商脚本加载后调用的全局回调名(如 'onTMapScriptLoad') */
  callbackName?: string;
}

/** 注入方返回的句柄:元素(失败时 loader 尝试 remove) */
export interface ScriptInjection {
  element?: { remove?: () => void } | null;
}

/**
 * 注入函数签名:loader 提供 onload/onerror,注入方负责 DOM 事件接线
 * (创建 script → 挂 head → 把 script.onload/onerror 接到 hooks)。
 */
export type ScriptInjector = (
  conf: ScriptConfig,
  hooks: { onload: () => void; onerror: (err?: unknown) => void },
) => ScriptInjection | null | undefined;

/** 模块级缓存:URL → 进行中的 Promise(幂等的核心) */
const loadCache = new Map<string, Promise<void>>();

/** 默认注入:创建 <script> 挂到 document.head,接线 onload/onerror */
function defaultInjector(
  conf: ScriptConfig,
  hooks: { onload: () => void; onerror: (err?: unknown) => void },
): ScriptInjection {
  if (typeof document === 'undefined') {
    hooks.onerror(new Error('[map-engine] document is not available for script injection'));
    return {};
  }
  const script = document.createElement('script');
  script.src = conf.url;
  script.async = true;
  script.onload = () => hooks.onload();
  script.onerror = () => hooks.onerror(new Error(`${conf.globalVar} script failed to load`));
  document.head.appendChild(script);
  return { element: script };
}

function windowRecord(): Record<string, unknown> {
  return window as unknown as Record<string, unknown>;
}

/**
 * 幂等加载脚本。同 URL 并发/重复调用共享同一 Promise,只注入一次;
 * 失败自动清理(移除标签 + 清缓存),下次调用可重试。
 */
export function loadScript(
  conf: ScriptConfig,
  options: { inject?: ScriptInjector } = {},
): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('[map-engine] script loader is only available in the browser'));
  }
  // 厂商命名空间已就绪(此前已成功加载)→ 直接成功,不再注入
  if (windowRecord()[conf.globalVar]) return Promise.resolve();

  const cached = loadCache.get(conf.url);
  if (cached) return cached;

  let resolveLoad!: () => void;
  let rejectLoad!: (err: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolveLoad = resolve;
    rejectLoad = reject;
  });
  // 先入缓存再注入:注入方同步失败(如无 document)也会被失败分支清掉,保证可重试
  loadCache.set(conf.url, promise);

  let settled = false;
  let element: { remove?: () => void } | null | undefined = null;

  const cleanupCallback = () => {
    if (conf.callbackName) delete windowRecord()[conf.callbackName];
  };

  const succeed = () => {
    if (settled) return;
    settled = true;
    cleanupCallback();
    resolveLoad();
  };

  const fail = (err: unknown) => {
    if (settled) return;
    settled = true;
    cleanupCallback();
    // 失败恢复(复刻 amap-api.ts L94-100):移除 script 标签 + 清缓存 → 可重试
    element?.remove?.();
    loadCache.delete(conf.url);
    rejectLoad(err instanceof Error ? err : new Error(`${conf.globalVar} script failed to load`));
  };

  const injector = options.inject ?? defaultInjector;
  try {
    if (conf.callbackName) {
      // 回调模式:回调必须在脚本注入前注册(厂商脚本执行时调用它)
      windowRecord()[conf.callbackName] = succeed;
    }
    const result = injector(conf, { onload: succeed, onerror: fail });
    element = result?.element ?? null;
  } catch (err) {
    fail(err);
  }

  return promise;
}

/** 清空模块级缓存(测试用;生产代码无调用点) */
export function resetScriptLoader(): void {
  loadCache.clear();
}
