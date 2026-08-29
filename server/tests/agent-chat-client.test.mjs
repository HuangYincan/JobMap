import test from 'node:test';
import assert from 'node:assert/strict';
import { agentChatMapFields, parseSseChunk, streamAgentChat } from '../src/components/agent-chat-client.ts';

// ---- parseSseChunk 纯函数矩阵 ----

test('parseSseChunk: 单个事件', () => {
  const evs = parseSseChunk('data: {"type":"delta","text":"你好"}\n\n');
  assert.equal(evs.length, 1);
  assert.deepEqual(evs[0], { type: 'delta', text: '你好' });
});

test('parseSseChunk: 多个事件(data 行之间空行分隔)', () => {
  const chunk = [
    'data: {"type":"tool","name":"rest__geocodeAddress","status":"start"}\n\n',
    'data: {"type":"delta","text":"建议:"}\n\n',
    'data: {"type":"done"}\n\n',
  ].join('');
  const evs = parseSseChunk(chunk);
  assert.equal(evs.length, 3);
  assert.deepEqual(evs[1], { type: 'delta', text: '建议:' });
  assert.deepEqual(evs[2], { type: 'done' });
});

test('parseSseChunk: 坏 JSON 跳过,好事件保留', () => {
  const chunk = [
    'data: {"type":"delta","text":"ok"}\n\n',
    'data: {not json}\n\n',
    'data: [DONE]\n\n',
    'data: {"type":"delta","text":"next"}\n\n',
  ].join('');
  const evs = parseSseChunk(chunk);
  assert.equal(evs.length, 2);
  assert.deepEqual(evs[0], { type: 'delta', text: 'ok' });
  assert.deepEqual(evs[1], { type: 'delta', text: 'next' });
});

test('parseSseChunk: 空行/纯空块忽略', () => {
  assert.deepEqual(parseSseChunk(''), []);
  assert.deepEqual(parseSseChunk('\n\n\n\n'), []);
  assert.deepEqual(parseSseChunk('data: {"type":"done"}\n\n\n\n'), [{ type: 'done' }]);
});

test('parseSseChunk: 无 data 行的块忽略(event: 行等)', () => {
  const chunk = 'event: message\ndata: {"type":"delta","text":"x"}\n\n';
  const evs = parseSseChunk(chunk);
  assert.equal(evs.length, 1);
  assert.deepEqual(evs[0], { type: 'delta', text: 'x' });
});

test('parseSseChunk: 非对象 JSON / 无 type 字段跳过', () => {
  const chunk = 'data: 42\n\ndata: "str"\n\ndata: {"nope":true}\n\n';
  assert.deepEqual(parseSseChunk(chunk), []);
});

test('parseSseChunk: 跨 chunk 残缺尾部容错(不完整块不产出,不抛错)', () => {
  // 尾部 "data: {"type":"del" 未以 \n\n 结束 → 整体 split 后 JSON 解析失败 → 跳过
  const partial = 'data: {"type":"delta","text":"hi"}\n\ndata: {"type":"del';
  const evs = parseSseChunk(partial);
  assert.equal(evs.length, 1);
  assert.deepEqual(evs[0], { type: 'delta', text: 'hi' });
});

test('parseSseChunk: 单行 data 事件含 JSON 转义换行(\\n 在 JSON 字符串内)正常解析', () => {
  // 契约:每事件一行 data: <单行 JSON>(route 逐事件序列化);JSON 内的换行以
  // \n 转义序列存在,解析后还原为真实换行。
  const chunk = 'data: {"type":"delta","text":"a\\nb"}\n\n';
  const evs = parseSseChunk(chunk);
  assert.equal(evs.length, 1);
  assert.deepEqual(evs[0], { type: 'delta', text: 'a\nb' });
});

