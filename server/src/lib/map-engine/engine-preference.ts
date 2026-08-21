// ============================================================
// 引擎偏好读写 — MapEngine 内核(engine-preference)
//
// localStorage key `domain-map:engine` 持久化用户偏好的引擎;
// SSR / 非浏览器环境守卫:读返回 null,写静默 no-op。
// ============================================================

import type { MapEngineId } from './types.ts';

const ENGINE_PREFERENCE_KEY = 'domain-map:engine';

const ENGINE_IDS: readonly string[] = ['amap', 'tencent', 'baidu'];

function hasBrowserStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/** 读取用户偏好的引擎;未设置 / 值无效 / 非浏览器环境 → null */
export function readEnginePreference(): MapEngineId | null {
  if (!hasBrowserStorage()) return null;
  try {
    const raw = window.localStorage.getItem(ENGINE_PREFERENCE_KEY);
    if (!raw) return null;
    return ENGINE_IDS.includes(raw) ? (raw as MapEngineId) : null;
  } catch {
    // 隐私模式 / 配额异常:读不到按未设置处理,不影响主流程
    return null;
  }
}

/** 写入用户偏好的引擎;非浏览器 / 写入失败静默 no-op */
export function writeEnginePreference(id: MapEngineId): void {
  if (!hasBrowserStorage()) return;
  try {
    window.localStorage.setItem(ENGINE_PREFERENCE_KEY, id);
  } catch {
    // 静默:偏好写失败不影响地图主流程
  }
}
