import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMUTE_COMPARE_MAX,
  filterByCommuteEstimate,
  listedCommuteHits,
  poiCommuteHit,
  toggleCommuteCompare,
} from '../src/lib/commute-filter.ts';
import { estimateMinutes } from '../src/lib/commute.ts';
import { haversineDistance } from '../src/lib/types.ts';
import { buildCommuteCompareColumns, COMMUTE_COMPARE_ROWS } from '../src/lib/commute-compare.ts';

const origin = { lng: 120.15, lat: 30.27 };

function poi(id, lng, lat) {
  return {
    id,
    name: id,
    kind: 'domain',
    mode: 'domain',
    source: 'seed',
    location: { lng, lat, address: `${id}-addr` },
  };
}

test('strict vs near:上限内是命中,超限不得画成命中', () => {
  const nearPoi = poi('near', origin.lng + 0.002, origin.lat);
  const farPoi = poi('far', origin.lng + 0.2, origin.lat);
  const result = filterByCommuteEstimate([nearPoi, farPoi], origin, 'transit', 45);
  assert.equal(result.strict.every((h) => h.minutes <= 45), true);
  assert.equal(result.near.every((h) => h.minutes > 45), true);
  assert.ok(result.strict.some((h) => h.poi.id === 'near'));
  assert.ok(result.near.some((h) => h.poi.id === 'far'));
  assert.equal(
    listedCommuteHits(result, 'strict').some((h) => h.bucket === 'near'),
    false,
  );
});

test('严格 0 命中:列表为空,closest 是最接近的超限项', () => {
  const far = poi('far', origin.lng + 0.25, origin.lat);
  const farther = poi('farther', origin.lng + 0.4, origin.lat);
  const result = filterByCommuteEstimate([far, farther], origin, 'walk', 15);
  assert.equal(result.strict.length, 0);
  assert.ok(result.closest);
  assert.equal(result.closest.bucket, 'near');
  assert.equal(result.closest.poi.id, 'far');
  assert.equal(listedCommuteHits(result, 'strict').length, 0);
});

test('无起点或空列表不规划', () => {
  const p = poi('a', 120.2, 30.3);
  assert.deepEqual(filterByCommuteEstimate([p], null, 'transit', 45), {
    strict: [],
    near: [],
    closest: null,
  });
  assert.deepEqual(filterByCommuteEstimate([], origin, 'transit', 45), {
    strict: [],
    near: [],
    closest: null,
  });
});

test('分钟来自 estimateMinutes(直线),不发 plan', () => {
  const p = poi('a', 120.2, 30.3);
  const hit = poiCommuteHit(p, origin, 'drive', 45);
  const meters = haversineDistance(origin, p.location);
  assert.equal(hit.minutes, estimateMinutes(meters, 'drive'));
});

test('toggleCommuteCompare 最多 5 列,再点取消', () => {
  let ids = [];
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) ids = toggleCommuteCompare(ids, id);
  assert.equal(ids.length, COMMUTE_COMPARE_MAX);
  assert.deepEqual(ids, ['b', 'c', 'd', 'e', 'f']);
  ids = toggleCommuteCompare(ids, 'c');
  assert.deepEqual(ids, ['b', 'd', 'e', 'f']);
});

test('通勤对比表无 score 字段', () => {
  assert.equal(COMMUTE_COMPARE_ROWS.includes('score'), false);
  const cols = buildCommuteCompareColumns(
    [poi('a', 120.2, 30.3)],
    { a: 38 },
    'estimate',
    { estimate: '估算', provider: '供应商', minutes: '分钟' },
  );
  assert.equal('score' in cols[0], false);
  assert.equal(cols[0].commuteMinutes, '38 分钟');
  assert.equal(cols[0].quality, '估算');
});
