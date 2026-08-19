/**
 * 地图初始相机常量与判定(ws-poi-vanish2)。
 * createMap 首载相机 = 默认中心(杭州);fast refresh remount 时 hook state 被保留,
 * 新地图以用户上次视野初始化(不再回杭州默认)。settle 门控用「相机是否仍处默认
 * 中心」判定:首载(相机=默认)仍飞用户位置,remount 恢复视野(非默认)不抢镜头。
 */

/** 默认初始化中心(杭州西湖):createMap 首载与 settle 门控的共同参照 */
export const DEFAULT_MAP_CENTER = { lng: 120.15, lat: 30.27 } as const;

/** 默认初始化 zoom */
export const DEFAULT_MAP_ZOOM = 13;

/** 「相机仍处默认位置」判定阈值(度,≈11km):中心距默认小于该值视为默认位置 */
export const DEFAULT_CENTER_NEAR_DEG = 0.1;

/** 相机中心是否仍处于默认初始化中心附近(纯函数,可单测) */
export function isNearDefaultCenter(center: { lng: number; lat: number } | null | undefined): boolean {
  if (!center) return false;
  return (
    Math.abs(center.lng - DEFAULT_MAP_CENTER.lng) < DEFAULT_CENTER_NEAR_DEG &&
    Math.abs(center.lat - DEFAULT_MAP_CENTER.lat) < DEFAULT_CENTER_NEAR_DEG
  );
}
