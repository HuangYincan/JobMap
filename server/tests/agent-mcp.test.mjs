// MCP 客户端单测(ws-b):normalizeTool 矩阵 / key 门控 / streamable 全流程
// (JSON + SSE 响应形态) / legacy SSE 全流程(Mcp-Session-Id 回传 + 防御
// POST 直返 JSON) / 连接失败与超时 → isReady false / 404 换备选 transport /
// 并发信号量 / 失败重建。
import test from 'node:test';
import assert from 'node:assert/strict';
import { getMcpProvider, normalizeTool, resetMcpProvidersForTest } from '../src/lib/agent/mcp-providers.ts';
import { MCP_ENDPOINTS } from '../src/lib/agent/mcp-endpoints.ts';

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

const encoder = new TextEncoder();

function streamFrom(text) {
  return new ReadableStream({
    start(c) {
      c.enqueue(encoder.encode(text));
      c.close();
    },
  });
}

function jsonResponse(obj, headers = { 'content-type': 'application/json' }) {
  return { ok: true, status: 200, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, body: streamFrom(JSON.stringify(obj)) };
}

function sseResponse(text, headers = { 'content-type': 'text/event-stream' }) {
  return { ok: true, status: 200, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, body: streamFrom(text) };
}

function okResponse(status = 202) {
  return { ok: status < 400, status, headers: { get: () => null }, body: null };
}

function statusResponse(status) {
  return { ok: false, status, headers: { get: () => null }, body: null };
}

