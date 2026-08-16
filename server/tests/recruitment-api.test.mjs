// Work catalog in the browser: GET /api/pois first, seed only as fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchWorkCatalogFromApi } from '../src/lib/recruitment-adapters/api.ts';
import { resolveInternshipLocations } from '../src/lib/poi-service.ts';

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

test('resolveInternshipLocations leaves plausible coordinates alone', async () => {
  const [out] = await resolveInternshipLocations([SAMPLE]);
  assert.equal(out.location.lng, 120.02);
  assert.equal(out.location.lat, 30.28);
});

test('poi-service prefers the public catalog over the bundled seed', () => {
  const service = src('lib/poi-service.ts');
  assert.match(service, /fetchWorkCatalogFromApi/);
  assert.match(service, /if \(fromApi\.length\) return fromApi/);
  assert.match(service, /hasPlausibleCoord/);
});

test('job alerts scan loadServerCatalog, not a hardcoded seed', () => {
  const route = src('app/api/me/notifications/route.ts');
  assert.match(route, /loadServerCatalog/);
  assert.doesNotMatch(route, /INTERNSHIP_SEED/);
});
