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

test('fetchPOIsForMode(domain 杭州内 + 分类): categories 参数构造 + 全量分页循环(短页到底)', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    const u = new URL(String(url), 'http://x');
    const offset = Number(u.searchParams.get('offset'));
    const rows =
      offset === 0
        ? 300
        : offset === 300
          ? 300
          : 100;
    return {
      ok: true,
      json: async () => ({
        total: 700,
        results: Array.from({ length: rows }, (_, i) => domainPoi(`${offset}-${i}`)),
      }),
    };
  };
  try {
    const { pois, noMore } = await fetchPOIsForMode({
      mode: 'domain',
      center: HZ_CENTER,
      zoom: 13,
      pageOffset: 0,
      existing: [],
      filters: { category: '餐饮服务' },
    });
    assert.equal(urls.length, 3); // offset 0/300/600,短页(100<300)停
    for (const raw of urls) {
      const u = new URL(raw, 'http://x');
      assert.equal(u.searchParams.get('categories'), '餐饮服务');
      assert.equal(u.searchParams.get('limit'), '300'); // API 上限满页
    }
    assert.match(urls[0], /offset=0/);
    assert.match(urls[1], /offset=300/);
    assert.match(urls[2], /offset=600/);
    assert.equal(pois.length, 700);
    assert.equal(noMore, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchPOIsForMode(domain 杭州内 + 分类): offset 到 API 上限(1000)即止,受容量保护', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    const u = new URL(String(url), 'http://x');
    const offset = Number(u.searchParams.get('offset'));
    return {
      ok: true,
      json: async () => ({
        total: 1500, // 服务端还有更多,但 offset 已到上限
        results: Array.from({ length: 300 }, (_, i) => domainPoi(`o${offset}-${i}`)),
      }),
    };
  };
  try {
    const { pois, noMore } = await fetchPOIsForMode({
      mode: 'domain',
      center: HZ_CENTER,
      zoom: 13,
      pageOffset: 0,
      existing: [],
      filters: { category: '购物服务' },
    });
    assert.equal(urls.length, 4); // offset 0/300/600/900;1200 越过上限 → 停
    assert.match(urls[3], /offset=900/);
    assert.equal(pois.length, 1000); // DOMAIN_POI_HARD_CAP 钳制
    assert.equal(noMore, false); // 1500 > 已取 → 未穷尽(尽力全量,受容量保护)
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchPOIsForMode(domain 杭州内 + 分类): 取消信号中断分页循环', async () => {
  const originalFetch = globalThis.fetch;
  const signal = { cancelled: false };
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    if (call >= 2) signal.cancelled = true; // 第二页后取消
    return {
      ok: true,
      json: async () => ({
        total: 5000,
        results: Array.from({ length: 300 }, (_, i) => domainPoi(`s${call}-${i}`)),
      }),
    };
  };
  try {
    const { pois, noMore } = await fetchPOIsForMode({
      mode: 'domain',
      center: HZ_CENTER,
      zoom: 13,
      pageOffset: 0,
      existing: [],
      filters: { category: '餐饮服务' },
      signal,
    });
    assert.equal(call, 2); // 第三轮循环入口发现 cancelled → 不再发请求
    assert.equal(pois.length, 600);
    assert.equal(noMore, false); // 被取消不算到底
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchPOIsForMode(domain 杭州内 + 分类 + 关键词): 搜索豁免,不发 categories', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return {
      ok: true,
      json: async () => ({ total: 1, results: [domainPoi('kfc')] }),
    };
  };
  try {
    const { pois } = await fetchPOIsForMode({
      mode: 'domain',
      center: HZ_CENTER,
      zoom: 13,
      pageOffset: 0,
      existing: [],
      query: '肯德基',
      filters: { category: '餐饮服务' },
    });
    assert.equal(urls.length, 1);
    const u = new URL(urls[0], 'http://x');
    assert.equal(u.searchParams.get('q'), '肯德基');
    assert.equal(u.searchParams.get('categories'), null); // 搜索不受分类门控
    assert.equal(pois.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
