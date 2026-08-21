// ============================================================
// marker 稳定性契约测试(b2)—「marker 只添加一次、跨视口保留实例」
// (ws-c 同步语义:控制器拿到 view 即引擎就绪,异步门已删)
//
// 目标不变式(修复公司 POI 屏闪):
//   (a) setPOIs 跨批次只增不删:离开视口的 id 不再被 remove,实例保留
//       (removeMarker 只留给 clear/destroy;空列表 = 清空)
//   (b) setVisiblePOIs 只切换 show/hide,实例保留在 markers Map;
//       后续新增的 marker 按同一可见集应用
//   (c) clusterZoomForZoom 分桶:zoom 8.1/8.4 同桶(LOD/徽章零重建),
//       8→9 切换一次(聚合 ↔ 个体 pin);map-shell 以该值为
//       clusterState/可见性 memo 依赖键
//   (d) marker 源 = catalog 只增池:新增 POI 进池只 add,已有实例不重建
//
// 用 MockMap(duck-type MapView)+ MockMarker 直接观察 overlay 注册表
// 与 show/hide 状态。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  installAMapMock,
  uninstallAMapMock,
  MockMap,
  makePoi,
} from './fixtures/amap-mock.mjs';
import {
  clusterZoomForZoom,
  createPOIMarkerController,
} from '../src/lib/map-markers.ts';

const HZ = [
  makePoi('hz-1', '浙江省发展规划研究院', 120.099, 30.299),
  makePoi('hz-2', '中国电建华东院', 120.079, 30.324),
];
const VIEWPORT_B = [
  makePoi('hz-1', '浙江省发展规划研究院', 120.099, 30.299), // 仍在视野
  makePoi('sh-1', '上海一', 121.47, 31.23), // 新进入视野
];

const countOnMap = (map) => map.getAllOverlays('marker').length;

test.afterEach(() => {
  uninstallAMapMock();
});

// ---- (a) setPOIs 跨批次只增不删 ----

test('视口批次切换:离开视口的 id 不再被 remove,只 add 新 + 更新存量', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });

  c.setPOIs(HZ); // 批次 1:杭州 2 家
  assert.equal(countOnMap(map), 2);
  const hz1Before = c.getMarkerByPOIId('hz-1');
  const hz2Before = c.getMarkerByPOIId('hz-2');
  assert.ok(hz1Before && hz2Before, '批次 1 双 marker 已建');

  // 批次 2 = 视口平移后:hz-2 离开视口、sh-1 进入——整体替换的 listCatalog 语义
  c.setPOIs(VIEWPORT_B);
  assert.equal(countOnMap(map), 3, '只增不删:hz-2 不被 remove');
  assert.ok(c.getMarkerByPOIId('hz-2'), '离开视口的 hz-2 实例保留(不再销毁重建)');
  assert.ok(c.getMarkerByPOIId('sh-1'), '新进入视口的 sh-1 已 add');
  assert.equal(c.getMarkerByPOIId('hz-1'), hz1Before, '存量 hz-1 实例同一性不变(不重建)');
  assert.equal(c.getMarkerByPOIId('hz-2'), hz2Before, '存量 hz-2 实例同一性不变(不重建)');

  c.destroy();
  assert.equal(countOnMap(map), 0, 'destroy 才摘除全部');
});

test('池增长:新增 POI 进池只 add,已有实例不重建(marker 源 = catalog 语义)', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });

  c.setPOIs(HZ);
  const before = new Map(
    HZ.map((p) => [p.id, c.getMarkerByPOIId(p.id)]),
  );

  // 视口累积池增长(mergePoisById 只增):hz 保留 + 新公司进池
  c.setPOIs([...HZ, makePoi('hz-3', '新华三', 120.11, 30.19)]);
  assert.equal(countOnMap(map), 3, '新增 1 个,共 3 个');
  for (const [id, marker] of before) {
    assert.equal(c.getMarkerByPOIId(id), marker, `${id} 实例同一性不变(只 add,不重建)`);
  }
  assert.ok(c.getMarkerByPOIId('hz-3'), '新进池的 hz-3 已 add');
  c.destroy();
});

// ---- (b) setVisiblePOIs show/hide 语义与实例保留 ----

test('setVisiblePOIs:show/hide 切换,实例保留;null 恢复全显', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setPOIs(HZ);
  for (const p of HZ) assert.ok(c.getMarkerByPOIId(p.id).isVisible(), '初始全显');

  c.setVisiblePOIs(['hz-1']); // zoom tier 过滤/聚合边界:只显 hz-1
  assert.ok(c.getMarkerByPOIId('hz-1').isVisible(), 'hz-1 显示');
  assert.ok(!c.getMarkerByPOIId('hz-2').isVisible(), 'hz-2 隐藏');
  assert.equal(countOnMap(map), 2, '隐藏不移除:实例仍在 overlay 表');
  assert.ok(c.getMarkerByPOIId('hz-2'), '隐藏的 hz-2 实例保留(不销毁)');

  c.setVisiblePOIs(HZ.map((p) => p.id)); // 出聚合/zoom 恢复
  for (const p of HZ) assert.ok(c.getMarkerByPOIId(p.id).isVisible(), '恢复全显');

  c.setVisiblePOIs(null); // 重置:全显
  for (const p of HZ) assert.ok(c.getMarkerByPOIId(p.id).isVisible(), 'null = 全显');
  c.destroy();
});

