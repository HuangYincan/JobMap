import test from 'node:test';
import assert from 'node:assert/strict';
import { extractActions, loadUserMemory, publicToolEvent, runAgent, sanitizeToolText, toolKind } from '../src/lib/agent/run-agent.ts';
import { providerError } from '../src/lib/agent/llm-provider.ts';
import { __memoryStoreTest, addMemory, clearMemories } from '../src/lib/memory-store.ts';

const CFG = { baseUrl: 'https://llm.example.com/v1', apiKey: 'sk-test', model: 'm', maxTurns: 4, maxHistoryChars: 6000 };

/** 脚本化 mock LLM:每次 streamChat 按脚本取一个行为。 */
function mockProvider(script) {
  const seen = [];
  let calls = 0;
  const provider = {
    seen,
    async streamChat(opts) {
      const idx = Math.min(calls, script.length - 1);
      const behavior = script[idx];
      seen.push({ index: idx, messages: opts.messages, tools: opts.tools });
      calls++;
      if (behavior.throwErr) throw behavior.throwErr;
      // 真实推理模型(DSS 等)流式顺序:reasoning_content 先于 content/tool_calls;轮末回调累计全文
      for (const r of behavior.reasoning ?? []) opts.onReasoning?.(r);
      for (const d of behavior.deltas ?? []) opts.onDelta(d);
      for (const tc of behavior.toolCalls ?? []) opts.onToolCall(tc);
      const joined = (behavior.reasoning ?? []).join('');
      if (joined) opts.onTurnReasoning?.(joined);
      opts.onDone();
    },
  };
  return provider;
}

function mockTool(name, impl) {
  const calls = [];
  return {
    name,
    description: `${name} 的说明`,
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    provider: 'amap',
    calls,
    async call(input, ctx) {
      calls.push({ input, ctx });
      if (impl) return impl(input, ctx);
      return { ok: true, text: `结果:${input.query ?? ''}` };
    },
  };
}

async function collectEvents(req) {
  const events = [];
  for await (const e of runAgent(req)) events.push(e);
  return events;
}

function baseReq(overrides = {}) {
  return {
    config: CFG,
    messages: [{ role: 'user', content: '帮我找杭州的前端岗位' }],
    tools: [],
    signal: new AbortController().signal,
    ...overrides,
  };
}

// ---------- 工具调用闭环 ----------

test('runAgent: tool_calls → 工具执行 → 结果回流 → 二轮 → done', async () => {
  const tool = mockTool('amap__place_search');
  const mp = mockProvider([
    { toolCalls: [{ id: 'c1', name: 'amap__place_search', arguments: '{"query":"杭州"}' }] },
    { deltas: ['找到了', ' 前端岗位'] },
  ]);
  const events = await collectEvents(
    baseReq({
      tools: [tool],
      provider: mp,
      viewport: { center: { lng: 120.15, lat: 30.28 }, zoom: 11 },
    }),
  );

  assert.deepEqual(
    events.map((e) => e.type),
    ['tool', 'tool', 'delta', 'delta', 'done'],
  );
  // 公开 tool 事件:name 为公开类别(amap__place_search → search),summary 不携带
  assert.equal(events[0].type === 'tool' && events[0].status, 'start');
  assert.equal(events[0].type === 'tool' && events[0].name, 'search');
  assert.equal(events[1].type === 'tool' && events[1].status, 'done');
  assert.equal(events[1].type === 'tool' && events[1].name, 'search');
  assert.equal(events[1].type === 'tool' && 'summary' in events[1], false, 'tool 事件不携带 summary');
  assert.deepEqual(events.slice(2, 4).map((e) => e.text), ['找到了', ' 前端岗位']);

  // 工具收到解析后的参数与上下文
  assert.deepEqual(tool.calls[0].input, { query: '杭州' });
  assert.equal(tool.calls[0].ctx.lang, 'zh');
  assert.deepEqual(tool.calls[0].ctx.viewport, { center: { lng: 120.15, lat: 30.28 }, zoom: 11 });
  assert.ok(tool.calls[0].ctx.signal instanceof AbortSignal);

  // 二轮消息含 assistant(tool_calls) + tool 结果
  const round2 = mp.seen[1];
  assert.ok(round2.messages.some((m) => m.role === 'assistant' && m.tool_calls?.[0]?.id === 'c1'));
  const toolMsg = round2.messages.find((m) => m.role === 'tool');
  assert.equal(toolMsg.tool_call_id, 'c1');
  assert.equal(toolMsg.content, '结果:杭州');
  // tools 定义注入(description 截断 500)
  assert.equal(round2.tools[0].function.name, 'amap__place_search');
  assert.equal(round2.tools[0].function.description.length <= 500, true);
  // system 在首轮消息最前
  assert.equal(mp.seen[0].messages[0].role, 'system');
});

