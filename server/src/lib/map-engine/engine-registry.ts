// ============================================================
// 引擎注册表 — MapEngine 内核(engine-registry)
//
// 三引擎描述对象(AMap / Tencent / Baidu)统一入口:
// - isConfigured:运行时读 process.env(Next 构建期内联,测试可控)
// - load / isLoaded / createView / search:本 WS 只提供骨架,完整实现
//   由 ws-c(AMap)/ ws-d(Tencent)/ ws-e(Baidu)各自落地;未实现前调用
//   一律抛 not-implemented,调用方不得吞错。
// - 本文件不 import amap-api(AMap 完整版由 ws-c 独立实现,内核层不
//   反向依赖具体厂商适配)。
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

function makeEngine(desc: EngineDescriptor): MapEngine {
  return {
    id: desc.id,
    label: desc.label,
    namespace: desc.namespace,
    coordSystem: desc.coordSystem,
    keyVar: desc.keyVar,
    isConfigured: () => Boolean(process.env[desc.keyVar]),
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
