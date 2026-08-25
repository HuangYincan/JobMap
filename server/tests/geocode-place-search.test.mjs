// 地点检索补全 (2026-08-25, fix/site-place-search) — 占位地址分类 + 选点规则。
//
// 背景: 读路径无差别剔除城市中心钉后, 地址为城市名占位 (上海/深圳市) 或无地址
// 的带岗位站点被一并隐藏 (用户裁定: 数据补全而非改读路径)。本测试钉住:
//   cityNameOnlyAddress     — 地址自身是否「仅城市名」占位 (自包含, 无城市上下文)
//   siteNeedsPlaceSearch    — 站点是否走「公司名+城市」地点检索补全通道
//   planSiteGeocode         — needsGeocode (地址 geocode) / needsPlaceSearch 分类
//   pickPlaceSearchPoi      — 选点规则: 名称强匹配闸门 / 同城优先 / 同省近邻 /
//                             市中心半径惩罚 / office 类型加分 / null 兜底
// 全部纯函数, 无网络无 key。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cityNameOnlyAddress,
  distanceKm,
  pickPlaceSearchPoi,
  placeSearchRadiusScore,
  planSiteGeocode,
  siteHasStreetAddress,
  siteNeedsPlaceSearch,
} from '../src/lib/site-geocode.ts';

// --- 占位地址判定 (自包含) ---------------------------------------------------

test('cityNameOnlyAddress: 城市名占位 → true (裸名/带市/省前缀连写)', () => {
  for (const addr of ['上海', '上海市', '深圳市', '浙江省杭州市', '广西柳州', '北京市', '新加坡']) {
    assert.equal(cityNameOnlyAddress(addr), true, `${addr} 应为城市名占位`);
  }
});

test('cityNameOnlyAddress: 街道地址/多城市列表串/空 → false', () => {
  for (const addr of [
    '北京市海淀区中关村',
    '杭州市西湖区文一西路969号',
    '上海市黄浦区马当路388号',
    '北京/上海/深圳/成都',
    '浙江省杭州市上城区花园兜街175号',
    '',
    '   ',
  ]) {
    assert.equal(cityNameOnlyAddress(addr), false, `${addr} 不应判为城市名占位`);
  }
});

// --- 站点通道判定 ------------------------------------------------------------

test('siteNeedsPlaceSearch: 无地址/城市名占位 (缺坐标或中心钉) → 地点检索', () => {
  const mk = (location) => ({ id: 's', name: 'x', city: '杭州市', province: '浙江省', location });
  // 无地址 (location 缺失/空) 且无坐标 → 地点检索
  assert.equal(siteNeedsPlaceSearch(mk(undefined)), true);
  assert.equal(siteNeedsPlaceSearch(mk({})), true);
  // 城市名占位 (无坐标) → 地点检索
  assert.equal(siteNeedsPlaceSearch(mk({ address: '上海市' })), true);
  assert.equal(siteNeedsPlaceSearch(mk({ address: '深圳' })), true);
  // 城市名占位 + 坐标仍在城市中心钉 → 地点检索 (用户裁定: 读路径剔除中心钉,
  // 带岗位站用公司名+城市补全真实办公点)
  const SHANGHAI = { lng: 121.47, lat: 31.23 };
  assert.equal(siteNeedsPlaceSearch(mk({ address: '上海市', ...SHANGHAI })), true);
  // 多城市列表占位 → 不是本通道 (有「地址」形态, siteNeedsGeocode 归
  // needsGeocode, apply 既有公司名检索分支; 点选规则不与占位站混用)
  assert.equal(siteNeedsPlaceSearch(mk({ address: '北京/上海/深圳/成都' })), false);
  assert.equal(siteHasStreetAddress(mk({ address: '北京/上海/深圳/成都' })), false);
  // 街道地址 → 地址 geocode, 不是地点检索
  assert.equal(siteNeedsPlaceSearch(mk({ address: '西湖区文二西路712号' })), false);
  assert.equal(siteHasStreetAddress(mk({ address: '西湖区文二西路712号' })), true);
  // 真实坐标 (非中心钉) + 占位/无地址 → 坐标可用, 地址缺可容忍, 不补全
  assert.equal(siteNeedsPlaceSearch(mk({ address: '上海市', lng: 120.2, lat: 30.2 })), false);
  assert.equal(siteNeedsPlaceSearch(mk({ lng: 120.2, lat: 30.2 })), false);
});

