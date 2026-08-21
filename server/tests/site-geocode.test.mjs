import test from 'node:test';
import assert from 'node:assert/strict';

import { poiToSourceCompany } from '../src/lib/recruitment-source.ts';
import { WORK_SEED } from '../src/lib/seed-data.ts';
import {
  addressConflictsWithCity,
  addressConflictsWithRegeoDistrict,
  amapQuotaExhausted,
  applyGeocodeHits,
  baiduGeocodeAddressRest,
  baiduPlaceSearchRest,
  baiduRegeoCityRest,
  cleanCompanySearchName,
  geocodeAddressRest,
  geocodeQueryForSite,
  gradeOfficePoi,
  importedSiteQuery,
  normalizeNameForMatch,
  officeNameMatchStrength,
  parseBaiduOfficePoi,
  parseTencentOfficePoi,
  pickBestOfficePoi,
  placeTextSearchRest,
  planSiteGeocode,
  regeoCityRest,
  regeoMatchesTarget,
  siteCityTarget,
  siteHasStreetAddress,
  siteNeedsGeocode,
  tencentGeocodeAddressRest,
  tencentPlaceSearchRest,
  tencentQuotaExhausted,
  tencentRegeoCityRest,
} from '../src/lib/site-geocode.ts';

test('current WORK_SEED sites already have coordinates', () => {
  const plan = planSiteGeocode(WORK_SEED.map((poi) => poiToSourceCompany(poi)));
  assert.equal(plan.needs.length, 0);
  assert.ok(plan.alreadyLocated >= 50);
});

test('planSiteGeocode lists (0,0) and missing points', () => {
  const company = poiToSourceCompany(WORK_SEED[0]);
  company.sites[0].location = { lng: 0, lat: 0, address: '余杭区文一西路' };
  const plan = planSiteGeocode([company]);
  assert.equal(plan.needs.length, 1);
  assert.match(plan.needs[0].query, /余杭区文一西路/);
  assert.equal(siteNeedsGeocode(company.sites[0]), true);
});

test('applyGeocodeHits fills only the missing site', () => {
  const company = poiToSourceCompany(WORK_SEED[0]);
  const keptLng = company.sites[0].location?.lng;
  company.sites.push({
    id: `${company.sites[0].id}-east`,
    name: '东区',
    location: { lng: 0, lat: 0, address: '滨江区网商路' },
  });
  const query = geocodeQueryForSite(company.name, company.sites[1]);
  const [out] = applyGeocodeHits([company], [{ query, location: { lng: 120.21, lat: 30.19 } }]);
  assert.equal(out.sites[0].location?.lng, keptLng);
  assert.equal(out.sites[1].location?.lng, 120.21);
  assert.equal(out.sites[1].location?.address, '滨江区网商路');
});

test('geocodeAddressRest is a no-op without AMAP_WEB_KEY', async () => {
  const prev = process.env.AMAP_WEB_KEY;
  delete process.env.AMAP_WEB_KEY;
  try {
    const result = await geocodeAddressRest('西湖');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no-key');
  } finally {
    if (prev != null) process.env.AMAP_WEB_KEY = prev;
  }
});

test('geocodeAddressRest parses a successful AMap payload without logging the key', async () => {
  const prev = process.env.AMAP_WEB_KEY;
  process.env.AMAP_WEB_KEY = 'test-web-key';
  let requested = '';
  try {
    const result = await geocodeAddressRest('西湖', '杭州', async (input) => {
      requested = String(input);
      return {
        ok: true,
        json: async () => ({ status: '1', geocodes: [{ location: '120.15,30.24' }] }),
      };
    });
    assert.equal(result.ok, true);
    assert.equal(result.location?.lng, 120.15);
    assert.match(requested, /restapi\.amap\.com\/v3\/geocode\/geo/);
    assert.match(requested, /key=test-web-key/);
  } finally {
    if (prev == null) delete process.env.AMAP_WEB_KEY;
    else process.env.AMAP_WEB_KEY = prev;
  }
});

// --- office discovery (place-text) helpers ---------------------------------

test('cleanCompanySearchName strips decor and applies known aliases', () => {
  assert.equal(cleanCompanySearchName('字节跳动Seed大模型'), '字节跳动');
  assert.equal(cleanCompanySearchName('淘天集团[T-Star  Lab )'), '淘天集团');
  assert.equal(cleanCompanySearchName('商汤科技「无限原力」'), '商汤科技');
  assert.equal(cleanCompanySearchName('阿里巴巴（2026 秋招）'), '阿里巴巴');
  assert.equal(cleanCompanySearchName('认养'), '认养一头牛');
  assert.equal(cleanCompanySearchName('财通证劵'), '财通证券');
  assert.equal(cleanCompanySearchName('快手'), '快手');
});

test('normalizeNameForMatch strips legal forms so office names still match', () => {
  assert.equal(normalizeNameForMatch('杭州海天管业有限公司'), '杭州海天管业');
  assert.equal(normalizeNameForMatch('财通证券股份有限公司杭州营业部'), '财通证券杭州营业部');
  // 海天集团 must NOT match 杭州海天管业 (wrong-entity trap).
  const q = normalizeNameForMatch('海天集团');
  const c = normalizeNameForMatch('杭州海天管业有限公司');
  assert.equal(q.includes(c) || c.includes(q), false);
});

test('gradeOfficePoi rejects out-of-city and name-mismatch candidates', () => {
  const hz = { name: '商汤科技有限公司', address: '利一路188号天人大厦29楼', lng: 120, lat: 30, type: '公司企业', adname: '萧山区', pname: '浙江省', cityname: '杭州市' };
  assert.equal(gradeOfficePoi(hz, '商汤科技').confidence, 'high');
  const beijing = { ...hz, pname: '北京市', cityname: '北京市' };
  assert.equal(gradeOfficePoi(beijing, '商汤科技').confidence, 'low');
  const wrong = { ...hz, name: '杭州海天管业有限公司' };
  assert.equal(gradeOfficePoi(wrong, '海天集团').confidence, 'low');
  const noStreet = { ...hz, address: '滨江区' };
  assert.equal(gradeOfficePoi(noStreet, '商汤科技').confidence, 'medium');
});

