// Agent 会话存储(ws-panel2):纯函数 + 注入式存储单测。
// 覆盖:create/switch/delete/list/append/标题派生/cap 裁剪/旧历史迁移(含空旧键)/activeId 语义。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SESSION_TITLE,
  LEGACY_HISTORY_KEY,
  SESSIONS_CAP,
  SESSIONS_KEY,
  SESSION_MESSAGES_CAP,
  appendMessage,
  createSession,
  createSessionId,
  deleteSession,
  deriveTitle,
  emptyState,
  listSessions,
  loadSessionState,
  parseLegacyHistory,
  parseState,
  relativeTime,
  saveMessages,
  saveSessionState,
  switchSession,
} from '../src/lib/agent-session-store.ts';

/** 内存版注入式存储(仿 localStorage 子集)。 */
function makeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    _map: store,
  };
}

const NOW = 1_752_000_000_000; // 固定基准(2025-07-16 附近)

function userMsg(content) {
  return { role: 'user', content };
}

function assistantMsg(content) {
  return { role: 'assistant', content };
}

// ---- deriveTitle ----

test('deriveTitle: 首条用户消息截断 12 字(中英文按码点)', () => {
  assert.equal(deriveTitle([userMsg('导航到深圳腾讯大厦')]), '导航到深圳腾讯大厦'); // 8 字,不截
  assert.equal(deriveTitle([userMsg('帮我看看杭州的岗位有哪些推荐')]), '帮我看看杭州的岗位有哪些'); // 12 字截断
  assert.equal(deriveTitle([userMsg('导航到深圳腾讯大厦'), assistantMsg('好的')]), '导航到深圳腾讯大厦');
  assert.equal(deriveTitle([assistantMsg('你好'), userMsg('第二个问题')]), '第二个问题');
  // 码点截断:emoji(代理对)不劈开
  const emojiTitle = deriveTitle([userMsg('🧭' + '🚀'.repeat(11) + '测试')]);
  assert.equal([...emojiTitle].length, 12, 'emoji 按码点截断为 12');
  assert.equal(emojiTitle, '🧭' + '🚀'.repeat(11), '截断边界不劈开代理对');
  assert.equal([...deriveTitle([userMsg('a'.repeat(20))])].length, 12);
  assert.equal(deriveTitle([userMsg('你好世界'.repeat(10))]), '你好世界你好世界你好世界');
});

test('deriveTitle: 无用户消息 → 「新会话」', () => {
  assert.equal(deriveTitle([]), DEFAULT_SESSION_TITLE);
  assert.equal(deriveTitle([assistantMsg('只有助手消息')]), DEFAULT_SESSION_TITLE);
  assert.equal(deriveTitle([userMsg('   ')]), DEFAULT_SESSION_TITLE); // 空内容
});

// ---- createSession / activeId 语义 ----

test('createSession: 新建空会话并置为 active;标题为「新会话」', () => {
  const s0 = emptyState();
  const s1 = createSession(s0, { id: 'a', now: NOW });
  assert.equal(s1.sessions.length, 1);
  assert.equal(s1.sessions[0].id, 'a');
  assert.equal(s1.sessions[0].title, DEFAULT_SESSION_TITLE);
  assert.deepEqual(s1.sessions[0].messages, []);
  assert.equal(s1.sessions[0].updatedAt, NOW);
  assert.equal(s1.activeId, 'a');
  // 原状态不变(不可变)
  assert.equal(s0.sessions.length, 0);
  assert.equal(s0.activeId, null);
});

test('createSession: 新会话在前,active 切换;id 缺省自动生成', () => {
  const s1 = createSession(emptyState(), { id: 'a', now: NOW });
  const s2 = createSession(s1, { id: 'b', now: NOW + 1 });
  assert.deepEqual(s2.sessions.map((s) => s.id), ['b', 'a']);
  assert.equal(s2.activeId, 'b');
  const s3 = createSession(s2);
  assert.equal(typeof s3.activeId, 'string');
  assert.ok(s3.activeId.startsWith('s-'));
});

