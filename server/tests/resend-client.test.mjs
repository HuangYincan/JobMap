// Resend 邮件客户端契约测试(ws-resend-otp)
//
// fetchImpl 注入假实现,确定性覆盖:缺 key / 成功 / 429 重试 / 网络重试 /
// 401/403 / 422 / 模板内容 / randomOtpCode。
// 重试相关用例传 retryDelayMs: 0,避免真实等待。
// withEnv 必须被测试回调 return(测试 runner 才等待 env 恢复)。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EmailAuthError,
  EmailConfigError,
  EmailRateLimitedError,
  EmailSendFailedError,
  sendVerificationEmail,
} from '../src/lib/resend-client.ts';
import {
  buildVerificationEmailHtml,
  buildVerificationEmailText,
  EMAIL_FROM,
  EMAIL_SUBJECT,
} from '../src/lib/verification-email.ts';
import { randomOtpCode } from '../src/lib/session-store.ts';

const KEY = 're_test_resend_key';

async function withEnv(env, fn) {
  const saved = process.env.RESEND_API_KEY;
  if ('RESEND_API_KEY' in env) process.env.RESEND_API_KEY = env.RESEND_API_KEY;
  else delete process.env.RESEND_API_KEY;
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = saved;
  }
}

/** 记录每次调用的 URL 与 init,按 statuses 序列返回固定响应。 */
function fakeFetch(statuses, id = 'msg-1') {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const status = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    return new Response(JSON.stringify({ id }), { status });
  };
  return { calls, impl };
}

const input = { to: 'user@example.com', code: '123456', expiresAt: 1_750_000_000_000 };

test('sendVerificationEmail: 缺 key → EmailConfigError,fetch 零调用', () =>
  withEnv({}, async () => {
    const { calls, impl } = fakeFetch([200]);
    await assert.rejects(sendVerificationEmail(input, { fetchImpl: impl }), EmailConfigError);
    assert.equal(calls.length, 0);
  }));

test('sendVerificationEmail: 200 → 返回 messageId,请求含正确 URL/头/body 且无 key 泄漏', () =>
  withEnv({ RESEND_API_KEY: KEY }, async () => {
    const { calls, impl } = fakeFetch([200]);
    const result = await sendVerificationEmail(input, { fetchImpl: impl });
    assert.deepEqual(result, { messageId: 'msg-1' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.from, EMAIL_FROM);
    assert.equal(body.to, input.to);
    assert.equal(body.subject, EMAIL_SUBJECT);
    assert.ok(body.html.includes(input.code));
    assert.ok(body.text.includes(input.code));
    // body 无 key 泄漏
    assert.ok(!calls[0].init.body.includes(KEY), 'request body must not contain the API key');
  }));

test('sendVerificationEmail: 429 首试 → 重试 → 成功(恰好 2 次调用)', () =>
  withEnv({ RESEND_API_KEY: KEY }, async () => {
    const { calls, impl } = fakeFetch([429, 200]);
    const result = await sendVerificationEmail(input, { fetchImpl: impl, retryDelayMs: 0 });
    assert.deepEqual(result, { messageId: 'msg-1' });
    assert.equal(calls.length, 2);
  }));

test('sendVerificationEmail: 429 双失败 → EmailRateLimitedError(恰好 2 次)', () =>
  withEnv({ RESEND_API_KEY: KEY }, async () => {
    const { calls, impl } = fakeFetch([429, 429]);
    await assert.rejects(sendVerificationEmail(input, { fetchImpl: impl, retryDelayMs: 0 }), EmailRateLimitedError);
    assert.equal(calls.length, 2);
  }));

test('sendVerificationEmail: 网络 throw 首试 → 重试 → 成功(恰好 2 次)', () =>
  withEnv({ RESEND_API_KEY: KEY }, async () => {
    let calls = 0;
    const impl = async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed (test)');
      return new Response(JSON.stringify({ id: 'msg-1' }), { status: 200 });
    };
    const result = await sendVerificationEmail(input, { fetchImpl: impl, retryDelayMs: 0 });
    assert.deepEqual(result, { messageId: 'msg-1' });
    assert.equal(calls, 2);
  }));

test('sendVerificationEmail: 网络 throw 双失败 → EmailSendFailedError', () =>
  withEnv({ RESEND_API_KEY: KEY }, async () => {
    let calls = 0;
    const impl = async () => {
      calls += 1;
      throw new TypeError('fetch failed (test)');
    };
    await assert.rejects(sendVerificationEmail(input, { fetchImpl: impl, retryDelayMs: 0 }), EmailSendFailedError);
    assert.equal(calls, 2);
  }));

test('sendVerificationEmail: 401 与 403 → EmailAuthError(各恰好 1 次,不重试)', () =>
  withEnv({ RESEND_API_KEY: KEY }, async () => {
    for (const status of [401, 403]) {
      const { calls, impl } = fakeFetch([status]);
      await assert.rejects(sendVerificationEmail(input, { fetchImpl: impl }), EmailAuthError);
      assert.equal(calls.length, 1, `status ${status} must not retry`);
    }
  }));

test('sendVerificationEmail: 422 → EmailSendFailedError(恰好 1 次)', () =>
  withEnv({ RESEND_API_KEY: KEY }, async () => {
    const { calls, impl } = fakeFetch([422]);
    await assert.rejects(sendVerificationEmail(input, { fetchImpl: impl }), EmailSendFailedError);
    assert.equal(calls.length, 1);
  }));

test('邮件模板:html/text 均含验证码与 10 分钟提示,subject 常量', () => {
  const code = '042007';
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const html = buildVerificationEmailHtml(code, expiresAt);
  const text = buildVerificationEmailText(code, expiresAt);
  assert.match(html, /042007/);
  assert.match(html, /10 分钟/);
  assert.ok(!html.includes('</style>'), 'must use inline styles only');
  assert.match(text, /042007/);
  assert.match(text, /10 分钟/);
  assert.equal(EMAIL_SUBJECT, '登录验证码');
});

test('randomOtpCode: 6 位数字,含前导零,样本互异', () => {
  const codes = Array.from({ length: 200 }, () => randomOtpCode());
  for (const c of codes) {
    assert.match(c, /^\d{6}$/);
  }
  assert.ok(new Set(codes).size > 150, 'expected mostly distinct codes in 200 samples');
  assert.ok(codes.some((c) => c.startsWith('0')), 'expected at least one leading-zero code in 200 samples');
});