test('runAgent: 工具不在白名单 → tool error 事件,不调用任何工具,继续二轮', async () => {
  const real = mockTool('amap__place_search');
  const mp = mockProvider([
    { toolCalls: [{ id: 'evil1', name: 'evil__exec', arguments: '{}' }] },
    { deltas: ['我不认识这个工具'] },
  ]);
  const events = await collectEvents(baseReq({ tools: [real], provider: mp }));
  assert.deepEqual(
    events.map((e) => e.type),
    ['tool', 'tool', 'delta', 'done'],
  );
  assert.equal(events[0].type === 'tool' && events[0].status, 'start');
  assert.equal(events[0].type === 'tool' && events[0].name, 'other', '未知工具名 → other');
  assert.equal(events[1].type === 'tool' && events[1].status, 'error');
  assert.equal(events[1].type === 'tool' && events[1].name, 'other');
  assert.equal(events[1].type === 'tool' && 'summary' in events[1], false, 'tool error 事件不泄露内部细节');
  assert.equal(real.calls.length, 0);
  // 错误也回流为 tool 消息
  const toolMsg = mp.seen[1].messages.find((m) => m.role === 'tool');
  assert.equal(toolMsg.tool_call_id, 'evil1');
  assert.equal(toolMsg.content, 'tool not in whitelist');
});

test('runAgent: 工具抛错 → tool error 事件并继续;ok:false 结果也走 error', async () => {
  const boom = mockTool('amap__place_search', () => {
    throw new Error('boom');
  });
  const fail = mockTool('builtin__viewport', () => ({ ok: false, error: '查询失败' }));
  const mp = mockProvider([
    { toolCalls: [{ id: 'c1', name: 'amap__place_search', arguments: '{"query":"x"}' }] },
    { toolCalls: [{ id: 'c2', name: 'builtin__viewport', arguments: '{}' }] },
    { deltas: ['以上都没查到'] },
  ]);
  const events = await collectEvents(baseReq({ tools: [boom, fail], provider: mp }));
  assert.deepEqual(
    events.map((e) => e.type),
    ['tool', 'tool', 'tool', 'tool', 'delta', 'done'],
  );
  // tool error 事件:name 为公开类别,不携带内部错误文本
  assert.equal(events[1].type === 'tool' && events[1].name, 'search'); // amap__place_search
  assert.equal(events[1].type === 'tool' && 'summary' in events[1], false);
  assert.equal(events[3].type === 'tool' && events[3].name, 'other'); // builtin__viewport
  assert.equal(events[3].type === 'tool' && 'summary' in events[3], false);
});

test('runAgent: 工具参数非法 JSON → tool error,不调用工具,继续下一轮', async () => {
  const tool = mockTool('amap__place_search');
  const mp = mockProvider([
    { toolCalls: [{ id: 'c1', name: 'amap__place_search', arguments: 'not-json{{' }] },
    { deltas: ['修正参数'] },
  ]);
  const events = await collectEvents(baseReq({ tools: [tool], provider: mp }));
  assert.equal(tool.calls.length, 0);
  assert.equal(events[0].type === 'tool' && events[0].status, 'start');
  assert.equal(events[1].type === 'tool' && events[1].status, 'error');
  assert.equal(events[1].type === 'tool' && events[1].name, 'search');
  assert.equal(events[1].type === 'tool' && 'summary' in events[1], false);
  assert.deepEqual(
    events.map((e) => e.type),
    ['tool', 'tool', 'delta', 'done'],
  );
  // 错误回流为 tool 消息
  const toolMsg = mp.seen[1].messages.find((m) => m.role === 'tool');
  assert.equal(toolMsg.content, 'invalid tool arguments JSON');
});

// ---------- reasoning 转发与截断 ----------

