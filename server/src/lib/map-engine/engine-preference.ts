// ============================================================
// 引擎偏好读写 — MapEngine 内核(engine-preference)
//
// sessionStorage key `domain-map:engine` 记录**会话级**引擎偏好:
// - 新会话 / 新标签页默认无偏好 → resolveEngine 回落优先级第一个(amap);
//   用户要求「默认高德」,故不跨会话持久化(不再用持久化 storage)。
// - 会话内手动切换(use-map-engine → writeEnginePreference)仍记住。
// - 历史遗留的跨会话偏好值不读取、不迁移、不清除(由浏览器自行回收)。
// SSR / 非浏览器环境守卫:读返回 null,写静默 no-op。
// ============================================================

import type { MapEngineId } from './types.ts';

const ENGINE_PREFERENCE_KEY = 'domain-map:engine';

const ENGINE_IDS: readonly string[] = ['amap', 'tencent', 'baidu'];

function hasBrowserStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

/** 读取会话偏好的引擎;未设置 / 值无效 / 非浏览器环境 → null */
export function readEnginePreference(): MapEngineId | null {
  if (!hasBrowserStorage()) return null;
  try {
    const raw = window.sessionStorage.getItem(ENGINE_PREFERENCE_KEY);
    if (!raw) return null;
    return ENGINE_IDS.includes(raw) ? (raw as MapEngineId) : null;
  } catch {
    // 隐私模式 / 配额异常:读不到按未设置处理,不影响主流程
    return null;
  }
}

/** 写入会话偏好的引擎;非浏览器 / 写入失败静默 no-op */
export function writeEnginePreference(id: MapEngineId): void {
  if (!hasBrowserStorage()) return;
  try {
    window.sessionStorage.setItem(ENGINE_PREFERENCE_KEY, id);
  } catch {
    // 静默:偏好写失败不影响地图主流程
  }
}