test('createSession: cap 10,超出丢最旧(updatedAt 最小)', () => {
  let state = emptyState();
  for (let i = 0; i < SESSIONS_CAP; i++) {
    state = createSession(state, { id: `s${i}`, now: NOW + i });
  }
  assert.equal(state.sessions.length, SESSIONS_CAP);
  // 第 11 个:丢 updatedAt 最小的 s0;新会话存活
  state = createSession(state, { id: 's10', now: NOW + 100 });
  assert.equal(state.sessions.length, SESSIONS_CAP);
  assert.ok(state.sessions.every((s) => s.id !== 's0'));
  assert.ok(state.sessions.some((s) => s.id === 's10'));
  assert.equal(state.activeId, 's10');
});

test('createSession: 平局(同 updatedAt)不丢新会话,丢最先生成的', () => {
  let state = createSession(emptyState(), { id: 'a', now: NOW });
  for (let i = 1; i < SESSIONS_CAP; i++) {
    state = createSession(state, { id: `s${i}`, now: NOW }); // 全部同 now
  }
  state = createSession(state, { id: 'last', now: NOW }); // 第 11 个,同 now
  assert.equal(state.sessions.length, SESSIONS_CAP);
  assert.ok(state.sessions.some((s) => s.id === 'last'), '新会话不被丢');
  assert.ok(state.sessions.every((s) => s.id !== 'a'), '丢最先生成的 a');
});

// ---- switchSession ----

test('switchSession: 切换 activeId;未知 id / 已激活 → 原状态不动', () => {
  const s1 = createSession(emptyState(), { id: 'a', now: NOW });
  const s2 = createSession(s1, { id: 'b', now: NOW + 1 });
  const switched = switchSession(s2, 'a');
  assert.equal(switched.activeId, 'a');
  assert.equal(switchSession(s2, 'nope'), s2, '未知 id 返回原状态');
  assert.equal(switchSession(s2, 'b'), s2, '已激活返回原状态');
});

// ---- deleteSession ----

test('deleteSession: 删非当前会话 → active 不变', () => {
  const s1 = createSession(emptyState(), { id: 'a', now: NOW });
  const s2 = createSession(s1, { id: 'b', now: NOW + 1 });
  const del = deleteSession(s2, 'a');
  assert.deepEqual(del.sessions.map((s) => s.id), ['b']);
  assert.equal(del.activeId, 'b');
});

test('deleteSession: 删当前 → 切到最近(updatedAt 最大)', () => {
  const s1 = createSession(emptyState(), { id: 'a', now: NOW });
  const s2 = createSession(s1, { id: 'b', now: NOW + 5 });
  const s3 = createSession(s2, { id: 'c', now: NOW + 10 }); // active = c
  const del = deleteSession(s3, 'c');
  assert.deepEqual(del.sessions.map((s) => s.id), ['b', 'a']);
  assert.equal(del.activeId, 'b'); // 最近 = b
});

test('deleteSession: 删当前,最近平局 → 取列表先出现的', () => {
  const s1 = createSession(emptyState(), { id: 'a', now: NOW });
  const s2 = createSession(s1, { id: 'b', now: NOW + 1 });
  const s3 = createSession(s2, { id: 'c', now: NOW + 2 });
  // 把 b 的 updatedAt 拉到与 a 相同
  const eq = saveMessages(s3, 'b', [], { now: NOW });
  const del = deleteSession(eq, 'c');
  assert.equal(del.activeId, 'b'); // 平局取列表先出现的(b 在 a 前)
});

test('deleteSession: 全删 → 新建空会话(active 指向它)', () => {
  const s1 = createSession(emptyState(), { id: 'a', now: NOW });
  const del = deleteSession(s1, 'a', { id: 'fresh', now: NOW + 1 });
  assert.equal(del.sessions.length, 1);
  assert.equal(del.sessions[0].id, 'fresh');
  assert.equal(del.sessions[0].title, DEFAULT_SESSION_TITLE);
  assert.deepEqual(del.sessions[0].messages, []);
  assert.equal(del.activeId, 'fresh');
});

test('deleteSession: 未知 id → 原状态不动', () => {
  const s1 = createSession(emptyState(), { id: 'a', now: NOW });
  assert.equal(deleteSession(s1, 'nope'), s1);
});

// ---- listSessions ----

test('listSessions: 按 updatedAt 倒序(不改原状态)', () => {
  const s1 = createSession(emptyState(), { id: 'a', now: NOW });
  const s2 = createSession(s1, { id: 'b', now: NOW + 1 });
  const s3 = createSession(s2, { id: 'c', now: NOW + 2 });
  const list = listSessions(s3);
  assert.deepEqual(list.map((s) => s.id), ['c', 'b', 'a']);
  assert.deepEqual(s3.sessions.map((s) => s.id), ['c', 'b', 'a'], '原数组顺序不变');
  list[0].title = 'mutated';
  assert.equal(s3.sessions[0].title, DEFAULT_SESSION_TITLE, '返回副本');
});

