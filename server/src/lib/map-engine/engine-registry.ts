// ============================================================
// 引擎注册表 — MapEngine 内核(engine-registry)
//
// 三引擎描述对象(AMap / Tencent / Baidu)统一入口:
// - isConfigured:运行时读 process.env(Next 构建期内联,测试可控)
// - load / isLoaded / createView / search:本文件只提供骨架,完整实现经
//   registerEngine() 外部装配(ws-f 统一接线;use-map-engine 模块级调用,
//   与 registerAmapEngine 同模式),未装配前调用一律抛 not-implemented,
//   调用方不得吞错。
// - 本文件不 import 厂商实现 / amap-api(内核不反向依赖具体厂商适配)。
// ============================================================

import type { MapEngine, MapEngineId, MapSearchProvider } from './types.ts';
import { readEnginePreference } from './engine-preference.ts';

/** 引擎优先级:无偏好 / 指定项未配置时的默认选择顺序 */
export const ENGINE_PRIORITY: MapEngineId[] = ['amap', 'tencent', 'baidu'];

interface EngineDescriptor {
  id: MapEngineId;
  label: string;
  namespace: 'AMap' | 'TMap' | 'BMapGL';
  coordSystem: 'gcj02' | 'bd09';
  keyVar: MapEngine['keyVar'];
  /** 完整实现所属 workstream(错误信息提示,便于定位) */
  implementor: string;
}

function notImplemented(desc: EngineDescriptor, what: string): Error {
  return new Error(`[map-engine] ${desc.id} ${what} 未实现:由 ${desc.implementor} 落地`);
}

function unsupportedSearch(desc: EngineDescriptor): MapSearchProvider {
  const fail = (what: string) => () => Promise.reject(notImplemented(desc, what));
  return {
    searchPOI: fail('search.searchPOI'),
    fetchSuggestions: fail('search.fetchSuggestions'),
    getCurrentPosition: fail('search.getCurrentPosition'),
    geocodeAddress: fail('search.geocodeAddress'),
  };
}

/**
 * keyVar → isConfigured 静态分派:Next 构建期只替换静态字面量
 * (process.env.NEXT_PUBLIC_XXX → 值),process.env 括号动态访问在
 * 浏览器端恒为 undefined,故按 keyVar 逐字面量分派;未知 keyVar 视为未配置。
 */
function envConfigured(keyVar: string): () => boolean {
  switch (keyVar) {
    case 'NEXT_PUBLIC_AMAP_KEY':
      return () => Boolean(process.env.NEXT_PUBLIC_AMAP_KEY?.trim());
    case 'NEXT_PUBLIC_TENCENT_JSAPI_KEY':
      return () => Boolean(process.env.NEXT_PUBLIC_TENCENT_JSAPI_KEY?.trim());
    case 'NEXT_PUBLIC_BAIDU_AK':
      return () => Boolean(process.env.NEXT_PUBLIC_BAIDU_AK?.trim());
    default:
      return () => false;
  }
}

function makeEngine(desc: EngineDescriptor): MapEngine {
  return {
    id: desc.id,
    label: desc.label,
    namespace: desc.namespace,
    coordSystem: desc.coordSystem,
    keyVar: desc.keyVar,
    isConfigured: envConfigured(desc.keyVar),
    isLoaded: () =>
      typeof window !== 'undefined' &&
      Boolean((window as unknown as Record<string, unknown>)[desc.namespace]),
    load: () => Promise.reject(notImplemented(desc, 'load')),
    createView: () => Promise.reject(notImplemented(desc, 'createView')),
    search: unsupportedSearch(desc),
  };
}

/** AMap(高德)— 完整 load / createView / search 由 ws-c 实现 */
export const AMAP_ENGINE: MapEngine = makeEngine({
  id: 'amap',
  label: '高德地图',
  namespace: 'AMap',
  coordSystem: 'gcj02',
  keyVar: 'NEXT_PUBLIC_AMAP_KEY',
  implementor: 'ws-c',
});

/** Tencent(腾讯)— 完整实现由 ws-d 落地 */
export const TENCENT_ENGINE: MapEngine = makeEngine({
  id: 'tencent',
  label: '腾讯地图',
  namespace: 'TMap',
  coordSystem: 'gcj02',
  keyVar: 'NEXT_PUBLIC_TENCENT_JSAPI_KEY',
  implementor: 'ws-d',
});

/** Baidu(百度)— 完整实现由 ws-e 落地(bd09 坐标系,适配层负责换算) */
export const BAIDU_ENGINE: MapEngine = makeEngine({
  id: 'baidu',
  label: '百度地图',
  namespace: 'BMapGL',
  coordSystem: 'bd09',
  keyVar: 'NEXT_PUBLIC_BAIDU_AK',
  implementor: 'ws-e',
});

const ENGINES: Record<string, MapEngine> = {
  amap: AMAP_ENGINE,
  tencent: TENCENT_ENGINE,
  baidu: BAIDU_ENGINE,
};

/**
 * 引擎完整实现装配(ws-f 统一接线):把厂商实现(load/isLoaded/createView/search)
 * Object.assign 到注册表骨架对象上——registerAmapEngine 同款装配模式,幂等。
 *
 * - 方法 bind 到 impl 自身:厂商实现可能依赖 this(如 baidu 类实例);
 * - 骨架的 id/label/namespace/coordSystem/keyVar/isConfigured 保持不动
 *   (描述字段与 env 契约不受影响);
 * - 装配前骨架保持 not-implemented 语义(骨架门禁测试依赖:未 import 厂商
 *   实现前调用即明确报错);装配由 use-map-engine 模块级接线触发。
 */
export function registerEngine(impl: MapEngine): MapEngine {
  const target = ENGINES[impl.id];
  if (!target) {
    throw new Error(`[map-engine] registerEngine: unknown engine id: ${String(impl.id)}`);
  }
  Object.assign(target, {
    load: impl.load.bind(impl),
    isLoaded: impl.isLoaded.bind(impl),
    createView: impl.createView.bind(impl),
    search: impl.search,
  });
  return target;
}

/** 按优先级过滤已配置(key 存在)的引擎 */
export function getConfiguredEngines(): MapEngine[] {
  return ENGINE_PRIORITY.map((id) => ENGINES[id]).filter((engine) => engine.isConfigured());
}

/**
 * 解析当前应使用的引擎:
 * - preferred 存在且已配置 → 它
 * - 否则(preferred 缺省或未配置)→ 本地偏好(readEnginePreference)已配置 → 偏好
 * - 再否则 → 优先级第一个已配置;全部未配置 → null(调用方回退 CSS fallback 地图)
 */
export function resolveEngine(preferred?: MapEngineId | null): MapEngine | null {
  const configured = getConfiguredEngines();
  if (configured.length === 0) return null;

  if (preferred) {
    const hit = configured.find((engine) => engine.id === preferred);
    return hit ?? configured[0];
  }

  const pref = readEnginePreference();
  if (pref) {
    const hit = configured.find((engine) => engine.id === pref);
    if (hit) return hit;
  }
  return configured[0];
}

/** 按 id 取引擎描述(未知 id 抛错——MapEngineId 是闭合联合,属编程错误) */
export function getEngine(id: MapEngineId): MapEngine {
  const engine = ENGINES[id];
  if (!engine) {
    throw new Error(`[map-engine] unknown engine id: ${String(id)}`);
  }
  return engine;
}
