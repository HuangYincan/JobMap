import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchPOIsForMode, setActiveSearchProvider } from '../src/lib/poi-service.ts';
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

test('fetchPOIsForMode returns empty for college/overseas without touching data sources', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('must not fetch');
  };
  let batches = 0;
  try {
    for (const mode of ['college', 'overseas']) {
      const result = await fetchPOIsForMode({
        mode,
        onlyActive: false,
        onBatch: () => {
          batches += 1;
        },
      });
      assert.deepEqual(result, { pois: [] });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(batches, 0);
});

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

test('fetchPOIsForMode(domain 杭州内 + 关键词): route 502 → fetchLocalPois return null → 走 searchPOI 高德兜底', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  setActiveSearchProvider({
    searchPOI: async (params) => {
      calls.push(params);
      return [domainPoi('provider-poi')];
    },
    fetchSuggestions: async () => [],
    getCurrentPosition: async () => null,
    geocodeAddress: async () => null,
  });
  // 只对 domain-local 模拟 502(DB 故障);其余 URL 不允许被请求(证明走了 provider)
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/pois/domain-local')) {
      return { ok: false, status: 502, json: async () => ({}) };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const { pois } = await fetchPOIsForMode({
      mode: 'domain',
      center: HZ_CENTER,
      zoom: 13,
      pageOffset: 0,
      existing: [],
      query: '肯德基',
    });
    assert.equal(calls.length, 1, '502 → null → 恰走一次 searchPOI 兜底');
    assert.equal(calls[0].keyword, '肯德基');
    assert.ok(pois.some((p) => p.id === 'provider-poi'), '高德兜底结果并入累计池');
  } finally {
    globalThis.fetch = originalFetch;
    setActiveSearchProvider(null);
  }
});

test('fetchPOIsForMode(domain 杭州内浏览): route 502 → 高德视口兜底,不抛错不静默', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  setActiveSearchProvider({
    searchPOI: async (params) => {
      calls.push(params);
      return [domainPoi('amap-fallback')];
    },
    fetchSuggestions: async () => [],
    getCurrentPosition: async () => null,
    geocodeAddress: async () => null,
  });
  globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => ({}) });
  try {
    const { pois } = await fetchPOIsForMode({
      mode: 'domain',
      center: HZ_CENTER,
      zoom: 13,
      pageOffset: 0,
      existing: [],
    });
    assert.ok(calls.length > 0, '浏览路径 502 → 视口兜底(searchPOI)被触发');
    assert.ok(pois.some((p) => p.id === 'amap-fallback'), '兜底 POI 返回,不静默清空');
  } finally {
    globalThis.fetch = originalFetch;
    setActiveSearchProvider(null);
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

// ---------------------------------------------------------------------------
// ws-5:关键词回退搜索引擎化——活跃引擎 provider 优先(与视口兜底同口径),
// 不再硬绑 amap-api.searchPOI;未注入(SSR/测试/零配置)回落 amap-api 直连。
// ---------------------------------------------------------------------------

function fakeProvider(calls) {
  return {
    searchPOI: async (opts) => {
      calls.push(opts);
      return [domainPoi('kfc'), domainPoi('kfc-2')];
    },
    fetchSuggestions: async () => [],
    getCurrentPosition: async () => null,
    geocodeAddress: async () => null,
  };
}

test('fetchPOIsForMode(domain 杭州外 + 关键词): 走活跃引擎 provider.searchPOI(ws-5 搜索引擎化)', async () => {
  const calls = [];
  setActiveSearchProvider(fakeProvider(calls));
  try {
    const { pois, noMore } = await fetchPOIsForMode({
      mode: 'domain',
      center: { lng: 121.47, lat: 31.23 }, // 上海 → 杭州外,跳过本地库直接走关键词搜索
      zoom: 10,
      pageOffset: 0,
      existing: [],
      query: '肯德基',
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].keyword, '肯德基');
    assert.equal(calls[0].limit, 25);
    assert.equal(calls[0].page, 1); // pageOffset 0 → 第 1 页
    assert.equal(calls[0].city, ''); // zoom 10 > 8 → 非全国
    assert.equal(pois.length, 2);
    assert.equal(noMore, undefined); // 与 amap-api 路径同语义:本地长度比较,不置 noMore
  } finally {
    setActiveSearchProvider(null);
  }
});

test('fetchPOIsForMode(domain 杭州外 + 关键词): provider 收到 zoom≤8 全国城市 + pageOffset 翻页(ws-5)', async () => {
  const calls = [];
  setActiveSearchProvider(fakeProvider(calls));
  try {
    const { pois } = await fetchPOIsForMode({
      mode: 'domain',
      center: { lng: 121.47, lat: 31.23 },
      zoom: 7,
      pageOffset: 2,
      existing: [],
      query: '天安门',
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].city, '全国'); // zoom ≤ 8 → 全国(与 amap-api 路径同语义)
    assert.equal(calls[0].page, 3); // pageOffset 2 → 第 3 页
    assert.equal(pois.length, 2);
  } finally {
    setActiveSearchProvider(null);
  }
});

test('fetchPOIsForMode(domain 杭州内 + 关键词): 本地库不可用 → 回退活跃引擎 provider(ws-5)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('local db down');
  };
  const calls = [];
  setActiveSearchProvider(fakeProvider(calls));
  try {
    const { pois } = await fetchPOIsForMode({
      mode: 'domain',
      center: HZ_CENTER,
      zoom: 13,
      pageOffset: 0,
      existing: [],
      query: '肯德基',
    });
    assert.equal(calls.length, 1, '本地库失败后必须改走 provider,不空白');
    assert.equal(pois.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    setActiveSearchProvider(null);
  }
});

