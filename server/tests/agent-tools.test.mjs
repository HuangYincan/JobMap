// 工具层单测(ws-b):builtin(viewport/listTools)/ rest 兜底(geocode/placeSearch/
// regeo,输出 sanitize)/ baidu-ai-map skill 工具组(env 门控 + 契约)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { builtinTools } from '../src/lib/agent/tools/builtin.ts';
import { restFallbackTools } from '../src/lib/agent/tools/rest-fallback.ts';
import { baiduAgentPlanTools } from '../src/lib/agent/tools/baidu-agent-plan.ts';

const MAP_KEYS = ['AMAP_WEB_KEY', 'BAIDU_MAP_AK', 'TENCENT_MAP_KEY', 'BAIDU_MAP_AUTH_TOKEN'];

async function withEnv(env, fn) {
  const saved = new Map();
  for (const k of MAP_KEYS) {
    saved.set(k, process.env[k]);
    if (k in env) process.env[k] = env[k];
    else delete process.env[k];
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const CTX = { lang: 'zh', requestId: 't', signal: new AbortController().signal };

function restJson(payload) {
  return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
}

// ---------------------------------------------------------------------------
// builtin
// ---------------------------------------------------------------------------

test('builtin: viewport 回显 + listTools 不暴露 secret', async () => {
  const tools = builtinTools();
  assert.deepEqual(tools.map((t) => t.name), ['builtin__viewport', 'builtin__listTools']);

  const viewport = tools.find((t) => t.name === 'builtin__viewport');
  const withVp = await viewport.call({}, { ...CTX, viewport: { center: { lng: 120.15, lat: 30.28 }, zoom: 12 } });
  assert.equal(withVp.ok, true);
  if (withVp.ok) {
    assert.match(withVp.text, /120\.15/);
    assert.match(withVp.text, /30\.28/);
    assert.match(withVp.text, /zoom: 12/);
  }
  const noVp = await viewport.call({}, CTX);
  assert.ok(noVp.ok && /没有可用的视野信息/.test(noVp.text));

  const listTools = tools.find((t) => t.name === 'builtin__listTools');
  const empty = await listTools.call({}, CTX);
  assert.ok(empty.ok && /没有可用工具/.test(empty.text));
  const named = await listTools.call({}, { ...CTX, viewport: undefined });
  assert.ok(named.ok && /没有可用工具/.test(named.text));
});

test('builtin: listTools 通过工厂 getter 返回当前工具集', async () => {
  const names = ['amap__place_search', 'rest__geocodeAddress'];
  const tools = builtinTools(() => names);
  const listTools = tools.find((t) => t.name === 'builtin__listTools');
  const r = await listTools.call({}, CTX);
  assert.ok(r.ok && r.text.includes('amap__place_search') && r.text.includes('rest__geocodeAddress'));
});

// ---------------------------------------------------------------------------
// rest 兜底
// ---------------------------------------------------------------------------

test('rest__geocodeAddress: 缺参 → error;无 key → no-key error;成功 → 坐标转述', async () => {
  const [tool] = restFallbackTools();
  const missing = await tool.call({}, CTX);
  assert.equal(missing.ok, false);

  await withEnv({}, async () => {
    const noKey = await tool.call({ address: '杭州大厦' }, CTX);
    assert.equal(noKey.ok, false);
    if (!noKey.ok) assert.match(noKey.error, /no-key/);
  });

  await withEnv({ AMAP_WEB_KEY: 'k' }, async () => {
    const fetchImpl = async (url) => {
      assert.ok(String(url).includes('restapi.amap.com/v3/geocode/geo'));
      return restJson({ status: '1', geocodes: [{ location: '120.1563,30.2733' }] });
    };
    const r = await restFallbackTools(fetchImpl).find((t) => t.name === 'rest__geocodeAddress').call(
      { address: '杭州大厦', city: '杭州' },
      CTX,
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.match(r.text, /120\.1563,30\.2733/);
      assert.match(r.text, /来源: amap/);
    }
  });
});

test('rest__placeSearch: 缺参 → error;空结果 → 提示;成功 → POI 列表;超长输出截断 3000', async () => {
  const tools = restFallbackTools();
  const tool = tools.find((t) => t.name === 'rest__placeSearch');
  const missing = await tool.call({}, CTX);
  assert.equal(missing.ok, false);

  await withEnv({ AMAP_WEB_KEY: 'k' }, async () => {
    // 空结果 → 提示(不报错)
    const fetchEmpty = async (url) => {
      assert.ok(String(url).includes('/v3/place/text'));
      return restJson({ status: '1', pois: [] });
    };
    const empty = await restFallbackTools(fetchEmpty).find((t) => t.name === 'rest__placeSearch').call({ query: '不存在的东西xyz' }, CTX);
    assert.ok(empty.ok && /没有找到 POI/.test(empty.text));

    // 正常列表 → POI 逐项转述
    const fetchList = async (url) => {
      assert.ok(String(url).includes('/v3/place/text'));
      return restJson({
        status: '1',
        pois: [
          { name: '第一家店', address: '滨江区长河街道', location: '120.2,30.2', type: '商务', adname: '滨江区', pname: '浙江省', cityname: '杭州市' },
          { name: '第二家', address: '文三路', location: '120.1,30.1', type: '餐饮', adname: '西湖区', pname: '浙江省', cityname: '杭州市' },
        ],
      });
    };
    const r = await restFallbackTools(fetchList).find((t) => t.name === 'rest__placeSearch').call({ query: '咖啡' }, CTX);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.match(r.text, /找到 2 个 POI/);
      assert.match(r.text, /第一家店/);
      assert.match(r.text, /第二家/);
      assert.match(r.text, /120\.2,30\.2/);
    }

    // 超长输出 → sanitizeToolText 截断 3000
    const longName = '长'.repeat(4000);
    const fetchLong = async () => restJson({ status: '1', pois: [{ name: longName, address: 'a', location: '120.2,30.2' }] });
    const rLong = await restFallbackTools(fetchLong).find((t) => t.name === 'rest__placeSearch').call({ query: '咖啡' }, CTX);
    assert.equal(rLong.ok, true);
    if (rLong.ok) {
      assert.ok(rLong.text.length <= 3000, `输出必须截断 3000,实际 ${rLong.text.length}`);
      assert.ok(!rLong.text.includes('长'.repeat(3001)));
    }
  });
});

test('rest__regeo: 非有限坐标 → error;成功 → 省/市/区', async () => {
  const tools = restFallbackTools();
  const tool = tools.find((t) => t.name === 'rest__regeo');
  const bad = await tool.call({ lng: 'x', lat: 1 }, CTX);
  assert.equal(bad.ok, false);
  const bad2 = await tool.call({ lng: NaN, lat: 1 }, CTX);
  assert.equal(bad2.ok, false);

  await withEnv({ AMAP_WEB_KEY: 'k' }, async () => {
    const fetchImpl = async (url) => {
      assert.ok(String(url).includes('/v3/geocode/regeo'));
      return restJson({
        status: '1',
        regeocode: { addressComponent: { province: '浙江省', cityname: '杭州市', district: '西湖区' } },
      });
    };
    const r = await restFallbackTools(fetchImpl).find((t) => t.name === 'rest__regeo').call({ lng: 120.1, lat: 30.2 }, CTX);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.match(r.text, /浙江省/);
      assert.match(r.text, /杭州市/);
      assert.match(r.text, /西湖区/);
    }
  });
});