// ---- appendMessage ----

test('appendMessage: 追加消息 + 标题派生 + updatedAt 更新', () => {
  const s1 = createSession(emptyState(), { id: 'a', now: NOW });
  const s2 = appendMessage(s1, 'a', userMsg('帮我看看杭州的岗位有哪些推荐'), { now: NOW + 1 });
  assert.equal(s2.sessions[0].messages.length, 1);
  assert.equal(s2.sessions[0].title, '帮我看看杭州的岗位有哪些');
  assert.equal(s2.sessions[0].updatedAt, NOW + 1);
  const s3 = appendMessage(s2, 'a', assistantMsg('好的'), { now: NOW + 2 });
  assert.deepEqual(s3.sessions[0].messages, [userMsg('帮我看看杭州的岗位有哪些推荐'), assistantMsg('好的')]);
  assert.equal(s3.sessions[0].title, '帮我看看杭州的岗位有哪些', '标题只取首条用户消息');
  assert.equal(s3.sessions[0].updatedAt, NOW + 2);
});

test('appendMessage: cap 30 条,超出丢最旧(队首)', () => {
  let state = createSession(emptyState(), { id: 'a', now: NOW });
  for (let i = 0; i < SESSION_MESSAGES_CAP + 5; i++) {
    state = appendMessage(state, 'a', userMsg(`msg-${i}`), { now: NOW + i });
  }
  assert.equal(state.sessions[0].messages.length, SESSION_MESSAGES_CAP);
  assert.equal(state.sessions[0].messages[0].content, 'msg-5'); // 0..4 被丢
  assert.equal(state.sessions[0].messages[29].content, 'msg-34');
  assert.equal(state.sessions[0].title, 'msg-5');
});

test('appendMessage: 未知会话 / 非法消息 → 原状态不动', () => {
  const s1 = createSession(emptyState(), { id: 'a', now: NOW });
  assert.equal(appendMessage(s1, 'nope', userMsg('x')), s1);
  assert.equal(appendMessage(s1, 'a', { role: 'robot', content: 'x' }), s1);
  assert.equal(appendMessage(s1, 'a', null), s1);
});

test('appendMessage: 消息可带 actions/tools,原样保留', () => {
  const s1 = createSession(emptyState(), { id: 'a', now: NOW });
  const msg = {
    role: 'assistant',
    content: '找到了',
    actions: [{ type: 'search', payload: { query: '腾讯' } }],
    tools: [{ name: 'search', status: 'done' }],
  };
  const s2 = appendMessage(s1, 'a', msg, { now: NOW + 1 });
  assert.deepEqual(s2.sessions[0].messages[0], msg);
});

// ---- saveMessages ----

test('saveMessages: 整份替换(流结束快照/清屏语义)', () => {
  const s1 = createSession(emptyState(), { id: 'a', now: NOW });
  const s2 = appendMessage(s1, 'a', userMsg('第一问'), { now: NOW + 1 });
  const s3 = saveMessages(s2, 'a', [userMsg('第二问'), assistantMsg('答')], { now: NOW + 2 });
  assert.deepEqual(s3.sessions[0].messages, [userMsg('第二问'), assistantMsg('答')]);
  assert.equal(s3.sessions[0].title, '第二问');
  assert.equal(s3.sessions[0].updatedAt, NOW + 2);
});

test('saveMessages: 清空 → 标题重置「新会话」;坏行丢弃;cap 30', () => {
  const s1 = createSession(emptyState(), { id: 'a', now: NOW });
  const s2 = appendMessage(s1, 'a', userMsg('旧问题'), { now: NOW + 1 });
  const s3 = saveMessages(s2, 'a', [], { now: NOW + 2 });
  assert.deepEqual(s3.sessions[0].messages, []);
  assert.equal(s3.sessions[0].title, DEFAULT_SESSION_TITLE);
  const many = Array.from({ length: SESSION_MESSAGES_CAP + 3 }, (_, i) => userMsg(`m${i}`));
  const s4 = saveMessages(s3, 'a', [...many, { role: 'bad', content: 'x' }], { now: NOW + 3 });
  assert.equal(s4.sessions[0].messages.length, SESSION_MESSAGES_CAP);
  assert.equal(s4.sessions[0].messages[0].content, 'm3');
  assert.ok(s4.sessions[0].messages.every((m) => m.role !== 'bad'));
});