test('pickBestOfficePoi prefers a real office over a retail store of the same brand', () => {
  const office = { name: '快手(星耀中心7号楼)', address: '启智街515号星耀中心7号楼', lng: 120.221, lat: 30.202, type: '公司企业', adname: '滨江区', pname: '浙江省', cityname: '杭州市' };
  const store = { name: '快手(濮院店)', address: '新洲路与坊路交叉口', lng: 120.325, lat: 30.453, type: '购物服务', adname: '临平区', pname: '浙江省', cityname: '杭州市' };
  const best = pickBestOfficePoi([store, office], '快手');
  assert.equal(best?.name, '快手(星耀中心7号楼)');
});

test('pickBestOfficePoi grades against the site province/city (multi-city)', () => {
  const shanghai = { name: '得物公司', address: '杨浦区淞沪路518号', lng: 121.511, lat: 31.307, type: '', adname: '杨浦区', pname: '上海市', cityname: '上海市' };
  // 默认 浙江省/杭州市 (legacy) → 上海 POI 被拒; 传站点城市 → 接受.
  assert.equal(pickBestOfficePoi([shanghai], '得物'), undefined);
  assert.equal(pickBestOfficePoi([shanghai], '得物', '上海市', '上海市')?.lng, 121.511);
});

test('officeNameMatchStrength accepts qualifier-wrapped names and rejects same-brand traps', () => {
  // 强匹配: 精确 / 城市前缀 / 品牌拼音 / 办公形态括号段.
  for (const [candidate, company] of [
    ['得物', '得物'],
    ['得物公司', '得物'],
    ['上海燧原科技有限公司', '燧原科技'],
    ['深圳市商汤科技有限公司', '商汤科技'],
    ['bilibili哔哩哔哩运营总部', '哔哩哔哩'],
    ['快手(星耀中心7号楼)', '快手'],
  ]) {
    assert.equal(officeNameMatchStrength(candidate, company), 'strong', `${candidate} vs ${company}`);
  }
  // 同品牌陷阱: 同名工厂 / 零售店 / 驿站 / 包装实业 / 错误公司.
  for (const [candidate, company] of [
    ['广州得物包装实业有限公司', '得物'],
    ['得物潮鞋AJ品牌集合店', '得物'],
    ['得物(宝龙旭辉广场店)', '得物'],
    ['拼多多驿站(川图路海中心站)', '拼多多'],
    ['上汽大众汽车有限公司', '上汽集团'],
    ['杭州海天管业有限公司', '海天集团'],
  ]) {
    assert.equal(officeNameMatchStrength(candidate, company), 'no', `${candidate} vs ${company}`);
  }
});

test('gradeOfficePoi rejects same-brand store/warehouse traps from Baidu', () => {
  const trap = { name: '拼多多驿站(川图路海中心站)', address: '浦东新区川图路海中心', lng: 121.7, lat: 31.15, type: '', adname: '浦东新区', pname: '上海市', cityname: '上海市' };
  assert.equal(gradeOfficePoi(trap, '拼多多', '上海市', '上海市').confidence, 'low');
  const factory = { name: '广州得物包装实业有限公司', address: '花都区东升路', lng: 113.23, lat: 23.34, type: '', adname: '花都区', pname: '广东省', cityname: '广州市' };
  assert.equal(gradeOfficePoi(factory, '得物', '广东省', '广州市').confidence, 'low');
  const hq = { name: 'bilibili哔哩哔哩运营总部', address: '杨浦区政立路499号国正中心', lng: 121.5, lat: 31.3, type: '', adname: '杨浦区', pname: '上海市', cityname: '上海市' };
  assert.equal(gradeOfficePoi(hq, '哔哩哔哩', '上海市', '上海市').confidence, 'high');
});

test('placeTextSearchRest and regeoCityRest are no-ops without AMAP_WEB_KEY', async () => {
  const prev = process.env.AMAP_WEB_KEY;
  delete process.env.AMAP_WEB_KEY;
  try {
    const hit = await placeTextSearchRest('快手');
    assert.equal(hit.ok, false);
    assert.equal(hit.reason, 'no-key');
    const re = await regeoCityRest(120, 30);
    assert.equal(re.ok, false);
  } finally {
    if (prev != null) process.env.AMAP_WEB_KEY = prev;
  }
});

// --- multi-city (national scope) -------------------------------------------

function radarCompany(sites) {
  return {
    slug: 'x-company',
    name: '某司',
    industries: ['internet'],
    scale: 'enterprise',
    sites,
    positions: [],
  };
}

test('planSiteGeocode scopes multi-city sites to their own city', () => {
  const beijing = {
    id: 'x-company-site-beijing',
    name: '某司',
    city: '北京市',
    province: '北京市',
    location: { lng: 0, lat: 0, address: '北京市朝阳区望京东路' },
  };
  const plan = planSiteGeocode([radarCompany([beijing])]);
  assert.equal(plan.needs.length, 1);
  assert.equal(plan.needs[0].city, '北京市');
  assert.match(plan.needs[0].query, /望京东路/);
});

test('geocodeQueryForSite uses the site city (not the fallback) when the site has one', () => {
  const beijing = {
    id: 'x-company-site-beijing',
    name: '某司',
    city: '北京市',
    province: '北京市',
    location: { lng: 0, lat: 0 },
  };
  const query = geocodeQueryForSite('某司', beijing);
  assert.match(query, /^北京市/);
  const bare = { id: 'x-company-site', name: '某司', location: { lng: 0, lat: 0 } };
  assert.match(geocodeQueryForSite('某司', bare), /^杭州/);
});