/** 受控 SSE 响应流:POST 到达后由测试把对应 id 的响应 push 进流。 */
function controlledSseResponse(headers = {}) {
  let controller;
  const body = new ReadableStream({ start(c) { controller = c; } });
  const push = (id, result, isError = false) => {
    const payload = isError ? { jsonrpc: '2.0', id, error: result } : { jsonrpc: '2.0', id, result };
    controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(payload)}\n\n`));
  };
  return { res: { ok: true, status: 200, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, body }, push };
}

const INIT_RESULT = { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'mock-mcp' } };

// ---------------------------------------------------------------------------
// normalizeTool 纯函数矩阵
// ---------------------------------------------------------------------------

test('normalizeTool: 前缀 + slug(小写/非 [a-z0-9_] 转 _)', () => {
  assert.equal(normalizeTool('amap', { name: 'placeSearch' }).name, 'amap__placesearch');
  assert.equal(normalizeTool('amap', { name: 'Place Search@2' }).name, 'amap__place_search_2');
  // '中文POI-查询' → 小写后 中/文/-/查/询 各转 '_' → slug='__poi___',name='tencent' + '__' + slug
  assert.equal(normalizeTool('tencent', { name: '中文POI-查询' }).name, 'tencent____poi___');
  assert.equal(normalizeTool('baidu', { name: '' }).name, 'baidu__unnamed');
});

test('normalizeTool: slug 截断 60', () => {
  const long = 'x'.repeat(80);
  const r = normalizeTool('amap', { name: long });
  assert.equal(r.name, `amap__${'x'.repeat(60)}`);
  assert.equal(r.name.length, 'amap__'.length + 60);
});

test('normalizeTool: description 截 500,缺失用原 name 转述', () => {
  const withDesc = normalizeTool('amap', { name: 't1', description: 'd'.repeat(600) });
  assert.equal(withDesc.description.length, 500);
  const noDesc = normalizeTool('amap', { name: 'orig-name' });
  assert.equal(noDesc.description, 'orig-name');
  const noName = normalizeTool('amap', {});
  assert.equal(noName.description, 'amap__unnamed');
});

test('normalizeTool: inputSchema 缺失/非对象 → 兜底', () => {
  assert.deepEqual(normalizeTool('amap', { name: 't' }).inputSchema, { type: 'object', properties: {} });
  assert.deepEqual(normalizeTool('amap', { name: 't', inputSchema: [] }).inputSchema, { type: 'object', properties: {} });
  assert.deepEqual(normalizeTool('amap', { name: 't', inputSchema: 'x' }).inputSchema, { type: 'object', properties: {} });
  assert.deepEqual(normalizeTool('amap', { name: 't', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }).inputSchema, {
    type: 'object',
    properties: { q: { type: 'string' } },
  });
});

// ---------------------------------------------------------------------------
// key 门控
// ---------------------------------------------------------------------------

test('key 未配 → getMcpProvider 全 null', async () => {
  resetMcpProvidersForTest();
  await withEnv({}, () => {
    assert.equal(getMcpProvider('amap'), null);
    assert.equal(getMcpProvider('tencent'), null);
    assert.equal(getMcpProvider('baidu'), null);
  });
});

test('key 已配 → getMcpProvider 非 null', async () => {
  resetMcpProvidersForTest();
  await withEnv({ AMAP_WEB_KEY: 'k1', TENCENT_MAP_KEY: 'k2', BAIDU_MAP_AK: 'k3' }, () => {
    assert.ok(getMcpProvider('amap'));
    assert.ok(getMcpProvider('tencent'));
    assert.ok(getMcpProvider('baidu'));
  });
});

// ---------------------------------------------------------------------------
// Streamable HTTP transport(JSON 响应形态)
// ---------------------------------------------------------------------------

test('streamable: 握手→通知→listTools→callTool 全流程(JSON 响应 + session 回传)', async () => {
  resetMcpProvidersForTest();
  await withEnv({ BAIDU_MAP_AK: 'test-ak' }, async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body });
      if (body?.method === 'initialize') {
        return jsonResponse({ jsonrpc: '2.0', id: body.id, result: INIT_RESULT }, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' });
      }
      if (body && body.id === undefined) return okResponse(); // notification
      if (body?.method === 'tools/list') {
        return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'placeSearch', description: '地点检索', inputSchema: { type: 'object' } }] } });
      }
      if (body?.method === 'tools/call') {
        return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: '西湖区咖啡店…' }], isError: false } });
      }
      return jsonResponse({ jsonrpc: '2.0', id: body?.id, error: { code: -32601, message: 'method not found' } });
    };

    const h = getMcpProvider('baidu', { fetchImpl });
    assert.equal(h.isReady(), false);

    const tools = await h.listTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, 'placeSearch');
    assert.equal(h.isReady(), true);

    // 工具列表缓存:第二次不再发 tools/list
    await h.listTools();
    const listCalls = calls.filter((c) => c.body?.method === 'tools/list');
    assert.equal(listCalls.length, 1);

    const r = await h.callTool('placeSearch', { query: '咖啡' });
    assert.equal(r.isError, false);
    assert.equal(r.text, '西湖区咖啡店…');

    // 握手契约
    const init = calls.find((c) => c.body?.method === 'initialize');
    assert.ok(init, 'initialize 必须被调用');
    assert.equal(init.body.id, 1);
    assert.deepEqual(init.body.params.protocolVersion, '2025-06-18');
    assert.deepEqual(init.body.params.clientInfo, { name: 'domain-map-agent', version: '1.0.0' });
    assert.equal(init.headers['mcp-protocol-version'], '2025-06-18');
    assert.ok(String(init.headers.Accept).includes('text/event-stream'));
    // 通知(no id)
    assert.ok(calls.some((c) => c.body && c.body.id === undefined && c.body.method === 'notifications/initialized'));
    // session 回传
    const call = calls.find((c) => c.body?.method === 'tools/call');
    assert.equal(call.headers['Mcp-Session-Id'], 'sess-1');
    assert.deepEqual(call.body.params, { name: 'placeSearch', arguments: { query: '咖啡' } });
  });
});

test('streamable: SSE 响应形态(tools/call 走 text/event-stream)', async () => {
  resetMcpProvidersForTest();
  await withEnv({ BAIDU_MAP_AK: 'test-ak' }, async () => {
    const fetchImpl = async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : null;
      if (body?.method === 'initialize') return jsonResponse({ jsonrpc: '2.0', id: body.id, result: INIT_RESULT });
      if (body && body.id === undefined) return okResponse();
      if (body?.method === 'tools/list') return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'nearby' }] } });
      if (body?.method === 'tools/call') {
        return sseResponse(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'sse 结果' }] } })}\n\n`);
      }
      return okResponse();
    };
    const h = getMcpProvider('baidu', { fetchImpl });
    await h.listTools();
    const r = await h.callTool('nearby', {});
    assert.equal(r.isError, false);
    assert.equal(r.text, 'sse 结果');
  });
});