test('saveMessages: 未知会话 → 原状态不动', () => {
  const s1 = createSession(emptyState(), { id: 'a', now: NOW });
  assert.equal(saveMessages(s1, 'nope', [userMsg('x')]), s1);
});

// ---- parseState / 持久化 round-trip ----

test('parseState: 坏数据 → null;结构不符 → null;部分行损坏 → 丢行', () => {
  assert.equal(parseState(null), null);
  assert.equal(parseState(''), null);
  assert.equal(parseState('not json'), null);
  assert.equal(parseState('{"sessions": 3}'), null);
  assert.equal(parseState('[]'), null);
  assert.equal(parseState('{"sessions": "x"}'), null);
  const raw = JSON.stringify({
    sessions: [
      { id: 'a', title: '好标题', messages: [userMsg('你好'), { role: 'bad', content: 1 }], updatedAt: 1 },
      { id: 'b', updatedAt: 2 }, // 缺 messages → 整行丢
      { role: 'c' }, // 非对象 → 丢
    ],
    activeId: 'a',
  });
  const parsed = parseState(raw);
  assert.equal(parsed.sessions.length, 1);
  assert.deepEqual(parsed.sessions[0].messages, [userMsg('你好')]);
  assert.equal(parsed.activeId, 'a');
});

test('parseState: activeId 无效 → 回落到最近会话;无会话 → null', () => {
  const raw = JSON.stringify({
    sessions: [{ id: 'a', title: 't', messages: [], updatedAt: 1 }],
    activeId: 'ghost',
  });
  assert.equal(parseState(raw).activeId, 'a');
  assert.equal(parseState('{"sessions": [], "activeId": null}').activeId, null);
});

test('saveSessionState / loadSessionState round-trip', () => {
  const storage = makeStorage();
  let state = createSession(emptyState(), { id: 'a', now: NOW });
  state = appendMessage(state, 'a', userMsg('杭州有什么工作'), { now: NOW + 1 });
  saveSessionState(storage, state);
  const loaded = loadSessionState(storage);
  assert.deepEqual(loaded, state);
  assert.ok(storage._map.has(SESSIONS_KEY));
});

test('createSessionId: 唯一且带前缀', () => {
  const ids = new Set(Array.from({ length: 20 }, () => createSessionId()));
  assert.equal(ids.size, 20);
  for (const id of ids) assert.ok(id.startsWith('s-'));
});

// ---- 迁移(旧 dm.agent-history.v1,sessionStorage)----

test('loadSessionState: 无 v1 键 + 旧历史 → 迁为第一个会话(保留消息),旧键清除', () => {
  const storage = makeStorage(); // 无 dm.agent-sessions.v1
  const legacyStorage = makeStorage({
    [LEGACY_HISTORY_KEY]: JSON.stringify([userMsg('导航到深圳腾讯'), assistantMsg('已定位')]),
  });
  const state = loadSessionState(storage, legacyStorage);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.activeId, state.sessions[0].id);
  assert.deepEqual(state.sessions[0].messages, [userMsg('导航到深圳腾讯'), assistantMsg('已定位')]);
  assert.equal(state.sessions[0].title, '导航到深圳腾讯');
  assert.ok(!legacyStorage._map.has(LEGACY_HISTORY_KEY), '迁移后旧键清除');
  assert.ok(storage._map.has(SESSIONS_KEY), '迁移结果已落新键');
  // 幂等:再次 load 直接读 v1,不再动旧键
  const legacy2 = makeStorage({ [LEGACY_HISTORY_KEY]: JSON.stringify([userMsg('x')]) });
  const state2 = loadSessionState(storage, legacy2);
  assert.deepEqual(state2, state);
  assert.ok(legacy2._map.has(LEGACY_HISTORY_KEY), 'v1 存在时旧键不动');
});

