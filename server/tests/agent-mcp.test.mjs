// MCP 客户端单测(ws-mcp-sdk,官方 @modelcontextprotocol/sdk 版):
// - normalizeTool 矩阵(纯函数,原样保留)
// - key 门控(缺失 → null)
// - InMemoryTransport 集成:握手 → listTools → callTool 全流程、错误映射、版本容忍
//   (responder 回 2025-03-26,SDK 支持列表内不抛错)
// - Streamable HTTP transport(baidu/amap,mock fetch):JSON + SSE 两种响应形态、
//   session 回传、连接失败/超时 → isReady false、外部 abort、并发信号量、
//   404 换备选 transport
// - legacy SSE transport(tencent,SDK SSEClientTransport + eventsource):
//   GET 流 + endpoint 事件 + POST 关联
import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
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
  const text = JSON.stringify(obj);
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
    body: streamFrom(text),
    json: async () => obj,
    text: async () => text,
  };
}

function sseResponse(text, headers = { 'content-type': 'text/event-stream' }) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
    body: streamFrom(text),
    json: async () => {
      throw new Error('not json');
    },
    text: async () => text,
  };
}

function okResponse(status = 202) {
  return {
    ok: status < 400,
    status,
    statusText: 'OK',
    headers: { get: () => null },
    body: null,
    json: async () => {
      throw new Error('no body');
    },
    text: async () => '',
  };
}

function statusResponse(status) {
  return { ok: false, status, statusText: 'ERR', headers: { get: () => null }, body: null, text: async () => '' };
}

/** 受控 SSE 响应流:GET 打开后由测试 push 事件;endpoint 事件必须先发(SDK SSE 依赖它定 POST 端点)。 */
function controlledSseResponse(url) {
  let controller;
  const body = new ReadableStream({ start(c) { controller = c; } });
  const push = (text) => controller.enqueue(encoder.encode(text));
  const pushMessage = (id, result, isError = false) => {
    const payload = isError ? { jsonrpc: '2.0', id, error: result } : { jsonrpc: '2.0', id, result };
    push(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  const pushEndpoint = () => push(`event: endpoint\ndata: ${url}\n\n`);
  return {
    res: { ok: true, status: 200, statusText: 'OK', headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'text/event-stream' : null) }, body },
    push,
    pushMessage,
    pushEndpoint,
  };
}

const INIT_RESULT = {
  protocolVersion: '2025-06-18',
  capabilities: { tools: {} },
  serverInfo: { name: 'mock-mcp', version: '1.0.0' },
};