test('runAgent: reasoning 事件按流式顺序转发(先思考后回答),与 delta 顺序保持', async () => {
  const mp = mockProvider([
    { reasoning: ['先想想', '再想想'], deltas: ['回答'] },
  ]);
  const events = await collectEvents(baseReq({ provider: mp }));
  assert.deepEqual(
    events.map((e) => e.type),
    ['reasoning', 'reasoning', 'delta', 'done'],
  );
  assert.equal(events[0].type === 'reasoning' && events[0].text, '先想想');
  assert.equal(events[1].type === 'reasoning' && events[1].text, '再想想');
});

test('runAgent: reasoning 与 tool 事件交错时保持回调顺序', async () => {
  const mp = mockProvider([
    { reasoning: ['规划中'], toolCalls: [{ id: 'c1', name: 'amap__place_search', arguments: '{"query":"x"}' }] },
    { reasoning: ['继续'], deltas: ['结果'] },
  ]);
  const events = await collectEvents(baseReq({ provider: mp }));
  assert.deepEqual(
    events.map((e) => e.type),
    ['reasoning', 'tool', 'tool', 'reasoning', 'delta', 'done'],
  );
  assert.equal(events[0].type === 'reasoning' && events[0].text, '规划中');
  assert.equal(events[3].type === 'reasoning' && events[3].text, '继续');
});

test('runAgent: reasoning 总量超 4000 → 截断且不再转发(与 delta 顺序保持)', async () => {
  const big = '思'.repeat(3000);
  const mp = mockProvider([
    { reasoning: [big, big, '尾巴'], deltas: ['最终回答'] },
  ]);
  const events = await collectEvents(baseReq({ provider: mp }));
  const reasoning = events.filter((e) => e.type === 'reasoning');
  // 前两段转发 3000 + 1000(第二段截断),第三段超限不再转发
  const forwarded = reasoning.map((e) => (e.type === 'reasoning' ? e.text : '')).join('');
  assert.equal(forwarded.length, 4000);
  assert.equal(forwarded.endsWith('思'), true); // 第二段只转发前 1000 字符
  assert.ok(!forwarded.includes('尾巴'), '超限后的 reasoning 不再转发');
  assert.deepEqual(
    events.map((e) => e.type),
    ['reasoning', 'reasoning', 'delta', 'done'],
  );
});

test('runAgent: 无 reasoning(非推理模型)→ 零 reasoning 事件', async () => {
  const mp = mockProvider([{ deltas: ['直接回答'] }]);
  const events = await collectEvents(baseReq({ provider: mp }));
  assert.deepEqual(
    events.map((e) => e.type),
    ['delta', 'done'],
  );
});

// ---------- reasoning_content 回传(DeepSeek 思考模式) ----------

test('runAgent: tool_calls 轮次追加的 assistant 消息回传本轮 reasoning_content(多 chunk 拼接)', async () => {
  const tool = mockTool('amap__place_search');
  const mp = mockProvider([
    { reasoning: ['先想', '想再查'], toolCalls: [{ id: 'c1', name: 'amap__place_search', arguments: '{"query":"杭州"}' }] },
    { deltas: ['找到 3 个岗位'] },
  ]);
  const events = await collectEvents(baseReq({ tools: [tool], provider: mp }));
  assert.equal(events.at(-1).type, 'done');
  // 二轮请求中的 assistant(tool_calls) 消息带本轮 reasoning_content 累计全文
  const assistant = mp.seen[1].messages.find((m) => m.role === 'assistant' && m.tool_calls);
  assert.ok(assistant, '二轮消息含 assistant(tool_calls)');
  assert.equal(assistant.reasoning_content, '先想想再查');
  assert.equal(assistant.tool_calls[0].id, 'c1');
  // 无 tool_calls 的 assistant 消息不携带 reasoning_content
  assert.ok(
    !mp.seen[1].messages.some((m) => m.role === 'assistant' && !m.tool_calls && 'reasoning_content' in m),
    '最终轮无 tool_calls 不附加 reasoning_content',
  );
});

