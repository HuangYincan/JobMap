// ============================================================
// 收藏相机同步状态机(纯函数,ws1 saved-overlay-wipe,2026-08-22)
//
// 背景:点按切换「收藏图层」→ setBounds(收藏点外接框)是程序化相机移动,其
// settle 事件(moveend/zoomend/idle)若触发视口刷新,空批次会把 catalog 置空
// → markerPois 坍缩 → controller.clear() 只删不建,全部 POI 消失。旧修复是
// 500ms 时间窗补丁(use-work-viewport VIEWPORT_SUPPRESS_MS)——动画 >500ms
// 或腾讯 idle 300ms debounce 叠加后,迟到事件逃逸窗口,清空链路照旧。
//
// 本模块是结构性替代:setBounds 前置位同步状态(含目标中心),settle 事件到达
// 时以「相机是否位于目标中心」判定事件归属并跳过——事件/状态语义,无时间
// 常数,慢动画/迟到事件不逃逸;相机离开目标(用户接管)或消费满 settle 事件
// 对(moveend+zoomend;腾讯映射为单个 idle 由 consumed 兜底)后自动结束,
// 不残留误伤后续用户操作触发的视口刷新。
//
// 消费方:
// - use-work-viewport onViewChange:同步期内跳过视口刷新(consumeSavedCameraSync);
// - map-shell syncView:同步期内冻结 distance 圆心 mapCenter(根因 #2,
//   圆心不随程序化移动跳变 → work 模式 distance 筛选不把视野外 pin 裁空)。
// 本模块只依赖 ./types.ts(无 @ 别名),node 测试可直接 import。
// ============================================================

import { haversineDistance } from './types.ts';

/** 收藏图层 toggle 的程序化相机同步状态。 */
export interface SavedCameraSync {
  /** setBounds 目标视野中心(toggle 由 overlayBounds 中点计算) */
  destCenter: { lng: number; lat: number };
  /** 已消费的 settle 事件数(事件对兜底:≥2 强制结束,防单事件引擎残留) */
  consumed: number;
}

/** 「相机位于收藏同步目标中心」的判定容差(米)。fit 保持 bounds 居中,中心应
 *  与目标中心重合;容差只吸收引擎浮点/对齐抖动,不含时间语义。 */
export const SAVED_CAMERA_MATCH_METERS = 250;

/** 事件到达时相机是否位于收藏同步目标中心(纯函数,可测)。 */
export function cameraAtDestination(
  center: { lng: number; lat: number } | null | undefined,
  sync: SavedCameraSync | null | undefined,
): boolean {
  if (!sync || !center) return false;
  return haversineDistance(center, sync.destCenter) <= SAVED_CAMERA_MATCH_METERS;
}

/** 消费一次相机 settle 事件(纯函数,可测):返回下一次同步状态;null = 同步结束。
 *  - 事件到达时相机不在目标中心 → 用户已接管相机,结束同步(该事件按正常刷新处理);
 *  - 相机在目标中心但已消费满 2 个事件(moveend+zoomend 事件对)→ 结束同步;
 *  - 否则保持同步(继续吞掉该程序化相机移动的后续 settle 事件)。 */
export function consumeSavedCameraSync(
  sync: SavedCameraSync | null,
  center: { lng: number; lat: number } | null | undefined,
): SavedCameraSync | null {
  if (!sync) return null;
  if (!cameraAtDestination(center, sync)) return null;
  const consumed = sync.consumed + 1;
  if (consumed >= 2) return null;
  return { destCenter: sync.destCenter, consumed };
}
