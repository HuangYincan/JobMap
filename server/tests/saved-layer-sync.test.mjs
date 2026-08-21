// ============================================================
// 收藏图层 toggle 相机同步状态机回归测试(ws1 saved-overlay-wipe,2026-08-22)
//
// 回归场景:点按切换「收藏图层」→ setBounds(收藏点外接框)是程序化相机移动,
// 其 settle 事件(moveend/zoomend/idle)到达时若视口刷新照常执行,空批次会把
// catalog 置空 → markerPois 坍缩 → controller.clear() 只删不建,全部 POI 消失。
// 旧修复是 500ms 时间窗补丁(慢动画/迟到事件逃逸);本测试钉死结构性修复:
// 「收藏相机同步」状态机以「事件到达时相机是否位于目标中心」判定事件归属,
// 打开收藏 → 动画期间任何事件 → 视口刷新被跳过(catalog 不被空批次清空);
// 相机离开目标或事件对消费满后同步自动结束,关闭收藏后视口刷新恢复正常。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cameraAtDestination,
  consumeSavedCameraSync,
  SAVED_CAMERA_MATCH_METERS,
} from '../src/lib/saved-camera-sync.ts';

/** 杭州默认中心(与 map-shell DEFAULT_MAP_CENTER 同值) */
const ORIGIN = { lng: 120.15, lat: 30.27 };
/** 收藏点外接框中点(如用户收藏散落在杭州西溪一带) */
const DEST = { lng: 120.02, lat: 30.28 };

function makeSync(consumed = 0) {
  return { destCenter: DEST, consumed };
}

test('cameraAtDestination: 目标中心判定有容差(纯几何,无时间语义)', () => {
  assert.equal(cameraAtDestination(null, makeSync()), false);
  assert.equal(cameraAtDestination(undefined, null), false);
  assert.equal(cameraAtDestination(DEST, null), false);
  assert.equal(cameraAtDestination(DEST, makeSync()), true);
  // ~250m 内(引擎浮点/对齐抖动)视为已到达
  const jitter = { lng: DEST.lng + 0.001, lat: DEST.lat }; // ~91m @30°N
  assert.equal(cameraAtDestination(jitter, makeSync()), true);
  // 明显离开目标(用户接管相机 / 动画未到达)→ false
  assert.equal(cameraAtDestination(ORIGIN, makeSync()), false);
  // 容差常量是米级几何阈值,不是时间常数
  assert.equal(typeof SAVED_CAMERA_MATCH_METERS, 'number');
  assert.ok(SAVED_CAMERA_MATCH_METERS > 0);
});

test('consumeSavedCameraSync: 目标上消费满 settle 事件对后结束同步', () => {
  // 无同步状态 → null(正常视口刷新路径)
  assert.equal(consumeSavedCameraSync(null, DEST), null);
  // 第一次 settle 事件(moveend):相机在目标 → 保持同步(继续吞后续事件)
  assert.deepEqual(consumeSavedCameraSync(makeSync(0), DEST), { destCenter: DEST, consumed: 1 });
  // 第二次 settle 事件(zoomend,同一次 setBounds 的事件对)→ 同步结束
  assert.equal(consumeSavedCameraSync(makeSync(1), DEST), null);
});

test('consumeSavedCameraSync: 相机离开目标(用户接管)→ 立即结束同步', () => {
  // 单事件引擎(Tencent idle 只发一个 settle 事件)残留的同步状态,
  // 由用户下一次移动事件结束——该事件按正常刷新处理,不误伤
  assert.equal(consumeSavedCameraSync(makeSync(1), ORIGIN), null);
  assert.equal(consumeSavedCameraSync(makeSync(0), ORIGIN), null);
  // 快照缺失(读不到中心)同样结束,不残留
  assert.equal(consumeSavedCameraSync(makeSync(1), null), null);
});