test('runAgent: 多轮各回传本轮 reasoning,最终轮不追加 assistant 消息', async () => {
  const tool = mockTool('amap__place_search');
  const mp = mockProvider([
    { reasoning: ['第一轮思考'], toolCalls: [{ id: 'c1', name: 'amap__place_search', arguments: '{"query":"a"}' }] },
    { reasoning: ['第二轮思考'], toolCalls: [{ id: 'c2', name: 'amap__place_search', arguments: '{"query":"b"}' }] },
    { deltas: ['最终答复'] },
  ]);
  const events = await collectEvents(baseReq({ tools: [tool], provider: mp }));
  assert.deepEqual(
    events.map((e) => e.type),
    ['reasoning', 'tool', 'tool', 'reasoning', 'tool', 'tool', 'delta', 'done'],
  );
  // 每轮 assistant(tool_calls) 只带本轮 reasoning(history 含前几轮消息,取最新一条)
  assert.equal(mp.seen[1].messages.find((m) => m.role === 'assistant' && m.tool_calls).reasoning_content, '第一轮思考');
  assert.equal(mp.seen[2].messages.findLast((m) => m.role === 'assistant' && m.tool_calls).reasoning_content, '第二轮思考');
  // 最终轮无 tool_calls:runAgent 不追加 assistant 消息 → 请求中无多余 reasoning_content
  assert.ok(
    !mp.seen[2].messages.some((m) => m.role === 'assistant' && !m.tool_calls && 'reasoning_content' in m),
    '最终轮不追加带 reasoning 的 assistant 消息',
  );
});

test('runAgent: 无 reasoning 直接 tool_calls(非推理模型)→ assistant 消息不附加 reasoning_content 字段', async () => {
  const tool = mockTool('amap__place_search');
  const mp = mockProvider([
    { toolCalls: [{ id: 'c1', name: 'amap__place_search', arguments: '{"query":"x"}' }] },
    { deltas: ['ok'] },
  ]);
  await collectEvents(baseReq({ tools: [tool], provider: mp }));
  const assistant = mp.seen[1].messages.find((m) => m.role === 'assistant' && m.tool_calls);
  assert.ok(assistant);
  // 选择说明:空 reasoning 不附加字段(不污染非推理模型请求);若实测某 provider(如 DeepSeek
  // 思考模式)空 reasoning + tool_calls 仍 400,应改为总是附加空串 reasoning_content: ''。
  assert.equal('reasoning_content' in assistant, false, '空 reasoning 不附加 reasoning_content 字段');
});

// ---------- 动作提取与下发 ----------

test('runAgent: 无工具调用 → 动作 JSON 容错提取、逐个校验下发(非法丢弃)', async () => {
  const mp = mockProvider([
    {
      deltas: [
        '好的,',
        '{"actions":[{"type":"flyTo","payload":{"center":{"lng":120.1536,"lat":30.2875},"zoom":12}},{"type":"flyTo","payload":{"center":{"lng":999,"lat":30}}},{"type":"weird","payload":{}},{"type":"search","payload":{"query":"杭州 前端"}}]}',
      ],
    },
  ]);
  const events = await collectEvents(baseReq({ provider: mp }));
  const actions = events.filter((e) => e.type === 'action');
  assert.equal(actions.length, 2);
  assert.deepEqual(actions[0].action, { type: 'flyTo', payload: { center: { lng: 120.1536, lat: 30.2875 }, zoom: 12 } });
  assert.deepEqual(actions[1].action, { type: 'search', payload: { query: '杭州 前端' } });
  assert.equal(events.at(-1).type, 'done');
  assert.equal('truncated' in events.at(-1), false);
});

test('runAgent: 纯文本回复(无动作) → 仅 delta + done', async () => {
  const mp = mockProvider([{ deltas: ['你好,我在地图上看看。'] }]);
  const events = await collectEvents(baseReq({ provider: mp }));
  assert.deepEqual(
    events.map((e) => e.type),
    ['delta', 'done'],
  );
});

test('extractActions: 纯函数 — 围栏/前后缀/多个动作块/损坏段', () => {
  assert.deepEqual(
    extractActions('```json\n{"actions":[{"type":"search","payload":{"query":"杭州"}}]}\n```'),
    [{ type: 'search', payload: { query: '杭州' } }],
  );
  assert.deepEqual(extractActions('前缀文字 {"actions": [{"type":"flyTo","payload":{"center":{"lng":120,"lat":30}}}]} 后缀'), [
    { type: 'flyTo', payload: { center: { lng: 120, lat: 30 } } },
  ]);
  // 损坏的 JSON 段被跳过,后面的段仍解析
  assert.deepEqual(extractActions('{"actions":[{"type":"flyTo","payload":{'), []);
  assert.deepEqual(extractActions('没有动作'), []);
  assert.deepEqual(extractActions(''), []);
  // 字符串中的花括号不干扰配对
  assert.deepEqual(
    extractActions('回复:{"actions":[{"type":"select","payload":{"id":"a{b}c"}}]}完'),
    [{ type: 'select', payload: { id: 'a{b}c' } }],
  );
});