/** 标准 InMemory 服务器 responder:initialize/tools/list/tools/call 全支持,未知方法回 JSON-RPC 错误。 */
function standardResponder(msg) {
  if (msg.method === 'initialize') {
    return { jsonrpc: '2.0', id: msg.id, result: INIT_RESULT };
  }
  if (msg.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [
          { name: 'placeSearch', description: '地点检索', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
        ],
      },
    };
  }
  if (msg.method === 'tools/call') {
    return { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: '西湖区咖啡店…' }], isError: false } };
  }
  if (msg.method === 'notifications/initialized') return null;
  return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unknown method ${msg.method}` } };
}

/** 用 InMemoryTransport 对搭 mock 服务器;factory 供 getMcpProvider 的 transportFactory 注入。 */
function makeInMemoryServer(respond) {
  const hits = [];
  const factory = () => {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    serverT.onmessage = async (msg) => {
      hits.push(msg.method);
      const reply = await respond(msg);
      if (reply) clientT.onmessage(reply);
    };
    return clientT;
  };
  return { factory, hits };
}

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
// InMemoryTransport 集成(SDK Client + InMemoryTransport 对搭 mock 服务器)
// ---------------------------------------------------------------------------

test('InMemory: 握手→listTools→callTool 全流程(listTools 缓存 + 契约)', async () => {
  resetMcpProvidersForTest();
  await withEnv({ AMAP_WEB_KEY: 'k1' }, async () => {
    const initParams = [];
    const { factory, hits } = makeInMemoryServer((msg) => {
      if (msg.method === 'initialize') initParams.push(msg.params);
      return standardResponder(msg);
    });
    const h = getMcpProvider('amap', { transportFactory: factory });
    assert.equal(h.isReady(), false);

    const tools = await h.listTools();
    assert.equal(tools.length, 1);
    assert.deepEqual(tools[0], {
      name: 'placeSearch',
      description: '地点检索',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    });
    assert.equal(h.isReady(), true);

    // 工具列表缓存:第二次不再发 tools/list
    await h.listTools();
    assert.equal(hits.filter((m) => m === 'tools/list').length, 1);

    const r = await h.callTool('placeSearch', { query: '咖啡' });
    assert.equal(r.isError, false);
    assert.equal(r.text, '西湖区咖啡店…');

    // 握手契约(SDK 行为):LATEST_PROTOCOL_VERSION(2025-11-25)+ clientInfo + capabilities
    assert.ok(hits.includes('initialize'), 'initialize 必须被调用');
    assert.ok(hits.includes('notifications/initialized'), 'initialized 通知必须发送');
    assert.equal(initParams.length, 1);
    assert.equal(typeof initParams[0].protocolVersion, 'string');
    assert.equal(initParams[0].protocolVersion, '2025-11-25');
    assert.deepEqual(initParams[0].clientInfo, { name: 'domain-map-agent', version: '1.0.0' });
    assert.deepEqual(initParams[0].capabilities, {});
  });
});

test('InMemory: 版本容忍 —— 服务器回 2025-03-26(高德实测)不抛错', async () => {
  resetMcpProvidersForTest();
  await withEnv({ AMAP_WEB_KEY: 'k1' }, async () => {
    const { factory } = makeInMemoryServer((msg) => {
      if (msg.method === 'initialize') {
        return { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'amap-mcp', version: '1' } } };
      }
      return standardResponder(msg);
    });
    const h = getMcpProvider('amap', { transportFactory: factory });
    const tools = await h.listTools(); // 版本不匹配也不得抛错
    assert.equal(tools[0].name, 'placeSearch');
    assert.equal(h.isReady(), true);
    const r = await h.callTool('placeSearch', {});
    assert.equal(r.isError, false);
    assert.equal(r.text, '西湖区咖啡店…');
  });
});

test('InMemory: callTool JSON-RPC 错误 → isError + rpc error 文本,不剔除', async () => {
  resetMcpProvidersForTest();
  await withEnv({ AMAP_WEB_KEY: 'k1' }, async () => {
    const { factory } = makeInMemoryServer((msg) => {
      if (msg.method === 'tools/call' && msg.params?.name === 'nope') {
        return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'tool not found' } };
      }
      return standardResponder(msg);
    });
    const h = getMcpProvider('amap', { transportFactory: factory });
    await h.listTools();
    const r = await h.callTool('nope', {});
    assert.equal(r.isError, true);
    assert.match(r.text, /^mcp\(amap\) rpc error: MCP error -32601: tool not found$/);
    assert.equal(h.isReady(), true, 'RPC 错误不剔除 provider');
    // 连接保活:后续调用仍可用
    const r2 = await h.callTool('placeSearch', {});
    assert.equal(r2.isError, false);
  });
});

test('InMemory: callTool 结果 isError=true → isError 透传 + 文本转述', async () => {
  resetMcpProvidersForTest();
  await withEnv({ AMAP_WEB_KEY: 'k1' }, async () => {
    const { factory } = makeInMemoryServer((msg) => {
      if (msg.method === 'tools/call') {
        return { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'sorry' }], isError: true } };
      }
      return standardResponder(msg);
    });
    const h = getMcpProvider('amap', { transportFactory: factory });
    await h.listTools();
    const r = await h.callTool('placeSearch', {});
    assert.equal(r.isError, true);
    assert.equal(r.text, 'sorry');
  });
});

test('InMemory: 连接失败(initialize 返回错误)→ listTools 抛错 + isReady false;重建可成功', async () => {
  resetMcpProvidersForTest();
  await withEnv({ AMAP_WEB_KEY: 'k1' }, async () => {
    const bad = getMcpProvider('amap', {
      transportFactory: makeInMemoryServer((msg) => {
        if (msg.method === 'initialize') {
          return { jsonrpc: '2.0', id: msg.id, error: { code: -32600, message: 'invalid request' } };
        }
        return standardResponder(msg);
      }).factory,
    });
    await assert.rejects(() => bad.listTools());
    assert.equal(bad.isReady(), false);

    // 同 id 再次获取 → 新实例(新 transport),能成功
    const good = getMcpProvider('amap', { transportFactory: makeInMemoryServer(standardResponder).factory });
    assert.notEqual(good, bad, '失败后应重建新实例');
    const tools = await good.listTools();
    assert.equal(tools[0].name, 'placeSearch');
    assert.equal(good.isReady(), true);
  });
});

// ---------------------------------------------------------------------------
// Streamable HTTP transport(经 baidu/amap 端点;SDK StreamableHTTPClientTransport)
// ---------------------------------------------------------------------------

/** streamable mock:GET(可选 SSE 流)→ 405;initialize → JSON+session;通知 → 202;tools/* → JSON。 */
function streamableFetchMock(handlers) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    const entry = { url: String(url), method, headers: init.headers ?? {}, body };
    calls.push(entry);
    if (method === 'GET') return statusResponse(405); // 服务器不开 GET SSE 流(规范允许)
    if (handlers) {
      const r = await handlers(entry, calls);
      if (r) return r;
    }
    if (body && body.id === undefined) return okResponse(202); // notification → 202(SDK 尝试开流)
    if (body?.method === 'initialize') {
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: INIT_RESULT }, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' });
    }
    if (body?.method === 'tools/list') {
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'placeSearch', description: '地点检索', inputSchema: { type: 'object' } }] } });
    }
    if (body?.method === 'tools/call') {
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: '西湖区咖啡店…' }], isError: false } });
    }
    return jsonResponse({ jsonrpc: '2.0', id: body?.id, error: { code: -32601, message: 'method not found' } });
  };
  return { fetchImpl, calls };
}

test('streamable: 握手→通知→listTools→callTool 全流程(JSON 响应 + session 回传)', async () => {
  resetMcpProvidersForTest();
  await withEnv({ BAIDU_MAP_AK: 'test-ak' }, async () => {
    const { fetchImpl, calls } = streamableFetchMock();
    const h = getMcpProvider('baidu', { fetchImpl });
    assert.equal(h.isReady(), false);

    const tools = await h.listTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, 'placeSearch');
    assert.equal(h.isReady(), true);

    // 工具列表缓存:第二次不再发 tools/list
    await h.listTools();
    assert.equal(calls.filter((c) => c.body?.method === 'tools/list').length, 1);

    const r = await h.callTool('placeSearch', { query: '咖啡' });
    assert.equal(r.isError, false);
    assert.equal(r.text, '西湖区咖啡店…');

    // 握手契约(SDK 行为)
    const init = calls.find((c) => c.body?.method === 'initialize');
    assert.ok(init, 'initialize 必须被调用');
    assert.equal(init.body.params.protocolVersion, '2025-11-25'); // SDK LATEST_PROTOCOL_VERSION
    assert.deepEqual(init.body.params.clientInfo, { name: 'domain-map-agent', version: '1.0.0' });
    assert.deepEqual(init.body.params.capabilities, {});
    assert.equal(init.headers.get('content-type'), 'application/json');
    assert.equal(init.headers.get('accept'), 'application/json, text/event-stream');
    // SDK 在 initialize 完成后才把协商版本放进 header
    assert.equal(init.headers.get('mcp-protocol-version'), null);
    // 通知(no id)
    assert.ok(calls.some((c) => c.body && c.body.id === undefined && c.body.method === 'notifications/initialized'));
    // session 回传(initialize 响应头 mcp-session-id → 后续请求携带)
    const call = calls.find((c) => c.body?.method === 'tools/call');
    assert.equal(call.headers.get('mcp-session-id'), 'sess-1');
    assert.equal(call.headers.get('mcp-protocol-version'), '2025-06-18'); // 协商出的服务器版本
    assert.deepEqual(call.body.params, { name: 'placeSearch', arguments: { query: '咖啡' } });
  });
});

test('streamable: SSE 响应形态(tools/call 走 text/event-stream)', async () => {
  resetMcpProvidersForTest();
  await withEnv({ BAIDU_MAP_AK: 'test-ak' }, async () => {
    const fetchImpl2 = async (url, init = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(init.body) : null;
      if (method === 'GET') return statusResponse(405);
      if (body && body.id === undefined) return okResponse(202);
      if (body?.method === 'initialize') return jsonResponse({ jsonrpc: '2.0', id: body.id, result: INIT_RESULT });
      if (body?.method === 'tools/list') return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'nearby', inputSchema: { type: 'object' } }] } });
      if (body?.method === 'tools/call') {
        return sseResponse(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'sse 结果' }] } })}\n\n`);
      }
      return okResponse(202);
    };
    const h = getMcpProvider('baidu', { fetchImpl: fetchImpl2 });
    await h.listTools();
    const r = await h.callTool('nearby', {});
    assert.equal(r.isError, false);
    assert.equal(r.text, 'sse 结果');
  });
});

