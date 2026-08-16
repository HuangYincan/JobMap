import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearModeCache,
  MODE_CACHE_PREFIX,
  readModeCache,
  writeModeCache,
} from '../src/lib/mode-cache.ts';

function installMemoryStorage() {
  const store = new Map();
  globalThis.window = {
    sessionStorage: {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
      removeItem(key) {
        store.delete(key);
      },
    },
  };
  return store;
}

const samplePoi = {
  id: 'p1',
  kind: 'domain',
  name: '西湖',
  mode: 'domain',
  source: 'amap',
  location: { lng: 120.15, lat: 30.27 },
  category: '风景名胜',
};

test('writeModeCache / readModeCache round-trips a catalog in sessionStorage', () => {
  installMemoryStorage();
  writeModeCache({
    mode: 'domain',
    catalog: [samplePoi],
    pageOffset: 2,
    searchOrigin: { lng: 120.1, lat: 30.2 },
    query: '',
    filters: {},
    sort: 'distance',
  });
  const cached = readModeCache('domain');
  assert.ok(cached);
  assert.equal(cached.catalog.length, 1);
  assert.equal(cached.catalog[0].id, 'p1');
  assert.equal(cached.pageOffset, 2);
  assert.deepEqual(cached.searchOrigin, { lng: 120.1, lat: 30.2 });
});

test('switching modes keeps isolated caches', () => {
  installMemoryStorage();
  writeModeCache({
    mode: 'domain',
    catalog: [samplePoi],
    pageOffset: 0,
    searchOrigin: { lng: 120.15, lat: 30.27 },
    query: '',
    filters: {},
    sort: 'distance',
  });
  writeModeCache({
    mode: 'work',
    catalog: [{
      id: 'c1',
      kind: 'recruitment',
      name: '阿里巴巴',
      mode: 'work',
      source: 'seed',
      location: { lng: 120.02, lat: 30.28 },
      industry: '互联网',
      positions: [],
    }],
    pageOffset: 0,
    searchOrigin: null,
    query: '',
    filters: {},
    sort: 'distance',
  });
  assert.equal(readModeCache('domain')?.catalog[0].id, 'p1');
  assert.equal(readModeCache('work')?.catalog[0].id, 'c1');
  assert.equal(readModeCache('internship')?.catalog[0].id, 'c1');
  assert.ok(MODE_CACHE_PREFIX.startsWith('domain-map:'));
});

test('clearModeCache only drops that mode', () => {
  installMemoryStorage();
  writeModeCache({
    mode: 'domain',
    catalog: [samplePoi],
    pageOffset: 0,
    searchOrigin: null,
    query: '',
    filters: {},
    sort: 'distance',
  });
  writeModeCache({
    mode: 'work',
    catalog: [{ ...samplePoi, id: 'c1', mode: 'work' }],
    pageOffset: 0,
    searchOrigin: null,
    query: '',
    filters: {},
    sort: 'distance',
  });
  clearModeCache('domain');
  assert.equal(readModeCache('domain'), null);
  assert.equal(readModeCache('work')?.catalog[0].id, 'c1');
});

test('legacy internship cache key is readable as work', () => {
  const store = installMemoryStorage();
  store.set(
    `${MODE_CACHE_PREFIX}internship`,
    JSON.stringify({
      version: 2,
      mode: 'internship',
      catalog: [{ ...samplePoi, id: 'legacy', mode: 'internship' }],
      pageOffset: 1,
      searchOrigin: null,
      query: '',
      filters: {},
      sort: 'distance',
      savedAt: 1,
    }),
  );
  const cached = readModeCache('work');
  assert.equal(cached?.catalog[0].id, 'legacy');
  assert.equal(cached?.mode, 'work');
});

test('stale cache version is rejected so refreshed data loads', () => {
  const store = installMemoryStorage();
  store.set(
    `${MODE_CACHE_PREFIX}work`,
    JSON.stringify({
      version: 1,
      mode: 'work',
      catalog: [{ ...samplePoi, id: 'stale', mode: 'work' }],
      pageOffset: 0,
      searchOrigin: null,
      query: '',
      filters: {},
      sort: 'distance',
      savedAt: 1,
    }),
  );
  assert.equal(readModeCache('work'), null);
});

test('writeModeCache ignores an empty catalog', () => {
  const store = installMemoryStorage();
  writeModeCache({
    mode: 'domain',
    catalog: [],
    pageOffset: 0,
    searchOrigin: null,
    query: '',
    filters: {},
    sort: 'distance',
  });
  assert.equal(store.size, 0);
});
