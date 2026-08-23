// Work catalog in the browser: GET /api/pois first, seed only as fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { apiRecruitmentAdapter, fetchWorkCatalogFromApi } from '../src/lib/recruitment-adapters/api.ts';
import { resetAMapLoader, resetGeocodeCache } from '../src/lib/amap-api.ts';
import { fetchPOIsForMode, resolveInternshipLocations } from '../src/lib/poi-service.ts';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function src(rel) {
  return readFileSync(join(srcRoot, rel), 'utf8');
}

const SAMPLE = {
  kind: 'recruitment',
  id: 'alibaba-xixi',
  name: '阿里巴巴',
  mode: 'work',
  source: 'api',
  location: { lng: 120.02, lat: 30.28, address: '余杭区' },
  company: { name: '阿里巴巴', industries: ['internet'], scale: 'bigtech' },
  sites: [],
  positions: [],
};

test('apiRecruitmentAdapter is the catalog reader, not official-career files', () => {
  assert.equal(apiRecruitmentAdapter.kind, 'catalog');
});

test('fetchWorkCatalogFromApi pages /api/pois and keeps catalog ids', async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('page=1')) {
      return {
        ok: true,
        json: async () => ({ total: 1, page: 1, pageSize: 50, results: [SAMPLE] }),
      };
    }
    return { ok: true, json: async () => ({ total: 1, page: 2, pageSize: 50, results: [] }) };
  };
  try {
    const pois = await fetchWorkCatalogFromApi();
    assert.equal(pois.length, 1);
    assert.equal(pois[0].id, 'alibaba-xixi');
    assert.match(calls[0], /\/api\/pois\?mode=work&page=1/);
  } finally {
    globalThis.fetch = original;
  }
});

test('fetchWorkCatalogFromApi returns [] when the public API is down', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  try {
    assert.deepEqual(await fetchWorkCatalogFromApi(), []);
  } finally {
    globalThis.fetch = original;
  }
});

test('fetchPOIsForMode(work) reads the public catalog once and returns it', async () => {
  const calls = [];
  const batches = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      json: async () => ({ total: 1, page: 1, pageSize: 50, results: [SAMPLE] }),
    };
  };
  try {
    const { pois, noMore } = await fetchPOIsForMode({
      mode: 'work',
      onBatch: (batch) => batches.push(batch),
    });
    assert.equal(pois.length, 1);
    assert.equal(pois[0].id, 'alibaba-xixi');
    assert.equal(noMore, undefined);
    assert.equal(calls.filter((url) => url.includes('/api/pois?mode=work')).length, 1);
    assert.equal(batches.length, 2);
    assert.equal(batches[0][0].id, 'alibaba-xixi');
    assert.equal(batches[1][0].id, 'alibaba-xixi');
  } finally {
    globalThis.fetch = original;
  }
});

test('resolveInternshipLocations leaves plausible coordinates alone', async () => {
  const [out] = await resolveInternshipLocations([SAMPLE]);
  assert.equal(out.location.lng, 120.02);
  assert.equal(out.location.lat, 30.28);
});

test('resolveInternshipLocations geocodes an address-only point when AMap is ready', async () => {
  const originalWindow = globalThis.window;
  resetAMapLoader();
  resetGeocodeCache();
  class FakeGeocoder {
    constructor(opts) {
      this.city = opts.city;
    }

    getLocation(address, done) {
      assert.equal(this.city, '杭州');
      done('complete', { geocodes: [{ location: { lng: 120.05, lat: 30.25 } }] });
    }
  }
  globalThis.window = { AMap: { Geocoder: FakeGeocoder } };
  try {
    const input = { ...SAMPLE, id: 'address-only', location: { address: '余杭区' } };
    const [out] = await resolveInternshipLocations([input]);
    assert.equal(out.id, 'address-only');
    assert.equal(out.location.lng, 120.05);
    assert.equal(out.location.lat, 30.25);
    assert.equal(out.location.address, '余杭区');
  } finally {
    globalThis.window = originalWindow;
    resetAMapLoader();
    resetGeocodeCache();
  }
});

test('resolveInternshipLocations leaves points without an address alone', async () => {
  const originalWindow = globalThis.window;
  resetAMapLoader();
  try {
    globalThis.window = undefined;
    const input = { ...SAMPLE, id: 'no-address', location: {} };
    const [out] = await resolveInternshipLocations([input]);
    assert.deepEqual(out, input);
  } finally {
    globalThis.window = originalWindow;
    resetAMapLoader();
  }
});

test('poi-service prefers the public catalog over the bundled seed', () => {
  const service = src('lib/poi-service.ts');
  assert.match(service, /fetchWorkCatalogFromApi/);
  assert.match(service, /if \(fromApi\.length\) return fromApi/);
  assert.match(service, /let workSeedPromise/);
  assert.match(service, /const immediate = \(await workSeedFromAdapters\(\)\)/);
  assert.match(service, /const seeded = \(await internshipSeedResolved\(\)\)/);
  assert.match(service, /hasPlausibleCoord/);
});

test('job alerts scan loadServerCatalog, not a hardcoded seed', () => {
  const route = src('app/api/me/notifications/route.ts');
  assert.match(route, /loadServerCatalog/);
  assert.doesNotMatch(route, /INTERNSHIP_SEED/);
});