// ---------- 截断 / 裁剪 / 降级 / abort ----------

test('runAgent: 超 maxTurns → done truncated(末轮工具不执行)', async () => {
  const tool = mockTool('amap__place_search');
  const mp = mockProvider([
    { toolCalls: [{ id: 'c1', name: 'amap__place_search', arguments: '{"query":"a"}' }] },
    { toolCalls: [{ id: 'c2', name: 'amap__place_search', arguments: '{"query":"b"}' }] },
  ]);
  const events = await collectEvents(baseReq({ config: { ...CFG, maxTurns: 2 }, tools: [tool], provider: mp }));
  assert.deepEqual(
    events.map((e) => e.type),
    ['tool', 'tool', 'tool', 'done'],
  );
  // 第一轮执行了 c1;第二轮(末轮)只发 start 即截断
  assert.equal(events[1].type === 'tool' && events[1].status, 'done');
  assert.equal(events[2].type === 'tool' && events[2].status, 'start');
  assert.deepEqual(events.at(-1), { type: 'done', truncated: true });
  assert.equal(tool.calls.length, 1);
});

test('runAgent: 历史裁剪 — 超 maxHistoryChars 时删最旧 user,保留 system 与最近一轮', async () => {
  const tool = mockTool('builtin__viewport', () => ({ ok: true, text: 'ok' }));
  const longUser = '旧消息' + 'x'.repeat(5000);
  const mp = mockProvider([
    { toolCalls: [{ id: 'c1', name: 'builtin__viewport', arguments: '{}' }] },
    { deltas: ['新回复'] },
  ]);
  const events = await collectEvents(
    baseReq({
      config: { ...CFG, maxHistoryChars: 2000 },
      messages: [{ role: 'user', content: longUser }],
      tools: [tool],
      provider: mp,
    }),
  );
  assert.equal(events.at(-1).type, 'done');
  const round2Messages = mp.seen[1].messages;
  assert.ok(!round2Messages.some((m) => m.content === longUser), '最旧超长 user 被裁掉');
  assert.equal(round2Messages[0].role, 'system', 'system 保留');
  assert.ok(round2Messages.some((m) => m.role === 'tool'), '最近一轮的 tool 消息保留');
});

/** 断言 LLM 收到的 history 形状合法:system 在最前(永在);每个 role:'tool' 消息之前存在
 *  声明其 tool_call_id 的 assistant(tool_calls);每个 assistant(tool_calls) 的 tool_calls
 *  均有对应 tool 消息(裁剪不拆散配对、不留孤儿 tool —— 否则 DeepSeek 400)。 */
function assertHistoryWellFormed(messages) {
  assert.equal(messages[0].role, 'system', 'history 以 system 开头(system 永在)');
  const declared = new Set();
  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      for (const tc of m.tool_calls) declared.add(tc.id);
    } else if (m.role === 'tool') {
      assert.ok(
        declared.has(m.tool_call_id),
        `tool 消息 ${m.tool_call_id} 之前存在带匹配 tool_call_id 的 assistant(tool_calls)`,
      );
    }
  }
  const toolIds = messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id);
  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      for (const tc of m.tool_calls) {
        assert.ok(toolIds.includes(tc.id), `assistant(tool_calls) 的 ${tc.id} 有对应 tool 消息`);
      }
    }
  }
}

test('runAgent: 工具结果 >3000 字符 → 入 history 前 sanitizeToolText 截断(ok 与 error 摘要均处理)', async () => {
  const big = 'x'.repeat(5000);
  const toolOk = mockTool('amap__place_search', () => ({ ok: true, text: big }));
  const toolErr = mockTool('builtin__viewport', () => ({ ok: false, error: big }));
  const mp = mockProvider([
    {
      toolCalls: [
        { id: 'c1', name: 'amap__place_search', arguments: '{"query":"q"}' },
        { id: 'c2', name: 'builtin__viewport', arguments: '{}' },
      ],
    },
    { deltas: ['ok'] },
  ]);
  const events = await collectEvents(baseReq({ tools: [toolOk, toolErr], provider: mp }));
  const toolMsgs = mp.seen[1].messages.filter((m) => m.role === 'tool');
  assert.equal(toolMsgs.length, 2);
  for (const tm of toolMsgs) assert.equal(tm.content.length, 3000, 'tool 消息内容被截断到 3000 字符(LLM 历史内部面)');
  // 公开 tool 事件不携带 summary(截断只影响内部 LLM 历史;对外 name 收敛为类别)
  const toolEvents = events.filter((e) => e.type === 'tool' && e.status !== 'start');
  assert.equal(toolEvents.length, 2);
  assert.equal(toolEvents[0].name, 'search');
  assert.equal(toolEvents[1].name, 'other');
  for (const e of toolEvents) assert.equal('summary' in e, false, 'tool 事件不携带 summary');
});

