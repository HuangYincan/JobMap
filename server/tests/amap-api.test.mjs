import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadAMap,
  searchPOI,
  fetchSuggestions,
  getCurrentPosition,
  geocodeAddress,
  resetAMapLoader,
  resetGeocodeCache,
  normalizeAMapPOI,
  AMAP_LOAD_TIMEOUT_MS,
  AMAP_CALLBACK_TIMEOUT_MS,
  SCRIPT_ID,
  AMAP_URL,
} from '../src/lib/amap-api.ts';

const BASE = {
  id: 'B0FFHF120D',
  name: '杭州印象西湖',
  location: '120.135687,30.251276',
  type: '风景名胜;公园广场;公园',
};

async function withAmap(classes, fn) {
  globalThis.window = { AMap: classes };
  resetAMapLoader();
  resetGeocodeCache();
  try {
    return await fn();
  } finally {
    delete globalThis.window;
    resetAMapLoader();
    resetGeocodeCache();
  }
}

test('normalizeAMapPOI accepts object, string, and lnglat coordinates and drops invalid rows', () => {
  const object = normalizeAMapPOI({ ...BASE, location: { lng: 120.1, lat: 30.2 } });
  assert.equal(object?.location.lng, 120.1);
  assert.equal(object?.location.lat, 30.2);
  const legacy = normalizeAMapPOI({ ...BASE, lnglat: { lng: 120.2, lat: 30.3 } });
  assert.equal(legacy?.location.lng, 120.2);
  assert.equal(normalizeAMapPOI({ ...BASE, location: 'bad' }), null);
  assert.equal(normalizeAMapPOI({ ...BASE, location: '120,30' }).location.lat, 30);
  assert.equal(normalizeAMapPOI({ ...BASE, name: '' }), null);
});

test('searchPOI normalizes rows, dedupes ids, and rejects bad callbacks', async () => {
  let mode = 'complete';
  class FakePlaceSearch {
    constructor() {
      if (mode === 'ctor') throw new Error('ctor failed');
    }

    search(_keyword, done) {
      if (mode === 'complete') {
        done('complete', {
          poiList: {
            count: 2,
            pois: [
              { ...BASE, tel: '0571-85791266' },
              { ...BASE, name: 'duplicate' },
            ],
          },
        });
      } else {
        done(mode, null);
      }
    }

    searchNearBy(_keyword, _center, _radius, done) {
      this.search('', done);
    }

    on() {}
  }

  await withAmap({ PlaceSearch: FakePlaceSearch }, async () => {
    const result = await searchPOI({ keyword: '西湖' });
    assert.equal(result.total, 2);
    assert.equal(result.pois.length, 1, 'same poiid must be deduped');
    assert.equal(result.pois[0].tel, '0571-85791266');

    mode = 'error';
    await assert.rejects(searchPOI({ keyword: '西湖' }), /AMap PlaceSearch failed/);

    mode = 'incomplete';
    await assert.rejects(searchPOI({ keyword: '西湖' }), /PlaceSearch incomplete/);

    mode = 'ctor';
    await assert.rejects(searchPOI({ keyword: '西湖' }), /PlaceSearch constructor failed/);
  });
});

test('fetchSuggestions parses tips and returns [] on failure or constructor errors', async () => {
  let mode = 'complete';
  class FakeAutoComplete {
    constructor() {
      if (mode === 'ctor') throw new Error('ctor failed');
    }

    search(_keyword, done) {
      if (mode === 'complete') {
        done('complete', {
          tips: [
            {
              id: 'tip-1',
              name: '西湖',
              location: '120.1,30.2',
              type: '风景名胜;公园',
              typecode: '110101',
              address: '龙井路',
              cityname: '杭州市',
              adname: '西湖区',
            },
            { name: 'no-location' },
          ],
        });
      } else {
        done(mode, null);
      }
    }

    on() {}
  }

  await withAmap({ AutoComplete: FakeAutoComplete }, async () => {
    const tips = await fetchSuggestions('西湖', '杭州');
    assert.equal(tips.length, 2);
    assert.deepEqual(tips[0].location, { lng: 120.1, lat: 30.2 });
    assert.equal(tips[0].type, '风景名胜');
    assert.equal(tips[0].city[0], '杭州市');
    assert.equal(tips[0].district, '西湖区');
    assert.equal(tips[1].location, undefined, 'tips without coordinates are still returned for search text');

    mode = 'error';
    assert.deepEqual(await fetchSuggestions('x'), []);

    mode = 'ctor';
    assert.deepEqual(await fetchSuggestions('x'), []);
  });
});