test('geocodeQueryForSite routes 北京/上海/杭州 sites to their own city', () => {
  const mk = (city, province) => ({
    id: `x-site-${city}`,
    name: '某司',
    city,
    province,
    location: { lng: 0, lat: 0 },
  });
  assert.match(geocodeQueryForSite('某司', mk('北京市', '北京市')), /^北京市/);
  assert.match(geocodeQueryForSite('某司', mk('上海市', '上海市')), /^上海市/);
  assert.match(geocodeQueryForSite('某司', mk('杭州市', '浙江省')), /^杭州市/);
  // Street address wins over city scope.
  const withAddr = { ...mk('上海市', '上海市'), location: { lng: 0, lat: 0, address: '杨浦区黄兴路221号' } };
  assert.match(geocodeQueryForSite('某司', withAddr), /^杨浦区黄兴路221号/);
});

// --- province 从 city 推断 (2026-08-22, fix/geocode-province-infer) ----------
// 回归场景: qqdoc-jobs/qqdoc-official/embodied 站 province 字段为空 → 旧默认
// 「浙江省」→ 上海/北京/广东等站 geocode 命中后 regeo 校验 (落点省 vs target
// 省) 必拒 — 全量跑 492 unresolved 中 332 个 outside-province。

test('siteCityTarget infers province from city when site.province is empty', () => {
  const mk = (city, province) => ({
    id: 'x-site',
    name: '某司',
    city,
    province,
    location: { lng: 0, lat: 0 },
  });
  // 直辖市 + 主要省份城市 (含 trim 后空) → CITY_TABLE 反查.
  assert.equal(siteCityTarget(mk('上海市', '')).province, '上海市');
  assert.equal(siteCityTarget(mk('上海市', '  ')).province, '上海市');
  assert.equal(siteCityTarget(mk('北京市', undefined)).province, '北京市');
  assert.equal(siteCityTarget(mk('杭州市', null)).province, '浙江省');
  assert.equal(siteCityTarget(mk('深圳市', '')).province, '广东省');
  assert.equal(siteCityTarget(mk('广州市', '')).province, '广东省');
  assert.equal(siteCityTarget(mk('武汉市', '')).province, '湖北省');
  assert.equal(siteCityTarget(mk('成都市', '')).province, '四川省');
  // 裸城市名 (无「市」后缀) 同样可反查.
  assert.equal(siteCityTarget(mk('杭州', '')).province, '浙江省');
  // 显式 province 优先于推断.
  assert.equal(siteCityTarget(mk('杭州市', '上海市')).province, '上海市');
});

test('siteCityTarget falls back to 浙江省 for overseas/dirty/empty cities', () => {
  const mk = (city, province) => ({
    id: 'x-site',
    name: '某司',
    city,
    province,
    location: { lng: 0, lat: 0 },
  });
  // 海外城市 → 查不到 → 回退 (海外站 geocode 自然 no-result, 不再误报省).
  assert.equal(siteCityTarget(mk('San Carlos, CA', '')).province, '浙江省');
  assert.equal(siteCityTarget(mk('Singapore', undefined)).province, '浙江省');
  // 脏值 (区级拼接) → 回退现行为.
  assert.equal(siteCityTarget(mk('北京市朝阳区', '')).province, '浙江省');
  // city 空 → 回退 杭州市/浙江省 (历史行为不变).
  const noCity = siteCityTarget(mk('', ''));
  assert.equal(noCity.city, '杭州市');
  assert.equal(noCity.province, '浙江省');
});

test('regeo gate accepts a Shanghai POI when the site only names the city', () => {
  // 根因场景全链路: 上海站 province 空 → 旧 target.province='浙江省' →
  // regeo pname='上海市' 必拒; 推断后通过.
  const site = { id: 'x-site', name: '某司', city: '上海市', location: { lng: 0, lat: 0 } };
  const target = siteCityTarget(site);
  assert.equal(target.province, '上海市');
  assert.equal(target.city, '上海市');
  assert.equal(regeoMatchesTarget({ ok: true, province: '上海市', cityname: '上海市' }, target).ok, true);
});

test('importedSiteQuery scopes the DB fallback to the site city', () => {
  // 上海站点无街道地址 → 城市级查询（上海,不是杭州）。
  assert.equal(importedSiteQuery(null, '上海市', '某司', '某司'), '上海市 某司 某司');
  assert.equal(importedSiteQuery(null, '北京市', '某司', '某司'), '北京市 某司 某司');
  assert.equal(importedSiteQuery(null, '杭州市', '某司', '某司'), '杭州市 某司 某司');
  // 无城市字段的存量行 → 杭州兜底（保持历史行为）。
  assert.equal(importedSiteQuery(null, null, '某司', '某司'), '杭州 某司 某司');
  // 街道地址优先于城市。
  assert.equal(importedSiteQuery('浦东新区张江路100号', '上海市', '某司', '某司'), '浦东新区张江路100号 某司');
});

test('regeoMatchesTarget confirms the coordinate sits in the target city', () => {
  const beijing = { city: '北京市', province: '北京市' };
  // 直辖市: cityname 为空, province 兜底 (北京 regeo pname='北京市').
  assert.equal(regeoMatchesTarget({ ok: true, province: '北京市', district: '海淀区' }, beijing).ok, true);
  assert.equal(regeoMatchesTarget({ ok: true, cityname: '', province: '北京市', district: '朝阳区' }, beijing).ok, true);
  // province 不匹配 → reject (坐标在广东但目标北京).
  assert.equal(regeoMatchesTarget({ ok: true, province: '广东省', cityname: '广州市' }, beijing).ok, false);
  // 普通市: province + cityname 都需匹配.
  const guangzhou = { city: '广州市', province: '广东省' };
  assert.equal(regeoMatchesTarget({ ok: true, province: '广东省', cityname: '广州市' }, guangzhou).ok, true);
  assert.equal(regeoMatchesTarget({ ok: true, province: '广东省', cityname: '深圳市' }, guangzhou).ok, false);
  // 全空 (未知区域) → ok (regeo 无足够信息时不拦截).
  assert.equal(regeoMatchesTarget({ ok: true }, beijing).ok, true);
});

