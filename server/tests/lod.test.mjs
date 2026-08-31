import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_ZOOM, TIER_HIDDEN, TIER_DEFAULT, maxTierForZoom } from '../src/lib/lod.ts';

test('LOD model: tier = minimum visible zoom; maxTierForZoom is identity (floor)', () => {
  assert.equal(maxTierForZoom(0), 0);
  assert.equal(maxTierForZoom(5), 5);
  assert.equal(maxTierForZoom(11), 11);
  assert.equal(maxTierForZoom(20), 20);
});

test('LOD: fractional zoom floors (zoom >= tier 才显示)', () => {
  assert.equal(maxTierForZoom(13.9), 13);
  assert.equal(maxTierForZoom(4.1), 4);
});

test('LOD: zoom beyond max clamps to MAX_ZOOM (tier 21 永不显示)', () => {
  assert.equal(maxTierForZoom(21), MAX_ZOOM);
  assert.equal(maxTierForZoom(999), MAX_ZOOM);
  // 对照:TIER_HIDDEN 高于任何可见 tier,等价隐藏标记
  assert.ok(TIER_HIDDEN > MAX_ZOOM);
});

test('LOD: negative zoom clamps to 0 (tier 0 一直可见)', () => {
  assert.equal(maxTierForZoom(-1), 0);
});

test('LOD: invalid zoom falls back to max visible (全部)', () => {
  assert.equal(maxTierForZoom(Number.NaN), MAX_ZOOM);
  assert.equal(maxTierForZoom(Number.POSITIVE_INFINITY), MAX_ZOOM);
  assert.equal(maxTierForZoom(Number.NEGATIVE_INFINITY), MAX_ZOOM);
});

test('LOD: default tier for unlabeled companies is 12 (小厂可见性)', () => {
  assert.equal(TIER_DEFAULT, 12);
});