test('getCurrentPosition returns parsed positions and null on failure', async () => {
  let mode = 'complete';
  class FakeGeolocation {
    constructor() {
      if (mode === 'ctor') throw new Error('ctor failed');
    }

    getCurrentPosition(done) {
      if (mode === 'complete') {
        done('complete', {
          position: { getLng: () => 120.1, getLat: () => 30.2 },
          accuracy: 25,
          isConverted: true,
          formattedAddress: '杭州',
          info: 'ok',
        });
      } else {
        done(mode, null);
      }
    }
  }

  await withAmap({ Geolocation: FakeGeolocation }, async () => {
    const map = { addControl() {} };
    const pos = await getCurrentPosition(map);
    assert.deepEqual(pos, {
      position: { lng: 120.1, lat: 30.2 },
      accuracy: 25,
      converted: true,
      address: '杭州',
      info: 'ok',
    });

    mode = 'error';
    assert.equal(await getCurrentPosition({ addControl() {} }), null);

    mode = 'ctor';
    assert.equal(await getCurrentPosition({ addControl() {} }), null);
  });
});

test('geocodeAddress caches results and returns null on failure or constructor errors', async () => {
  let mode = 'complete';
  let calls = 0;
  class FakeGeocoder {
    constructor() {
      if (mode === 'ctor') throw new Error('ctor failed');
    }

    getLocation(_address, done) {
      calls += 1;
      if (mode === 'complete') {
        done('complete', { geocodes: [{ location: { lng: 120.1, lat: 30.2 } }] });
      } else {
        done(mode, null);
      }
    }
  }

  await withAmap({ Geocoder: FakeGeocoder }, async () => {
    const first = await geocodeAddress('西湖区');
    assert.deepEqual(first, { lng: 120.1, lat: 30.2, address: '西湖区' });
    const cached = await geocodeAddress('西湖区');
    assert.equal(calls, 1, 'second call must hit the cache');
    assert.deepEqual(cached, first);

    mode = 'error';
    assert.equal(await geocodeAddress('不存在'), null);

    mode = 'ctor';
    assert.equal(await geocodeAddress('不存在2'), null);

    assert.equal(await geocodeAddress('   '), null);
  });
});

test('low-level AMap callbacks time out instead of hanging', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());

  class SilentAutoComplete {
    search() {}

    on() {}
  }

  class SilentGeolocation {
    getCurrentPosition() {}
  }

  class SilentGeocoder {
    getLocation() {}
  }

  await withAmap(
    {
      AutoComplete: SilentAutoComplete,
      Geolocation: SilentGeolocation,
      Geocoder: SilentGeocoder,
    },
    async () => {
      const suggestions = fetchSuggestions('西湖');
      const position = getCurrentPosition({ addControl() {} });
      const location = geocodeAddress('西湖区');
      await new Promise((resolve) => setImmediate(resolve));
      mock.timers.tick(AMAP_CALLBACK_TIMEOUT_MS);

      assert.deepEqual(await suggestions, []);
      assert.equal(await position, null);
      assert.equal(await location, null);
    },
  );
});

