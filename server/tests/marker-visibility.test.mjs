// ============================================================
// marker 稳定性契约测试(b2)—「marker 只添加一次、跨视口保留实例」
// (ws-c 同步语义:控制器拿到 view 即引擎就绪,异步门已删)
//
// 目标不变式(修复公司 POI 屏闪):
//   (a) setPOIs 跨批次只增不删:离开视口的 id 不再被 remove,实例保留
//       (removeMarker 只留给 clear/destroy;空列表 = 保留实例,2026-08-25
//       f-lod-pool 修订:空过滤 ≠ 清空池,可见性由 setVisiblePOIs 负责)
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
  makeDomainPoi,
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

// ---- 空列表语义(与 marker-leak 互补;2026-08-25 f-lod-pool 修订)----

test('setPOIs([]) 保留实例且不重置可见集:空过滤 ≠ 清空池,clear() 才显式清空', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setPOIs(HZ);
  c.setVisiblePOIs(['hz-1']);
  const hz1Before = c.getMarkerByPOIId('hz-1');
  const hz2Before = c.getMarkerByPOIId('hz-2');

  c.setPOIs([]); // 刷新/加载瞬态:空过滤 ◁ 清空——实例保留、可见集不变
  assert.equal(countOnMap(map), 2, '空列表保留全部实例(不摘除)');
  assert.equal(c.getMarkerByPOIId('hz-1'), hz1Before, 'hz-1 实例同一性不变');
  assert.equal(c.getMarkerByPOIId('hz-2'), hz2Before, 'hz-2 实例同一性不变');

  c.setPOIs(HZ); // 刷新完成,新批次进池(同内容):可见集未被空列表重置
  assert.equal(countOnMap(map), 2);
  assert.ok(c.getMarkerByPOIId('hz-1').isVisible(), '可见集未重置:hz-1 仍显示');
  assert.ok(!c.getMarkerByPOIId('hz-2').isVisible(), '可见集未重置:hz-2 仍隐藏');

  c.clear(); // 显式清空(唯一清场路径):全部摘除 + 可见集复位
  assert.equal(countOnMap(map), 0, 'clear() 清零');
  c.setPOIs(HZ); // clear 后新批次全显(visibleIds 已复位 null)
  for (const p of HZ) {
    assert.ok(c.getMarkerByPOIId(p.id).isVisible(), 'clear 后可见集重置 → 新批次全显');
  }
  c.destroy();
});

// ---- (e) 契约化:控制器只调 MapMarker 契约方法(ws-2 引擎无关化)----
// 三引擎适配层各自断言 setZIndex→setzIndex/setVisible→show·hide 等大小写映射;
// 此处断言控制器侧只出现契约方法名(wrapper.setZIndex/setVisible/setContent/
// setPosition/remove/on),绝不直调裸实例 AMap 专属方法(amap-mock 的
// setIcon/setOffset 已改为抛错绊线)。

test('select/deselect 走契约:setContent 重渲染 + setZIndex(100/20),创建经 opts.content', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setPOIs(HZ);
  const hz1 = c.getMarkerByPOIId('hz-1');
  assert.equal(hz1.contractCalls.setZIndex, 1, '创建即经 wrapper.setZIndex(20)');
  assert.equal(hz1.contractCalls.setContent, 0, '创建经 opts.content,不额外 setContent');
  assert.match(hz1.opts.content, /dm-badge-normal/, '创建 content = normal 徽章');
  assert.equal(hz1.zIndex, 20, '招聘徽章 normal zIndex = 20');

  c.select('hz-1');
  assert.equal(hz1.contractCalls.setZIndex, 2, '选中经 wrapper.setZIndex(100)');
  assert.equal(hz1.contractCalls.setContent, 1, '选中经 wrapper.setContent 重渲染');
  assert.equal(hz1.zIndex, 100, '选中 zIndex = 100');
  assert.ok(hz1.content.includes('dm-badge-selected'), 'content 换 selected 徽章');

  c.deselect();
  assert.equal(hz1.contractCalls.setZIndex, 3, '取消选中回 setZIndex(20)');
  assert.equal(hz1.contractCalls.setContent, 2, '取消选中回 setContent(normal)');
  assert.ok(hz1.content.includes('dm-badge-normal'), 'content 回 normal 徽章');
  c.destroy();
});