// ---------------------------------------------------------------------------
// baidu-ai-map skill 工具组(env 门控)
// ---------------------------------------------------------------------------

test('baidu agent plan: token 未配 → 不注册(空数组)', async () => {
  await withEnv({}, () => {
    assert.deepEqual(baiduAgentPlanTools(), []);
  });
});

test('baidu agent plan: token 已配 → 5 个工具,名称/端点/参数契约', async () => {
  await withEnv({ BAIDU_MAP_AUTH_TOKEN: 't1.abc.def' }, async () => {
    const tools = baiduAgentPlanTools();
    assert.deepEqual(
      tools.map((t) => t.name),
      ['baidu__place', 'baidu__direction', 'baidu__geocoding', 'baidu__reverse_geocoding', 'baidu__weather'],
    );
    const place = tools.find((t) => t.name === 'baidu__place');
    assert.ok(place.inputSchema.required.includes('user_raw_request'));
    assert.equal(place.provider, 'baidu');

    // 必填缺失 → error,不发请求
    const missing = await place.call({}, CTX);
    assert.equal(missing.ok, false);
  });
});

test('baidu agent plan: 请求契约(Bearer 头 + 端点 + 参数)与响应不裁剪', async () => {
  await withEnv({ BAIDU_MAP_AUTH_TOKEN: 't-secret-token' }, async () => {
    const body = '{"result":"原始响应,不裁剪","data":"' + 'x'.repeat(4000) + '"}';
    let seen = null;
    const fetchImpl = async (url, init = {}) => {
      seen = { url: String(url), headers: init.headers ?? {} };
      return { ok: true, status: 200, text: async () => body, json: async () => ({}) };
    };
    const tools = baiduAgentPlanTools(fetchImpl);
    const place = tools.find((t) => t.name === 'baidu__place');

    const r = await place.call({ user_raw_request: '帮我找杭州西湖区的咖啡店', region: '杭州' }, CTX);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.text, body);
      assert.ok(r.text.length > 3000, '契约红线:响应不裁剪');
    }
    assert.ok(seen.url.includes('/agent_plan/v1/place'));
    assert.ok(seen.url.includes('user_raw_request=' + encodeURIComponent('帮我找杭州西湖区的咖啡店')));
    assert.ok(seen.url.includes('region=' + encodeURIComponent('杭州')));
    assert.equal(seen.headers.Authorization, 'Bearer t-secret-token');
  });
});

