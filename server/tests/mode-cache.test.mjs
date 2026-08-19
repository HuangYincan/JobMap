import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearModeCache,
  MODE_CACHE_PREFIX,
  MODE_CACHE_VERSION,
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

const sampleRecruitmentPoi = {
  id: 'c1',
  kind: 'recruitment',
  name: '阿里巴巴',
  mode: 'work',
  source: 'seed',
  location: { lng: 120.02, lat: 30.28 },
  company: { name: '阿里巴巴', industries: [], scale: 'bigtech' },
  positions: [],
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
    catalog: [sampleRecruitmentPoi],
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
    catalog: [sampleRecruitmentPoi],
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
      version: MODE_CACHE_VERSION,
      mode: 'internship',
      catalog: [{ ...sampleRecruitmentPoi, id: 'legacy', mode: 'internship' }],
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
      catalog: [{ ...sampleRecruitmentPoi, id: 'stale', mode: 'work' }],
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

test('work cache containing a domain-kind row is rejected as polluted (kind guard)', () => {
  const store = installMemoryStorage();
  store.set(
    `${MODE_CACHE_PREFIX}work`,
    JSON.stringify({
      version: MODE_CACHE_VERSION,
      mode: 'work',
      catalog: [sampleRecruitmentPoi, { ...samplePoi, id: 'hz-poison', mode: 'domain' }],
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

test('domain cache containing a recruitment-kind row is rejected as polluted (kind guard)', () => {
  const store = installMemoryStorage();
  store.set(
    `${MODE_CACHE_PREFIX}domain`,
    JSON.stringify({
      version: MODE_CACHE_VERSION,
      mode: 'domain',
      catalog: [samplePoi, { ...sampleRecruitmentPoi, id: 'job-poison', mode: 'work' }],
      pageOffset: 0,
      searchOrigin: null,
      query: '',
      filters: {},
      sort: 'distance',
      savedAt: 1,
    }),
  );
  assert.equal(readModeCache('domain'), null);
});

test('work cache of only recruitment rows survives the kind guard', () => {
  installMemoryStorage();
  writeModeCache({
    mode: 'work',
    catalog: [sampleRecruitmentPoi],
    pageOffset: 0,
    searchOrigin: null,
    query: '',
    filters: {},
    sort: 'distance',
  });
  assert.equal(readModeCache('work')?.catalog[0].id, 'c1');
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

test('viewport snapshot round-trips through the cache (ws1 Bug1 对齐加载)', () => {
  installMemoryStorage();
  writeModeCache({
    mode: 'work',
    catalog: [sampleRecruitmentPoi],
    pageOffset: 0,
    searchOrigin: null,
    query: '',
    filters: {},
    sort: 'distance',
    viewport: {
      center: { lng: 121.47, lat: 31.23 },
      zoom: 13,
      bounds: { west: 121.3, south: 31.1, east: 121.6, north: 31.4 },
    },
  });
  const cached = readModeCache('work');
  assert.deepEqual(cached?.viewport, {
    center: { lng: 121.47, lat: 31.23 },
    zoom: 13,
    bounds: { west: 121.3, south: 31.1, east: 121.6, north: 31.4 },
  });
});

test('legacy cache without viewport snapshot reads viewport=undefined (触发对齐加载)', () => {
  const store = installMemoryStorage();
  store.set(
    `${MODE_CACHE_PREFIX}work`,
    JSON.stringify({
      version: MODE_CACHE_VERSION,
      mode: 'work',
      catalog: [{ ...sampleRecruitmentPoi, id: 'legacy-nosnap', mode: 'work' }],
      pageOffset: 0,
      searchOrigin: null,
      query: '',
      filters: {},
      sort: 'distance',
      savedAt: 1,
    }),
  );
  const cached = readModeCache('work');
  assert.equal(cached?.catalog[0].id, 'legacy-nosnap');
  assert.equal(cached?.viewport, undefined); // 无快照 → 视为与当前视野不符
});

test('corrupt viewport snapshot is dropped, cache still readable (按不符处理)', () => {
  const store = installMemoryStorage();
  store.set(
    `${MODE_CACHE_PREFIX}work`,
    JSON.stringify({
      version: MODE_CACHE_VERSION,
      mode: 'work',
      catalog: [{ ...sampleRecruitmentPoi, id: 'corrupt-snap', mode: 'work' }],
      pageOffset: 0,
      searchOrigin: null,
      query: '',
      filters: {},
      sort: 'distance',
      savedAt: 1,
      viewport: { center: { lng: 'x', lat: 31.23 }, zoom: 13 }, // 非法 center
    }),
  );
  const cached = readModeCache('work');
  assert.equal(cached?.catalog[0].id, 'corrupt-snap');
  assert.equal(cached?.viewport, undefined);
});