test('regeoCityRest parses province for the direct municipalities', async () => {
  const prev = process.env.AMAP_WEB_KEY;
  process.env.AMAP_WEB_KEY = 'test-web-key';
  try {
    const re = await regeoCityRest(116.4, 39.9, async () => ({
      ok: true,
      json: async () => ({
        status: '1',
        regeocode: { addressComponent: { province: '北京市', district: '海淀区' } },
      }),
    }));
    assert.equal(re.ok, true);
    assert.equal(re.province, '北京市');
    assert.equal(re.cityname, undefined);
  } finally {
    if (prev == null) delete process.env.AMAP_WEB_KEY;
    else process.env.AMAP_WEB_KEY = prev;
  }
});

test('gradeOfficePoi validates against the site province/city', () => {
  const poi = { name: '某司北京有限公司', address: '望京东路6号', lng: 116.5, lat: 39.9, type: '公司企业', adname: '朝阳区', pname: '北京市', cityname: '北京市' };
  assert.equal(gradeOfficePoi(poi, '某司', '北京市', '北京市').confidence, 'high');
  const inHangzhou = { ...poi, cityname: '杭州市' };
  assert.equal(gradeOfficePoi(inHangzhou, '某司', '北京市', '北京市').confidence, 'low');
  const inShanghai = { ...poi, pname: '上海市', cityname: '上海市' };
  assert.equal(gradeOfficePoi(inShanghai, '某司', '北京市', '北京市').confidence, 'low');
  // Defaults keep the Hangzhou behavior for sites without city fields.
  const hz = { ...poi, name: '商汤科技有限公司', address: '利一路188号天人大厦29楼', pname: '浙江省', cityname: '杭州市' };
  assert.equal(gradeOfficePoi(hz, '商汤科技').confidence, 'high');
});

// --- Baidu fallback (BAIDU_MAP_AK) ------------------------------------------

async function withBaiduKey(body) {
  const prev = process.env.BAIDU_MAP_AK;
  process.env.BAIDU_MAP_AK = 'test-baidu-ak';
  try {
    return await body();
  } finally {
    if (prev == null) delete process.env.BAIDU_MAP_AK;
    else process.env.BAIDU_MAP_AK = prev;
  }
}

const AMAP_EXHAUSTED = { status: '0', info: 'USER_DAILY_QUERY_OVER_LIMIT', infocode: '10044' };

test('amapQuotaExhausted detects the daily-limit payload', () => {
  assert.equal(amapQuotaExhausted({ status: '1' }), false);
  assert.equal(amapQuotaExhausted({ status: '0', info: 'USER_DAILY_QUERY_OVER_LIMIT', infocode: '10044' }), true);
  assert.equal(amapQuotaExhausted({ status: '0', info: 'INVALID_USER_KEY', infocode: '10001' }), false);
});

test('siteHasStreetAddress only accepts a real street/building address', () => {
  assert.equal(siteHasStreetAddress({ id: 's', name: 'x', location: { address: '西湖区文二西路712号西溪乐谷2号楼' } }), true);
  assert.equal(siteHasStreetAddress({ id: 's', name: 'x', location: { address: '北京/上海/杭州' } }), false);
  assert.equal(siteHasStreetAddress({ id: 's', name: 'x', location: {} }), false);
});

// --- address ↔ city consistency gate (2026-08-20, fix/geocode-address-strategy) ---
// 回归场景: 奇安信 drops 的 site-guangzhou / site-chengdu / site-beijing 继承了
// 杭州 office 地址 "西湖区莲花街333号…", 必须判定为不可信 → 走公司名检索。

test('addressConflictsWithCity rejects the 奇安信 Hangzhou address on non-Hangzhou sites', () => {
  const addr = '西湖区莲花街333号莲花商务中心b座9楼';
  // 广州/成都/北京 站点拿到杭州地址 → 地址不可信 (实测错配: 广州 "花都区西湖").
  assert.equal(addressConflictsWithCity(addr, '广州市'), true);
  assert.equal(addressConflictsWithCity(addr, '成都市'), true);
  assert.equal(addressConflictsWithCity(addr, '北京市'), true);
  // 杭州站点本身 → 可信.
  assert.equal(addressConflictsWithCity(addr, '杭州市'), false);
});

test('addressConflictsWithCity trusts addresses that name their own city/district', () => {
  // 城市名 + 区名都在目标城市内 → 可信.
  assert.equal(addressConflictsWithCity('北京市朝阳区望京东路6号', '北京市'), false);
  assert.equal(addressConflictsWithCity('上海市杨浦区淞沪路518号', '上海市'), false);
  // 省前缀不影响判定 (广东省深圳市…).
  assert.equal(addressConflictsWithCity('广东省深圳市南山区高新南十道3区11栋11a', '深圳市'), false);
  assert.equal(addressConflictsWithCity('浙江省杭州市上城区花园兜街道175号', '杭州市'), false);
  // 地址区名先于城市名 ("南山区深圳市软件产业基地…").
  assert.equal(addressConflictsWithCity('南山区深圳市软件产业基地5B座501号', '深圳市'), false);
  // 无区县街道地址 → 无法判定, 放行 (由 regeo 区级校验兜底).
  assert.equal(addressConflictsWithCity('文一西路969号', '广州市'), false);
});