test('parseSseChunk: reasoning 事件透传解析(思考内容含中文/换行转义)', () => {
  const chunk = [
    'data: {"type":"reasoning","text":"先想想"}\n\n',
    'data: {"type":"reasoning","text":"再想想\\n补充"}\n\n',
    'data: {"type":"delta","text":"回答"}\n\n',
  ].join('');
  const evs = parseSseChunk(chunk);
  assert.equal(evs.length, 3);
  assert.deepEqual(evs[0], { type: 'reasoning', text: '先想想' });
  assert.deepEqual(evs[1], { type: 'reasoning', text: '再想想\n补充' });
  assert.deepEqual(evs[2], { type: 'delta', text: '回答' });
});

test('parseSseChunk: 多 data 行拼接后非合法 JSON → 跳过(SSE data 行拼接语义)', () => {
  // 多 data 行按 \n 拼接是 SSE 规范语义;但 JSON 负载内不允许裸换行,
  // 拼接结果非法 → 容错跳过(事件必须是单行 data 完整 JSON)。
  const chunk = 'data: {"type":"del\ndata: ta","text":"x"}\n\n';
  assert.deepEqual(parseSseChunk(chunk), []);
});

// ---- streamAgentChat:mock fetch(globalThis.fetch 临时替换)----

function sseResponse(chunks) {
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    }),
  };
}

function errorResponse(status, body) {
  return {
    ok: false,
    status,
    body: body
      ? new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));
            controller.close();
          },
        })
      : null,
    json: async () => {
      if (body === undefined) throw new SyntaxError('not json');
      return body;
    },
  };
}

async function collect(req, signal) {
  const events = [];
  for await (const ev of streamAgentChat(req, signal)) events.push(ev);
  return events;
}

