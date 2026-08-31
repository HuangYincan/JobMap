import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_CHAT_MAX_CHARS,
  AGENT_CHAT_MAX_MESSAGES,
  toAgentChatMessages,
} from '../src/lib/agent/chat-messages.ts';
import { MESSAGE_CONTENT_MAX, SESSION_MESSAGES_CAP } from '../src/lib/agent-session-store.ts';

test('chat 上限与会话 cap / 单条上限对齐', () => {
  assert.equal(AGENT_CHAT_MAX_MESSAGES, SESSION_MESSAGES_CAP);
  assert.equal(AGENT_CHAT_MAX_CHARS, MESSAGE_CONTENT_MAX);
});

test('toAgentChatMessages: 21 条未超 cap 原样保留且首条 user', () => {
  const msgs = Array.from({ length: 21 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `m${i}`,
  }));
  const out = toAgentChatMessages(msgs);
  assert.equal(out.length, 21);
  assert.equal(out[0].role, 'user');
  assert.equal(out[20].content, 'm20');
});

test('toAgentChatMessages: 会话已满再追加 → 从最旧裁到 30 且首条 user', () => {
  const msgs = Array.from({ length: 32 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `m${i}`,
  }));
  const out = toAgentChatMessages(msgs);
  assert.equal(out.length, 30);
  assert.equal(out[0].role, 'user');
  assert.equal(out[0].content, 'm2');
  assert.equal(out[29].content, 'm31');
});

test('toAgentChatMessages: 缺 content / 前导 assistant / 超长截断', () => {
  const out = toAgentChatMessages([
    { role: 'assistant', content: 'orphan' },
    { role: 'user' },
    { role: 'assistant', content: 'a'.repeat(AGENT_CHAT_MAX_CHARS + 8) },
    { role: 'system', content: 'drop' },
    { role: 'user', content: 'ok' },
  ]);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { role: 'user', content: '' });
  assert.equal(out[1].role, 'assistant');
  assert.equal(out[1].content.length, AGENT_CHAT_MAX_CHARS);
  assert.deepEqual(out[2], { role: 'user', content: 'ok' });
});

test('toAgentChatMessages: 非数组 / 空 → []', () => {
  assert.deepEqual(toAgentChatMessages(null), []);
  assert.deepEqual(toAgentChatMessages([]), []);
  assert.deepEqual(toAgentChatMessages([{ role: 'assistant', content: 'only' }]), []);
});
