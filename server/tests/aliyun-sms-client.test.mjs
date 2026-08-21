// 阿里云短信认证客户端契约测试(ws aliyun-sms-send)
//
// fetchImpl 注入假实现,确定性覆盖:缺配置 / 成功(签名可复算) /
// 业务错误码映射 / 网络重试 / HTTP 异常 / requestId 兜底。
// 签名确定性:now / signatureNonce 注入;重试用例传 retryDelayMs: 0。
// withEnv 必须被测试回调 return(测试 runner 才等待 env 恢复)。

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  SmsAuthError,
  SmsConfigError,
  SmsDayLimitedError,
  SmsRateLimitedError,
  SmsSendFailedError,
  sendSmsVerifyCode,
} from '../src/lib/aliyun-sms-client.ts';

const ENV_KEYS = [
  'ALIYUN_ACCESS_KEY_ID',
  'ALIYUN_ACCESS_KEY_SECRET',
  'ALIYUN_SMS_SIGN_NAME',
  'ALIYUN_SMS_TEMPLATE_CODE',
];
const ENV = {
  ALIYUN_ACCESS_KEY_ID: 'ak-test-id',
  ALIYUN_ACCESS_KEY_SECRET: 'ak-test-secret',
  ALIYUN_SMS_SIGN_NAME: '测试签名',
  ALIYUN_SMS_TEMPLATE_CODE: 'SMS_123456',
};

async function withEnv(env, fn) {
  const saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  try {
    for (const key of ENV_KEYS) {
      if (key in env) process.env[key] = env[key];
      else delete process.env[key];
    }
    return await fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

/** 记录每次调用的 URL,按序列返回固定响应({ status?, body? })。 */
function fakeFetch(responses) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(r.body ?? { Code: 'OK', RequestId: 'R1' }), {
      status: r.status ?? 200,
    });
  };
  return { calls, impl };
}

/** RFC3986 严格百分号编码(测试内复算签名用,与 client 同算法)。 */
function percentEncode(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * 复算签名:取 URL query(不含 Signature),字典序重排后按
 * StringToSign = 'GET&%2F&' + percentEncode(canonicalizedQuery)
 * 算 HMAC-SHA1(secret + '&') base64 —— 与 URL 中 Signature 值比对。
 */
function recomputeSignature(url, secret) {
  const rawQuery = String(url).split('?')[1];
  const canonical = rawQuery
    .split('&')
    .filter((pair) => !pair.startsWith('Signature='))
    .sort()
    .join('&');
  const stringToSign = `GET&%2F&${percentEncode(canonical)}`;
  return createHmac('sha1', `${secret}&`).update(stringToSign).digest('base64');
}

const FIXED_NOW = new Date('2026-08-22T08:00:00.123Z');
const NONCE = 'fixed-nonce-123';
const input = { phoneNumber: '13800138000', code: '123456' };

const successOptions = { now: () => FIXED_NOW, signatureNonce: NONCE, retryDelayMs: 0 };

test('sendSmsVerifyCode: 缺任一 ALIYUN_* 配置 → SmsConfigError,fetch 零调用', () =>
  withEnv({}, async () => {
    // 全缺
    const { calls, impl } = fakeFetch([{ body: { Code: 'OK' } }]);
    await assert.rejects(sendSmsVerifyCode(input, { fetchImpl: impl }), SmsConfigError);
    assert.equal(calls.length, 0);
    // 逐项缺一个(其余配齐)→ 同样 SmsConfigError
    for (const missing of ENV_KEYS) {
      const env = { ...ENV };
      delete env[missing];
      await withEnv(env, async () => {
        const f = fakeFetch([{ body: { Code: 'OK' } }]);
        await assert.rejects(sendSmsVerifyCode(input, { fetchImpl: f.impl }), SmsConfigError);
        assert.equal(f.calls.length, 0, `missing ${missing} must not call fetch`);
      });
    }
  }));

test('sendSmsVerifyCode: OK → 返回 requestId;URL 参数齐全、签名可复算、无 secret 明文', () =>
  withEnv(ENV, async () => {
    const { calls, impl } = fakeFetch([{ body: { Code: 'OK', RequestId: 'R1' } }]);
    const result = await sendSmsVerifyCode(input, { fetchImpl: impl, ...successOptions });
    assert.deepEqual(result, { requestId: 'R1' });
    assert.equal(calls.length, 1);

    const url = new URL(calls[0]);
    assert.equal(url.origin, 'https://dypnsapi.aliyuncs.com');
    // 公共参数 + 业务参数
    assert.equal(url.searchParams.get('Action'), 'SendSmsVerifyCode');
    assert.equal(url.searchParams.get('Version'), '2017-05-25');
    assert.equal(url.searchParams.get('Format'), 'JSON');
    assert.equal(url.searchParams.get('SignatureMethod'), 'HMAC-SHA1');
    assert.equal(url.searchParams.get('SignatureVersion'), '1.0');
    assert.equal(url.searchParams.get('SignatureNonce'), NONCE);
    assert.equal(url.searchParams.get('Timestamp'), '2026-08-22T08:00:00Z'); // 注入时刻,毫秒被截断
    assert.equal(url.searchParams.get('PhoneNumber'), input.phoneNumber);
    assert.equal(url.searchParams.get('SignName'), ENV.ALIYUN_SMS_SIGN_NAME);
    assert.equal(url.searchParams.get('TemplateCode'), ENV.ALIYUN_SMS_TEMPLATE_CODE);
    // 直接传值模式:模板参数为 {"code":"123456"}
    assert.equal(url.searchParams.get('TemplateParam'), JSON.stringify({ code: input.code }));
    // 签名可复算:与实现同算法重算,证明签名正确
    assert.equal(url.searchParams.get('Signature'), recomputeSignature(calls[0], ENV.ALIYUN_ACCESS_KEY_SECRET));
    // URL 中无 secret 明文(AccessKeyId 是 ID,secret 只参与 HMAC)
    assert.ok(!calls[0].includes(ENV.ALIYUN_ACCESS_KEY_SECRET), 'URL must not contain access key secret');
  }));

test('sendSmsVerifyCode: FREQUENCY_FAIL → SmsRateLimitedError(恰好 1 次,不重试)', () =>
  withEnv(ENV, async () => {
    const { calls, impl } = fakeFetch([{ body: { Code: 'FREQUENCY_FAIL', Message: 'too frequent' } }]);
    await assert.rejects(sendSmsVerifyCode(input, { fetchImpl: impl, ...successOptions }), SmsRateLimitedError);
    assert.equal(calls.length, 1);
  }));

test('sendSmsVerifyCode: BUSINESS_LIMIT_CONTROL → SmsDayLimitedError', () =>
  withEnv(ENV, async () => {
    const { calls, impl } = fakeFetch([{ body: { Code: 'BUSINESS_LIMIT_CONTROL', Message: 'day limit' } }]);
    await assert.rejects(sendSmsVerifyCode(input, { fetchImpl: impl, ...successOptions }), SmsDayLimitedError);
    assert.equal(calls.length, 1);
  }));

test('sendSmsVerifyCode: InvalidAccessKeyId.NotFound → SmsAuthError', () =>
  withEnv(ENV, async () => {
    const { calls, impl } = fakeFetch([{ body: { Code: 'InvalidAccessKeyId.NotFound', Message: 'invalid ak' } }]);
    await assert.rejects(sendSmsVerifyCode(input, { fetchImpl: impl, ...successOptions }), SmsAuthError);
    assert.equal(calls.length, 1);
  }));

test('sendSmsVerifyCode: INVALID_PARAMETERS → SmsSendFailedError', () =>
  withEnv(ENV, async () => {
    const { calls, impl } = fakeFetch([{ body: { Code: 'INVALID_PARAMETERS', Message: 'bad params' } }]);
    await assert.rejects(sendSmsVerifyCode(input, { fetchImpl: impl, ...successOptions }), SmsSendFailedError);
    assert.equal(calls.length, 1);
  }));

test('sendSmsVerifyCode: 网络 throw 首试 → 重试 → 成功(恰好 2 次)', () =>
  withEnv(ENV, async () => {
    let calls = 0;
    const impl = async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed (test)');
      return new Response(JSON.stringify({ Code: 'OK', RequestId: 'R1' }), { status: 200 });
    };
    const result = await sendSmsVerifyCode(input, { fetchImpl: impl, ...successOptions });
    assert.deepEqual(result, { requestId: 'R1' });
    assert.equal(calls, 2);
  }));

