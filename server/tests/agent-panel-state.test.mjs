import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceAgentEvent } from '../src/lib/agent-panel-state.ts';

const delta = (text) => ({ type: 'delta', text });
const reasoning = (text) => ({ type: 'reasoning', text });
const tool = (name, status) => ({ type: 'tool', name, status });
const action = (type, payload) => ({ type: 'action', action: { type, payload } });
const user = (content) => ({ role: 'user', content });

test('单轮:文本 + 工具 start/done 同一条消息(done 原位更新 start)', () => {
  let msgs = [];
  msgs = reduceAgentEvent(msgs, delta('第一轮回答'));
  msgs = reduceAgentEvent(msgs, tool('search', 'start'));
  msgs = reduceAgentEvent(msgs, tool('search', 'done'));
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].role, 'assistant');
  assert.equal(msgs[0].content, '第一轮回答');
  // start → done 原位更新:仍是 1 条工具行,状态翻转
  assert.deepEqual(msgs[0].tools, [{ name: 'search', status: 'done' }]);
});

test('两轮:文本+工具 拆两条消息(轮序 = 消息序)', () => {
  let msgs = [];
  msgs = reduceAgentEvent(msgs, delta('文本1'));
  msgs = reduceAgentEvent(msgs, tool('search', 'start'));
  msgs = reduceAgentEvent(msgs, tool('search', 'done'));
  msgs = reduceAgentEvent(msgs, delta('文本2')); // 最后一条已有 tools → 开新消息
  msgs = reduceAgentEvent(msgs, tool('geocode', 'start'));
  msgs = reduceAgentEvent(msgs, tool('geocode', 'done'));
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].content, '文本1');
  assert.deepEqual(msgs[0].tools, [{ name: 'search', status: 'done' }]);
  assert.equal(msgs[1].content, '文本2');
  assert.deepEqual(msgs[1].tools, [{ name: 'geocode', status: 'done' }]);
});

test('tool start 拆轮:已含工具的消息再来 start → 开新消息;各自 done 原位更新到所在消息', () => {
  let msgs = [];
  msgs = reduceAgentEvent(msgs, tool('search', 'start'));
  msgs = reduceAgentEvent(msgs, tool('geocode', 'start')); // 最后一条已有 tools → 新消息
  assert.equal(msgs.length, 2);
  assert.deepEqual(msgs[0].tools, [{ name: 'search', status: 'start' }]);
  assert.deepEqual(msgs[1].tools, [{ name: 'geocode', status: 'start' }]);
  // done 事件按 name 定位到所在消息(跨消息顺序到达也能正确归位)
  msgs = reduceAgentEvent(msgs, tool('search', 'done'));
  msgs = reduceAgentEvent(msgs, tool('geocode', 'done'));
  assert.equal(msgs.length, 2);
  assert.deepEqual(msgs[0].tools, [{ name: 'search', status: 'done' }]);
  assert.deepEqual(msgs[1].tools, [{ name: 'geocode', status: 'done' }]);
});

test('tool error 原位更新 + 找不到 start 的 done 挂到当前消息', () => {
  let msgs = [];
  msgs = reduceAgentEvent(msgs, tool('weather', 'start'));
  msgs = reduceAgentEvent(msgs, tool('weather', 'error'));
  assert.deepEqual(msgs[0].tools, [{ name: 'weather', status: 'error' }]);
  // 无对应 start 的 done:追加为一行(现有逻辑兜底)
  msgs = reduceAgentEvent(msgs, tool('project', 'done'));
  assert.deepEqual(msgs[0].tools, [
    { name: 'weather', status: 'error' },
    { name: 'project', status: 'done' },
  ]);
});

test('action 追加到最终轮:文本+动作同一条消息', () => {
  let msgs = [];
  msgs = reduceAgentEvent(msgs, delta('帮你定位了两个地点'));
  msgs = reduceAgentEvent(msgs, action('addMarkers', { points: [{ lng: 120.1, lat: 30.2 }] }));
  msgs = reduceAgentEvent(msgs, action('addMarkers', { points: [{ lng: 120.2, lat: 30.3 }] }));
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].content, '帮你定位了两个地点');
  assert.equal(msgs[0].actions.length, 2);
  assert.equal(msgs[0].actions[0].type, 'addMarkers');
  // 无 assistant 消息时 action 新建消息
  msgs = reduceAgentEvent([], action('flyTo', { center: { lng: 120, lat: 30 } }));
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].actions.length, 1);
});

test('reasoning 归属:先于本轮 delta,与文本同消息;工具轮之后开新消息', () => {
  let msgs = [];
  msgs = reduceAgentEvent(msgs, reasoning('第一轮思考'));
  msgs = reduceAgentEvent(msgs, reasoning('续'));
  msgs = reduceAgentEvent(msgs, delta('第一轮回答'));
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].reasoning, '第一轮思考续');
  assert.equal(msgs[0].content, '第一轮回答');
  // 第二轮:工具后 reasoning → 开新消息(轮边界)
  msgs = reduceAgentEvent(msgs, tool('search', 'start'));
  msgs = reduceAgentEvent(msgs, tool('search', 'done'));
  msgs = reduceAgentEvent(msgs, reasoning('第二轮思考'));
  msgs = reduceAgentEvent(msgs, delta('第二轮回答'));
  assert.equal(msgs.length, 2);
  assert.equal(msgs[1].reasoning, '第二轮思考');
  assert.equal(msgs[1].content, '第二轮回答');
});

test('用户消息不拆:用户消息由面板原样追加,事件流只开新的 assistant 消息', () => {
  let msgs = [user('第一问')];
  msgs = reduceAgentEvent(msgs, delta('回答一'));
  msgs = reduceAgentEvent(msgs, tool('search', 'start'));
  msgs = reduceAgentEvent(msgs, tool('search', 'done'));
  msgs = reduceAgentEvent(msgs, delta('补充说明')); // 工具后 → 新轮
  assert.equal(msgs.length, 3);
  assert.deepEqual(msgs[0], user('第一问'));
  assert.equal(msgs[1].role, 'assistant');
  assert.equal(msgs[1].content, '回答一');
  assert.equal(msgs[2].content, '补充说明');
  // 用户新消息(send 直接追加数组)之后:assistant 事件开全新消息,不接旧助手消息
  msgs = [...msgs, user('第二问')];
  msgs = reduceAgentEvent(msgs, delta('回答二'));
  assert.equal(msgs.length, 5);
  assert.equal(msgs[3].role, 'user');
  assert.equal(msgs[4].role, 'assistant');
  assert.equal(msgs[4].content, '回答二');
});

test('done/error 事件级:透传不拆消息、不改内容(数组引用不变)', () => {
  const base = [user('问'), { role: 'assistant', content: '答' }];
  const out = reduceAgentEvent(base, { type: 'done', truncated: true });
  const out2 = reduceAgentEvent(base, { type: 'error', code: 'ERROR', message: '' });
  assert.equal(out, base);
  assert.equal(out2, base);
});