test('highlight 走契约:setContent 重渲染 + setZIndex(80);选中清高亮(既有语义)', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setPOIs(HZ);
  const hz1 = c.getMarkerByPOIId('hz-1');
  c.highlight('hz-1');
  assert.equal(hz1.zIndex, 80, '高亮 zIndex = 80');
  assert.ok(hz1.content.includes('dm-badge-highlighted'), 'content 换 highlighted 徽章');
  c.select('hz-1'); // 选中压过高亮,且清空同 id 的高亮(既有状态机语义)
  assert.equal(hz1.zIndex, 100, '选中 zIndex = 100');
  c.deselect(); // 高亮已被选中清空 → 回落 normal(不是高亮)
  assert.equal(hz1.zIndex, 20, '取消选中回 normal zIndex = 20');
  assert.ok(hz1.content.includes('dm-badge-normal'), 'content 回 normal 徽章');
  c.destroy();
});

test('domain 图钉:创建即 content(data URI),选中重渲染,无 icon 直调', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setPOIs([makeDomainPoi('d-1', '西湖', 120.15, 30.27)]);
  const raw = c.getMarkerByPOIId('d-1');
  assert.ok(raw, 'domain pin 已建');
  assert.equal(raw.opts.icon, undefined, '创建不传 icon 规格(统一 content 路径)');
  assert.match(raw.opts.content, /data:image\/svg\+xml/, 'content = SVG data URI 图钉');
  assert.match(raw.opts.content, /width="32"/, 'normal 状态 32px 基准');
  assert.equal(raw.opts.offset[0], -16, '锚点 offset 恒定 [-16,-40](图钉底尖)');
  assert.equal(raw.opts.offset[1], -40);
  assert.equal(raw.zIndex, 10, 'domain pin normal zIndex = 10');

  c.select('d-1');
  assert.equal(raw.contractCalls.setContent, 1, '选中经 wrapper.setContent 重渲染');
  assert.equal(raw.contractCalls.setZIndex, 2, 'zIndex 10 → 100');
  assert.equal(raw.zIndex, 100, '选中 zIndex = 100');
  assert.match(raw.content, /width="42"/, '选中 42px(1.3×)');
  assert.match(raw.content, /margin-left:-5px/, '负 margin 补偿锚点(offset 恒定)');
  c.destroy();
});

test('可见性契约:setVisiblePOIs 经 wrapper.setVisible,非裸 show/hide 直调', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setPOIs(HZ);
  for (const p of HZ) {
    assert.equal(c.getMarkerByPOIId(p.id).contractCalls.setVisible, 1, '创建即 applyVisibility → setVisible(true)');
  }
  c.setVisiblePOIs(['hz-1']);
  const hz2 = c.getMarkerByPOIId('hz-2');
  assert.ok(hz2.contractCalls.setVisible >= 2, '隐藏经 wrapper.setVisible(false)');
  assert.ok(!hz2.isVisible(), '裸实例可见性已切换');
  c.setVisiblePOIs(null);
  assert.ok(hz2.contractCalls.setVisible >= 3, '恢复经 wrapper.setVisible(true)');
  assert.ok(hz2.isVisible(), '裸实例恢复显示');
  c.destroy();
});

test('setPOIs 存量更新走契约 setPosition 对象形态(非数组)', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setPOIs(HZ);
  const hz1 = c.getMarkerByPOIId('hz-1');
  c.setPOIs(HZ); // 存量路径 → setPosition
  assert.equal(hz1.contractCalls.setPosition, 1, '存量 marker 经 wrapper.setPosition');
  assert.deepEqual(hz1.position, [120.099, 30.299], '适配层收对象形态转厂商数组');
  c.destroy();
});

// ---- replace 模式(2026-08-25 a-marker-core)— 视口整体换 catalog 语义 ----
// setPOIs(pois, { replace: true }):add/update 完成后销毁「不在新列表、也不在
// retainIds」的 id;默认(不传 opts)行为 = 只增不删,完全不变。

