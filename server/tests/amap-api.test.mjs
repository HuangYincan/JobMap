import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAMapPOI } from '../src/lib/amap-api.ts';

const BASE = {
  id: 'B0FFHF120D',
  name: '杭州印象西湖',
  location: '120.135687,30.251276',
  type: '风景名胜;公园广场;公园',
};

test('normalizeAMapPOI: 真实电话保留', () => {
  const poi = normalizeAMapPOI({ ...BASE, tel: '0571-85791266' });
  assert.ok(poi);
  assert.equal(poi.tel, '0571-85791266');
  assert.equal(poi.id, 'B0FFHF120D'); // 真 poiid 透传
});

test('normalizeAMapPOI: tel 空值防御 — "[]"/空串/空数组 → undefined', () => {
  const r1 = normalizeAMapPOI({ ...BASE, tel: '[]' });
  assert.equal(r1?.tel, undefined);
  const r2 = normalizeAMapPOI({ ...BASE, tel: '' });
  assert.equal(r2?.tel, undefined);
  const r3 = normalizeAMapPOI({ ...BASE, tel: '  ' });
  assert.equal(r3?.tel, undefined);
  const r4 = normalizeAMapPOI({ ...BASE, tel: undefined });
  assert.equal(r4?.tel, undefined);
  // AMap 空电话可能返回 truthy 的空数组
  const r5 = normalizeAMapPOI({ ...BASE, tel: [] });
  assert.equal(r5?.tel, undefined);
  // 数组第一个元素是真实电话 → 取用
  const r6 = normalizeAMapPOI({ ...BASE, tel: ['0571-85791266'] });
  assert.equal(r6?.tel, '0571-85791266');
});

test('normalizeAMapPOI: 无 tel 字段不影响其他字段', () => {
  const poi = normalizeAMapPOI({ ...BASE, rating: '4.4' });
  assert.ok(poi);
  assert.equal(poi.rating, 4.4);
  assert.equal(poi.tel, undefined);
});