test('sendSmsVerifyCode: 网络 throw 双失败 → SmsSendFailedError(恰好 2 次)', () =>
  withEnv(ENV, async () => {
    let calls = 0;
    const impl = async () => {
      calls += 1;
      throw new TypeError('fetch failed (test)');
    };
    await assert.rejects(sendSmsVerifyCode(input, { fetchImpl: impl, ...successOptions }), SmsSendFailedError);
    assert.equal(calls, 2);
  }));

test('sendSmsVerifyCode: HTTP 500 且 body 无 Code → SmsSendFailedError(恰好 1 次,不重试)', () =>
  withEnv(ENV, async () => {
    const { calls, impl } = fakeFetch([{ status: 500, body: { error: 'gateway' } }]);
    await assert.rejects(sendSmsVerifyCode(input, { fetchImpl: impl, ...successOptions }), SmsSendFailedError);
    assert.equal(calls.length, 1);
  }));

test('sendSmsVerifyCode: HTTP 500 且 body 有 Code → 按业务码映射(不重试)', () =>
  withEnv(ENV, async () => {
    const { calls, impl } = fakeFetch([{ status: 500, body: { Code: 'BUSINESS_LIMIT_CONTROL' } }]);
    await assert.rejects(sendSmsVerifyCode(input, { fetchImpl: impl, ...successOptions }), SmsDayLimitedError);
    assert.equal(calls.length, 1);
  }));

test('sendSmsVerifyCode: Code OK 但无 RequestId(Model.BizId) → 成功且 requestId 为空串', () =>
  withEnv(ENV, async () => {
    const { calls, impl } = fakeFetch([{ body: { Code: 'OK', Model: { BizId: 'B1' } } }]);
    const result = await sendSmsVerifyCode(input, { fetchImpl: impl, ...successOptions });
    assert.deepEqual(result, { requestId: '' });
    assert.equal(calls.length, 1);
  }));