test('AMap low-level calls catch synchronous plugin method failures', async () => {
  class ThrowingAutoComplete {
    search() {
      throw new Error('autocomplete failed');
    }

    on() {}
  }

  class ThrowingGeolocation {
    getCurrentPosition() {
      throw new Error('geolocation failed');
    }
  }

  class ThrowingGeocoder {
    getLocation() {
      throw new Error('geocoder failed');
    }
  }

  await withAmap(
    {
      AutoComplete: ThrowingAutoComplete,
      Geolocation: ThrowingGeolocation,
      Geocoder: ThrowingGeocoder,
    },
    async () => {
      assert.deepEqual(await fetchSuggestions('x'), []);
      assert.equal(await getCurrentPosition({ addControl() {} }), null);
      assert.equal(await geocodeAddress('x'), null);
    },
  );
});

test('normalizeAMapPOI: 真实电话保留', () => {
  const poi = normalizeAMapPOI({ ...BASE, tel: '0571-85791266' });
  assert.ok(poi);
  assert.equal(poi.tel, '0571-85791266');
  assert.equal(poi.id, 'B0FFHF120D'); // 真 poiid 透传
});

test('normalizeAMapPOI: tel 空值防御 — "[]"/空串/空数组 → undefined', () => {
  const r1 = normalizeAMapPOI({ ...BASE, tel: '[]' });
  assert.equal(r1?.tel, undefined);
  const r2 = normalizeAMapPOI({ ...BASE, tel: '' });
  assert.equal(r2?.tel, undefined);
  const r3 = normalizeAMapPOI({ ...BASE, tel: '  ' });
  assert.equal(r3?.tel, undefined);
  const r4 = normalizeAMapPOI({ ...BASE, tel: undefined });
  assert.equal(r4?.tel, undefined);
  // AMap 空电话可能返回 truthy 的空数组
  const r5 = normalizeAMapPOI({ ...BASE, tel: [] });
  assert.equal(r5?.tel, undefined);
  // 数组第一个元素是真实电话 → 取用
  const r6 = normalizeAMapPOI({ ...BASE, tel: ['0571-85791266'] });
  assert.equal(r6?.tel, '0571-85791266');
});

test('normalizeAMapPOI: 无 tel 字段不影响其他字段', () => {
  const poi = normalizeAMapPOI({ ...BASE, rating: '4.4' });
  assert.ok(poi);
  assert.equal(poi.rating, 4.4);
  assert.equal(poi.tel, undefined);
});

// ============================================================
// loadAMap 加载超时化(amap-load-timeout):脚本卡死(DNS/TLS/CDN)
// 不再永久 pending,超时后清理标签 + reject(code='AMAP_LOAD_TIMEOUT')。
// ============================================================

/** 最小浏览器 DOM mock:getElementById / createElement / head.appendChild,
 *  注入的 script 存进 registry,测试手动触发 onload/onerror。 */
function makeScriptDom() {
  const registry = new Map();
  let injectedCount = 0;
  return {
    registry,
    injectedCount: () => injectedCount,
    document: {
      getElementById(id) {
        return registry.get(id) ?? null;
      },
      createElement(tag) {
        assert.equal(tag, 'script');
        const el = {
          id: '',
          src: '',
          async: false,
          onload: null,
          onerror: null,
          addEventListener() {},
          remove() {
            registry.delete(el.id);
          },
        };
        return el;
      },
      head: {
        appendChild(el) {
          injectedCount += 1;
          registry.set(el.id, el);
        },
      },
    },
  };
}

/** 每个 loadAMap 用例前:装 window/document + key env,清加载缓存 */
function setupBrowserEnv(win = {}) {
  const dom = makeScriptDom();
  globalThis.window = win;
  globalThis.document = dom.document;
  process.env.NEXT_PUBLIC_AMAP_KEY = 'test-amap-key';
  process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE = 'test-amap-security';
  resetAMapLoader();
  return dom;
}

function teardownBrowserEnv() {
  delete globalThis.window;
  delete globalThis.document;
  delete process.env.NEXT_PUBLIC_AMAP_KEY;
  delete process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE;
  resetAMapLoader();
}

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

/** 同步 attach 结果探针:p 的 handler 必须在 reject 发生(tick/onerror)之前挂上,
 *  否则 node:test 的 MockTimers.tick / 测试框架会把 rejection 判为 unhandled。 */
