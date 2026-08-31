import test from 'node:test';
import assert from 'node:assert/strict';

import { INTERNSHIP_SEED } from './fixtures/seed-data.ts';
import {
  buildCompareColumn,
  buildCompareColumns,
  toggleCompareSelection,
} from '../src/lib/compare-saved.ts';

const westlake = { lng: 120.15, lat: 30.24 };

function place(id, extra = {}) {
  const poi = INTERNSHIP_SEED.find((item) => item.id === id);
  assert.ok(poi, id);
  return {
    id: `saved-${id}`,
    poiId: id,
    name: extra.name ?? poi.name,
    mode: 'work',
    kind: 'recruitment',
    address: extra.address ?? poi.location.address,
    lng: extra.lng ?? poi.location.lng,
    lat: extra.lat ?? poi.location.lat,
    createdAt: '2026-08-16T00:00:00.000Z',
    ...extra,
  };
}

test('toggleCompareSelection keeps at most two and drops the oldest', () => {
  assert.deepEqual(toggleCompareSelection([], 'a'), ['a']);
  assert.deepEqual(toggleCompareSelection(['a'], 'a'), []);
  assert.deepEqual(toggleCompareSelection(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggleCompareSelection(['a', 'b'], 'c'), ['b', 'c']);
});

test('buildCompareColumn uses live recruitment fields', () => {
  const alibaba = INTERNSHIP_SEED.find((item) => item.id === 'alibaba-xixi');
  const col = buildCompareColumn(place('alibaba-xixi'), alibaba, westlake);
  assert.equal(col.scale, '大厂');
  assert.match(col.industries, /互联网/);
  assert.equal(col.rating, '4.4');
  assert.ok(Number(col.openJobs) >= 1);
  assert.match(col.families, /实习/);
  assert.match(col.salary, /–/);
  assert.notEqual(col.distance, '—');
  assert.match(col.address, /余杭/);
  assert.match(col.benefits, /餐补/);
});

test('buildCompareColumn falls back to the saved snapshot when catalog misses', () => {
  const col = buildCompareColumn(
    {
      id: 's1',
      poiId: 'missing-office',
      name: '某园区',
      mode: 'work',
      kind: 'recruitment',
      address: '西湖区',
      lng: 120.1,
      lat: 30.2,
      createdAt: '2026-08-16T00:00:00.000Z',
    },
    undefined,
    westlake,
  );
  assert.equal(col.name, '某园区');
  assert.equal(col.scale, '—');
  assert.equal(col.openJobs, '—');
  assert.equal(col.address, '西湖区');
  assert.notEqual(col.distance, '—');
});

test('buildCompareColumns resolves two saved companies from the catalog', () => {
  const cols = buildCompareColumns(
    ['alibaba-xixi', 'tencent-hangzhou'],
    [place('alibaba-xixi'), place('tencent-hangzhou')],
    INTERNSHIP_SEED,
    westlake,
  );
  assert.equal(cols.length, 2);
  assert.equal(cols[0].name, '阿里巴巴');
  assert.equal(cols[1].name, '腾讯');
  assert.equal(cols[0].scale, cols[1].scale);
  assert.notEqual(cols[0].openJobs, '—');
});