test('fetchPOIsForMode(domain + 关键词): provider.searchPOI 抛错 → 错误信号(可重试,不静默 return existing)', async () => {
  setActiveSearchProvider({
    searchPOI: async () => {
      throw new Error('engine quota exhausted');
    },
    fetchSuggestions: async () => [],
    getCurrentPosition: async () => null,
    geocodeAddress: async () => null,
  });
  try {
    await assert.rejects(
      fetchPOIsForMode({
        mode: 'domain',
        center: { lng: 121.47, lat: 31.23 },
        zoom: 10,
        pageOffset: 0,
        existing: [],
        query: '肯德基',
      }),
      /domain keyword search failed: engine quota exhausted/,
    );
  } finally {
    setActiveSearchProvider(null);
  }
});

test('fetchPOIsForMode(domain): 杭州中心但视野略超出导入框 → 裁剪后走本地,不 400', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return {
      ok: true,
      json: async () => ({ total: 1, offset: 0, limit: 50, results: [domainPoi('hz')] }),
    };
  };
  try {
    const { pois } = await fetchPOIsForMode({
      mode: 'domain',
      center: HZ_CENTER,
      zoom: 9,
      bounds: { west: 118.0, south: 28.5, east: 121.2, north: 31.0 },
      existing: [],
    });
    assert.equal(pois.length, 1);
    assert.equal(urls.length, 1);
    assert.match(urls[0], /domain-local/);
    const u = new URL(urls[0], 'http://local.test');
    const parts = u.searchParams.get('bounds').split(',').map(Number);
    assert.ok(parts[0] >= 118.3 && parts[1] >= 29.1 && parts[2] <= 120.8 && parts[3] <= 30.7);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchPOIsForMode(domain): 上海视野即使 center 仍是杭州 → 不打 domain-local', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  const providerCalls = [];
  setActiveSearchProvider({
    searchPOI: async (params) => {
      providerCalls.push(params);
      return [domainPoi('sh')];
    },
    fetchSuggestions: async () => [],
    getCurrentPosition: async () => null,
    geocodeAddress: async () => null,
  });
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const { pois } = await fetchPOIsForMode({
      mode: 'domain',
      center: HZ_CENTER,
      zoom: 13,
      bounds: { west: 121.0, south: 30.9, east: 121.8, north: 31.5 },
      existing: [],
    });
    assert.equal(urls.filter((u) => u.includes('domain-local')).length, 0);
    assert.ok(providerCalls.length >= 1);
    assert.ok(pois.some((p) => p.id === 'sh'));
  } finally {
    globalThis.fetch = originalFetch;
    setActiveSearchProvider(null);
  }
});
