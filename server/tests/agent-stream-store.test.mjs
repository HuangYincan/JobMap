// 每会话独立流状态纯函数单测(ws-pstream:agent 会话并行流,切换不打断)。
//
// 矩阵:并发两会话流互不打断、done 只落该会话、finishStream 完成判定
// (done → 'done' / 停止 → 'stopped' / 其他 → null)、删会话终止流、卸载清理
// abort 全部、未知 sessionId no-op(迟到事件安全落空)、重发覆盖建流。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  abortAllStreams,
  createSessionStream,
  finishStream,
  getStreamMessages,
  isStreaming,
  markDone,
  markStreamError,
  removeStream,
  routeAction,
  routeDelta,
  routeTool,
  startStream,
  stopStream,
} from '../src/lib/agent-stream-store.ts';
import { resolveCompletion } from '../src/components/agent-map-executor.ts';

const EMPTY = new Map();
const sidA = 's-a';
const sidB = 's-b';
const user = (content) => ({ role: 'user', content });
const toolInfo = (status) => ({ name: 'search', status });
const action = { type: 'flyTo', payload: { center: { lng: 120, lat: 30 } } };

test('startStream:建流 streaming=true + controller + 消息种子;重发同会话覆盖建流(状态清零)', () => {
  const c1 = new AbortController();
  const m1 = startStream(EMPTY, sidA, c1, [user('问')]);
  const e1 = m1.get(sidA);
  assert.ok(e1, 'entry 存在');
  assert.equal(e1.streaming, true);
  assert.equal(e1.controller, c1);
  assert.deepEqual(e1.messages, [user('问')]);
  assert.equal(e1.completion, null);
  assert.equal(e1.done, false);
  assert.equal(e1.truncated, false);
  assert.equal(e1.notConfigured, false);
  assert.equal(e1.fatalError, null);
  assert.equal(e1.tool, null);
  assert.equal(m1.size, 1);
  // 覆盖式:同一会话新一轮,旧 entry 被替换(旧 controller 不再被引用)
  const c2 = new AbortController();
  const m2 = startStream(m1, sidA, c2, [user('问'), { role: 'user', content: '再问' }]);
  assert.equal(m2.get(sidA).controller, c2);
  assert.equal(m2.get(sidA).messages.length, 2);
  assert.equal(m2.size, 1);
});

test('并发两会话流互不打断:delta/tool/action 只路由到所属会话', () => {
  let m = startStream(EMPTY, sidA, new AbortController(), [user('问A')]);
  m = startStream(m, sidB, new AbortController(), [user('问B')]);
  // A 流事件:A 消息增长,B 原样
  m = routeDelta(m, sidA, '回答A1');
  m = routeDelta(m, sidA, '回答A1续');
  m = routeTool(m, sidA, toolInfo('start'));
  m = routeTool(m, sidA, toolInfo('done'));
  m = routeAction(m, sidA, action);
  assert.deepEqual(m.get(sidA).messages, [
    user('问A'),
    {
      role: 'assistant',
      content: '回答A1回答A1续',
      tools: [{ name: 'search', status: 'done' }],
      actions: [action],
    },
  ]);
  assert.deepEqual(m.get(sidB).messages, [user('问B')], 'B 流不受 A 事件影响');
  // B 流事件:B 消息增长,A 原样(交错路由各自独立)
  m = routeDelta(m, sidB, '回答B1');
  assert.equal(m.get(sidB).messages[1].content, '回答B1');
  assert.equal(m.get(sidA).messages[1].content, '回答A1回答A1续');
  assert.equal(m.get(sidA).streaming, true);
  assert.equal(m.get(sidB).streaming, true);
});

test('done 只落该会话:markDone 置 done/truncated/completion,另一会话不受影响', () => {
  let m = startStream(EMPTY, sidA, new AbortController(), []);
  m = startStream(m, sidB, new AbortController(), []);
  m = routeDelta(m, sidA, 'A 完成内容');
  m = markDone(m, sidA, true);
  const a = m.get(sidA);
  assert.equal(a.done, true);
  assert.equal(a.truncated, true);
  assert.equal(a.completion, 'done');
  assert.equal(a.streaming, true, 'done 事件不置 streaming(false 由 finishStream 落定)');
  assert.equal(a.messages.length, 1);
  const b = m.get(sidB);
  assert.equal(b.done, false, 'B 不受 A 的 done 影响');
  assert.equal(b.completion, null);
  assert.equal(b.truncated, false);
  assert.equal(b.messages.length, 0);
});

test('finishStream 完成判定:done → done / 停止 → stopped / 静默 → null;streaming=false', () => {
  // done 事件已到 → 'done'(abort 不影响已完成的判定)
  let m = startStream(EMPTY, sidA, new AbortController(), []);
  m = markDone(m, sidA, false);
  m = finishStream(m, sidA, true);
  assert.equal(m.get(sidA).streaming, false);
  assert.equal(m.get(sidA).completion, 'done');
  // 用户停止(abort)未收到 done → 'stopped'
  m = startStream(EMPTY, sidA, new AbortController(), []);
  m = finishStream(m, sidA, true);
  assert.equal(m.get(sidA).completion, 'stopped');
  assert.equal(m.get(sidA).streaming, false);
  // 异常/静默结束 → null
  m = startStream(EMPTY, sidA, new AbortController(), []);
  m = finishStream(m, sidA, false);
  assert.equal(m.get(sidA).completion, null);
  // 与 executor resolveCompletion 同款规则(行为等价)
  assert.equal(resolveCompletion(true, true), 'done');
});

