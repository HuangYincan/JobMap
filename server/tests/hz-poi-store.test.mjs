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

test('hzPoiSpatialSql: zoom 钳位 0..20;NaN 跳过 LOD tier 子句', () => {
  // zoom=0 → tier <= 0(仅地标),而不是丢弃 LOD 子句放出 tier-21「永隐」类
  const r1 = hzPoiSpatialSql({ zoom: 0 });
  assert.ok(r1.where.includes('p.tier <= $1'), 'zoom=0 应有 tier <= 0');
  assert.equal(r1.params[0], 0);
  const r2 = hzPoiSpatialSql({ zoom: Number.NaN });
  assert.ok(!r2.where.includes('p.tier <= $'), 'zoom=NaN 不应有 LOD 参数');
  const r3 = hzPoiSpatialSql({ zoom: -1 });
  assert.ok(r3.where.includes('p.tier <= $'), 'zoom=-1 钳位到 0');
  assert.equal(r3.params[0], 0);
  const r4 = hzPoiSpatialSql({ zoom: 22 });
  assert.equal(r4.params[0], 20, 'zoom=22 钳位到 20,tier-21 永隐类不放行');
  const r5 = hzPoiSpatialSql({ zoom: 13 });
  assert.ok(r5.where.includes('p.tier <= $'), 'zoom=13 应有 LOD 参数');
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
  assert.equal(parseBoundsParam('118.3,29.1,,30.7'), null); // 空段 → 0 的坑
});

// ---- loadHangzhouPoisFromDb: 钳位/总数/回退(池注入) ----
import { loadHangzhouPoisFromDb } from '../src/lib/hz-poi-store.ts';

test('loadHangzhouPoisFromDb: limit/offset 钳位 1..300 / 0..1000', async () => {
  const queries = [];
  const pool = {
    query: async (sql) => {
      queries.push(sql.slice(0, 40));
      return { rows: [] };
    },
  };
  const r = await loadHangzhouPoisFromDb({ limit: 500, offset: -3, zoom: 13 }, pool);
  assert.equal(r?.limit, 300);
  assert.equal(r?.offset, 0);
  assert.ok(queries.some((q) => q.includes('count(*)'))); // rows 空 → 独立 count
});

test('loadHangzhouPoisFromDb: NaN limit/offset 落回默认,不把 NaN 传给 pg', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push(params ?? []);
      return sql.includes('OVER()')
        ? { rows: [{ total: '7' }] } // 窗口查询:带 total 的行
        : { rows: [{ n: '7' }] }; // 独立 count
    },
  };
  const r = await loadHangzhouPoisFromDb({ limit: Number.NaN, offset: Number.NaN }, pool);
  assert.equal(r?.limit, 300);
  assert.equal(r?.offset, 0);
  assert.equal(r?.total, 7);
  for (const c of calls) {
    assert.ok(c.every((v) => typeof v !== 'number' || Number.isFinite(v)));
  }
});

test('loadHangzhouPoisFromDb: 查库失败 → null(走回退),不伪装成空 200', async () => {
  const pool = {
    query: async () => {
      throw new Error('connection refused');
    },
  };
  assert.equal(await loadHangzhouPoisFromDb({ zoom: 13 }, pool), null);
});