test('runAgent: 历史裁剪按轮删除 — 小预算多轮后无孤儿 tool 消息、system 永在、history 形状合法', async () => {
  const tool = mockTool('amap__place_search', () => ({ ok: true, text: '结果' + 'x'.repeat(300) }));
  const mp = mockProvider([
    { toolCalls: [{ id: 'c1', name: 'amap__place_search', arguments: '{"query":"a"}' }] },
    { toolCalls: [{ id: 'c2', name: 'amap__place_search', arguments: '{"query":"b"}' }] },
    { toolCalls: [{ id: 'c3', name: 'amap__place_search', arguments: '{"query":"c"}' }] },
    { deltas: ['收尾答复'] },
  ]);
  const events = await collectEvents(
    baseReq({ config: { ...CFG, maxHistoryChars: 500 }, tools: [tool], provider: mp }),
  );
  assert.equal(events.at(-1).type, 'done');
  // 每一轮 LLM 收到的 history 形状都合法(裁剪按整轮删除,不产生孤儿 tool、不拆散配对)
  for (const seen of mp.seen) assertHistoryWellFormed(seen.messages);
  // 裁剪确实发生:最早轮的工具结果已随整轮被裁掉
  const finalMessages = mp.seen[mp.seen.length - 1].messages;
  assert.ok(!finalMessages.some((m) => m.role === 'tool' && m.tool_call_id === 'c1'), '最早轮的 tool 结果已被裁掉');
});

test('runAgent: unsupported_tools → 无 tools 降级重跑一次(成功路径)', async () => {
  const tool = mockTool('amap__place_search');
  const mp = mockProvider([
    { throwErr: providerError('unsupported_tools', 'tools not supported') },
    { deltas: ['降级成功'] },
  ]);
  const events = await collectEvents(baseReq({ tools: [tool], provider: mp }));
  assert.deepEqual(
    events.map((e) => e.type),
    ['delta', 'done'],
  );
  assert.ok(mp.seen[0].tools, '首轮带 tools');
  assert.equal(mp.seen[1].tools, undefined, '降级轮无 tools');
  assert.equal(mp.seen[1].messages[0].role, 'system');
});

test('runAgent: unsupported_tools 降级后仍失败 → error 事件(只降级一次)', async () => {
  const tool = mockTool('amap__place_search');
  const mp = mockProvider([
    { throwErr: providerError('unsupported_tools', 'nope') },
    { throwErr: providerError('unsupported_tools', 'nope again') },
  ]);
  const events = await collectEvents(baseReq({ tools: [tool], provider: mp }));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'error');
  assert.equal(events[0].code, 'unsupported_tools');
});

test('runAgent: abort → 静默停止,不发 error 事件', async () => {
  const ac = new AbortController();
  ac.abort();
  const mp = mockProvider([{ throwErr: providerError('aborted', 'aborted') }]);
  const events = await collectEvents(baseReq({ provider: mp, signal: ac.signal }));
  assert.deepEqual(events, []);
});

test('runAgent: 网络错误 → error 事件(code llm_network_error),message 无 secret', async () => {
  const mp = mockProvider([{ throwErr: providerError('network', 'fetch failed') }]);
  const events = await collectEvents(baseReq({ provider: mp }));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'error');
  assert.equal(events[0].code, 'llm_network_error');
  assert.ok(!String(events[0].message).includes('sk-test'));
});

test('runAgent: 未分类错误 → error 事件 code llm_error', async () => {
  const mp = mockProvider([{ throwErr: new TypeError('something unexpected') }]);
  const events = await collectEvents(baseReq({ provider: mp }));
  assert.equal(events[0].type, 'error');
  assert.equal(events[0].code, 'llm_error');
});

test('runAgent: HTTP 错误 → error 事件 code http_<status>', async () => {
  const { HttpError } = await import('../src/lib/llm-validate.ts');
  const mp = mockProvider([{ throwErr: new HttpError(401) }]);
  const events = await collectEvents(baseReq({ provider: mp }));
  assert.equal(events[0].type, 'error');
  assert.equal(events[0].code, 'http_401');
});

