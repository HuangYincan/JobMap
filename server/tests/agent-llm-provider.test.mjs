import test from 'node:test';
import assert from 'node:assert/strict';
import { createLlmProvider, parseSseLine, providerError } from '../src/lib/agent/llm-provider.ts';
import { HttpError } from '../src/lib/llm-validate.ts';

/** 由字符串片段构造 SSE 响应体(片段可跨 chunk 拆行,模拟网络分片)。 */
function sseResponse(chunks, status = 200) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'content-type': 'text/event-stream' } });
}

const BASE = { baseUrl: 'https://llm.example.com/v1', apiKey: 'sk-test', model: 'm' };

function streamChat(provider, overrides = {}) {
  const api = { deltas: [], toolCalls: [], doneCount: 0, calls: [], reasoning: [], turnReasoning: '' };
  const opts = {
    ...BASE,
    messages: [{ role: 'user', content: 'hi' }],
    signal: overrides.signal ?? new AbortController().signal,
    onDelta: (t) => {
      api.deltas.push(t);
    },
    onReasoning: (r) => {
      api.reasoning.push(r);
    },
    onTurnReasoning: (r) => {
      api.turnReasoning = r;
    },
    onToolCall: (tc) => {
      api.toolCalls.push(tc);
    },
    onDone: () => {
      api.doneCount++;
    },
  };
  const p = provider.streamChat(opts);
  api.promise = p;
  api.opts = opts;
  return api;
}

// ---------- parseSseLine 纯函数矩阵 ----------

test('parseSseLine: 合法 data 行 → payload', () => {
  assert.equal(parseSseLine('data: [DONE]'), '[DONE]');
  assert.equal(parseSseLine('data: {"a":1}'), '{"a":1}');
  assert.equal(parseSseLine('data:  {"a":1}'), '{"a":1}'); // 多空格
  assert.equal(parseSseLine('data: {"a":1}\r'), '{"a":1}'); // CRLF
  assert.equal(parseSseLine('data:'), '');
});

test('parseSseLine: 非 data 行 → null', () => {
  assert.equal(parseSseLine(': comment'), null);
  assert.equal(parseSseLine('event: message'), null);
  assert.equal(parseSseLine(''), null);
  assert.equal(parseSseLine('   '), null);
  assert.equal(parseSseLine('random text'), null);
});

// ---------- 流式解析 ----------

test('streamChat: delta 文本逐 chunk 转发,[DONE] 终止', async () => {
  const seen = {};
  const provider = createLlmProvider(async (url, init) => {
    seen.url = url;
    seen.auth = init.headers.authorization;
    seen.body = JSON.parse(init.body);
    return sseResponse([
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
  });
  const api = streamChat(provider);
  await api.promise;
  assert.deepEqual(api.deltas, ['你', '好']);
  assert.equal(api.doneCount, 1);
  assert.equal(seen.url, 'https://llm.example.com/v1/chat/completions');
  assert.equal(seen.auth, 'Bearer sk-test');
  assert.equal(seen.body.stream, true);
  assert.deepEqual(seen.body.messages, [{ role: 'user', content: 'hi' }]);
  assert.equal('tools' in seen.body, false, '无工具时不带 tools 字段');
});

test('streamChat: 工具调用跨 chunk 增量拼接(参数直到流末完整)', async () => {
  const provider = createLlmProvider(async () =>
    sseResponse([
      'data: {"choices":[{"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"amap__place_search","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"query\\":\\"杭"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"州\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ]),
  );
  const api = streamChat(provider);
  await api.promise;
  assert.equal(api.deltas.length, 0);
  assert.ok(api.toolCalls.length >= 1);
  const last = api.toolCalls[api.toolCalls.length - 1];
  assert.equal(last.id, 'c1');
  assert.equal(last.name, 'amap__place_search');
  assert.equal(last.arguments, '{"query":"杭州"}');
  assert.equal(api.doneCount, 1);
});

test('streamChat: 多工具调用(index 0/1)分别累计', async () => {
  const provider = createLlmProvider(async () =>
    sseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"t1","arguments":"{}"}},{"index":1,"id":"b","function":{"name":"t2","arguments":"{\\"x\\":1}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ]),
  );
  const api = streamChat(provider);
  await api.promise;
  const byId = new Map(api.toolCalls.map((tc) => [tc.id, tc]));
  assert.equal(byId.get('a').name, 't1');
  assert.equal(byId.get('a').arguments, '{}');
  assert.equal(byId.get('b').name, 't2');
  assert.equal(byId.get('b').arguments, '{"x":1}');
});

// ---------- reasoning(reasoning_content)解析 ----------

test('streamChat: reasoning_content 逐 chunk 转发,与 content 互不干扰', async () => {
  const provider = createLlmProvider(async () =>
    sseResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"先"}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"想想"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"回答"}}]}\n\n',
      'data: [DONE]\n\n',
    ]),
  );
  const api = streamChat(provider);
  await api.promise;
  assert.deepEqual(api.reasoning, ['先', '想想']);
  assert.deepEqual(api.deltas, ['回答']);
  assert.equal(api.doneCount, 1);
});