test('addressConflictsWithCity rejects other known cities and foreign districts', () => {
  // 地址含其他已知城市名 → 不可信.
  assert.equal(addressConflictsWithCity('杭州市文一西路969号', '广州市'), true);
  // 地址含非目标城市区名 → 不可信 (宁波银行 / 迈瑞医疗 的上城区地址污染).
  assert.equal(addressConflictsWithCity('上城区市民街69号2幢306室', '上海市'), true);
  assert.equal(addressConflictsWithCity('上城区市民街200号圣奥中央商务大厦F21层', '北京市'), true);
  assert.equal(addressConflictsWithCity('上城区市民街200号圣奥中央商务大厦F21层', '杭州市'), false);
  // 市区级联: 杭州市西湖区 → 广州 站点.
  assert.equal(addressConflictsWithCity('杭州市西湖区文二西路712号', '广州市'), true);
});

test('addressConflictsWithCity handles district-name collisions and county-level cities', () => {
  // 西湖区 同时属于 杭州 和 南昌 → 南昌 站点不误杀.
  assert.equal(addressConflictsWithCity('西湖区站前西路121号', '南昌市'), false);
  assert.equal(addressConflictsWithCity('西湖区站前西路121号', '南昌'), false);
  // 县级市 (温岭市 ⊂ 台州市) → 不误杀.
  assert.equal(addressConflictsWithCity('浙江省台州市温岭市中华路728号', '台州'), false);
  // 功能区名 (高新区/工业园区) → 目标城市收录则不误杀.
  assert.equal(addressConflictsWithCity('江苏省苏州市高新区狮山路28号', '苏州市'), false);
  assert.equal(addressConflictsWithCity('四川省成都市高新区花样年香年广场T2', '成都市'), false);
});

test('addressConflictsWithCity passes unknown districts and overseas text', () => {
  // 未收录区名 (城关区/内蒙古自治区…) → 放行, regeo 区级校验兜底.
  assert.equal(addressConflictsWithCity('甘肃省兰州市城关区高新飞雁街128号', '兰州市'), false);
  assert.equal(addressConflictsWithCity('内蒙古自治区鄂尔多斯市鄂托克旗棋盘井镇1号路', '鄂尔多斯'), false);
  // 海外地址 → 放行 (geocode 城市内检索自然失败).
  assert.equal(addressConflictsWithCity('韩国仁川广域市西区圆仓洞488', '仁川'), false);
  assert.equal(addressConflictsWithCity('神奈川県横浜市西区浅間町1−6−10', '横滨市'), false);
});

test('addressConflictsWithRegeoDistrict rejects geocoded points in a different district', () => {
  // 未知区名地址在城市内错配: 落点区 ≠ 地址区名 → 拒 (回退公司名检索).
  assert.equal(addressConflictsWithRegeoDistrict('霞山区人民大道南42号', '赤坎区'), true);
  // 落点区与地址区名一致 → 通过.
  assert.equal(addressConflictsWithRegeoDistrict('霞山区人民大道南42号', '霞山区'), false);
  // 无 regeo 区名 → 无法校验, 放行.
  assert.equal(addressConflictsWithRegeoDistrict('霞山区人民大道南42号', ''), false);
});

test('addressConflictsWithRegeoDistrict skips known and functional districts', () => {
  // 已收录区名由前置闸门把关, 不做区级比对 (行政区边界 adname 模糊).
  assert.equal(addressConflictsWithRegeoDistrict('滨江区网商路', '西湖区'), false);
  assert.equal(addressConflictsWithRegeoDistrict('西湖区文二西路712号', '花都区'), false);
  // 功能区名 → 跳过 (regeo adname 是底层行政区).
  assert.equal(addressConflictsWithRegeoDistrict('四川省成都市高新区花样年香年广场', '武侯区'), false);
  assert.equal(addressConflictsWithRegeoDistrict('苏州工业园区星湖街328号', '虎丘区'), false);
  // 超长 token (省名) → 跳过.
  assert.equal(addressConflictsWithRegeoDistrict('内蒙古自治区鄂尔多斯市东胜区', '康巴什区'), false);
});

test('parseBaiduOfficePoi maps the Baidu place shape onto the GCJ-02 candidate', () => {
  const poi = parseBaiduOfficePoi({
    name: '得物App总部',
    location: { lng: 121.512, lat: 31.272 },
    address: '黄兴路221号',
    province: '上海市',
    city: '上海市',
    district: '杨浦区',
  });
  assert.equal(poi?.name, '得物App总部');
  assert.equal(poi?.lng, 121.512);
  assert.equal(poi?.cityname, '上海市');
  assert.equal(poi?.adname, '杨浦区');
  // Missing location object → null (no crash on malformed rows).
  assert.equal(parseBaiduOfficePoi({ name: 'x' }), null);
});

test('baiduPlaceSearchRest parses a gcj02ll place response', async () => {
  await withBaiduKey(async () => {
    let requested = '';
    const hit = await baiduPlaceSearchRest('得物', '上海市', async (input) => {
      requested = String(input);
      return {
        ok: true,
        json: async () => ({
          status: 0,
          results: [{ name: '得物App总部', location: { lng: 121.512, lat: 31.272 }, province: '上海市', city: '上海市', district: '杨浦区' }],
        }),
      };
    });
    assert.equal(hit.ok, true);
    assert.equal(hit.provider, 'baidu');
    assert.equal(hit.pois.length, 1);
    assert.equal(hit.pois[0].lng, 121.512);
    assert.match(requested, /api\.map\.baidu\.com\/place\/v2\/search/);
    assert.match(requested, /ret_coordtype=gcj02ll/);
    assert.ok(requested.includes(`region=${encodeURIComponent('上海市')}`));
  });
});

test('baiduRegeoCityRest sends lat,lng + coordtype=gcj02ll and parses the municipality', async () => {
  await withBaiduKey(async () => {
    let requested = '';
    const re = await baiduRegeoCityRest(121.512, 31.272, async (input) => {
      requested = String(input);
      return {
        ok: true,
        json: async () => ({ status: 0, result: { addressComponent: { province: '上海市', city: '上海市', district: '杨浦区' } } }),
      };
    });
    assert.equal(re.ok, true);
    assert.equal(re.province, '上海市');
    assert.equal(re.cityname, '上海市');
    // 百度 location = "lat,lng" (纬度在前).
    assert.match(requested, /location=31\.272%2C121\.512/);
    assert.match(requested, /coordtype=gcj02ll/);
  });
});