test('streamAgentChat: 事件跨 chunk 切分按 \n\n 正确重组', async () => {
  const originalFetch = globalThis.fetch;
  let sentBody = null;
  globalThis.fetch = async (_url, opts) => {
    sentBody = JSON.parse(opts.body);
    return sseResponse([
      'data: {"type":"del', // 事件在 chunk 中间被切断
      'ta","text":"hi"}\n\n', // 跨 chunk 续上 + 空行结束
      'data: {"type":"tool","name":"n","status":"start"}\n\ndata: {"type":"do',
      'ne"}\n\n',
    ]);
  };
  try {
    const events = await collect({ messages: [{ role: 'user', content: 'q' }] }, new AbortController().signal);
    assert.deepEqual(events, [
      { type: 'delta', text: 'hi' },
      { type: 'tool', name: 'n', status: 'start' },
      { type: 'done' },
    ]);
    // 请求体契约:POST 到 /api/agent/chat,messages 原样
    assert.deepEqual(sentBody.messages, [{ role: 'user', content: 'q' }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamAgentChat: reasoning 事件跨 chunk 切分也正确重组', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    sseResponse([
      'data: {"type":"reasoning","text":"先想', // reasoning 事件在 chunk 中间切断
      '想"}\n\n',
      'data: {"type":"reasoning","text":"继续"}\n\n',
      'data: {"type":"done"}\n\n',
    ]);
  try {
    const events = await collect({ messages: [{ role: 'user', content: 'q' }] }, new AbortController().signal);
    assert.deepEqual(events, [
      { type: 'reasoning', text: '先想想' },
      { type: 'reasoning', text: '继续' },
      { type: 'done' },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamAgentChat: viewport/lang 透传;首条带视口快照', async () => {
  const originalFetch = globalThis.fetch;
  let sentBody = null;
  globalThis.fetch = async (_url, opts) => {
    sentBody = JSON.parse(opts.body);
    return sseResponse(['data: {"type":"done"}\n\n']);
  };
  try {
    const req = {
      messages: [{ role: 'user', content: 'hello' }],
      viewport: { center: { lng: 120.15, lat: 30.27 }, zoom: 13 },
      lang: 'en',
    };
    const events = await collect(req, new AbortController().signal);
    assert.deepEqual(events, [{ type: 'done' }]);
    assert.deepEqual(sentBody.viewport, req.viewport);
    assert.equal(sentBody.lang, 'en');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamAgentChat: userLocation 透传', async () => {
  const originalFetch = globalThis.fetch;
  let sentBody = null;
  globalThis.fetch = async (_url, opts) => {
    sentBody = JSON.parse(opts.body);
    return sseResponse(['data: {"type":"done"}\n\n']);
  };
  try {
    const req = {
      messages: [{ role: 'user', content: '附近前端' }],
      userLocation: { lng: 121.47, lat: 31.23 },
      lang: 'zh',
    };
    await collect(req, new AbortController().signal);
    assert.deepEqual(sentBody.userLocation, req.userLocation);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamAgentChat: 超 cap 历史裁到 30 且首条 user;缺 content 补空串', async () => {
  const originalFetch = globalThis.fetch;
  let sentBody = null;
  globalThis.fetch = async (_url, opts) => {
    sentBody = JSON.parse(opts.body);
    return sseResponse(['data: {"type":"done"}\n\n']);
  };
  try {
    const many = Array.from({ length: 32 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `m${i}`,
    }));
    many[2] = { role: 'user' };
    await collect({ messages: many }, new AbortController().signal);
    assert.equal(sentBody.messages.length, 30);
    assert.equal(sentBody.messages[0].role, 'user');
    assert.equal(sentBody.messages[0].content, '');
    assert.equal(sentBody.messages[29].content, 'm31');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('agentChatMapFields: 缺 zoom 或非 finite 坐标则省略,数字字符串可解析', () => {
  assert.deepEqual(agentChatMapFields({ center: { lng: 120.15, lat: 30.28 } }, { lng: 121.47, lat: 31.23 }), {
    userLocation: { lng: 121.47, lat: 31.23 },
  });
  assert.deepEqual(
    agentChatMapFields({ center: { lng: 120.15, lat: 30.28 }, zoom: Number.NaN }, { lng: null, lat: 31.23 }),
    {},
  );
  assert.deepEqual(
    agentChatMapFields({ center: { lng: '120.15', lat: '30.28' }, zoom: '11' }, { lng: '121.47', lat: '31.23' }),
    {
      viewport: { center: { lng: 120.15, lat: 30.28 }, zoom: 11 },
      userLocation: { lng: 121.47, lat: 31.23 },
    },
  );
});

test('streamAgentChat: 503 LLM_UNCONFIGURED → error 事件(不抛错)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    errorResponse(503, { code: 'LLM_UNCONFIGURED', message: 'llm not configured' });
  try {
    const events = await collect({ messages: [{ role: 'user', content: 'q' }] }, new AbortController().signal);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'error');
    assert.equal(events[0].code, 'LLM_UNCONFIGURED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamAgentChat: 非 JSON 错误体 → 状态码兜底 error 事件', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 429, body: null });
  try {
    const events = await collect({ messages: [{ role: 'user', content: 'q' }] }, new AbortController().signal);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'error');
    assert.equal(events[0].code, 'HTTP_429');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamAgentChat: 无 body 的 200 → NO_STREAM error 事件', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, body: null });
  try {
    const events = await collect({ messages: [{ role: 'user', content: 'q' }] }, new AbortController().signal);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'error');
    assert.equal(events[0].code, 'NO_STREAM');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamAgentChat: signal.abort 静默结束(无事件、不抛错)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    return {
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          opts.signal.addEventListener('abort', () =>
            controller.error(new DOMException('aborted', 'AbortError')),
          );
        },
        pull() {
          // 流保持打开,等待 abort
        },
        cancel() {},
      }),
    };
  };
  try {
    const controller = new AbortController();
    const promise = collect({ messages: [{ role: 'user', content: 'q' }] }, controller.signal);
    setTimeout(() => controller.abort(), 10);
    const events = await promise;
    assert.deepEqual(events, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamAgentChat: fetch 未开始前 abort → 静默结束', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new DOMException('aborted', 'AbortError');
  };
  try {
    const controller = new AbortController();
    controller.abort();
    const events = await collect({ messages: [{ role: 'user', content: 'q' }] }, controller.signal);
    assert.deepEqual(events, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('streamAgentChat: 网络错误(非 abort)向上抛', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('network down');
  };
  try {
    await assert.rejects(
      collect({ messages: [{ role: 'user', content: 'q' }] }, new AbortController().signal),
      /network down/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