test('streamChat: 同一 chunk 内 reasoning_content 与 content 都转发(字段顺序保持)', async () => {
  const provider = createLlmProvider(async () =>
    sseResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"思","content":"答"}}]}\n\n',
      'data: [DONE]\n\n',
    ]),
  );
  const api = streamChat(provider);
  await api.promise;
  assert.deepEqual(api.reasoning, ['思']);
  assert.deepEqual(api.deltas, ['答']);
});

test('streamChat: reasoning_content 为空串/缺失 → 不回调', async () => {
  const provider = createLlmProvider(async () =>
    sseResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"","content":"a"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"b"}}]}\n\n',
      'data: [DONE]\n\n',
    ]),
  );
  const api = streamChat(provider);
  await api.promise;
  assert.deepEqual(api.reasoning, []);
  assert.deepEqual(api.deltas, ['a', 'b']);
});

test('streamChat: 未提供 onReasoning 回调(兼容缺省)→ 不抛错', async () => {
  const provider = createLlmProvider(async () =>
    sseResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"x"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      'data: [DONE]\n\n',
    ]),
  );
  const opts = {
    ...BASE,
    messages: [{ role: 'user', content: 'hi' }],
    signal: new AbortController().signal,
    onDelta: () => {},
    onToolCall: () => {},
    onDone: () => {},
  };
  await provider.streamChat(opts); // 无 onReasoning 字段:?. 缺省不调用
  assert.equal(opts.onReasoning, undefined);
});

// ---------- onTurnReasoning 轮末累计回传 ----------

test('streamChat: onTurnReasoning 回传本轮 reasoning_content 累计全文(多 chunk 拼接)', async () => {
  const provider = createLlmProvider(async () =>
    sseResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"先"}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"想想"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"回答"}}]}\n\n',
      'data: [DONE]\n\n',
    ]),
  );
  const api = streamChat(provider);
  await api.promise;
  assert.equal(api.turnReasoning, '先想想'); // 累计全文 = 各 chunk 按流式顺序拼接
  assert.deepEqual(api.reasoning, ['先', '想想']); // 逐段转发不受影响
  assert.deepEqual(api.deltas, ['回答']);
  assert.equal(api.doneCount, 1);
});

test('streamChat: 无 reasoning(非推理模型)→ 不回调 onTurnReasoning', async () => {
  const provider = createLlmProvider(async () =>
    sseResponse([
      'data: {"choices":[{"delta":{"content":"直接回答"}}]}\n\n',
      'data: [DONE]\n\n',
    ]),
  );
  const api = streamChat(provider);
  await api.promise;
  assert.equal(api.turnReasoning, '', '空 reasoning 不触发轮末回传');
  assert.equal(api.doneCount, 1);
});

test('streamChat: 未提供 onTurnReasoning(兼容缺省)→ 不抛错', async () => {
  const provider = createLlmProvider(async () =>
    sseResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"x"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      'data: [DONE]\n\n',
    ]),
  );
  const opts = {
    ...BASE,
    messages: [{ role: 'user', content: 'hi' }],
    signal: new AbortController().signal,
    onDelta: () => {},
    onToolCall: () => {},
    onDone: () => {},
  };
  await provider.streamChat(opts); // 无 onTurnReasoning 字段:?. 缺省不调用
  assert.equal(opts.onTurnReasoning, undefined);
});

test('streamChat: 注释行/事件行/坏 JSON 行被忽略,不中断流', async () => {
  const provider = createLlmProvider(async () =>
    sseResponse([
      ': keep-alive\n\n',
      'event: message\n',
      'data: not-json{\n\n',
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      'data: [DONE]\n\n',
    ]),
  );
  const api = streamChat(provider);
  await api.promise;
  assert.deepEqual(api.deltas, ['ok']);
  assert.equal(api.doneCount, 1);
});

