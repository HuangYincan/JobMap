// fetchSearchSuggest 客户端 LRU 行为：空结果不缓存（否则首次空「死」5 分钟，
// 挡住 domain 本地优先→高德回退）；center 透传给服务端算距离。
import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchSearchSuggest } from '../src/lib/api.ts';
import { resetSuggestCache, suggestCacheSize } from '../src/lib/public-cache.ts';

function stubFetch(payload, captureUrl) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    captureUrl.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => typeof payload === 'function' ? payload(String(url)) : payload,
    };
  };
  return () => {
    globalThis.fetch = original;
  };
}

test('fetchSearchSuggest: 空结果不写 LRU 缓存', async () => {
  resetSuggestCache();
  const calls = [];
  const restore = stubFetch({ suggestions: [], recentSearches: [] }, calls);
  try {
    const r1 = await fetchSearchSuggest('不存在词', 'domain');
    assert.equal(r1.suggestions.length, 0);
    assert.equal(suggestCacheSize(), 0, '空结果不得入缓存');
    await fetchSearchSuggest('不存在词', 'domain');
    assert.equal(calls.length, 2, '第二次仍要发请求（本地 0 命中 → 客户端回退高德）');
  } finally {
    restore();
  }
});

test('fetchSearchSuggest: 非空结果入 LRU,5 分钟内命中不再发请求', async () => {
  resetSuggestCache();
  const calls = [];
  const payload = {
    suggestions: [
      { type: 'poi', id: 'B0FFF', title: '肯德基', icon: '📍', location: { lng: 120.15, lat: 30.25 }, distance: 350 },
    ],
    recentSearches: [],
  };
  const restore = stubFetch(payload, calls);
  try {
    const r1 = await fetchSearchSuggest('肯德基', 'domain');
    assert.equal(r1.suggestions[0].distance, 350);
    assert.equal(suggestCacheSize(), 1);
    const r2 = await fetchSearchSuggest('肯德基', 'domain');
    assert.equal(calls.length, 1, '命中缓存不再发请求');
    assert.equal(r2.suggestions[0].title, '肯德基');
  } finally {
    restore();
  }
});

test('fetchSearchSuggest: different center buckets do not share distances and A→B re-requests', async () => {
  resetSuggestCache();
  const calls = [];
  const restore = stubFetch((url) => ({
    suggestions: [
      {
        type: 'poi',
        id: 'B0FFF',
        title: '肯德基',
        icon: '📍',
        location: { lng: 120.15, lat: 30.25 },
        distance: calls.length * 100,
      },
    ],
    recentSearches: [],
  }), calls);
  try {
    const centerA = { lng: 120.1501, lat: 30.2501 };
    const centerB = { lng: 121.2001, lat: 31.3001 };
    const rA = await fetchSearchSuggest('肯德基', 'domain', centerA);
    const rB = await fetchSearchSuggest('肯德基', 'domain', centerB);
    const rAAgain = await fetchSearchSuggest('肯德基', 'domain', centerA);
    assert.equal(calls.length, 2, 'A→B must miss the origin bucket, while A reuses its entry');
    assert.equal(rA.suggestions[0].distance, 100);
    assert.equal(rB.suggestions[0].distance, 200);
    assert.equal(rAAgain.suggestions[0].distance, 100, 'A must not be contaminated by B');
    assert.ok(calls[0].includes('center=120.1501%2C30.2501') || calls[0].includes('center=120.1501,30.2501'));
    assert.ok(calls[1].includes('center=121.2001%2C31.3001') || calls[1].includes('center=121.2001,31.3001'));
  } finally {
    restore();
  }
});

test('fetchSearchSuggest: micro-moves in one origin bucket reuse the cache', async () => {
  resetSuggestCache();
  const calls = [];
  const restore = stubFetch({
    suggestions: [
      { type: 'poi', id: 'B0FFF', title: '肯德基', icon: '📍', location: { lng: 120.15, lat: 30.25 }, distance: 100 },
    ],
    recentSearches: [],
  }, calls);
  try {
    await fetchSearchSuggest('肯德基', 'domain', { lng: 120.1501, lat: 30.2501 });
    await fetchSearchSuggest('肯德基', 'domain', { lng: 120.1504, lat: 30.2504 });
    assert.equal(calls.length, 1, 'micro-moves must not create a new request for every map event');
  } finally {
    restore();
  }
});

test('fetchSearchSuggest: center 透传为 lng,lat 参数', async () => {
  resetSuggestCache();
  const calls = [];
  const restore = stubFetch({ suggestions: [], recentSearches: [] }, calls);
  try {
    await fetchSearchSuggest('阿里', 'work', { lng: 120.15, lat: 30.25 });
    assert.ok(calls[0].includes('center=120.15%2C30.25') || calls[0].includes('center=120.15,30.25'));
  } finally {
    restore();
  }
});