test('runAgent: 超时 → error 事件 code timeout', async () => {
  const mp = mockProvider([{ throwErr: providerError('timeout', 'LLM 响应超时') }]);
  const events = await collectEvents(baseReq({ provider: mp }));
  assert.equal(events[0].type, 'error');
  assert.equal(events[0].code, 'timeout');
});

// ---------- sanitizeToolText 纯函数 ----------

test('sanitizeToolText: 剔除 script、超长 URL、截断', () => {
  assert.equal(sanitizeToolText('<script>alert(1)</script>结果'), '结果');
  assert.equal(sanitizeToolText('前面 <script>恶意', 100).includes('<script'), false);
  const longUrl = 'https://example.com/' + 'a'.repeat(200);
  assert.equal(sanitizeToolText(`看 ${longUrl} 这里`), '看 [url] 这里');
  const normalUrl = 'https://example.com/short';
  assert.equal(sanitizeToolText(`看 ${normalUrl}`), `看 ${normalUrl}`);
  const long = '字'.repeat(5000);
  assert.equal(sanitizeToolText(long, 100).length, 100);
  assert.equal(sanitizeToolText('短文本'), '短文本');
  assert.equal(sanitizeToolText(undefined), '');
});

// ---------- 公开面脱敏(toolKind / publicToolEvent,2026-08-21 安全要求) ----------

test('toolKind: 内部工具名 → 公开类别(剥供应商前缀 + 后缀关键词)', () => {
  // search(含 text_search/place/poi/suggestion/search/query)
  assert.equal(toolKind('amap__maps_text_search'), 'search');
  assert.equal(toolKind('tencent__placesuggestion'), 'search');
  assert.equal(toolKind('baidu__map_search_places'), 'search');
  assert.equal(toolKind('rest__placeSearch'), 'search');
  assert.equal(toolKind('amap__place_search'), 'search');
  // geocode(含 geo/geocode/regeo/revers)
  assert.equal(toolKind('amap__geocode'), 'geocode');
  assert.equal(toolKind('rest__geocodeAddress'), 'geocode');
  assert.equal(toolKind('baidu__reverse_geocoding'), 'geocode');
  assert.equal(toolKind('rest__regeo'), 'geocode');
  // directions(含 route/direction + navi/uri 导航链接生成类,2026-08-22 ws-navi)
  assert.equal(toolKind('baidu__direction'), 'directions');
  assert.equal(toolKind('amap__driving_route'), 'directions');
  assert.equal(toolKind('amap__maps_navi_uri'), 'directions');
  assert.equal(toolKind('tencent__navi_link'), 'directions');
  // weather
  assert.equal(toolKind('baidu__weather'), 'weather');
  // project(含 jobs/position/company/recruit/岗位)
  assert.equal(toolKind('amap__company'), 'project');
  assert.equal(toolKind('builtin__jobs'), 'project');
  assert.equal(toolKind('rest__recruit_list'), 'project');
});

test('toolKind: 未知前缀仍按关键词归类;未知后缀 → other', () => {
  assert.equal(toolKind('custom__text_search'), 'search', '未知前缀不剥,关键词照常命中');
  assert.equal(toolKind('evil__exec'), 'other');
  assert.equal(toolKind('builtin__viewport'), 'other');
  assert.equal(toolKind('builtin__listTools'), 'other');
  assert.equal(toolKind('amap__anything_weird'), 'other');
  assert.equal(toolKind(''), 'other');
});

test('publicToolEvent: name 收敛为公开类别,summary 一律不携带(内部名/错误码不外泄)', () => {
  assert.deepEqual(publicToolEvent({ name: 'amap__maps_text_search', status: 'start' }), {
    type: 'tool',
    name: 'search',
    status: 'start',
  });
  assert.deepEqual(publicToolEvent({ name: 'amap__place_search', status: 'done', summary: '结果:杭州' }), {
    type: 'tool',
    name: 'search',
    status: 'done',
  });
  // error 路径:内部错误文本不随公开事件外泄
  assert.deepEqual(publicToolEvent({ name: 'evil__exec', status: 'error', summary: 'tool not in whitelist' }), {
    type: 'tool',
    name: 'other',
    status: 'error',
  });
});