test('streamChat: EOF 无 [DONE] 也视为完成', async () => {
  const provider = createLlmProvider(async () => sseResponse(['data: {"choices":[{"delta":{"content":"末"}}]}\n\n']));
  const api = streamChat(provider);
  await api.promise;
  assert.deepEqual(api.deltas, ['末']);
  assert.equal(api.doneCount, 1);
});

test('streamChat: 带 tools 时 body 含 tools', async () => {
  const seen = {};
  const provider = createLlmProvider(async (url, init) => {
    seen.body = JSON.parse(init.body);
    return sseResponse(['data: [DONE]\n\n']);
  });
  const api = streamChat(provider);
  api.opts.tools = [{ type: 'function', function: { name: 't', description: 'd', parameters: { type: 'object' } } }];
  await provider.streamChat(api.opts);
  assert.equal(seen.body.tools.length, 1);
  assert.equal(seen.body.tools[0].function.name, 't');
});

test('streamChat: assistant(tool_calls) 序列化为 OpenAI 嵌套形状,reasoning_content 保留;无 tool_calls 消息不受影响', async () => {
  const seen = {};
  const provider = createLlmProvider(async (url, init) => {
    seen.body = JSON.parse(init.body);
    return sseResponse(['data: [DONE]\n\n']);
  });
  const api = streamChat(provider);
  api.opts.messages = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
    {
      role: 'assistant',
      content: '',
      reasoning_content: '先想想', // DeepSeek 思考模式:tool_calls 消息必须回传
      tool_calls: [
        { id: 'c1', name: 'amap__place_search', arguments: '{"query":"杭州"}' },
        { id: 'c2', name: 'rest__geocode', arguments: '{}' },
      ],
    },
    { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
    { role: 'assistant', content: '直接回答,无工具调用' },
  ];
  await provider.streamChat(api.opts);
  const msgs = seen.body.messages;
  // 扁平 {id,name,arguments} → 嵌套 {id, type:'function', function:{name,arguments}}
  assert.deepEqual(msgs[2].tool_calls, [
    { id: 'c1', type: 'function', function: { name: 'amap__place_search', arguments: '{"query":"杭州"}' } },
    { id: 'c2', type: 'function', function: { name: 'rest__geocode', arguments: '{}' } },
  ]);
  assert.equal(msgs[2].reasoning_content, '先想想', 'reasoning_content 随消息保留(回传必需)');
  assert.equal(msgs[2].content, '');
  assert.equal(msgs[2].role, 'assistant');
  // tool 消息原样(tool_call_id 已正确)
  assert.equal(msgs[3].role, 'tool');
  assert.equal(msgs[3].tool_call_id, 'c1');
  assert.equal(msgs[3].content, '{"ok":true}');
  // 无 tool_calls 的 assistant / system / user 消息不受影响
  assert.equal('tool_calls' in msgs[4], false, '无 tool_calls 的 assistant 消息不附加字段');
  assert.deepEqual(msgs[0], { role: 'system', content: 'sys' });
  assert.deepEqual(msgs[1], { role: 'user', content: 'hi' });
});

// ---------- 重试与错误 ----------

test('streamChat: 429 两次后 200(重试 2 次,退避注入 0)', async () => {
  let calls = 0;
  const provider = createLlmProvider(
    async () => {
      calls++;
      if (calls <= 2) return new Response('rate limited', { status: 429 });
      return sseResponse(['data: {"choices":[{"delta":{"content":"好"}}]}\n\n', 'data: [DONE]\n\n']);
    },
    { retryDelaysMs: [0, 0] },
  );
  const api = streamChat(provider);
  await api.promise;
  assert.equal(calls, 3);
  assert.deepEqual(api.deltas, ['好']);
  assert.equal(api.doneCount, 1);
});

test('streamChat: 500 后 200(重试一次)', async () => {
  let calls = 0;
  const provider = createLlmProvider(
    async () => {
      calls++;
      if (calls === 1) return new Response('boom', { status: 500 });
      return sseResponse(['data: [DONE]\n\n']);
    },
    { retryDelaysMs: [0] },
  );
  const api = streamChat(provider);
  await api.promise;
  assert.equal(calls, 2);
  assert.equal(api.doneCount, 1);
});

test('streamChat: 429 持续 → HttpError(429),不再重试', async () => {
  let calls = 0;
  const provider = createLlmProvider(
    async () => {
      calls++;
      return new Response('rate limited', { status: 429 });
    },
    { retryDelaysMs: [0, 0] },
  );
  await assert.rejects(streamChat(provider).promise, (err) => err instanceof HttpError && err.status === 429);
  assert.equal(calls, 3, '共 3 次尝试(1 + 2 重试)');
});