test('setVisiblePOIs 后新增的 marker 按同一可见集应用', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });

  c.setPOIs(HZ);
  c.setVisiblePOIs(['hz-1']); // 可见集先于新 marker 存在

  c.setPOIs([...HZ, makePoi('hz-3', '新华三', 120.11, 30.19)]);
  assert.ok(c.getMarkerByPOIId('hz-3'), '新 marker 已 add(实例保留语义)');
  assert.ok(!c.getMarkerByPOIId('hz-3').isVisible(), '不在可见集 → 新 marker 默认隐藏');
  assert.ok(c.getMarkerByPOIId('hz-1').isVisible(), '可见集内 hz-1 显示');
  c.destroy();
});

test('setVisiblePOIs 空集 = 全部隐藏(刷新后旧池不显示),实例不销毁', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setPOIs(HZ);
  c.setVisiblePOIs([]);
  for (const p of HZ) {
    assert.ok(!c.getMarkerByPOIId(p.id).isVisible(), `${p.id} 隐藏`);
    assert.ok(c.getMarkerByPOIId(p.id), `${p.id} 实例仍在`);
  }
  assert.equal(countOnMap(map), 2, '实例仍在 overlay 表');
  c.destroy();
});

test('可见集先于 setPOIs:新建 marker 按可见集应用(同步语义,异步门已删)', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setVisiblePOIs(['hz-2']); // 先记录可见集
  c.setPOIs(HZ); // 同步创建
  assert.equal(countOnMap(map), 2, '同步创建 2 个');
  assert.ok(!c.getMarkerByPOIId('hz-1').isVisible(), 'hz-1 按可见集隐藏');
  assert.ok(c.getMarkerByPOIId('hz-2').isVisible(), 'hz-2 显示');
  c.destroy();
});

// ---- (c) cluster effect 依赖分桶(clusterZoomForZoom)----

test('clusterZoomForZoom 分桶:zoom 微调不重建,聚合↔个体只切换一次', () => {
  // 聚合区间(zoom ≤ 8,严格边界与 clusterCities 一致):LOD 分桶 = floor(zoom)
  // ——徽章计数只随整数 zoom 变化,区间内微调(5.2→5.9)零重建
  assert.equal(clusterZoomForZoom(5.0), 5);
  assert.equal(clusterZoomForZoom(5.2), 5);
  assert.equal(clusterZoomForZoom(5.9), 5);
  assert.equal(clusterZoomForZoom(7.1), 7);
  assert.equal(clusterZoomForZoom(7.9), 7);
  assert.equal(clusterZoomForZoom(8.0), 8);

  // 个体 pin 桶(zoom > 8):8.1/8.4/8.9 恒为 CLUSTER_MAX_ZOOM + 1 → 零重建
  assert.equal(clusterZoomForZoom(8.1), 9);
  assert.equal(clusterZoomForZoom(8.4), 9);
  assert.equal(clusterZoomForZoom(8.9), 9);
  assert.equal(clusterZoomForZoom(9.0), 9);
  assert.equal(clusterZoomForZoom(12.5), 9);

  // 8→9 区间恰好一次切换(8.0 聚合 → 8.1 个体):分桶序列 7,7,8,9×6
  const seq = [7.1, 7.9, 8.0, 8.1, 8.4, 8.9, 9.0, 9.1, 12.5].map(clusterZoomForZoom);
  assert.deepEqual(seq, [7, 7, 8, 9, 9, 9, 9, 9, 9], '分桶序列:7,7,8,9×6——8→9 一次切换');

  assert.equal(clusterZoomForZoom(NaN), 9, '非法 zoom 落入个体 pin 桶');
});

// ---- 空列表语义(与 marker-leak 互补)----

test('setPOIs([]) 清空后可见集重置:新批次全显', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setPOIs(HZ);
  c.setVisiblePOIs(['hz-1']);
  c.setPOIs([]); // 刷新:清空
  assert.equal(countOnMap(map), 0, '空列表清空全部');
  c.setPOIs(HZ); // 刷新完成,新批次进池
  assert.equal(countOnMap(map), 2);
  for (const p of HZ) {
    assert.ok(c.getMarkerByPOIId(p.id).isVisible(), '清空后可见集重置 → 新批次全显');
  }
  c.destroy();
});