test('回归:打开收藏 → 动画期间任何事件 → 视口刷新被跳过,catalog 不被清空', () => {
  // 模拟 onViewChange 与 settle 事件序列(与 use-work-viewport 事件侧同构):
  // 事件到达时若同步状态非空 → consume 并跳过 schedule;否则正常 schedule。
  // 加载器 load 回调就是「会把空批次写进 catalog」的路径——跳过 schedule
  // 即等价于「catalog 不被空批次清空,POI 不消失」。
  let sync = makeSync(0); // toggle ON 时置位(setBounds 前)
  let scheduled = 0;
  const onViewChange = (center) => {
    if (sync) {
      sync = consumeSavedCameraSync(sync, center);
      return; // 跳过视口刷新
    }
    scheduled += 1;
  };

  // setBounds 动画的 settle 事件:moveend + zoomend 都在目标中心
  onViewChange(DEST); // moveend → 跳过
  assert.ok(sync, 'moveend 后同步仍在(zoomend 仍需吞掉)');
  onViewChange(DEST); // zoomend → 跳过,事件对消费完
  assert.equal(sync, null, '事件对消费完后同步结束');
  assert.equal(scheduled, 0, '动画期间任何事件都不触发视口刷新 → catalog 不被清空');

  // 慢动画/迟到事件:settle 事件 3 秒后才到(旧 500ms 时间窗会逃逸)→ 仍被跳过
  sync = makeSync(0);
  onViewChange(DEST); // 迟到的 moveend → 跳过,同步继续
  assert.equal(scheduled, 0, '迟到事件同样不逃逸(事件/状态语义,非时间窗)');
  assert.ok(sync, '事件对未消费完,同步继续');
  onViewChange(DEST); // 迟到的 zoomend(事件对消费完)→ 同步结束
  assert.equal(sync, null, '迟到事件对消费完后同步结束');
  assert.equal(scheduled, 0, '动画期间任何事件都不触发视口刷新');

  // 关闭收藏后:用户拖动相机 → 视口刷新恢复正常
  onViewChange(ORIGIN); // 用户接管相机
  assert.equal(scheduled, 1, '用户移动事件触发正常视口刷新');
  onViewChange(ORIGIN);
  assert.equal(scheduled, 2, '后续事件持续正常刷新');
});

test('回归:单事件引擎(Tencent idle)残留同步 → 仅下一次事件被吞,随后恢复正常', () => {
  let sync = makeSync(0);
  let scheduled = 0;
  const onViewChange = (center) => {
    if (sync) {
      sync = consumeSavedCameraSync(sync, center);
      return;
    }
    scheduled += 1;
  };

  onViewChange(DEST); // 唯一的 settle 事件(idle)→ 跳过,同步残留 consumed=1
  assert.deepEqual(sync, { destCenter: DEST, consumed: 1 });
  onViewChange(DEST); // 用户在目标处缩放(zoomend)→ 吞掉并结束同步(不误伤后续)
  assert.equal(sync, null);
  assert.equal(scheduled, 0);
  onViewChange(DEST);
  assert.equal(scheduled, 1, '同步结束后恢复正常刷新');
});

test('回归:收藏 toggle 的相机移动不改变 distance 圆心(根因 #2)', () => {
  // map-shell syncView 的圆心冻结逻辑:同步期内相机在目标 → 圆心保持原值;
  // 相机离开目标 → 结束同步并更新圆心。与 consumeSavedCameraSync 共享
  // cameraAtDestination 判定,保证两处消费口径一致。
  let mapCenter = { ...ORIGIN };
  let sync = makeSync(0);
  const syncView = (center) => {
    if (sync && cameraAtDestination(center, sync)) return; // 冻结圆心(不更新)
    if (sync) sync = null;
    mapCenter = { ...center };
  };

  syncView(DEST); // toggle 相机移动的 settle 事件:圆心冻结
  assert.deepEqual(mapCenter, ORIGIN, 'distance 圆心不随收藏 toggle 跳变(work 筛选不裁空)');
  syncView(DEST);
  assert.deepEqual(mapCenter, ORIGIN);
  syncView(ORIGIN); // 用户移回:同步结束,圆心恢复正常跟随
  assert.deepEqual(mapCenter, ORIGIN);
  const elsewhere = { lng: 120.5, lat: 31.2 };
  syncView(elsewhere);
  assert.deepEqual(mapCenter, elsewhere, '同步结束后圆心正常跟随用户视野');
});