test('streamChat: 网络错 2 次退避后成功;持续网络错 → kind network', async () => {
  let calls = 0;
  const okProvider = createLlmProvider(
    async () => {
      calls++;
      if (calls <= 2) throw new TypeError('fetch failed');
      return sseResponse(['data: [DONE]\n\n']);
    },
    { retryDelaysMs: [0, 0] },
  );
  await streamChat(okProvider).promise;
  assert.equal(calls, 3);

  const failProvider = createLlmProvider(
    async () => {
      throw new TypeError('fetch failed');
    },
    { retryDelaysMs: [0, 0] },
  );
  await assert.rejects(streamChat(failProvider).promise, (err) => err.kind === 'network');
});

test('streamChat: 400/422 且响应体涉及 tools → kind unsupported_tools', async () => {
  for (const status of [400, 422]) {
    const provider = createLlmProvider(async () => new Response('{"error":{"message":"tools is not supported"}}', { status }));
    await assert.rejects(
      streamChat(provider).promise,
      (err) => err.kind === 'unsupported_tools' && err instanceof Error,
      `status ${status}`,
    );
  }
});

test('streamChat: 400 无 tools 字样 → HttpError(400),非 unsupported_tools', async () => {
  const provider = createLlmProvider(async () => new Response('bad request', { status: 400 }));
  await assert.rejects(streamChat(provider).promise, (err) => err instanceof HttpError && err.status === 400);
});

test('streamChat: 401 → HttpError(401),不重试', async () => {
  let calls = 0;
  const provider = createLlmProvider(
    async () => {
      calls++;
      return new Response('unauthorized', { status: 401 });
    },
    { retryDelaysMs: [0, 0] },
  );
  await assert.rejects(streamChat(provider).promise, (err) => err instanceof HttpError && err.status === 401);
  assert.equal(calls, 1);
});

// ---------- 超时与 abort ----------

/** 永不产生数据的流;收到 abort 时以 AbortError 报错(模拟真实 fetch 行为)。 */
function hangingResponse(fetchInit) {
  const stream = new ReadableStream({
    start(controller) {
      fetchInit.signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

test('streamChat: 首包超时 → kind timeout,不重试', async () => {
  let calls = 0;
  const provider = createLlmProvider(
    async (url, init) => {
      calls++;
      return hangingResponse(init);
    },
    { firstPacketTimeoutMs: 20, overallTimeoutMs: 5000, retryDelaysMs: [0] },
  );
  await assert.rejects(streamChat(provider).promise, (err) => err.kind === 'timeout');
  assert.equal(calls, 1, '超时不重试');
});

test('streamChat: 整体超时上限生效 → kind timeout', async () => {
  const provider = createLlmProvider(
    async (url, init) => hangingResponse(init),
    { firstPacketTimeoutMs: 10000, overallTimeoutMs: 30, retryDelaysMs: [0] },
  );
  await assert.rejects(streamChat(provider).promise, (err) => err.kind === 'timeout');
});

test('streamChat: 调用方已 abort → kind aborted,且不发请求', async () => {
  let calls = 0;
  const ac = new AbortController();
  ac.abort();
  const provider = createLlmProvider(async () => {
    calls++;
    return sseResponse(['data: [DONE]\n\n']);
  });
  await assert.rejects(streamChat(provider, { signal: ac.signal }).promise, (err) => err.kind === 'aborted');
  assert.equal(calls, 0);
});

test('streamChat: 流中 abort → kind aborted', async () => {
  const ac = new AbortController();
  const provider = createLlmProvider(
    async (url, init) => {
      const stream = new ReadableStream({
        start(controller) {
          init.signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
          // 先给一个 chunk 再挂起,等 abort
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"半"}}]}\n\n'));
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    },
    { retryDelaysMs: [0] },
  );
  const api = streamChat(provider, { signal: ac.signal });
  const p = api.promise;
  setTimeout(() => ac.abort(), 5);
  await assert.rejects(p, (err) => err.kind === 'aborted');
  assert.deepEqual(api.deltas, ['半']);
});

test('providerError: 构造 kind 可判别的错误', () => {
  const e = providerError('unsupported_tools', 'no tools');
  assert.equal(e.kind, 'unsupported_tools');
  assert.equal(e.name, 'AgentProviderError');
  assert.ok(e instanceof Error);
});