// ---------------------------------------------------------------------------
// legacy SSE transport(经 tencent 端点实测;amap 2026-08-21 已校准为 streamable)
// ---------------------------------------------------------------------------

test('legacy SSE: GET 流 + POST 关联 + Mcp-Session-Id 回传', async () => {
  resetMcpProvidersForTest();
  await withEnv({ TENCENT_MAP_KEY: 'tencent-key' }, async () => {
    const calls = [];
    let stream = null;
    const fetchImpl = async (url, init = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ url: String(url), method, headers: init.headers ?? {}, body });
      if (method === 'GET') {
        stream = controlledSseResponse({ 'mcp-session-id': 'legacy-sess' });
        return stream.res;
      }
      if (body?.method === 'initialize') {
        stream.push(body.id, INIT_RESULT);
        return okResponse();
      }
      if (body && body.id === undefined) return okResponse();
      if (body?.method === 'tools/list') {
        stream.push(body.id, { tools: [{ name: 'around', description: '周边检索' }] });
        return okResponse();
      }
      if (body?.method === 'tools/call') {
        stream.push(body.id, { content: [{ type: 'text', text: 'legacy 结果' }] });
        return okResponse();
      }
      return okResponse();
    };

    const h = getMcpProvider('tencent', { fetchImpl });
    const tools = await h.listTools();
    assert.equal(tools.length, 1);
    const r = await h.callTool('around', { keyword: '公园' });
    assert.equal(r.text, 'legacy 结果');
    assert.equal(r.isError, false);

    // 事件流先开(GET),POST 才发生
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].headers.Accept, 'text/event-stream');
    // POST 回传 Mcp-Session-Id
    for (const c of calls.filter((c) => c.method === 'POST')) {
      assert.equal(c.headers['Mcp-Session-Id'], 'legacy-sess', `POST ${c.body?.method} 必须回传 session`);
    }
    // 响应按 id 关联(来自事件流而非 POST 响应体)
    assert.equal(calls.find((c) => c.body?.method === 'tools/call').body.params.name, 'around');
  });
});

test('legacy SSE: 防御 —— POST 直接返回 JSON-RPC 响应体(部分服务器实现)', async () => {
  resetMcpProvidersForTest();
  await withEnv({ TENCENT_MAP_KEY: 'tencent-key' }, async () => {
    let gotGet = false;
    const fetchImpl = async (url, init = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(init.body) : null;
      if (method === 'GET') {
        gotGet = true;
        const { res } = controlledSseResponse(); // 流开了但响应走 POST 直返
        return res;
      }
      if (body?.method === 'initialize') return jsonResponse({ jsonrpc: '2.0', id: body.id, result: INIT_RESULT });
      if (body && body.id === undefined) return okResponse();
      if (body?.method === 'tools/list') return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'direct' }] } });
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'direct-json' }] } });
    };
    const h = getMcpProvider('tencent', { fetchImpl });
    await h.listTools();
    const r = await h.callTool('direct', {});
    assert.equal(r.text, 'direct-json');
    assert.ok(gotGet, 'GET 事件流仍需打开');
  });
});

// ---------------------------------------------------------------------------
// 失败路径
// ---------------------------------------------------------------------------

test('连接失败(网络)→ isReady false;错误信息不含 key', async () => {
  resetMcpProvidersForTest();
  await withEnv({ AMAP_WEB_KEY: 'super-secret-key' }, async () => {
    const fetchImpl = async () => {
      throw new TypeError('network down');
    };
    const h = getMcpProvider('amap', { fetchImpl });
    await assert.rejects(() => h.listTools());
    assert.equal(h.isReady(), false);
    const r = await h.callTool('x', {});
    assert.equal(r.isError, true);
    assert.match(r.text, /mcp\(amap\) connect failed: mcp\.amap\.com/);
    assert.ok(!r.text.includes('super-secret-key'), '错误绝不含 key');
  });
});

