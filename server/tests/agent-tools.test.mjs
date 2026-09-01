// 工具层单测(ws-b):builtin(viewport/listTools)/ rest 兜底(geocode/placeSearch/
// regeo,输出 sanitize)/ baidu-ai-map skill 工具组(env 门控 + 契约)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { builtinTools, memorySaveTool } from '../src/lib/agent/tools/builtin.ts';
import { restFallbackTools } from '../src/lib/agent/tools/rest-fallback.ts';
import { baiduAgentPlanTools } from '../src/lib/agent/tools/baidu-agent-plan.ts';
import { workTools } from '../src/lib/agent/tools/work.ts';
import { navigationTools } from '../src/lib/agent/tools/navigation.ts';
import { __memoryStoreTest, clearMemories, listMemories } from '../src/lib/memory-store.ts';

const MAP_KEYS = ['AMAP_WEB_KEY', 'BAIDU_MAP_AK', 'TENCENT_MAP_KEY', 'BAIDU_MAP_AUTH_TOKEN'];
const NO_LOCAL = { searchLocal: async () => [] };

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
    assert.match(withVp.text, /视野中心/);
    assert.match(withVp.text, /用户位置未知/);
  }
  const withUser = await viewport.call(
    {},
    {
      ...CTX,
      userLocation: { lng: 121.47, lat: 31.23 },
      viewport: { center: { lng: 120.15, lat: 30.28 }, zoom: 12 },
    },
  );
  assert.equal(withUser.ok, true);
  if (withUser.ok) {
    assert.match(withUser.text, /121\.47/);
    assert.match(withUser.text, /用户位置/);
    assert.doesNotMatch(withUser.text, /用户位置未知/);
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
  const [tool] = restFallbackTools(fetch, NO_LOCAL);
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
    const r = await restFallbackTools(fetchImpl, NO_LOCAL).find((t) => t.name === 'rest__geocodeAddress').call(
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
    const empty = await restFallbackTools(fetchEmpty, NO_LOCAL).find((t) => t.name === 'rest__placeSearch').call({ query: '不存在的东西xyz' }, CTX);
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
    const r = await restFallbackTools(fetchList, NO_LOCAL).find((t) => t.name === 'rest__placeSearch').call({ query: '咖啡' }, CTX);
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
    const rLong = await restFallbackTools(fetchLong, NO_LOCAL).find((t) => t.name === 'rest__placeSearch').call({ query: '咖啡' }, CTX);
    assert.equal(rLong.ok, true);
    if (rLong.ok) {
      assert.ok(rLong.text.length <= 3000, `输出必须截断 3000,实际 ${rLong.text.length}`);
      assert.ok(!rLong.text.includes('长'.repeat(3001)));
    }
  });
});

test('rest__placeSearch: 本地目录命中则不打地图 API', async () => {
  let fetched = 0;
  const fetchImpl = async () => {
    fetched += 1;
    return restJson({ status: '1', pois: [] });
  };
  const searchLocal = async (query, city) => {
    assert.equal(query, '深圳腾讯');
    assert.equal(city, '深圳');
    return [{ source: 'work', name: '腾讯', address: '腾讯大厦', city: '深圳市', lng: 113.93, lat: 22.54, id: 'tencent' }];
  };
  const r = await restFallbackTools(fetchImpl, { searchLocal }).find((t) => t.name === 'rest__placeSearch').call(
    { query: '深圳腾讯' },
    CTX,
  );
  assert.equal(fetched, 0);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.match(r.text, /本地目录命中/);
    assert.match(r.text, /腾讯/);
    assert.match(r.text, /113\.93,22\.54/);
    assert.match(r.text, /未请求地图 API/);
  }
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
// builtin__memory_save(2026-08-22 ws-mem-a;tech/30-agent-memory.md §4)
// ---------------------------------------------------------------------------

test('memory_save: guest(无 ctx.userId)→ 拒绝「请先登录后再保存记忆」', async () => {
  const tool = memorySaveTool();
  const r = await tool.call({ content: '我喜欢杭州' }, CTX);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /请先登录/);
});

test('memory_save: 登录成功保存;超长截断 200;高置信敏感内容拒绝且不写入', async () => {
  __memoryStoreTest.poolOverride = () => null; // 内存模式
  try {
    await clearMemories('tool-mem');
    const tool = memorySaveTool();
    const ctx = { ...CTX, userId: 'tool-mem' };

    const ok = await tool.call({ content: '  我常驻杭州  ' }, ctx);
    assert.equal(ok.ok, true);
    if (ok.ok) assert.match(ok.text, /已记住:我常驻杭州/);

    // 超长 → 截断 200 后保存
    const long = await tool.call({ content: '字'.repeat(250) }, ctx);
    assert.equal(long.ok, true, '超长内容截断保存而非报错');
    const items = await listMemories('tool-mem');
    assert.equal(items.length, 2);
    assert.equal(items[0].content.length, 200, '超长截断 200');

    const sensitive = await tool.call({ content: '我的密码是 123456' }, ctx);
    assert.equal(sensitive.ok, false);
    if (!sensitive.ok) assert.match(sensitive.error, /不能保存.*密码/);
    const after = await listMemories('tool-mem');
    assert.equal(after.length, 2, '拒绝敏感内容后原有记忆保持不变');
    assert.ok(!after.some((item) => item.content.includes('123456')));
  } finally {
    __memoryStoreTest.poolOverride = undefined;
  }
});

test('memory_save: 敏感内容在 addMemory 前拒绝,DB 故障不改变拒绝结果', async () => {
  let calls = 0;
  __memoryStoreTest.poolOverride = () => ({
    query: async () => {
      calls += 1;
      throw new Error('db down');
    },
  });
  try {
    const r = await memorySaveTool().call({ content: '我的 token 是 abc' }, { ...CTX, userId: 'tool-sensitive' });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /不能保存.*令牌/);
    assert.equal(calls, 0, '敏感内容不得调用 addMemory/DB');
  } finally {
    __memoryStoreTest.poolOverride = undefined;
  }
});

test('memory_save: 空内容 → error;DB 写失败 → 可恢复 error(不抛)', async () => {
  const tool = memorySaveTool();
  const ctx = { ...CTX, userId: 'tool-mem' };

  const empty = await tool.call({ content: '   ' }, ctx);
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.match(empty.error, /不能为空/);

  const down = { query: async () => { throw new Error('db down'); } };
  __memoryStoreTest.poolOverride = () => down;
  try {
    const r = await tool.call({ content: '内容' }, ctx);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /暂不可用/);
  } finally {
    __memoryStoreTest.poolOverride = undefined;
  }
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

test('work/navigation 域工具: schema/名称/provider 注册', () => {
  const work = workTools({ loadCatalog: async () => [], getPosition: async () => undefined });
  const navigation = navigationTools({
    routeService: { plan: async () => ({ ok: false, error: { code: 'INTERNAL', message: 'x', retryable: false } }) },
    resolvePositions: async () => [],
  });
  assert.deepEqual(
    work.map((t) => [t.name, t.provider]),
    [
      ['work__searchPositions', 'work'],
      ['work__getPositionDetail', 'work'],
    ],
  );
  assert.deepEqual(
    navigation.map((t) => [t.name, t.provider]),
    [
      ['navigation__planRoute', 'navigation'],
      ['navigation__compareCommutes', 'navigation'],
      ['navigation__filterByCommute', 'navigation'],
    ],
  );
  for (const tool of [...work, ...navigation]) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(tool.inputSchema.properties);
  }
});