test('baiduGeocodeAddressRest parses geocoding v3', async () => {
  await withBaiduKey(async () => {
    let requested = '';
    const g = await baiduGeocodeAddressRest('西湖区文二西路712号', '杭州市', async (input) => {
      requested = String(input);
      return {
        ok: true,
        json: async () => ({ status: 0, result: { location: { lng: 120.095, lat: 30.287 }, precise: 1, confidence: 100 } }),
      };
    });
    assert.equal(g.ok, true);
    assert.equal(g.provider, 'baidu');
    assert.equal(g.location?.lng, 120.095);
    assert.match(requested, /api\.map\.baidu\.com\/geocoding\/v3/);
    assert.match(requested, /ret_coordtype=gcj02ll/);
  });
});

test('placeTextSearchRest falls back to Baidu when AMap quota is exhausted (10044)', async () => {
  const prev = process.env.AMAP_WEB_KEY;
  process.env.AMAP_WEB_KEY = 'test-web-key';
  try {
    await withBaiduKey(async () => {
      const hit = await placeTextSearchRest('得物', '上海市', async (input) => {
        const url = String(input);
        if (url.includes('restapi.amap.com')) {
          return { ok: true, json: async () => ({ ...AMAP_EXHAUSTED, pois: [] }) };
        }
        return {
          ok: true,
          json: async () => ({
            status: 0,
            results: [{ name: '得物App总部', location: { lng: 121.512, lat: 31.272 }, province: '上海市', city: '上海市' }],
          }),
        };
      });
      assert.equal(hit.ok, true);
      assert.equal(hit.amapUnavailable, true);
      assert.equal(hit.provider, 'baidu');
      assert.equal(hit.pois[0].lng, 121.512);
    });
  } finally {
    if (prev == null) delete process.env.AMAP_WEB_KEY;
    else process.env.AMAP_WEB_KEY = prev;
  }
});

test('placeTextSearchRest works Baidu-only when AMap has no key', async () => {
  const prev = process.env.AMAP_WEB_KEY;
  delete process.env.AMAP_WEB_KEY;
  try {
    await withBaiduKey(async () => {
      const hit = await placeTextSearchRest('得物', '上海市', async (input) => {
        assert.match(String(input), /api\.map\.baidu\.com/);
        return { ok: true, json: async () => ({ status: 0, results: [] }) };
      });
      assert.equal(hit.ok, true);
      assert.equal(hit.amapUnavailable, true);
      assert.equal(hit.provider, 'baidu');
    });
  } finally {
    if (prev != null) process.env.AMAP_WEB_KEY = prev;
  }
});

test('regeoCityRest falls back to Baidu regeo on AMap quota exhaustion', async () => {
  const prev = process.env.AMAP_WEB_KEY;
  process.env.AMAP_WEB_KEY = 'test-web-key';
  try {
    await withBaiduKey(async () => {
      const re = await regeoCityRest(121.512, 31.272, async (input) => {
        if (String(input).includes('restapi.amap.com')) {
          return { ok: true, json: async () => ({ ...AMAP_EXHAUSTED }) };
        }
        return { ok: true, json: async () => ({ status: 0, result: { addressComponent: { province: '上海市', city: '上海市', district: '杨浦区' } } }) };
      });
      assert.equal(re.ok, true);
      assert.equal(re.amapUnavailable, true);
      assert.equal(re.provider, 'baidu');
      assert.equal(re.cityname, '上海市');
    });
  } finally {
    if (prev == null) delete process.env.AMAP_WEB_KEY;
    else process.env.AMAP_WEB_KEY = prev;
  }
});

test('geocodeAddressRest falls back to Baidu geocoding on AMap quota exhaustion', async () => {
  const prev = process.env.AMAP_WEB_KEY;
  process.env.AMAP_WEB_KEY = 'test-web-key';
  try {
    await withBaiduKey(async () => {
      const g = await geocodeAddressRest('西湖区文二西路712号', '杭州市', async (input) => {
        if (String(input).includes('restapi.amap.com')) {
          return { ok: true, json: async () => ({ ...AMAP_EXHAUSTED }) };
        }
        return { ok: true, json: async () => ({ status: 0, result: { location: { lng: 120.095, lat: 30.287 } } }) };
      });
      assert.equal(g.ok, true);
      assert.equal(g.amapUnavailable, true);
      assert.equal(g.provider, 'baidu');
      assert.equal(g.location?.lng, 120.095);
    });
  } finally {
    if (prev == null) delete process.env.AMAP_WEB_KEY;
    else process.env.AMAP_WEB_KEY = prev;
  }
});

// --- Tencent fallback (TENCENT_MAP_KEY, 第三级兜底) --------------------------

async function withTencentKey(body) {
  const prev = process.env.TENCENT_MAP_KEY;
  process.env.TENCENT_MAP_KEY = 'test-tencent-key';
  try {
    return await body();
  } finally {
    if (prev == null) delete process.env.TENCENT_MAP_KEY;
    else process.env.TENCENT_MAP_KEY = prev;
  }
}

const BAIDU_QUOTA_302 = { status: 302 };

test('tencentQuotaExhausted detects the daily-limit status family', () => {
  assert.equal(tencentQuotaExhausted({ status: 0 }), false);
  assert.equal(tencentQuotaExhausted({ status: 121 }), true);
  assert.equal(tencentQuotaExhausted({ status: 321 }), true);
  assert.equal(tencentQuotaExhausted({ status: 322 }), true);
  // 每秒限流 (120) 与来源未授权 (110) 不是每日配额类.
  assert.equal(tencentQuotaExhausted({ status: 120 }), false);
  assert.equal(tencentQuotaExhausted({ status: 110 }), false);
});