// --- plan 分类 ---------------------------------------------------------------

function companyWith(sites) {
  return { slug: 'x-corp', name: '某司', industries: [], scale: 'enterprise', sites, positions: [] };
}

test('planSiteGeocode: needsGeocode (地址可 geocode) 与 needsPlaceSearch (占位/无地址) 分列', () => {
  const plan = planSiteGeocode([
    companyWith([
      { id: 's-geo', name: '某司', city: '杭州市', province: '浙江省', location: { address: '西湖区文一西路969号' } },
      { id: 's-ps-city', name: '某司', city: '上海市', province: '上海市', location: { address: '上海市' } },
      { id: 's-ps-noaddr', name: '某司', city: '广州市', province: '广东省', location: {} },
      { id: 's-ps-pin', name: '某司', city: '深圳市', province: '广东省', location: { address: '深圳市', lng: 114.06, lat: 22.55 } },
      { id: 's-geo-list', name: '某司', city: '深圳市', province: '广东省', location: { address: '北京/上海/深圳/成都' } },
      { id: 's-located', name: '某司', city: '杭州市', province: '浙江省', location: { lng: 120.2, lat: 30.2, address: '西湖区文二西路712号' } },
    ]),
  ]);
  // 有坐标 → alreadyLocated; 占位/无地址 (缺坐标或中心钉) → needsPlaceSearch;
  // 街道地址 / 多城市列表串 → needsGeocode (地址 geocode / 公司名检索通道)。
  assert.equal(plan.alreadyLocated, 1);
  assert.equal(plan.needsGeocode.length, 2);
  const geoById = Object.fromEntries(plan.needsGeocode.map((n) => [n.siteId, n]));
  assert.match(geoById['s-geo'].query, /文一西路/);
  assert.equal(geoById['s-geo-list'].query, '北京/上海/深圳/成都 某司');
  assert.equal(plan.needsPlaceSearch.length, 3);
  const byId = Object.fromEntries(plan.needsPlaceSearch.map((n) => [n.siteId, n]));
  assert.equal(byId['s-ps-city'].city, '上海市');
  assert.equal(byId['s-ps-city'].province, '上海市');
  assert.equal(byId['s-ps-city'].query, '某司');
  assert.equal(byId['s-ps-noaddr'].city, '广州市');
  assert.equal(byId['s-ps-pin'].city, '深圳市');
  assert.equal(byId['s-ps-pin'].province, '广东省');
});

// --- 选点规则 (pickPlaceSearchPoi) -------------------------------------------

const HANGZHOU = { city: '杭州市', province: '浙江省' };
const poi = (over) => ({
  name: '某司大厦',
  address: '西湖区文三路90号',
  lng: 120.14,
  lat: 30.26,
  type: '公司企业',
  adname: '西湖区',
  pname: '浙江省',
  cityname: '杭州市',
  ...over,
});

test('pickPlaceSearchPoi: 同城候选严格优先于同省近邻', () => {
  const near = poi({ name: '某司生产基地', address: '绍兴市柯桥区', lng: 120.5, lat: 30.1, cityname: '绍兴市', type: '' });
  const picks = pickPlaceSearchPoi([near, poi({})], '某司', HANGZHOU);
  assert.equal(picks?.poi.name, '某司大厦');
  assert.equal(picks?.confidence, 'high');
  assert.match(picks?.reason ?? '', /^place-search:matched:/);
});