test('版本容忍 wire:amap 服务器回 2025-03-26 → 全流程不抛错', async () => {
  resetMcpProvidersForTest();
  await withEnv({ AMAP_WEB_KEY: 'amap-key' }, async () => {
    const { fetchImpl } = streamableFetchMock();
    const fetchImpl2 = async (url, init = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(init.body) : null;
      if (method === 'GET') return statusResponse(405);
      if (body && body.id === undefined) return okResponse(202);
      if (body?.method === 'initialize') {
        return jsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'amap-mcp', version: '1' } },
        });
      }
      if (body?.method === 'tools/list') {
        return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'placeSearch', inputSchema: { type: 'object' } }] } });
      }
      return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'ok' }] } });
    };
    const h = getMcpProvider('amap', { fetchImpl: fetchImpl2 });
    const tools = await h.listTools(); // 版本不匹配也不得抛错
    assert.equal(tools[0].name, 'placeSearch');
    assert.equal(h.isReady(), true);
    const r = await h.callTool('placeSearch', {});
    assert.equal(r.isError, false);
    assert.equal(r.text, 'ok');
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

test('连接超时 → isReady false(错误含 host 与超时时长)', async () => {
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
  await withEnv({ BAIDU_MAP_AK: 'k' }, async () => {
    let active = 0;
    let maxActive = 0;
    const fetchImpl = async (url, init = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(init.body) : null;
      if (method === 'GET') return statusResponse(405);
      if (body?.method === 'initialize') return jsonResponse({ jsonrpc: '2.0', id: body.id, result: INIT_RESULT });
      if (body && body.id === undefined) return okResponse(202);
      if (body?.method === 'tools/list') return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 't1', inputSchema: { type: 'object' } }] } });
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
      // sse 备选端点:GET 开流(先发 endpoint 事件),POST 后经事件流回包
      if (method === 'GET') {
        stream = controlledSseResponse(s);
        stream.pushEndpoint();
        return stream.res;
      }
      if (body?.method === 'initialize') {
        stream.pushMessage(body.id, INIT_RESULT);
        return okResponse(200);
      }
      if (body && body.id === undefined) return okResponse(200);
      if (body?.method === 'tools/list') {
        stream.pushMessage(body.id, { tools: [{ name: 'fallback-tool', inputSchema: { type: 'object' } }] });
        return okResponse(200);
      }
      if (body?.method === 'tools/call') {
        stream.pushMessage(body.id, { content: [{ type: 'text', text: 'fallback ok' }] });
        return okResponse(200);
      }
      return okResponse(200);
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
    const r = await h.callTool('fallback-tool', {});
    assert.equal(r.isError, false);
    assert.equal(r.text, 'fallback ok');
  });
});