test('loadSessionState: 空旧键(空数组/坏 JSON/纯垃圾)→ 空状态,旧键仍清除', () => {
  for (const legacyRaw of ['[]', 'not json', '"str"', '']) {
    const storage = makeStorage();
    const legacyStorage = makeStorage({ [LEGACY_HISTORY_KEY]: legacyRaw });
    const state = loadSessionState(storage, legacyStorage);
    assert.deepEqual(state, emptyState(), `旧键 ${JSON.stringify(legacyRaw)} → 空状态`);
    assert.ok(!legacyStorage._map.has(LEGACY_HISTORY_KEY), '旧键清除');
  }
});

test('loadSessionState: 旧历史消息 cap 30;坏行丢弃', () => {
  const legacyRaw = JSON.stringify([
    ...Array.from({ length: SESSION_MESSAGES_CAP + 3 }, (_, i) => userMsg(`m${i}`)),
    { role: 'bad' },
  ]);
  const storage = makeStorage();
  const legacyStorage = makeStorage({ [LEGACY_HISTORY_KEY]: legacyRaw });
  const state = loadSessionState(storage, legacyStorage);
  assert.equal(state.sessions[0].messages.length, SESSION_MESSAGES_CAP);
  assert.equal(state.sessions[0].messages[0].content, 'm3');
});

test('loadSessionState: v1 存在 → 直接用,不迁移(旧键保留)', () => {
  const v1 = JSON.stringify({
    sessions: [{ id: 'a', title: '已有会话', messages: [userMsg('v1消息')], updatedAt: 1 }],
    activeId: 'a',
  });
  const storage = makeStorage({ [SESSIONS_KEY]: v1 });
  const legacyStorage = makeStorage({ [LEGACY_HISTORY_KEY]: JSON.stringify([userMsg('旧消息')]) });
  const state = loadSessionState(storage, legacyStorage);
  assert.deepEqual(state.sessions[0].messages, [userMsg('v1消息')]);
  assert.ok(legacyStorage._map.has(LEGACY_HISTORY_KEY), 'v1 存在时旧键不碰');
});

test('loadSessionState: v1 损坏 → 回落旧历史迁移', () => {
  const storage = makeStorage({ [SESSIONS_KEY]: '{broken' });
  const legacyStorage = makeStorage({ [LEGACY_HISTORY_KEY]: JSON.stringify([userMsg('旧消息')]) });
  const state = loadSessionState(storage, legacyStorage);
  assert.deepEqual(state.sessions[0].messages, [userMsg('旧消息')]);
});

test('loadSessionState: 无任何存储 → 空状态(SSR 安全)', () => {
  assert.deepEqual(loadSessionState(null), emptyState());
  assert.deepEqual(loadSessionState(undefined, null), emptyState());
});

// ---- parseLegacyHistory ----

test('parseLegacyHistory: 纯解析(数组/坏数据/空)', () => {
  assert.deepEqual(parseLegacyHistory(null), []);
  assert.deepEqual(parseLegacyHistory('nope'), []);
  assert.deepEqual(parseLegacyHistory('{"a":1}'), []);
  assert.deepEqual(parseLegacyHistory(JSON.stringify([userMsg('q'), { role: 'bad', content: 1 }])), [userMsg('q')]);
  assert.deepEqual(parseLegacyHistory(JSON.stringify([])), []);
});

// ---- relativeTime ----

test('relativeTime: 分钟/小时/日期分段', () => {
  assert.deepEqual(relativeTime(NOW, NOW), { kind: 'justNow' });
  assert.deepEqual(relativeTime(NOW, NOW + 30_000), { kind: 'justNow' });
  assert.deepEqual(relativeTime(NOW, NOW + 60_000), { kind: 'minutes', n: 1 });
  assert.deepEqual(relativeTime(NOW, NOW + 59 * 60_000), { kind: 'minutes', n: 59 });
  assert.deepEqual(relativeTime(NOW, NOW + 60 * 60_000), { kind: 'hours', n: 1 });
  assert.deepEqual(relativeTime(NOW, NOW + 23 * 3600_000), { kind: 'hours', n: 23 });
  const d = new Date(NOW);
  const later = NOW + 25 * 3600_000;
  const e = new Date(later);
  assert.deepEqual(relativeTime(NOW, later), { kind: 'date', month: d.getMonth() + 1, day: d.getDate() });
  assert.ok(d.getMonth() !== e.getMonth() || d.getDate() !== e.getDate(), '25 小时后跨日');
  assert.deepEqual(relativeTime(NOW, NOW - 5000), { kind: 'justNow' }); // 未来时间钳 0
});
