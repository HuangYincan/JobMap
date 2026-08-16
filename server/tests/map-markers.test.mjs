// map-markers 状态机：选中互斥，高亮不盖住选中
import test from 'node:test';
import assert from 'node:assert/strict';

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