// ---------------------------------------------------------------------------
// legacy SSE transport(经 tencent 端点;SDK SSEClientTransport + eventsource)
// ---------------------------------------------------------------------------

test('legacy SSE: GET 流 + endpoint 事件 + POST 关联(SDK 版)', async () => {
  resetMcpProvidersForTest();
  await withEnv({ TENCENT_MAP_KEY: 'tencent-key' }, async () => {
    const calls = [];
    let stream = null;
    const fetchImpl = async (url, init = {}) => {
      const method = init.method ?? 'GET';
      const s = String(url);
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ url: s, method, headers: init.headers ?? {}, body });
      if (method === 'GET') {
        stream = controlledSseResponse(s);
        stream.pushEndpoint(); // MCP legacy SSE 必须发 endpoint 事件定 POST 端点
        return stream.res;
      }
      if (body?.method === 'initialize') {
        stream.pushMessage(body.id, INIT_RESULT);
        return okResponse(200);
      }
      if (body && body.id === undefined) return okResponse(200);
      if (body?.method === 'tools/list') {
        stream.pushMessage(body.id, { tools: [{ name: 'around', description: '周边检索', inputSchema: { type: 'object' } }] });
        return okResponse(200);
      }
      if (body?.method === 'tools/call') {
        stream.pushMessage(body.id, { content: [{ type: 'text', text: 'legacy 结果' }] });
        return okResponse(200);
      }
      return okResponse(200);
    };

    const h = getMcpProvider('tencent', { fetchImpl });
    const tools = await h.listTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, 'around');
    const r = await h.callTool('around', { keyword: '公园' });
    assert.equal(r.text, 'legacy 结果');
    assert.equal(r.isError, false);

    // 事件流先开(GET,Accept: text/event-stream),POST 才发生
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].headers.get('Accept'), 'text/event-stream');
    // POST 到 endpoint 事件给定的 URL(同一端点,含 key 与 format=0)
    const posts = calls.filter((c) => c.method === 'POST');
    assert.ok(posts.length >= 3, `initialize/initialized/tools/list/tools/call 至少 4 个 POST,实际 ${posts.length}`);
    for (const c of posts) {
      assert.ok(c.url.includes('key=tencent-key'), 'POST URL 含 key 参数');
      assert.ok(c.url.includes('format=0'), 'POST URL 保持 format=0');
    }
    // 响应按 id 关联(来自事件流而非 POST 响应体)
    assert.equal(posts.find((c) => c.body?.method === 'tools/call').body.params.name, 'around');
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
