import test from 'node:test';
import assert from 'node:assert/strict';

import { poiToSourceCompany } from '../src/lib/recruitment-source.ts';
import { WORK_SEED } from '../src/lib/seed-data.ts';
import {
  applyGeocodeHits,
  cleanCompanySearchName,
  geocodeAddressRest,
  geocodeQueryForSite,
  gradeOfficePoi,
  normalizeNameForMatch,
  pickBestOfficePoi,
  placeTextSearchRest,
  planSiteGeocode,
  regeoCityRest,
  regeoMatchesTarget,
  siteNeedsGeocode,
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
