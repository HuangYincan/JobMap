import test from 'node:test';
import assert from 'node:assert/strict';

import { LOD_RULES, maxTierForZoom } from '../src/lib/lod.ts';

test('LOD rules are sorted by minZoom ascending and start at 0', () => {
  assert.equal(LOD_RULES[0].minZoom, 0);
  for (let i = 1; i < LOD_RULES.length; i += 1) {
    assert.ok(LOD_RULES[i].minZoom > LOD_RULES[i - 1].minZoom);
  }
  // 档位语义:越靠近街区 maxTier 越小(只展示名企)
  assert.equal(LOD_RULES[LOD_RULES.length - 1].maxTier, 1);
});

test('LOD: street level (zoom >= 14) shows only famous companies (tier 1)', () => {
  assert.equal(maxTierForZoom(14), 1);
  assert.equal(maxTierForZoom(15), 1);
  assert.equal(maxTierForZoom(18), 1);
});

test('LOD: city level (zoom 9-13) allows tier 1-2', () => {
  assert.equal(maxTierForZoom(9), 2);
  assert.equal(maxTierForZoom(11), 2);
  assert.equal(maxTierForZoom(13), 2);
});

test('LOD: national level (zoom < 9) allows everything (tier 3)', () => {
  assert.equal(maxTierForZoom(8), 3);
  assert.equal(maxTierForZoom(5), 3);
  assert.equal(maxTierForZoom(3), 3);
  assert.equal(maxTierForZoom(0), 3);
});

test('LOD: invalid zoom falls back to all (tier 3)', () => {
  assert.equal(maxTierForZoom(Number.NaN), 3);
  assert.equal(maxTierForZoom(Number.POSITIVE_INFINITY), 3);
  assert.equal(maxTierForZoom(Number.NEGATIVE_INFINITY), 3);
});
