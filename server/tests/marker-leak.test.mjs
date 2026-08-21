// ============================================================
// marker 泄漏契约测试 — 控制器与地图 overlay 表的失同步防护
//
// 目标不变式(Bug1 伴生,ws2 + b2 修订;ws-c 同步语义):
//   1. destroy() 后,地图上无该控制器管理过的 overlay(计数归零)
//   2. setPOIs 非空列表 = 只增不删(b2):地图计数单调不减——只新增缺失标记,
//      离开列表的 id 保留实例(可见性由 setVisiblePOIs 控制);
//      空列表 = 清空(刷新/重置路径)
//   3. 控制器拿到 view 即引擎就绪(ws-c 删除了 loadAMap 异步门):所有操作
//      同步生效,不再有「就绪前销毁」竞态
//
// 用 MockMap(duck-type MapView)直接观察 overlay 注册表(等价浏览器
// map.getAllOverlays)。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  installAMapMock,
  uninstallAMapMock,
  MockMap,
  makePoi,
} from './fixtures/amap-mock.mjs';
import { createPOIMarkerController } from '../src/lib/map-markers.ts';

const HZ = [
  makePoi('hz-1', '浙江省发展规划研究院', 120.099, 30.299),
  makePoi('hz-2', '中国电建华东院', 120.079, 30.324),
];
const SH = [
  makePoi('sh-1', '上海一', 121.47, 31.23),
  makePoi('sh-2', '上海二', 121.48, 31.24),
  makePoi('sh-3', '上海三', 121.49, 31.25),
  makePoi('sh-4', '上海四', 121.5, 31.26),
  makePoi('sh-5', '上海五', 121.51, 31.27),
  makePoi('sh-6', '上海六', 121.52, 31.28),
  makePoi('sh-7', '上海七', 121.53, 31.29),
];

const countOnMap = (map) => map.getAllOverlays('marker').length;

test.afterEach(() => {
  uninstallAMapMock();
});

test('只增不删:杭州→上海→杭州往返,计数单调不减,离开的 id 保留实例', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });

  c.setPOIs(HZ);
  assert.equal(countOnMap(map), 2, '杭州 2 个 marker 上地图');
  c.setPOIs(SH);
  assert.equal(countOnMap(map), 9, '上海 7 个新增,杭州 2 个实例保留(只增不删)');
  assert.ok(c.getMarkerByPOIId('hz-1'), '离开列表的 hz-1 实例仍在');
  c.setPOIs(HZ);
  assert.equal(countOnMap(map), 9, '回到杭州 → 上海 7 个实例同样保留,计数不减');
  assert.ok(c.getMarkerByPOIId('sh-1'), '离开列表的 sh-1 实例仍在');
  c.destroy();
  assert.equal(countOnMap(map), 0, 'destroy 后地图清零');
});

test('destroy 后重建:旧控制器 marker 不残留', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const a = createPOIMarkerController(map, { color: '#007AFF' });
  a.setPOIs(HZ);
  assert.equal(countOnMap(map), 2);

  // 模拟 accentColor 变化 → usePOIMap effect 重建控制器
  a.destroy();
  assert.equal(countOnMap(map), 0, '旧控制器 destroy 即摘除全部 marker');
  const b = createPOIMarkerController(map, { color: '#FF6B35' });
  b.setPOIs(SH);
  assert.equal(countOnMap(map), 7, '新控制器同步创建 7 个');
  b.destroy();
});

test('同步语义:view 就绪即建 marker;destroy 后不再创建(异步门已删)', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setPOIs(HZ);
  assert.equal(countOnMap(map), 2, '控制器拿到 view 即同步创建(旧 loadAMap.then(flush) 已删)');
  c.destroy();
  assert.equal(countOnMap(map), 0, 'destroy 即摘除全部');
});

test('重建同步生效:旧控制器销毁 + 新控制器创建,零泄漏', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const a = createPOIMarkerController(map, { color: '#007AFF' });
  a.setPOIs(HZ);
  a.destroy();
  const b = createPOIMarkerController(map, { color: '#007AFF' });
  b.setPOIs(SH);
  assert.equal(countOnMap(map), 7, '只有新控制器创建 7 个,旧控制器零泄漏');
  b.destroy();
});

test('簿记丢失兜底:markers 内部表被破坏,destroy 仍摘除全部 placed marker', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setPOIs(HZ);
  assert.equal(countOnMap(map), 2);

  // 模拟「marker 在地图上、但控制器内部 markers 表丢失」的泄漏场景
  // (TS private 仅编译期约束,运行时可直接访问):
  // 破坏内部表后,setPOIs 已无能力定位这些 marker 更新——只有 placed 兜底能清
  c.markers.clear();
  c.setPOIs(SH); // 内部表为空 → 只增路径新建 7 个(地图上 2+7=9,泄漏在途)
  assert.equal(countOnMap(map), 9, '簿记丢失后地图上 9 个(2 个失控 + 7 个新建)');
  c.destroy();
  assert.equal(countOnMap(map), 0, 'destroy 凭 placed 账兜底摘除全部 9 个');
});

test('地图先销毁:已注册 marker 由控制器 destroy 摘除,不残留', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setPOIs(HZ);
  assert.equal(countOnMap(map), 2);
  map.destroy(); // 地图销毁(如 map-shell unmount 时序),控制器仍活着
  c.setPOIs(SH); // isReady 拒收(地图已销毁)→ 不新增 marker
  assert.equal(countOnMap(map), 2, '已销毁地图上不新增 marker');
  c.destroy(); // 控制器销毁 → placed 兜底摘除(即使 setMap 抛错也被 try/catch)
  assert.equal(countOnMap(map), 0, 'destroy 后地图 overlay 清零');
});

test('多次往返 + 中途重建:计数只增不减(只增池语义),最终清零', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  let c = createPOIMarkerController(map, { color: '#007AFF' });
  for (let i = 0; i < 5; i++) {
    c.setPOIs(HZ);
    c.setPOIs(SH);
    assert.equal(countOnMap(map), 9, `往返 ${i + 1} 后计数=9(2+7 只增不删)`);
    if (i === 2) {
      c.destroy();
      assert.equal(countOnMap(map), 0, '重建前旧控制器清零');
      c = createPOIMarkerController(map, { color: '#FF6B35' });
      c.setPOIs(HZ);
      assert.equal(countOnMap(map), 2, '重建后从空开始只加 2 个');
    }
  }
  assert.equal(countOnMap(map), 9, '往返×5 后计数=9');
  c.destroy();
  assert.equal(countOnMap(map), 0, '最终清零');
});

test('已销毁的 map 上不创建 marker(控制器晚于地图销毁)', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  map.destroy();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setPOIs(HZ);
  assert.equal(countOnMap(map), 0, '地图已销毁,不注册 overlay');
  c.destroy();
});

test('setPOIs 空列表 → 地图清零(空列表 = 清空,刷新/重置路径)', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setPOIs(HZ);
  assert.equal(countOnMap(map), 2);
  c.setPOIs([]);
  assert.equal(countOnMap(map), 0, '空列表即移除全部(等价 clear)');
  c.destroy();
});