test('baidu agent plan: reverse_geocoding 校验 location 格式;weather 需 region/location 至少一个', async () => {
  await withEnv({ BAIDU_MAP_AUTH_TOKEN: 't' }, async () => {
    const fetches = [];
    const fetchImpl = async (url, init = {}) => {
      fetches.push(String(url));
      return { ok: true, status: 200, text: async () => '{}' };
    };
    const tools = baiduAgentPlanTools(fetchImpl);
    const regeo = tools.find((t) => t.name === 'baidu__reverse_geocoding');
    const weather = tools.find((t) => t.name === 'baidu__weather');

    const badLoc = await regeo.call({ location: '30.28' }, CTX);
    assert.equal(badLoc.ok, false);
    const badLoc2 = await regeo.call({ location: 'abc,def' }, CTX);
    assert.equal(badLoc2.ok, false);
    const okLoc = await regeo.call({ location: '30.123456,120.123456' }, CTX);
    assert.equal(okLoc.ok, true);
    assert.ok(fetches.at(-1).includes('/agent_plan/v1/reverse_geocoding'));

    const noRegion = await weather.call({}, CTX);
    assert.equal(noRegion.ok, false);
    const withRegion = await weather.call({ region: '杭州' }, CTX);
    assert.equal(withRegion.ok, true);
    assert.ok(fetches.at(-1).includes('/agent_plan/v1/weather'));
  });
});

test('baidu agent plan: 非 2xx → error 含 status,不含 token', async () => {
  await withEnv({ BAIDU_MAP_AUTH_TOKEN: 't-secret-token' }, async () => {
    const fetchImpl = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' });
    const tools = baiduAgentPlanTools(fetchImpl);
    const geo = tools.find((t) => t.name === 'baidu__geocoding');
    const r = await geo.call({ address: '杭州大厦' }, CTX);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.error, /status 401/);
      assert.ok(!r.error.includes('t-secret-token'), '错误绝不含 token');
    }
  });
});
