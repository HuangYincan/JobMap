import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AMAP_DEFAULT_RADIUS,
  AMAP_NEARBY_MAX_RADIUS,
  AMAP_PAGE_SIZE,
  AMAP_QPS,
  buildSearchQueue,
  categoryMatches,
  isCommonPoi,
  mapScaleMetersPerCm,
  mergePoisById,
  MORE_PAGE_SIZE,
  POI_HARD_CAP,
  POI_SOFT_CAP,
  popularityScore,
  sampleViewportGrid,
  searchRadiusMeters,
  zoomStrategy,
} from '../src/lib/viewport-search.ts';
import { sortPOIs } from '../src/lib/search.ts';

test('sampleViewportGrid: 4x4 yields 16 interior centers', () => {
  const pts = sampleViewportGrid(
    { west: 120, south: 30, east: 121, north: 31 },
    4,
    4
  );
  assert.equal(pts.length, 16);
  assert.ok(pts.every((p) => p.lng > 120 && p.lng < 121));
  assert.ok(pts.every((p) => p.lat > 30 && p.lat < 31));
  const uniq = new Set(pts.map((p) => `${p.lng},${p.lat}`));
  assert.equal(uniq.size, 16);
});

test('zoomStrategy: national view uses landmarks, city view uses all', () => {
  const s = zoomStrategy(4);
  assert.equal(s.categories, 'landmark');
  assert.equal(s.city, '全国');
  assert.equal(zoomStrategy(7).categories, 'core');
  assert.equal(zoomStrategy(13).categories, 'all');
});

test('searchRadiusMeters is scale × 30, default 3000 when over 50km', () => {
  const street = searchRadiusMeters(16, 30.27);
  const city = searchRadiusMeters(13, 30.27);
  const national = searchRadiusMeters(5, 30.27);
  assert.ok(street > 0 && street <= AMAP_NEARBY_MAX_RADIUS);
  assert.ok(city > street);
  assert.equal(national, AMAP_DEFAULT_RADIUS);
  assert.ok(Math.abs(street - mapScaleMetersPerCm(16, 30.27) * 30) < 1);
});

test('mergePoisById dedupes and respects cap', () => {
  const a = [{ id: '1' }, { id: '2' }];
  const b = [{ id: '2' }, { id: '3' }, { id: '4' }];
  const merged = mergePoisById(a, b, 3);
  assert.deepEqual(merged.map((p) => p.id), ['1', '2', '3']);
});

test('buildSearchQueue is one center: categories then pages', () => {
  const queue = buildSearchQueue(['风景名胜', '高等院校', '购物服务'], 2);
  assert.equal(queue.length, 6);
  assert.deepEqual(queue.slice(0, 3).map((t) => t.keyword), ['风景名胜', '高等院校', '购物服务']);
  assert.ok(queue.slice(0, 3).every((t) => t.page === 1));
  assert.ok(queue.slice(3).every((t) => t.page === 2));
});

test('categoryMatches maps UI values to AMap type prefixes', () => {
  assert.equal(categoryMatches('餐饮服务', 'food'), true);
  assert.equal(categoryMatches('餐饮服务', '餐饮服务'), true);
  assert.equal(categoryMatches('购物服务', 'shopping'), true);
  assert.equal(categoryMatches('餐饮服务', '住宿服务'), false);
  assert.equal(categoryMatches('餐饮服务', 'all'), true);
});

test('mergePoisById grows a catalog toward the display cap', () => {
  const existing = Array.from({ length: 3 }, (_, i) => ({ id: `e${i}` }));
  const incoming = Array.from({ length: 5 }, (_, i) => ({ id: `n${i}` }));
  const merged = mergePoisById(existing, incoming, POI_HARD_CAP);
  assert.equal(merged.length, 8);
  assert.equal(POI_SOFT_CAP, 300);
  assert.equal(MORE_PAGE_SIZE, 300);
  assert.ok(POI_HARD_CAP > POI_SOFT_CAP);
});

test('isCommonPoi drops anonymous shops without rating or photos', () => {
  assert.equal(isCommonPoi({ category: '餐饮服务' }), false);
  assert.equal(isCommonPoi({ category: '餐饮服务', rating: 4.2 }), true);
  assert.equal(isCommonPoi({ category: '风景名胜' }), true);
});

test('buildSearchQueue pageOffset advances PlaceSearch page', () => {
  const first = buildSearchQueue(['餐饮服务', '购物服务'], 1, 0);
  const more = buildSearchQueue(['餐饮服务', '购物服务'], 1, 1);
  assert.ok(first.every((t) => t.page === 1));
  assert.ok(more.every((t) => t.page === 2));
});

test('zoomStrategy pageSize stays within AMap PlaceSearch max and QPS is 3', () => {
  assert.ok(zoomStrategy(14).pageSize <= AMAP_PAGE_SIZE);
  assert.ok(zoomStrategy(7).pageSize <= AMAP_PAGE_SIZE);
  assert.equal(AMAP_QPS, 3);
});

test('popularityScore differs from rating so sorts can diverge', () => {
  const highRateLowPop = {
    id: 'a',
    kind: 'domain',
    name: 'A',
    mode: 'domain',
    source: 'amap',
    location: { lng: 120, lat: 30 },
    category: '其他',
    rating: 5,
    reviewCount: 2,
    photos: [],
  };
  const midRateHighPop = {
    id: 'b',
    kind: 'domain',
    name: 'B',
    mode: 'domain',
    source: 'amap',
    location: { lng: 120, lat: 30 },
    category: '风景名胜',
    rating: 3.2,
    reviewCount: 900,
    photos: ['x', 'y'],
  };
  const byRating = sortPOIs([highRateLowPop, midRateHighPop], 'rating');
  const byPop = sortPOIs([highRateLowPop, midRateHighPop], 'popularity');
  assert.equal(byRating[0].id, 'a');
  assert.equal(byPop[0].id, 'b');
  assert.ok(popularityScore(midRateHighPop) > popularityScore(highRateLowPop));
});
