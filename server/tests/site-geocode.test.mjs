import test from 'node:test';
import assert from 'node:assert/strict';

import { poiToSourceCompany } from '../src/lib/recruitment-source.ts';
import { WORK_SEED } from '../src/lib/seed-data.ts';
import {
  applyGeocodeHits,
  geocodeAddressRest,
  geocodeQueryForSite,
  planSiteGeocode,
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