test('HTTP 500 连接失败 → 错误只含 host 与 status', async () => {
  resetMcpProvidersForTest();
  await withEnv({ AMAP_WEB_KEY: 'secret-500' }, async () => {
    const fetchImpl = async () => statusResponse(500);
    const h = getMcpProvider('amap', { fetchImpl });
    await assert.rejects(() => h.listTools());
    const r = await h.callTool('x', {});
    assert.match(r.text, /mcp\(amap\) connect failed: mcp\.amap\.com status 500/);
    assert.ok(!r.text.includes('secret-500'));
  });
});

test('连接超时 → isReady false(错误含 host)', async () => {
  resetMcpProvidersForTest();
  await withEnv({ AMAP_WEB_KEY: 'k' }, async () => {
    // 永不响应的 fetch,但尊重 abort 信号(超时触发 → AbortError)
    const fetchImpl = (url, init = {}) =>
      new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    const h = getMcpProvider('amap', { fetchImpl, timeouts: { connectMs: 60 } });
    await assert.rejects(() => h.listTools());
    assert.equal(h.isReady(), false);
    const r = await h.callTool('x', {});
    assert.match(r.text, /mcp\(amap\) timeout after 60ms \(mcp\.amap\.com\)/);
  });
});

test('404 → 换备选 transport(streamable → sse)重试成功', async () => {
  resetMcpProvidersForTest();
  await withEnv({ BAIDU_MAP_AK: 'baidu-ak' }, async () => {
    const calls = [];
    let stream = null;
    const fetchImpl = async (url, init = {}) => {
      const s = String(url);
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ url: s, method, body });
      if (s.includes('/mcp?')) return statusResponse(404); // streamable 主端点失败
      // sse 备选端点
      if (method === 'GET') {
        stream = controlledSseResponse();
        return stream.res;
      }
      if (body?.method === 'initialize') {
        stream.push(body.id, INIT_RESULT);
        return okResponse();
      }
      if (body && body.id === undefined) return okResponse();
      if (body?.method === 'tools/list') {
        stream.push(body.id, { tools: [{ name: 'fallback-tool' }] });
        return okResponse();
      }
      return okResponse();
    };
    const h = getMcpProvider('baidu', { fetchImpl });
    const tools = await h.listTools();
    assert.equal(tools[0].name, 'fallback-tool');
    assert.equal(h.isReady(), true);
    // 两个端点都打到:streamable POST(404) + sse GET/POST
    assert.ok(calls.some((c) => c.url.includes('/mcp?') && c.method === 'POST'), '先试 streamable 主端点');
    assert.ok(calls.some((c) => c.url.includes('/sse?') && c.method === 'GET'), '再开 sse 备选流');
    assert.ok(calls.some((c) => c.url.includes('/sse?') && c.method === 'POST' && c.body?.method === 'initialize'));
    // 备选端点仍带 ak
    assert.ok(calls.some((c) => c.url.includes('ak=baidu-ak')));
  });
});

test('外部 abort → callTool 快速返回 isError,不发请求', async () => {
  resetMcpProvidersForTest();
  await withEnv({ AMAP_WEB_KEY: 'k' }, async () => {
    let fetches = 0;
    const fetchImpl = async () => {
      fetches++;
      return okResponse();
    };
    const h = getMcpProvider('amap', { fetchImpl });
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await h.callTool('t', {}, ctrl.signal);
    assert.equal(r.isError, true);
    assert.equal(r.text, 'mcp(amap) request aborted');
    assert.equal(fetches, 0, 'abort 后不应发出任何请求');
  });
});