test('pickPlaceSearchPoi: 名称不匹配 (门店/同名工厂) 过不了强匹配闸门 → null', () => {
  const store = poi({ name: '某司旗舰店', address: '延安路1号', lng: 120.16, lat: 30.25 });
  const factory = poi({ name: '杭州某司包装实业有限公司', address: '临平区兴宁路', lng: 120.3, lat: 30.42 });
  assert.equal(pickPlaceSearchPoi([store], '某司', HANGZHOU), null);
  assert.equal(pickPlaceSearchPoi([factory], '某司', HANGZHOU), null);
  assert.equal(pickPlaceSearchPoi([], '某司', HANGZHOU), null);
});

test('pickPlaceSearchPoi: 同城候选按距市中心半径排序 (远郊办公区 > 市中心)', () => {
  const center = poi({ lng: 120.15, lat: 30.27, address: '上城区解放路1号' }); // 恰在市中心 → 半径 0 分
  const remote = poi({ lng: 120.31, lat: 30.34, address: '滨江区江陵路1760号' }); // ~16km → 半径满 1 分
  const picked = pickPlaceSearchPoi([center, remote], '某司', HANGZHOU);
  assert.equal(picked?.poi.name, remote.name);
});

test('pickPlaceSearchPoi: 仅同省近邻候选 → 选中但 confidence low (写回闸门不写, 留待跟进)', () => {
  const neighbor = poi({ name: '某司(佛山分公司)', address: '佛山市南海区', lng: 113.14, lat: 23.03, pname: '广东省', cityname: '佛山市' });
  const picked = pickPlaceSearchPoi([neighbor], '某司', { city: '广州市', province: '广东省' });
  assert.equal(picked?.poi.name, '某司(佛山分公司)');
  assert.equal(picked?.confidence, 'low');
  assert.match(picked?.reason ?? '', /^place-search:outside-city/);
});

test('pickPlaceSearchPoi: 城市/省信息均无或明确异城异省 → 淘汰 (宁缺勿错)', () => {
  const noInfo = poi({ pname: '', cityname: '' });
  const elsewhere = poi({ pname: '北京市', cityname: '北京市', name: '某司(北京总部)', lng: 116.4, lat: 39.9 });
  assert.equal(pickPlaceSearchPoi([noInfo], '某司', HANGZHOU), null);
  assert.equal(pickPlaceSearchPoi([elsewhere], '某司', HANGZHOU), null);
});

test('pickPlaceSearchPoi: office 类型加分打破平局', () => {
  const noType = poi({ type: '', address: '滨江区江陵路1760号', lng: 120.3, lat: 30.32 });
  const office = poi({ type: '公司企业', address: '滨江区江陵路1760号', lng: 120.3, lat: 30.32 });
  const picked = pickPlaceSearchPoi([noType, office], '某司', HANGZHOU);
  assert.equal(picked?.poi.name, '某司大厦');
});

test('placeSearchRadiusScore / distanceKm: 3km 内 0, 13km+ 满 1, 中间线性', () => {
  const center = { lng: 120.15, lat: 30.27 };
  assert.equal(distanceKm(120.15, 30.27, 120.15, 30.27), 0);
  // 1° 纬度 ≈ 111.2km
  assert.ok(Math.abs(distanceKm(0, 0, 0, 1) - 111.19) < 1, `1° 纬度应约 111.2km, 实际 ${distanceKm(0, 0, 0, 1)}`);
  assert.equal(placeSearchRadiusScore(120.15, 30.27, center), 0);
  assert.equal(placeSearchRadiusScore(120.15, 30.4, center), 1); // ~14km → 满档
  const mid = placeSearchRadiusScore(0, 0.05, { lng: 0, lat: 0 }); // ~5.5km → 0.25 上下
  assert.ok(mid > 0.2 && mid < 0.3, `5.5km 半径分应 ~0.25, 实际 ${mid}`);
});
