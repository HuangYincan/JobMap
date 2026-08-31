import test from 'node:test';
import assert from 'node:assert/strict';

import { amapDirectionsUrl, estimateCommuteOptions, estimateMinutes } from '../src/lib/commute.ts';

test('estimateMinutes uses mode-specific speeds and overhead', () => {
  assert.equal(estimateMinutes(800, 'walk'), 10);
  assert.ok(estimateMinutes(3000, 'drive') < estimateMinutes(3000, 'walk'));
});

test('estimateCommuteOptions drops long walks and bikes', () => {
  const nearby = estimateCommuteOptions(600);
  assert.deepEqual(nearby.map((item) => item.mode), ['walk', 'bike', 'transit', 'drive']);

  const far = estimateCommuteOptions(8000);
  assert.ok(!far.some((item) => item.mode === 'walk'));
  assert.ok(far.some((item) => item.mode === 'transit'));
  assert.equal(estimateCommuteOptions(undefined).length, 0);
});

test('amapDirectionsUrl encodes destination and mode', () => {
  const url = amapDirectionsUrl({ lng: 120.15, lat: 30.27, name: '西湖' }, 'walk');
  assert.ok(url.includes('to=120.15,30.27,'));
  assert.ok(url.includes('mode=walk'));
});
