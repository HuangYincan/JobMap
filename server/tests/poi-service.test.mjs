import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchPOIsForMode } from '../src/lib/poi-service.ts';
import { SEARCH_TIMEOUT_MS, withTimeout } from '../src/lib/amap-api.ts';

const HZ_CENTER = { lng: 120.15, lat: 30.27 };

function domainPoi(id) {
  return {
    id,
    kind: 'domain',
    name: id,
    mode: 'domain',
    source: 'api',
    location: { lng: 120.1, lat: 30.2 },
    category: '餐饮服务',
    rating: 4.2,
    reviewCount: 10,
    photos: ['x'],
  };
}

test('withTimeout: 超时以 error 形态 settle(poi-loading B 兜底)', async () => {
  const never = new Promise(() => {});
  await assert.rejects(
    withTimeout(never, 20, 'AMap PlaceSearch'),
    /timed out after 20ms/
  );
  assert.equal(SEARCH_TIMEOUT_MS, 15000);
});

test('withTimeout: 正常 promise 不受影响', async () => {
  const value = await withTimeout(Promise.resolve(42), 100, 'x');
  assert.equal(value, 42);
  await assert.rejects(withTimeout(Promise.reject(new Error('boom')), 100, 'x'), /boom/);
});

test('fetchPOIsForMode(domain 杭州内): 用服务端 total 判 noMore(poi-loading D)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ total: 300, offset: 0, limit: 50, results: [domainPoi('a')] }),
  });
  try {
    const { pois, noMore } = await fetchPOIsForMode({
      mode: 'domain',
      center: HZ_CENTER,
      zoom: 13,
      pageOffset: 0,
      existing: [],
    });
    assert.equal(pois.length, 1);
    assert.equal(noMore, false); // 0 + 1 < 300 → 未到底
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchPOIsForMode(domain 杭州内): 取到 total 之后 → noMore=true', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ total: 3, offset: 0, limit: 50, results: [domainPoi('a'), domainPoi('b'), domainPoi('c')] }),
  });
  try {
    const { pois, noMore } = await fetchPOIsForMode({
      mode: 'domain',
      center: HZ_CENTER,
      zoom: 13,
      pageOffset: 0,
      existing: [],
    });
    assert.equal(pois.length, 3);
    assert.equal(noMore, true); // 0 + 3 >= 3 → 到底
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchPOIsForMode(domain 杭州内): 本地库失败 → 抛错(错误信号,不静默 return existing,poi-loading A)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('network down');
  };
  try {
    await assert.rejects(
      fetchPOIsForMode({
        mode: 'domain',
        center: HZ_CENTER,
        zoom: 13,
        pageOffset: 0,
        existing: [],
      }),
      /local domain POIs failed/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