test('parseTencentOfficePoi maps the Tencent place shape (title/location/ad_info)', () => {
  const poi = parseTencentOfficePoi({
    title: '得物App总部',
    location: { lat: 31.272, lng: 121.512 },
    category: '公司企业;商务写字楼',
    address: '黄兴路221号',
    ad_info: { province: '上海市', city: '上海市', district: '杨浦区' },
  });
  assert.equal(poi?.name, '得物App总部');
  assert.equal(poi?.lng, 121.512);
  assert.equal(poi?.lat, 31.272);
  assert.equal(poi?.type, '公司企业;商务写字楼');
  assert.equal(poi?.cityname, '上海市');
  assert.equal(poi?.pname, '上海市');
  assert.equal(poi?.adname, '杨浦区');
  // Missing location object → null (no crash on malformed rows).
  assert.equal(parseTencentOfficePoi({ title: 'x' }), null);
});

test('tencentGeocodeAddressRest parses ws/geocoder/v1 and city-qualifies the address', async () => {
  await withTencentKey(async () => {
    let requested = '';
    // 地址无城市前缀 → 拼上目标城市 (address 必须含省市区, 官方文档).
    const g = await tencentGeocodeAddressRest('西湖区文二西路712号', '杭州市', async (input) => {
      requested = String(input);
      return { ok: true, json: async () => ({ status: 0, result: { location: { lng: 120.095, lat: 30.287 } } }) };
    });
    assert.equal(g.ok, true);
    assert.equal(g.provider, 'tencent');
    assert.equal(g.location?.lng, 120.095);
    assert.match(requested, /apis\.map\.qq\.com\/ws\/geocoder\/v1/);
    assert.ok(decodeURIComponent(requested).includes('address=杭州市西湖区文二西路712号'));
    assert.ok(decodeURIComponent(requested).includes('region=杭州市'));
  });
  // 已含城市前缀的地址不重复拼.
  await withTencentKey(async () => {
    const g = await tencentGeocodeAddressRest('杭州市西湖区文二西路712号', '杭州市', async () => ({
      ok: true,
      json: async () => ({ status: 0, result: { location: { lng: 120.095, lat: 30.287 } } }),
    }));
    assert.equal(g.ok, true);
  });
});

test('tencentPlaceSearchRest sends boundary=region and parses data[]', async () => {
  await withTencentKey(async () => {
    let requested = '';
    const hit = await tencentPlaceSearchRest('得物', '上海市', async (input) => {
      requested = String(input);
      return {
        ok: true,
        json: async () => ({
          status: 0,
          count: 1,
          data: [
            { title: '得物App总部', location: { lat: 31.272, lng: 121.512 }, category: '公司企业', address: '黄兴路221号', ad_info: { province: '上海市', city: '上海市', district: '杨浦区' } },
          ],
        }),
      };
    });
    assert.equal(hit.ok, true);
    assert.equal(hit.provider, 'tencent');
    assert.equal(hit.pois.length, 1);
    assert.equal(hit.pois[0].lng, 121.512);
    assert.equal(hit.pois[0].adname, '杨浦区');
    assert.match(requested, /apis\.map\.qq\.com\/ws\/place\/v1\/search/);
    assert.ok(decodeURIComponent(requested).includes('boundary=region(上海市,0)'));
    assert.ok(requested.includes('page_size=10'));
    assert.ok(requested.includes('page_index=1'));
  });
});

test('tencentRegeoCityRest sends lat,lng (纬度在前) and parses ad_info', async () => {
  await withTencentKey(async () => {
    let requested = '';
    const re = await tencentRegeoCityRest(121.512, 31.272, async (input) => {
      requested = String(input);
      return { ok: true, json: async () => ({ status: 0, result: { ad_info: { province: '上海市', city: '上海市', district: '杨浦区' } } }) };
    });
    assert.equal(re.ok, true);
    assert.equal(re.provider, 'tencent');
    assert.equal(re.province, '上海市');
    assert.equal(re.cityname, '上海市');
    assert.equal(re.district, '杨浦区');
    assert.match(requested, /apis\.map\.qq\.com\/ws\/geocoder\/v1/);
    assert.match(requested, /location=31\.272%2C121\.512/);
  });
});

test('tencentPlaceSearchRest retries the per-second limit (status 120) once', async () => {
  await withTencentKey(async () => {
    let calls = 0;
    const hit = await tencentPlaceSearchRest('得物', '上海市', async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => (calls === 1 ? { status: 120, message: '请求被限制' } : { status: 0, data: [{ title: '得物App总部', location: { lat: 31.272, lng: 121.512 }, ad_info: { province: '上海市', city: '上海市' } }] }),
      };
    });
    assert.equal(calls, 2);
    assert.equal(hit.ok, true);
    assert.equal(hit.provider, 'tencent');
  });
});

test('placeTextSearchRest falls through AMap 10044 + Baidu 302 to Tencent', async () => {
  const prev = process.env.AMAP_WEB_KEY;
  process.env.AMAP_WEB_KEY = 'test-web-key';
  try {
    await withBaiduKey(async () => {
      await withTencentKey(async () => {
        let tencentCalls = 0;
        const hit = await placeTextSearchRest('得物', '上海市', async (input) => {
          const url = String(input);
          if (url.includes('restapi.amap.com')) return { ok: true, json: async () => ({ ...AMAP_EXHAUSTED, pois: [] }) };
          if (url.includes('api.map.baidu.com')) return { ok: true, json: async () => ({ ...BAIDU_QUOTA_302 }) };
          tencentCalls += 1;
          return {
            ok: true,
            json: async () => ({
              status: 0,
              data: [{ title: '得物App总部', location: { lat: 31.272, lng: 121.512 }, category: '公司企业', address: '黄兴路221号', ad_info: { province: '上海市', city: '上海市', district: '杨浦区' } }],
            }),
          };
        });
        assert.equal(hit.ok, true);
        assert.equal(hit.amapUnavailable, true);
        assert.equal(hit.provider, 'tencent');
        assert.equal(hit.pois[0].lng, 121.512);
        assert.equal(tencentCalls, 1);
      });
    });
  } finally {
    if (prev == null) delete process.env.AMAP_WEB_KEY;
    else process.env.AMAP_WEB_KEY = prev;
  }
});