test('routeTool 顶部状态条 per-session:start 置 tool,done/error 清空;仅本会话', () => {
  let m = startStream(EMPTY, sidA, new AbortController(), []);
  m = startStream(m, sidB, new AbortController(), []);
  m = routeTool(m, sidA, toolInfo('start'));
  assert.deepEqual(m.get(sidA).tool, toolInfo('start'));
  assert.equal(m.get(sidB).tool, null, 'B 顶部状态条不受影响');
  m = routeTool(m, sidA, toolInfo('done'));
  assert.equal(m.get(sidA).tool, null, 'done/error 清空顶部状态条');
  assert.equal(m.get(sidA).messages[0].tools[0].status, 'done');
});

test('markStreamError per-session:notConfigured/fatalError 只落本会话,另一会话不受影响', () => {
  let m = startStream(EMPTY, sidA, new AbortController(), []);
  m = startStream(m, sidB, new AbortController(), []);
  m = markStreamError(m, sidA, { notConfigured: true, fatalText: null });
  assert.equal(m.get(sidA).notConfigured, true);
  assert.equal(m.get(sidA).fatalError, null);
  assert.equal(m.get(sidB).notConfigured, false, 'B 不受 A 的 error 影响');
  m = markStreamError(m, sidB, { notConfigured: false, fatalText: '出错了' });
  assert.equal(m.get(sidB).fatalError, '出错了');
  assert.equal(m.get(sidA).fatalError, null);
});

test('stopStream 只 abort 本会话 controller,其余会话不受影响', () => {
  const ca = new AbortController();
  const cb = new AbortController();
  let m = startStream(EMPTY, sidA, ca, []);
  m = startStream(m, sidB, cb, []);
  stopStream(m, sidA);
  assert.equal(ca.signal.aborted, true, 'A 流已终止');
  assert.equal(cb.signal.aborted, false, 'B 流不受影响');
});

test('removeStream 删除会话:终止流 + 移除 entry;之后迟到事件 no-op 且不重建', () => {
  const c = new AbortController();
  let m = startStream(EMPTY, sidA, c, [user('问')]);
  const m2 = removeStream(m, sidA);
  assert.equal(c.signal.aborted, true, '删除会话终止其流');
  assert.equal(m2.has(sidA), false, 'entry 已移除');
  // 迟到事件(done/finally)在 entry 缺失时 no-op,且返回原 map 引用(不重建)
  const afterDone = markDone(m2, sidA, false);
  assert.equal(afterDone, m2, 'markDone no-op 返回原引用');
  const afterFinish = finishStream(m2, sidA, true);
  assert.equal(afterFinish, m2, 'finishStream no-op 返回原引用');
  assert.equal(afterFinish.has(sidA), false, '不重建已删会话的 entry');
  const afterDelta = routeDelta(m2, sidA, '迟到的 delta');
  assert.equal(afterDelta, m2);
  // 删除非当前会话:其余流原样
  let m3 = startStream(EMPTY, sidA, new AbortController(), []);
  m3 = startStream(m3, sidB, new AbortController(), []);
  m3 = removeStream(m3, sidA);
  assert.equal(m3.has(sidA), false);
  assert.equal(m3.has(sidB), true);
  assert.equal(m3.get(sidB).streaming, true);
});

test('abortAllStreams 卸载清理:abort 全部流 controller', () => {
  const ca = new AbortController();
  const cb = new AbortController();
  let m = startStream(EMPTY, sidA, ca, []);
  m = startStream(m, sidB, cb, []);
  abortAllStreams(m);
  assert.equal(ca.signal.aborted, true);
  assert.equal(cb.signal.aborted, true);
});

test('isStreaming / getStreamMessages:流式中为 true / 未建流为 false;消息取内存', () => {
  let m = startStream(EMPTY, sidA, new AbortController(), [user('问')]);
  assert.equal(isStreaming(m, sidA), true);
  assert.equal(isStreaming(m, sidB), false, '未建流会话非流式');
  assert.equal(isStreaming(m, null), false);
  m = finishStream(m, sidA, false);
  assert.equal(isStreaming(m, sidA), false, '结束后非流式');
  assert.deepEqual(getStreamMessages(m, sidA), [user('问')]);
  assert.equal(getStreamMessages(m, sidB), null, '无流会话取消息 → null');
  m = removeStream(m, sidA);
  assert.equal(getStreamMessages(m, sidA), null);
});

test('createSessionStream:全字段初始值', () => {
  const s = createSessionStream(new AbortController());
  assert.equal(s.streaming, true);
  assert.deepEqual(s.messages, []);
  assert.equal(s.done, false);
  assert.equal(s.completion, null);
  assert.equal(s.truncated, false);
  assert.equal(s.notConfigured, false);
  assert.equal(s.fatalError, null);
  assert.equal(s.tool, null);
});
