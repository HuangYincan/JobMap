import test from 'node:test';
import assert from 'node:assert/strict';

import { searchPublicCatalog, spatialClipFromSearch } from '../src/lib/public-search.ts';
import { loadWorkCatalogFromDb } from '../src/lib/recruitment-store.ts';
import { INTERNSHIP_SEED } from '../src/lib/seed-data.ts';
import { DISTRICT_BOXES } from '../src/lib/spatial-filters.ts';
import {
  companySitesSpatialSql,
  hasSpatialClip,
  knownHangzhouDistricts,
  parseDistanceKm,
  parseMaxTier,
} from '../src/lib/spatial-query.ts';

test('companySitesSpatialSql is empty without a clip', () => {
  assert.equal(hasSpatialClip(undefined), false);
  assert.deepEqual(companySitesSpatialSql(undefined), { sql: '', params: [] });
  assert.equal(parseDistanceKm(0), null);
  assert.equal(parseDistanceKm('2.5'), 2.5);
});

test('companySitesSpatialSql uses gist && then geography ST_DWithin', () => {
  const box = companySitesSpatialSql({
    bounds: { west: 120, south: 30.2, east: 120.2, north: 30.3 },
  });
  assert.match(box.sql, /s\.geom && ST_MakeEnvelope\(\$1, \$2, \$3, \$4, 4326\)/);
  assert.deepEqual(box.params, [120, 30.2, 120.2, 30.3]);

  const both = companySitesSpatialSql({
    bounds: { west: 120, south: 30.2, east: 120.2, north: 30.3 },
    origin: { lng: 120.1, lat: 30.25 },
    radiusMeters: 2500,
  });
  assert.match(both.sql, /ST_DWithin\(s\.geom::geography/);
  assert.match(both.sql, /ST_SetSRID\(ST_MakePoint\(\$5, \$6\), 4326\)::geography, \$7\)/);
  assert.equal(both.params.at(-1), 2500);
});

test('spatialClipFromSearch maps bounds, distance, and district onto the SQL clip', () => {
  const clip = spatialClipFromSearch({
    bounds: '120.0,30.2,120.2,30.3',
    filters: { distance: 3, district: ['余杭区', '火星区'] },
  });
  assert.ok(clip?.bounds);
  assert.equal(clip.bounds.west, 120);
  assert.equal(clip.origin?.lng, 120.1);
  assert.equal(clip.radiusMeters, 3000);
  assert.deepEqual(clip.districts, ['余杭区']);
  assert.equal(spatialClipFromSearch({}), undefined);
  assert.deepEqual(knownHangzhouDistricts(['西湖区', 'nope']), ['西湖区']);
});

test('companySitesSpatialSql unions district address and coarse box', () => {
  const sql = companySitesSpatialSql({ districts: ['余杭区'] });
  assert.match(sql.sql, /ILIKE \$1/);
  assert.match(sql.sql, /ILIKE \$2/);
  assert.match(sql.sql, /s\.geom && ST_MakeEnvelope\(\$3, \$4, \$5, \$6, 4326\)/);
  assert.deepEqual(sql.params.slice(0, 2), ['%余杭区%', '%余杭%']);
  assert.deepEqual(sql.params.slice(2), [
    DISTRICT_BOXES.余杭区.west,
    DISTRICT_BOXES.余杭区.south,
    DISTRICT_BOXES.余杭区.east,
    DISTRICT_BOXES.余杭区.north,
  ]);
});

test('in-memory public search still clips when there is no database', () => {
  const pois = [
    { id: 'in', kind: 'domain', name: 'In', mode: 'domain', source: 'seed', location: { lng: 120.1, lat: 30.25 }, category: '风景名胜' },
    { id: 'out', kind: 'domain', name: 'Out', mode: 'domain', source: 'seed', location: { lng: 121, lat: 30.25 }, category: '风景名胜' },
  ];
  const out = searchPublicCatalog(pois, { mode: 'domain', bounds: '120.0,30.2,120.2,30.3' });
  assert.deepEqual(out.results.map((p) => p.id), ['in']);
});

test('companySitesSpatialSql matches city by city_code exact or city ILIKE', () => {
  const city = companySitesSpatialSql({ city: '北京市' });
  assert.match(city.sql, /s\.city_code = \$1 OR COALESCE\(s\.city, ''\) ILIKE \$2/);
  assert.deepEqual(city.params, ['北京市', '%北京%']);
  // 行政区划码走精确匹配；无尾缀城市名同样 ILIKE 命中 '北京市'。
  const code = companySitesSpatialSql({ city: '110000' });
  assert.deepEqual(code.params, ['110000', '%110000%']);
  // 城市 + 视野合并成 AND。
  const both = companySitesSpatialSql({ city: '北京', bounds: { west: 116, south: 39, east: 117, north: 40 } });
  assert.match(both.sql, /s\.geom && ST_MakeEnvelope\(\$1, \$2, \$3, \$4, 4326\).*city_code = \$5/);
});

test('hasSpatialClip counts city / maxTier / alive as clips', () => {
  assert.equal(hasSpatialClip({ city: '北京' }), true);
  assert.equal(hasSpatialClip({ maxTier: 1 }), true);
  assert.equal(hasSpatialClip({ alive: true }), true);
  assert.equal(hasSpatialClip({ city: '  ' }), false);
  assert.equal(hasSpatialClip({}), false);
});

test('parseMaxTier accepts 1-3 integers and rejects garbage', () => {
  assert.equal(parseMaxTier(1), 1);
  assert.equal(parseMaxTier('2'), 2);
  assert.equal(parseMaxTier(3.7), 3);
  assert.equal(parseMaxTier(0), null);
  assert.equal(parseMaxTier(-1), null);
  assert.equal(parseMaxTier('abc'), null);
  assert.equal(parseMaxTier(undefined), null);
  assert.equal(parseMaxTier(null), null);
});

test('spatialClipFromSearch maps maxTier / city / alive onto the clip', () => {
  const clip = spatialClipFromSearch({ filters: { maxTier: 1, city: '北京', alive: true } });
  assert.equal(clip?.maxTier, 1);
  assert.equal(clip?.city, '北京');
  assert.equal(clip?.alive, true);
  assert.equal(spatialClipFromSearch({ filters: { maxTier: 'abc', city: '  ', alive: false } }), undefined);
});

test('loadWorkCatalogFromDb clips Hangzhou west-lake when DATABASE_URL is set', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL is not set');
    return;
  }
  const west = await loadWorkCatalogFromDb({
    bounds: { west: 120.01, south: 30.26, east: 120.04, north: 30.29 },
  });
  if (!west) {
    t.skip('Postgres pool unavailable');
    return;
  }
  assert.ok(west.length > 0);
  assert.ok(west.length < INTERNSHIP_SEED.length);
  assert.ok(west.every((p) => p.location.lng >= 120.01 && p.location.lng <= 120.04));
  assert.ok(west.some((p) => p.id === 'alibaba-xixi'));

  const empty = await loadWorkCatalogFromDb({
    bounds: { west: 10, south: 10, east: 11, north: 11 },
  });
  assert.ok(empty);
  assert.equal(empty.length, 0);

  const yuhang = await loadWorkCatalogFromDb({ districts: ['余杭区'] });
  assert.ok(yuhang);
  assert.ok(yuhang.some((p) => p.id === 'alibaba-xixi'));
});