test('并发信号量:每 provider 最多 3 个并发 call', async () => {
  resetMcpProvidersForTest();
  // 用 baidu(streamable,纯 POST 无 GET 流),便于 mock
  await withEnv({ BAIDU_MAP_AK: 'k' }, async () => {
    let active = 0;
    let maxActive = 0;
    const fetchImpl = async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : null;
      if (body?.method === 'initialize') return jsonResponse({ jsonrpc: '2.0', id: body.id, result: INIT_RESULT });
      if (body && body.id === undefined) return okResponse();
      if (body?.method === 'tools/list') return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 't1' }] } });
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 40));
      active--;
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'ok' }] } });
    };
    const h = getMcpProvider('baidu', { fetchImpl });
    await h.listTools();
    await Promise.all(Array.from({ length: 7 }, () => h.callTool('t1', {})));
    assert.ok(maxActive <= 3, `并发不得超过 3,实际 ${maxActive}`);
    assert.ok(maxActive >= 3, `并发应能达到 3,实际 ${maxActive}(信号量可能失效)`);
  });
});

test('listTools 失败 → dispose,下次 getMcpProvider 重建可成功', async () => {
  resetMcpProvidersForTest();
  // 用 baidu(streamable,纯 POST 无 GET 流),便于 mock
  await withEnv({ BAIDU_MAP_AK: 'k' }, async () => {
    const bad = getMcpProvider('baidu', {
      fetchImpl: async () => {
        throw new TypeError('down');
      },
    });
    await assert.rejects(() => bad.listTools());
    assert.equal(bad.isReady(), false);

    // 同 id 再次获取 → 新实例(新 fetch),能成功
    let initSeen = 0;
    const good = getMcpProvider('baidu', {
      fetchImpl: async (url, init = {}) => {
        const body = init.body ? JSON.parse(init.body) : null;
        if (body?.method === 'initialize') {
          initSeen++;
          return jsonResponse({ jsonrpc: '2.0', id: body.id, result: INIT_RESULT });
        }
        if (body && body.id === undefined) return okResponse();
        if (body?.method === 'tools/list') return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'ok-tool' }] } });
        return okResponse();
      },
    });
    assert.notEqual(good, bad, '失败后应重建新实例');
    const tools = await good.listTools();
    assert.equal(tools[0].name, 'ok-tool');
    assert.equal(good.isReady(), true);
    assert.equal(initSeen, 1);
  });
});

// ---------------------------------------------------------------------------
// 端点校准(2026-08-21 实测:高德 /sse 404 → /mcp streamable)
// ---------------------------------------------------------------------------

test('amap 端点已校准:Streamable HTTP /mcp?key=(实测替代已 404 的 /sse)', async () => {
  await withEnv({ AMAP_WEB_KEY: 'amap-key' }, () => {
    const ep = MCP_ENDPOINTS.amap;
    assert.ok(ep, 'AMAP_WEB_KEY 已配 → 端点非 null');
    assert.equal(ep.transport, 'streamable');
    assert.ok(ep.url.startsWith('https://mcp.amap.com/mcp?key='), `url=${ep.url}`);
    assert.ok(ep.url.includes('key=amap-key'), 'query auth 保持 key=<key>');
    assert.ok(!ep.url.includes('/sse'), '旧 SSE 端点已弃用');
  });
});

test('协议版本容忍:服务器回 2025-03-26(高德实测)→ 客户端不抛错', async () => {
  resetMcpProvidersForTest();
  await withEnv({ AMAP_WEB_KEY: 'amap-key' }, async () => {
    const fetchImpl = async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : null;
      if (body?.method === 'initialize') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'amap-mcp' } },
        });
      }
      if (body && body.id === undefined) return okResponse();
      if (body?.method === 'tools/list') {
        return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'placeSearch' }] } });
      }
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'ok' }] } });
    };
    const h = getMcpProvider('amap', { fetchImpl });
    const tools = await h.listTools(); // 版本不匹配也不得抛错
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, 'placeSearch');
    assert.equal(h.isReady(), true);
    const r = await h.callTool('placeSearch', {});
    assert.equal(r.isError, false);
    assert.equal(r.text, 'ok');
  });
});
