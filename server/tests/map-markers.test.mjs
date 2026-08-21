// map-markers 状态机：选中互斥，高亮不盖住选中
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveMarkerState } from '../src/lib/map-markers.ts';

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