test('runAgent: lang 与视图上下文传给工具 ctx', async () => {
  const tool = mockTool('builtin__viewport');
  const mp = mockProvider([{ toolCalls: [{ id: 'c1', name: 'builtin__viewport', arguments: '{}' }] }, { deltas: ['ok'] }]);
  await collectEvents(
    baseReq({
      lang: 'en',
      viewport: { center: { lng: 120, lat: 30 }, zoom: 10, bounds: { minLng: 119, minLat: 29, maxLng: 121, maxLat: 31 } },
      tools: [tool],
      provider: mp,
    }),
  );
  assert.equal(tool.calls[0].ctx.lang, 'en');
  assert.deepEqual(tool.calls[0].ctx.viewport, {
    center: { lng: 120, lat: 30 },
    zoom: 10,
    bounds: { minLng: 119, minLat: 29, maxLng: 121, maxLat: 31 },
  });
  assert.ok(tool.calls[0].ctx.requestId.length > 0);
});

// ---------- 用户记忆注入(2026-08-22 ws-mem-a) ----------

test('runAgent: 带 userId 且有记忆 → system 首条含记忆段(最新在前)', async () => {
  __memoryStoreTest.poolOverride = () => null; // 内存模式,确定性
  try {
    await clearMemories('mem-run-1');
    await addMemory('mem-run-1', '我常驻杭州');
    await addMemory('mem-run-1', '我在找前端岗位');
    const mp = mockProvider([{ deltas: ['好的'] }]);
    await collectEvents(baseReq({ userId: 'mem-run-1', provider: mp }));
    const system = mp.seen[0].messages[0];
    assert.equal(system.role, 'system');
    assert.match(system.content, /## 用户记忆/);
    assert.ok(system.content.includes('- 我在找前端岗位'), '最新记忆在前');
    assert.ok(system.content.includes('- 我常驻杭州'));
  } finally {
    __memoryStoreTest.poolOverride = undefined;
  }
});

test('runAgent: 无 userId / 空记忆 → system 不含记忆段', async () => {
  __memoryStoreTest.poolOverride = () => null;
  try {
    await clearMemories('mem-run-2');
    const mp1 = mockProvider([{ deltas: ['a'] }]);
    await collectEvents(baseReq({ provider: mp1 }));
    assert.ok(!mp1.seen[0].messages[0].content.includes('用户记忆'), '无 userId 不注入记忆段');

    const mp2 = mockProvider([{ deltas: ['b'] }]);
    await collectEvents(baseReq({ userId: 'mem-run-2', provider: mp2 }));
    assert.ok(!mp2.seen[0].messages[0].content.includes('用户记忆'), '空记忆不注入记忆段');
  } finally {
    __memoryStoreTest.poolOverride = undefined;
  }
});

test('runAgent: 记忆工具调用时 ctx.userId 透传', async () => {
  const tool = mockTool('builtin__viewport');
  const mp = mockProvider([{ toolCalls: [{ id: 'c1', name: 'builtin__viewport', arguments: '{}' }] }, { deltas: ['ok'] }]);
  await collectEvents(baseReq({ userId: 'mem-run-3', tools: [tool], provider: mp }));
  assert.equal(tool.calls[0].ctx.userId, 'mem-run-3');
  assert.equal(mp.seen[0].messages[0].content.includes('用户记忆'), false, '该用户无记忆 → 不注入');
});

test('loadUserMemory: 格式化 + 预算(20 条 / 总长 4000)截断,最新在前', async () => {
  __memoryStoreTest.poolOverride = () => null;
  try {
    await clearMemories('mem-budget');
    for (let i = 0; i < 25; i += 1) await addMemory('mem-budget', `事实${String(i).padStart(2, '0')}` + 'x'.repeat(197));
    const out = await loadUserMemory('mem-budget');
    assert.ok(out, '非空');
    const lines = out.split('\n');
    assert.equal(lines.length, 20, '最多 20 条');
    assert.ok(out.length <= 4000, `总长预算 4000,实际 ${out.length}`);
    assert.ok(out.startsWith('- 事实24'), '最新记忆在最前(- 事实24)');
    assert.ok(!out.includes('事实00'), '最旧 5 条被 20 条上限截掉');
    // 无 userId / 空 userId → undefined(不注入)
    assert.equal(await loadUserMemory(undefined), undefined);
    assert.equal(await loadUserMemory(''), undefined);
  } finally {
    __memoryStoreTest.poolOverride = undefined;
  }
});
