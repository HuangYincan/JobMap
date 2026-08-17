import test from 'node:test';
import assert from 'node:assert/strict';

import { hzPoiSpatialSql, hzRowToDomainPoi, parseBoundsParam } from '../src/lib/hz-poi-store.ts';

test('hzPoiSpatialSql: bbox + zoom + q + categories + common 过滤', () => {
  const { where, params } = hzPoiSpatialSql({
    bounds: { west: 120.0, south: 30.2, east: 120.2, north: 30.3 },
    zoom: 13,
    q: '肯德基',
    categories: ['餐饮服务', '购物服务'],
  });
  assert.match(where, /ST_MakeEnvelope\(\$1, \$2, \$3, \$4, 4326\)/);
  assert.match(where, /p\.tier <= \$5/);
  assert.match(where, /p\.name ILIKE \$6/);
  assert.match(where, /p\.big_type = ANY\(\$7::text\[\]\)/);
  assert.match(where, /\(p\.rating > 0 OR jsonb_array_length\(p\.photos\) > 0 OR p\.tier <= 3\)/);
  assert.deepEqual(params, [120.0, 30.2, 120.2, 30.3, 13, '%肯德基%', ['餐饮服务', '购物服务']]);
});

test('hzPoiSpatialSql: 无 clip 时仍有 common 过滤', () => {
  const { where, params } = hzPoiSpatialSql({});
  assert.match(where, /\(p\.rating > 0 OR jsonb_array_length\(p\.photos\) > 0 OR p\.tier <= 3\)/);
  assert.deepEqual(params, []);
});

test('hzPoiSpatialSql: zoom 非正数 / NaN 时跳过 LOD tier 子句', () => {
  const r1 = hzPoiSpatialSql({ zoom: 0 });
  assert.ok(!r1.where.includes('p.tier <= $'), 'zoom=0 不应有 LOD 参数');
  const r2 = hzPoiSpatialSql({ zoom: Number.NaN });
  assert.ok(!r2.where.includes('p.tier <= $'), 'zoom=NaN 不应有 LOD 参数');
  const r3 = hzPoiSpatialSql({ zoom: -1 });
  assert.ok(!r3.where.includes('p.tier <= $'), 'zoom=-1 不应有 LOD 参数');
  const r4 = hzPoiSpatialSql({ zoom: 13 });
  assert.ok(r4.where.includes('p.tier <= $'), 'zoom=13 应有 LOD 参数');
});

test('hzPoiSpatialSql: 全空 categories 不生成 ANY 参数;含有效值时保留', () => {
  const r1 = hzPoiSpatialSql({ categories: ['', '  '] });
  assert.ok(!r1.params.some((p) => Array.isArray(p)), '全空 categories 无数组参数');
  const r2 = hzPoiSpatialSql({ categories: ['', '餐饮服务'] });
  assert.ok(r2.params.some((p) => Array.isArray(p)), '含有效值 categories 有数组参数');
});

test('hzRowToDomainPoi: GCJ 坐标零转换 + photos 截 3 + category/subcategory', () => {
  const poi = hzRowToDomainPoi({
    poi_id: 'B0FFHF120D',
    name: '杭州印象西湖',
    address: '北山路82号',
    tel: '0571-85791266',
    rating: '4.4',
    lng_gcj: 120.135687,
    lat_gcj: 30.251276,
    big_type: '事件活动',
    mid_type: '公众活动',
    photos: ['http://a.com/1', 'http://a.com/2', 'http://a.com/3', 'http://a.com/4'],
    open_hours: null,
    total: '100',
  });
  assert.equal(poi.id, 'B0FFHF120D');
  assert.equal(poi.kind, 'domain');
  assert.equal(poi.source, 'api');
  assert.equal(poi.location.lng, 120.135687); // GCJ-02 直用
  assert.equal(poi.location.lat, 30.251276);
  assert.equal(poi.location.address, '北山路82号');
  assert.equal(poi.category, '事件活动');
  assert.equal(poi.subcategory, '公众活动');
  assert.equal(poi.rating, 4.4);
  assert.deepEqual(poi.photos, ['http://a.com/1', 'http://a.com/2', 'http://a.com/3']); // 截 3
  assert.equal(poi.tel, '0571-85791266');
});

test('hzRowToDomainPoi: rating null → undefined;无 photos → undefined', () => {
  const poi = hzRowToDomainPoi({
    poi_id: 'X', name: '测试', address: null, tel: null, rating: null, cost: null,
    lng_gcj: 120.1, lat_gcj: 30.2, big_type: '餐饮服务', mid_type: null,
    photos: null, open_hours: null, total: '1',
  });
  assert.equal(poi.rating, undefined);
  assert.equal(poi.photos, undefined);
  assert.equal(poi.subcategory, undefined);
  assert.equal(poi.priceLevel, undefined);
});

test('hzRowToDomainPoi: cost → priceLevel(与 normalizeAMapPOI 同口径)', () => {
  const poi = hzRowToDomainPoi({
    poi_id: 'Y', name: '测试', address: null, tel: null, rating: '4.2', cost: '260',
    lng_gcj: 120.1, lat_gcj: 30.2, big_type: '住宿服务', mid_type: null,
    photos: ['http://a.com/1'], open_hours: null, total: '1',
  });
  assert.equal(poi.priceLevel, 3); // ceil(260/100)=3,cap 4
  assert.equal(poi.rating, 4.2);
});

test('parseBoundsParam: 复用现有解析', () => {
  assert.deepEqual(parseBoundsParam('120.0,30.2,120.2,30.3'), {
    west: 120.0, south: 30.2, east: 120.2, north: 30.3,
  });
  assert.equal(parseBoundsParam('bad'), null);
  assert.equal(parseBoundsParam('120,30'), null);
});
