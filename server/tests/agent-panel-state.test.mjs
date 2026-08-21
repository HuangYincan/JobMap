import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceAgentEvent, stripActionJsonBlocks } from '../src/lib/agent-panel-state.ts';

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
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].reasoning, 'thinking'); // 只标记状态,不累积内容
  msgs = reduceAgentEvent(msgs, delta('第一轮回答'));
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].reasoning, 'done'); // 内容产出 → 思考完成
  assert.equal(msgs[0].content, '第一轮回答');
  // 第二轮:工具后 reasoning → 开新消息(轮边界)
  msgs = reduceAgentEvent(msgs, tool('search', 'start'));
  msgs = reduceAgentEvent(msgs, tool('search', 'done'));
  msgs = reduceAgentEvent(msgs, reasoning('第二轮思考'));
  assert.equal(msgs.length, 2);
  assert.equal(msgs[1].reasoning, 'thinking');
  msgs = reduceAgentEvent(msgs, delta('第二轮回答'));
  assert.equal(msgs.length, 2);
  assert.equal(msgs[1].reasoning, 'done');
  assert.equal(msgs[1].content, '第二轮回答');
  // 多轮各自标记:前一轮不受影响
  assert.equal(msgs[0].reasoning, 'done');
  assert.equal(msgs[0].content, '第一轮回答');
});

test('思考状态流转:tool 事件结束思考(无 delta 的纯思考轮)', () => {
  let msgs = [];
  msgs = reduceAgentEvent(msgs, reasoning('思考'));
  msgs = reduceAgentEvent(msgs, tool('search', 'start'));
  assert.equal(msgs[0].reasoning, 'done', '进入工具阶段 → 思考完成');
  assert.deepEqual(msgs[0].tools, [{ name: 'search', status: 'start' }]);
  // done 原位更新不改变思考状态
  msgs = reduceAgentEvent(msgs, tool('search', 'done'));
  assert.equal(msgs[0].reasoning, 'done');
  assert.deepEqual(msgs[0].tools, [{ name: 'search', status: 'done' }]);
});

test('思考状态流转:流结束(done)兜底翻转「思考中」', () => {
  let msgs = [];
  msgs = reduceAgentEvent(msgs, reasoning('思考'));
  assert.equal(msgs[0].reasoning, 'thinking');
  msgs = reduceAgentEvent(msgs, { type: 'done', truncated: false });
  assert.equal(msgs[0].reasoning, 'done', '只有 reasoning 没有 delta/tool → 流结束翻转');
});

test('思考状态不污染:无 reasoning 标记的消息不受 done/error 影响(数组引用不变)', () => {
  const base = [user('问'), { role: 'assistant', content: '答' }];
  const out = reduceAgentEvent(base, { type: 'done', truncated: true });
  const out2 = reduceAgentEvent(base, { type: 'error', code: 'ERROR', message: '' });
  assert.equal(out, base);
  assert.equal(out2, base);
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

// ---------- stripActionJsonBlocks(正文不展示动作 JSON,2026-08-22 ws-navi) ----------

test('stripActionJsonBlocks: 单块连同前置换行移除,前后缀文本保留', () => {
  assert.equal(
    stripActionJsonBlocks('已定位到:\n{"actions":[{"type":"flyTo","payload":{"center":{"lng":120.15,"lat":30.25},"zoom":14}}]}\n希望有帮助'),
    '已定位到:\n希望有帮助',
  );
  assert.equal(
    stripActionJsonBlocks('结果:{"actions":[{"type":"flyTo","payload":{"center":{"lng":120,"lat":30}}}]} 完成'),
    '结果: 完成',
  );
  assert.equal(stripActionJsonBlocks('{"actions":[{"type":"flyTo","payload":{"center":{"lng":120,"lat":30}}}]}'), '');
});

test('stripActionJsonBlocks: 多块全清', () => {
  assert.equal(
    stripActionJsonBlocks('第一块:{"actions":[{"type":"flyTo","payload":{"center":{"lng":1,"lat":2}}}]} 第二块:{"actions":[{"type":"search","payload":{"query":"x"}}]} 结尾'),
    '第一块: 第二块: 结尾',
  );
});

test('stripActionJsonBlocks: 嵌套 payload 花括号配对(字符串内花括号/转义引号不干扰)', () => {
  const nested = '说明:{"actions":[{"type":"drawCircle","payload":{"center":{"lng":120,"lat":30},"radiusMeters":1000}}]} 完毕';
  assert.equal(stripActionJsonBlocks(nested), '说明: 完毕');
  const quoted = '说明:{"actions":[{"type":"search","payload":{"query":"{\\"a\\":1}"}}]} 完毕';
  assert.equal(stripActionJsonBlocks(quoted), '说明: 完毕');
});

test('stripActionJsonBlocks: 残缺块容错(配对失败保留原文;已配对块后残缺 → 只清可配对部分)', () => {
  assert.equal(stripActionJsonBlocks('前缀 {"actions": [{"type":"flyTo"}'), '前缀 {"actions": [{"type":"flyTo"}');
  assert.equal(stripActionJsonBlocks('A:{"actions":[]} B:{"actions":[{'), 'A: B:{"actions":[{');
});

test('stripActionJsonBlocks: 无动作 JSON → 原文不变', () => {
  assert.equal(stripActionJsonBlocks('普通文本'), '普通文本');
  assert.equal(stripActionJsonBlocks(''), '');
  assert.equal(stripActionJsonBlocks('{"foo":"bar"}'), '{"foo":"bar"}');
});