const probe = (p) =>
  p.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );

test('loadAMap: 超时 reject(code=AMAP_LOAD_TIMEOUT),清缓存后可重新注入并成功', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => {
    mock.timers.reset();
    teardownBrowserEnv();
  });
  const dom = setupBrowserEnv();

  const p = loadAMap();
  const outcome = probe(p);
  assert.ok(dom.registry.has(SCRIPT_ID), '脚本已注入');
  const script1 = dom.registry.get(SCRIPT_ID);
  assert.match(
    script1.src,
    /^https:\/\/webapi\.amap\.com\/maps\?v=2\.0&key=test-amap-key&plugin=/,
    'script src 含 key 与 plugin 参数'
  );
  assert.equal(script1.async, true);
  assert.equal(loadAMap(), p, '加载中复用同一个 promise(同 URL 只注入一次)');
  assert.equal(dom.injectedCount(), 1);

  mock.timers.tick(AMAP_LOAD_TIMEOUT_MS);
  const r1 = await outcome;
  assert.equal(r1.ok, false);
  assert.equal(r1.error.code, 'AMAP_LOAD_TIMEOUT');
  assert.match(r1.error.message, /failed to load within 8000ms/);
  assert.equal(dom.registry.has(SCRIPT_ID), false, '超时后标签已移除');

  // loadPromise 已清空 → 再次调用重新注入新标签;onload 正常成功(重试可用)
  const p2 = loadAMap();
  assert.notEqual(p2, p, '超时后 loadPromise 已清空,重新注入');
  const script2 = dom.registry.get(SCRIPT_ID);
  assert.notEqual(script2, script1, '重试注入的是新标签');
  globalThis.window.AMap = { retried: true };
  script2.onload();
  assert.equal(await p2, globalThis.window.AMap);
});

test('loadAMap: 超时后迟到 onload 不 resolve,window.AMap 就绪后重试短路成功', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => {
    mock.timers.reset();
    teardownBrowserEnv();
  });
  const dom = setupBrowserEnv();

  const p = loadAMap();
  const outcome = probe(p);
  const script = dom.registry.get(SCRIPT_ID);
  mock.timers.tick(AMAP_LOAD_TIMEOUT_MS);
  const r1 = await outcome;
  assert.equal(r1.ok, false);
  assert.equal(r1.error.code, 'AMAP_LOAD_TIMEOUT');

  // 模拟脚本迟到完成:全局命名空间挂上后,已移除标签仍触发 onload——
  // 必须不二次 settle(outcome 保持 reject 态),也不抛出。
  globalThis.window.AMap = { late: true };
  script.onload();
  await flushMicrotasks();
  const r2 = await outcome;
  assert.equal(r2, r1, '迟到 onload 未改变已 settle 的结果(reject 态保持)');

  // 重试:window.AMap 已就绪 → 短路成功(等价页面级恢复)
  assert.equal(await loadAMap(), globalThis.window.AMap);
});

test('loadAMap: onerror 移除标签并清缓存,下次可重新注入', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => {
    mock.timers.reset();
    teardownBrowserEnv();
  });
  const dom = setupBrowserEnv();

  const p = loadAMap();
  const outcome = probe(p);
  const script = dom.registry.get(SCRIPT_ID);
  script.onerror();
  const r1 = await outcome;
  assert.equal(r1.ok, false);
  assert.equal(r1.error.message, 'AMap script failed to load');
  assert.equal(dom.registry.has(SCRIPT_ID), false, 'error 后标签已移除');

  // loadPromise 已清空 → 重新注入新标签,onload 成功(重试可用)
  const p2 = loadAMap();
  assert.notEqual(p2, p, 'error 后 loadPromise 已清空,重新注入');
  const script2 = dom.registry.get(SCRIPT_ID);
  assert.notEqual(script2, script, '重新注入的是新标签');
  globalThis.window.AMap = { retried: true };
  script2.onload();
  assert.equal(await p2, globalThis.window.AMap);
});
