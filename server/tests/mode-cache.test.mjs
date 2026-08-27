import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearModeCache,
  FILTER_KEYS_MAX,
  FILTER_VALUE_MAX,
  MODE_CACHE_RAW_MAX,
  MODE_PAGE_OFFSET_MAX,
  MODE_QUERY_MAX,
  MODE_SORT_MAX,
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

// 2026-08-26 (r5 geocode 数据落地, commit 313fc61): 135 站占位/中心钉坐标落真实办公点
// (address/lng/lat 改写), MODE_CACHE_VERSION 18 → 19。v18 缓存含旧坐标, 必须失效重拉。
test('current MODE_CACHE_VERSION is 20 (city-clip aggregate fanout landing forces refresh)', () => {
  assert.equal(MODE_CACHE_VERSION, 20);
});

test('v18 work cache is rejected after r5 geocode landing', () => {
  const store = installMemoryStorage();
  store.set(
    `${MODE_CACHE_PREFIX}work`,
    JSON.stringify({
      version: 18, // v18 = r5 数据落地前的线上版本(旧坐标目录)
      mode: 'work',
      catalog: [{ ...sampleRecruitmentPoi, id: 'pre-geocode', mode: 'work' }],
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

test('v17 work cache is rejected after read-path semantic fixes', () => {
  const store = installMemoryStorage();
  store.set(
    `${MODE_CACHE_PREFIX}work`,
    JSON.stringify({
      version: 17, // v17 = 中心钉过滤 / clip 空语义修正落地前的线上版本
      mode: 'work',
      catalog: [{ ...sampleRecruitmentPoi, id: 'pre-fix', mode: 'work' }],
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

test('oversized mode-cache raw values are rejected before JSON.parse', () => {
  const store = installMemoryStorage();
  store.set(`${MODE_CACHE_PREFIX}work`, 'x'.repeat(MODE_CACHE_RAW_MAX + 1));
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

test('mode cache bounds scalar fields, filters, coordinates, and viewport', () => {
  const store = installMemoryStorage();
  const filters = Object.fromEntries(
    Array.from({ length: FILTER_KEYS_MAX + 10 }, (_, i) => [
      `filter-${i}`,
      [i < FILTER_KEYS_MAX ? 'x'.repeat(FILTER_VALUE_MAX) : 'x'.repeat(FILTER_VALUE_MAX + 1)],
    ]),
  );
  store.set(`${MODE_CACHE_PREFIX}domain`, JSON.stringify({
    version: MODE_CACHE_VERSION,
    mode: 'domain',
    catalog: [samplePoi],
    pageOffset: MODE_PAGE_OFFSET_MAX + 1,
    searchOrigin: { lng: Number.NaN, lat: 30 },
    query: 'q'.repeat(MODE_QUERY_MAX + 1),
    filters,
    sort: 's'.repeat(MODE_SORT_MAX + 1),
    savedAt: 1,
    viewport: { center: { lng: Number.POSITIVE_INFINITY, lat: 30 }, zoom: 12 },
  }));
  const cached = readModeCache('domain');

  assert.equal(cached.pageOffset, MODE_PAGE_OFFSET_MAX);
  assert.equal(cached.searchOrigin, null);
  assert.equal(cached.query.length, MODE_QUERY_MAX);
  assert.equal(Object.keys(cached.filters).length, FILTER_KEYS_MAX);
  const expectedValue = ['x'.repeat(FILTER_VALUE_MAX)];
  for (const value of Object.values(cached.filters)) assert.deepEqual(value, expectedValue);
  assert.equal(cached.sort.length, MODE_SORT_MAX);
  assert.equal(cached.viewport, undefined);
});