test('setPOIs replace:池外 id 被销毁,新列表保留(不再永久累积)', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setPOIs(HZ); // hz-1 + hz-2
  assert.equal(countOnMap(map), 2);

  // 视口整体替换:hz-2 离开列表且不在 retainIds → 销毁;sh-1 新增
  c.setPOIs(VIEWPORT_B, { replace: true });
  assert.equal(countOnMap(map), 2, 'replace:池外 hz-2 销毁,只剩新列表 2 个');
  assert.equal(c.getMarkerByPOIId('hz-2'), undefined, '池外 hz-2 已销毁(实例释放)');
  assert.ok(c.getMarkerByPOIId('hz-1'), '新列表 hz-1 保留');
  assert.ok(c.getMarkerByPOIId('sh-1'), '新列表 sh-1 已 add');
  c.destroy();
  assert.equal(countOnMap(map), 0, 'destroy 清零');
});

test('replace + retainIds:收藏 overlay 离开列表也保留实例,隐藏/再显示可控', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setPOIs(HZ);
  const hz2Before = c.getMarkerByPOIId('hz-2');

  // 收藏 overlay 层(hz-2)即使离开新列表也保留(仅隐藏由 setVisiblePOIs 决定)
  const SH_ONLY = [makePoi('sh-1', '上海一', 121.47, 31.23)];
  c.setPOIs(SH_ONLY, { replace: true, retainIds: ['hz-2'] });
  assert.equal(countOnMap(map), 2, 'retainIds 保留 hz-2 + 新增 sh-1');
  assert.equal(c.getMarkerByPOIId('hz-2'), hz2Before, 'retained 实例同一性不变(不重建)');
  assert.ok(c.getMarkerByPOIId('hz-2'), 'retained hz-2 实例仍在可再 show');
  assert.equal(c.getMarkerByPOIId('hz-1'), undefined, '非保留的池外 hz-1 仍销毁');

  c.setVisiblePOIs(['hz-2', 'sh-1']);
  assert.ok(c.getMarkerByPOIId('hz-2').isVisible(), 'retained 实例按可见集可再 show');
  assert.ok(c.getMarkerByPOIId('sh-1').isVisible(), '新列表 marker 同可见集');
  c.setVisiblePOIs(['hz-2']); // 收藏层单独显示
  assert.ok(c.getMarkerByPOIId('hz-2').isVisible(), '收藏层显示');
  assert.ok(!c.getMarkerByPOIId('sh-1').isVisible(), '非收藏隐藏');
  c.destroy();
});

test('replace 保留存量/选中/高亮状态(存量实例不重建)', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setPOIs(HZ);
  const hz1Before = c.getMarkerByPOIId('hz-1');
  c.select('hz-1');
  c.highlight('hz-2');

  // hz-1 在新列表(保留 + 选中状态保持);hz-2 高亮但离开列表 → 销毁
  c.setPOIs(VIEWPORT_B, { replace: true });
  assert.equal(c.getMarkerByPOIId('hz-1'), hz1Before, '存量 hz-1 实例同一性不变(不重建)');
  assert.equal(hz1Before.zIndex, 100, '选中状态保持(zIndex 100)');
  assert.ok(hz1Before.content.includes('dm-badge-selected'), '选中徽章 content 保持');
  assert.equal(c.getMarkerByPOIId('hz-2'), undefined, '高亮的 hz-2 离开列表 → 销毁');
  const sh1 = c.getMarkerByPOIId('sh-1');
  assert.ok(sh1, '新列表 sh-1 已 add');
  assert.ok(sh1.opts.content.includes('dm-badge-normal'), '新增 marker 按当前选中/高亮关系建 normal 样式');
  assert.equal(sh1.zIndex, 20, '新增 marker normal zIndex');
  c.destroy();
});

test('默认 patch 模式(不传 opts):离开列表的 id 仍保留(只增不删不变)', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setPOIs(HZ);
  c.setPOIs(VIEWPORT_B); // 不带 opts
  assert.equal(countOnMap(map), 3, '默认模式只增不删:计数 3');
  assert.ok(c.getMarkerByPOIId('hz-2'), '离开列表的 hz-2 实例保留(默认 patch 语义不变)');
  c.destroy();
});
