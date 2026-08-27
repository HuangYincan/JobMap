// 地图相机缩放边界:Agent 动作与所有地图引擎共用。
// AMap JSAPI 的项目配置与 LOD 契约均以 [3,20] 为支持范围;
// agent 在 schema 与 bridge 两个边界都通过本函数钳制,避免引擎间行为漂移。

import { MAX_ZOOM } from '../lod.ts';

export const MIN_MAP_ZOOM = 3;
export const MAX_MAP_ZOOM = MAX_ZOOM;

/**
 * 把未知 zoom 规范化到项目/引擎共同支持范围。非 finite 值返回 null,
 * 让调用方拒绝 NaN/Infinity;有限的负值或过大值安全钳制到边界。
 */
export function clampMapZoom(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, value));
}
