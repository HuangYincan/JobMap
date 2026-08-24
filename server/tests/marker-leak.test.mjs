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

test('destroy 摘除走 remove 契约:placed 内每实例 wrapper.remove() 调用(ws-2)', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setPOIs(HZ);
  const raws = HZ.map((p) => c.getMarkerByPOIId(p.id));
  assert.ok(raws.every((m) => m && m.contractCalls), 'mock wrapper 带契约调用簿记');
  c.destroy();
  assert.equal(countOnMap(map), 0, 'destroy 后地图清零');
  for (const m of raws) {
    assert.ok(m.contractCalls.remove >= 1, 'destroy 经 wrapper.remove() 摘除(非 setMap 直调)');
  }
});

// ---- sync() 完整性自动补回(2026-08-25 a-marker-core)— 厂商侧外部删除的被动检测 ----
// 不变式:marker 被厂商侧删除(getMap → null)而 React 的 pois 引用不变时,
// sync() 发现缺失并按 poiById 原状态重建;幂等、O(n)、失败静默。

test('外部移除(mockDetach)→ sync() 重新 add,状态(位置/图标/click/选中/可见性)保持', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  let clicked = null;
  const c = createPOIMarkerController(map, {
    color: '#007AFF',
    onMarkerClick: (id) => {
      clicked = id;
    },
  });
  c.setPOIs(HZ);
  c.select('hz-1');
  c.setVisiblePOIs(['hz-1']); // hz-2 隐藏(可见集先于删除存在)
  const hz1Raw = c.getMarkerByPOIId('hz-1');
  const hz2Raw = c.getMarkerByPOIId('hz-2');
  assert.equal(countOnMap(map), 2);

  // 厂商侧外部删除 hz-1(等价 map.removeOverlay:getMap → null,不经控制器)
  hz1Raw.mockDetach();
  assert.equal(hz1Raw.getMap(), null, 'mockDetach 后 getMap() = null');
  assert.equal(countOnMap(map), 1, '外部删除后地图 overlay 只剩 hz-2');
  assert.equal(c.markers.get('hz-1').isAttached(), false, '契约探测:已脱挂');

  c.sync();
  const hz1Rebuilt = c.getMarkerByPOIId('hz-1');
  assert.ok(hz1Rebuilt && hz1Rebuilt !== hz1Raw, 'sync 重建 hz-1(新实例,非旧实例)');
  assert.equal(countOnMap(map), 2, '重建后地图恢复 2 个');
  assert.equal(hz1Rebuilt.getMap(), map, '重建实例挂回地图');
  assert.equal(hz2Raw, c.getMarkerByPOIId('hz-2'), '未删除的 hz-2 实例同一性不变');
  assert.deepEqual(hz1Rebuilt.position, { lng: 120.099, lat: 30.299 }, '位置按 poiById 还原');
  assert.ok(hz1Rebuilt.opts.content.includes('dm-badge-selected'), '选中徽章 content 还原');
  assert.equal(hz1Rebuilt.zIndex, 100, 'selected 状态还原(zIndex 100)');
  assert.ok(hz1Rebuilt.isVisible(), '可见集还原:hz-1 显示');
  assert.ok(!c.getMarkerByPOIId('hz-2').isVisible(), '可见集还原:hz-2 仍隐藏');
  hz1Rebuilt.trigger('click');
  assert.equal(clicked, 'hz-1', '重建后的 click 回调还原(onMarkerClick 可达)');
  c.destroy();
  assert.equal(countOnMap(map), 0, 'destroy 后地图清零');
});

test('sync 幂等:全挂载/已恢复后零重建、零重复 add', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setPOIs(HZ);
  const before = new Map(HZ.map((p) => [p.id, c.getMarkerByPOIId(p.id)]));

  c.sync(); // 全挂载 → 零重建
  for (const [id, m] of before) {
    assert.equal(c.getMarkerByPOIId(id), m, `${id} 全挂载时零重建(实例同一性不变)`);
  }
  assert.equal(countOnMap(map), 2, 'sync 后计数不变');

  // 删除 hz-1 → sync 恢复 → 二次 sync 不再重建(幂等)
  c.getMarkerByPOIId('hz-1').mockDetach();
  c.sync();
  const rebuilt = c.getMarkerByPOIId('hz-1');
  assert.ok(rebuilt, 'sync 恢复 hz-1');
  c.sync();
  assert.equal(c.getMarkerByPOIId('hz-1'), rebuilt, '二次 sync 零重建(幂等)');
  assert.equal(countOnMap(map), 2, '二次 sync 计数不变');
  c.destroy();
});

test('sync 清理 placed 孤儿:簿记丢失 + 外部脱挂 → 失效引用摘除,仍挂载孤儿保留', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setPOIs(HZ);
  const w1 = c.markers.get('hz-1'); // placed 存的是契约 wrapper(非裸实例)
  const w2 = c.markers.get('hz-2');
  assert.ok(w1 && w2, 'wrapper 簿记可探(TS private 仅编译期,runtime 可读)');
  c.markers.clear(); // 簿记丢失:hz-1/hz-2 沦为 placed 孤儿
  w1.raw.mockDetach(); // 厂商侧外部删除 hz-1

  c.sync();
  assert.equal(c.placed.has(w1), false, '已脱挂孤儿从 placed 摘除(失效引用清理)');
  assert.equal(c.placed.has(w2), true, '仍挂载孤儿保留(destroy sweepPlaced 负责兜底)');
  c.destroy();
  assert.equal(countOnMap(map), 0, 'destroy 后地图清零');
});

test('sync 在已销毁地图/已销毁控制器上静默 no-op(不抛、不重建)', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setPOIs(HZ);
  map.destroy(); // 地图先销毁
  assert.doesNotThrow(() => c.sync(), '地图已销毁 → sync 不抛');
  assert.equal(countOnMap(map), 2, '地图已销毁 → sync 不重建不新增');
  c.destroy();
  assert.doesNotThrow(() => c.sync(), '控制器已销毁 → sync 不抛');
});