test('geocodeAddressRest serves Tencent-only when AMap and Baidu keys are absent', async () => {
  const prev = process.env.AMAP_WEB_KEY;
  delete process.env.AMAP_WEB_KEY;
  try {
    const prevBaidu = process.env.BAIDU_MAP_AK;
    delete process.env.BAIDU_MAP_AK;
    try {
      await withTencentKey(async () => {
        const g = await geocodeAddressRest('西湖区文二西路712号', '杭州市', async (input) => {
          assert.match(String(input), /apis\.map\.qq\.com/);
          return { ok: true, json: async () => ({ status: 0, result: { location: { lng: 120.095, lat: 30.287 } } }) };
        });
        assert.equal(g.ok, true);
        assert.equal(g.amapUnavailable, true);
        assert.equal(g.provider, 'tencent');
        assert.equal(g.location?.lng, 120.095);
      });
    } finally {
      if (prevBaidu == null) delete process.env.BAIDU_MAP_AK;
      else process.env.BAIDU_MAP_AK = prevBaidu;
    }
  } finally {
    if (prev == null) delete process.env.AMAP_WEB_KEY;
    else process.env.AMAP_WEB_KEY = prev;
  }
});

test('chain reason attribution: Tencent daily limit (121) wins after AMap + Baidu fail', async () => {
  const prev = process.env.AMAP_WEB_KEY;
  process.env.AMAP_WEB_KEY = 'test-web-key';
  try {
    await withBaiduKey(async () => {
      await withTencentKey(async () => {
        const hit = await placeTextSearchRest('得物', '上海市', async (input) => {
          const url = String(input);
          if (url.includes('restapi.amap.com')) return { ok: true, json: async () => ({ ...AMAP_EXHAUSTED, pois: [] }) };
          if (url.includes('api.map.baidu.com')) return { ok: true, json: async () => ({ status: 403, message: 'not authorized' }) };
          return { ok: true, json: async () => ({ status: 121, message: '此key每日调用量已达到上限' }) };
        });
        assert.equal(hit.ok, false);
        assert.equal(hit.reason, 'tencent-status:121');
        assert.equal(hit.amapUnavailable, true);
      });
    });
  } finally {
    if (prev == null) delete process.env.AMAP_WEB_KEY;
    else process.env.AMAP_WEB_KEY = prev;
  }
});

test('Tencent is never called while the Baidu fallback succeeds', async () => {
  const prev = process.env.AMAP_WEB_KEY;
  process.env.AMAP_WEB_KEY = 'test-web-key';
  try {
    await withBaiduKey(async () => {
      await withTencentKey(async () => {
        const hit = await placeTextSearchRest('得物', '上海市', async (input) => {
          const url = String(input);
          if (url.includes('restapi.amap.com')) return { ok: true, json: async () => ({ ...AMAP_EXHAUSTED, pois: [] }) };
          assert.match(url, /api\.map\.baidu\.com/);
          return { ok: true, json: async () => ({ status: 0, results: [{ name: '得物App总部', location: { lng: 121.512, lat: 31.272 }, province: '上海市', city: '上海市' }] }) };
        });
        assert.equal(hit.ok, true);
        assert.equal(hit.provider, 'baidu');
        assert.equal(hit.amapUnavailable, true);
      });
    });
  } finally {
    if (prev == null) delete process.env.AMAP_WEB_KEY;
    else process.env.AMAP_WEB_KEY = prev;
  }
});

test('tencentGeocodeAddressRest is a no-op without TENCENT_MAP_KEY', async () => {
  const prev = process.env.TENCENT_MAP_KEY;
  delete process.env.TENCENT_MAP_KEY;
  try {
    const g = await tencentGeocodeAddressRest('西湖区文二西路712号', '杭州市');
    assert.equal(g.ok, false);
    assert.equal(g.reason, 'no-key');
  } finally {
    if (prev != null) process.env.TENCENT_MAP_KEY = prev;
  }
});

test('tencent endpoints surface http failures (res.ok / thrown fetch) as reason http', async () => {
  await withTencentKey(async () => {
    const httpFail = async () => ({ ok: false, status: 500 });
    const throwFail = async () => {
      throw new Error('network down');
    };
    // 正向 geocode: res.ok=false → http; fetch 抛错 → http.
    const g1 = await tencentGeocodeAddressRest('西湖区文二西路712号', '杭州市', httpFail);
    assert.equal(g1.ok, false);
    assert.equal(g1.reason, 'http');
    const g2 = await tencentGeocodeAddressRest('西湖区文二西路712号', '杭州市', throwFail);
    assert.equal(g2.ok, false);
    assert.equal(g2.reason, 'http');
    // place 检索: res.ok=false → http.
    const p1 = await tencentPlaceSearchRest('得物', '上海市', httpFail);
    assert.equal(p1.ok, false);
    assert.equal(p1.reason, 'http');
    assert.deepEqual(p1.pois, []);
    const p2 = await tencentPlaceSearchRest('得物', '上海市', throwFail);
    assert.equal(p2.ok, false);
    assert.equal(p2.reason, 'http');
    // regeo: res.ok=false / 抛错 → ok:false.
    const r1 = await tencentRegeoCityRest(121.512, 31.272, httpFail);
    assert.equal(r1.ok, false);
    const r2 = await tencentRegeoCityRest(121.512, 31.272, throwFail);
    assert.equal(r2.ok, false);
  });
});
