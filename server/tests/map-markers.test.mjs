// map-markers 状态机：选中互斥，高亮不盖住选中
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveMarkerState, createPOIMarkerController } from '../src/lib/map-markers.ts';
import {
  installAMapMock,
  uninstallAMapMock,
  MockMap,
  makeDomainPoi,
  makePoi,
} from './fixtures/amap-mock.mjs';

test('resolveMarkerState: selected wins over highlighted', () => {
  assert.equal(resolveMarkerState('a', 'a', 'a'), 'selected');
  assert.equal(resolveMarkerState('a', 'a', 'b'), 'selected');
  assert.equal(resolveMarkerState('b', 'a', 'b'), 'highlighted');
  assert.equal(resolveMarkerState('c', 'a', 'b'), 'normal');
});

test('resolveMarkerState: switching selection leaves the previous id normal', () => {
  const selected = 'b';
  const highlighted = null;
  assert.equal(resolveMarkerState('a', selected, highlighted), 'normal');
  assert.equal(resolveMarkerState('b', selected, highlighted), 'selected');
});

test('resolveMarkerState: empty selection and highlight is normal', () => {
  assert.equal(resolveMarkerState('a', null, null), 'normal');
});

// ---- 源码契约门禁(ws-2 引擎无关化)----
// 控制器不得直调裸实例的 AMap 专属 API(这些只允许出现在三引擎适配层);
// raw 逃生舱仅限两处:getMarkerByPOIId 探针 + createCityClusterMarker 返回值。

test('控制器源码契约:无 AMap 专属 API 直调(引擎无关化门禁)', () => {
  const src = readFileSync(new URL('../src/lib/map-markers.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(
    src,
    /setzIndex|setIcon\(|new this\.amap|\.show\(\)|\.hide\(\)|setMap\(null\)/,
    'map-markers.ts 不得出现 AMap 专属方法名/构造(适配层才有权出现)'
  );
  assert.equal((src.match(/\.raw\b/g) ?? []).length, 2, 'raw 直读仅限两处逃生舱');
});

// ---- isAttached 契约(2026-08-25 a-marker-core)— 控制器 sync 的探测通道 ----
// MockMarker.getMap() 为真 = 挂载;mockDetach() 模拟厂商侧外部移除(getMap → null)。
// 控制器侧只经契约 wrapper.isAttached 探测,不直碰裸实例(源码契约同上)。

test('isAttached 契约(amap-mock):挂载 true → mockDetach 外部移除后 false', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setPOIs([makeDomainPoi('d-1', '西湖', 120.15, 30.27)]);
  const raw = c.getMarkerByPOIId('d-1');
  assert.ok(raw, 'marker 已建');
  const wrapper = c.markers.get('d-1');
  assert.ok(wrapper, '内部簿记可探(TS private 仅编译期,runtime 可读——既有测试先例)');
  assert.equal(wrapper.isAttached(), true, '挂载时 wrapper.isAttached = true');
  assert.equal(raw.getMap(), map, 'MockMarker.getMap() = 地图实例(探测数据源)');

  raw.mockDetach(); // 厂商侧删除(mock 手段)
  assert.equal(raw.getMap(), null, 'mockDetach 后 getMap() = null');
  assert.equal(wrapper.isAttached(), false, '外部移除后 wrapper.isAttached = false');
  c.destroy();
});

test('isAttached 缺失/不支持探测(undefined)→ sync 跳过该 marker', () => {
  installAMapMock({ immediate: true });
  const map = new MockMap();
  const c = createPOIMarkerController(map, { color: '#007AFF' });
  c.setPOIs([makePoi('hz-1', '浙江省发展规划研究院', 120.099, 30.299)]);
  const raw = c.getMarkerByPOIId('hz-1');
  // 模拟引擎不支持探测:删除 wrapper 上的 isAttached(契约可选方法)
  delete c.markers.get('hz-1').isAttached;
  raw.mockDetach();
  c.sync();
  assert.equal(c.getMarkerByPOIId('hz-1'), raw, '无探测能力 → sync 跳过,实例不重建');
  assert.equal(countOnMap(map), 0, '跳过重建 → 地图上仍无 marker(未误补)');
  c.destroy();
});

const countOnMap = (map) => map.getAllOverlays('marker').length;

test.afterEach(() => {
  uninstallAMapMock();
});
