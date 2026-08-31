// OTP 限流 / 尝试上限 / 过期清理 + withDb 写路径不静默降级(ws-qa2)
//
// account-store 是 DB+内存双实现:单测通过 __accountStoreTest.poolOverride
// 注入 fake 池(模拟 DB 故障)或强制内存模式,确定性覆盖两条路径。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  __accountStoreTest,
  addHistory as storeAddHistory,
  consumeOtp as storeConsumeOtp,
  createSession as storeCreateSession,
  DbUnavailableError,
  enqueueNotification as storeEnqueueNotification,
  getSessionUser as storeGetSessionUser,
  issueOtp as storeIssueOtp,
  listHistory as storeListHistory,
  listSaved as storeListSaved,
  otpRateConfig,
  OtpRateLimitedError,
  OtpTooManyAttemptsError,
  recordApplication as storeRecordApplication,
  savePlace as storeSavePlace,
  updateUser as storeUpdateUser,
  upsertIdentity as storeUpsert,
} from '../src/lib/account-store.ts';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

// 模拟 DB 不可用的 fake 池:query 一律抛错。
const failingPool = {
  query: async () => {
    throw new Error('connection refused (test)');
  },
  connect: async () => ({
    query: async () => {
      throw new Error('connection refused (test)');
    },
    release() {},
  }),
};

test('issueOtp rate-limits the same target within 60s (cooldown)', async () => {
  __accountStoreTest.poolOverride = () => null; // 内存模式
  const target = `cooldown-${Date.now()}@test.local`;
  await storeIssueOtp('email', target);
  await assert.rejects(storeIssueOtp('email', target), (err) => {
    assert.ok(err instanceof OtpRateLimitedError, 'expected OtpRateLimitedError');
    assert.ok(err.retryAfterMs > 0 && err.retryAfterMs <= 60_000);
    return true;
  });
});

test('issueOtp enforces the 24h daily send cap', async () => {
  __accountStoreTest.poolOverride = () => null;
  const prev = { ...otpRateConfig };
  otpRateConfig.cooldownMs = 0; // 缩小窗口才能快速连发
  otpRateConfig.dailyLimit = 3;
  try {
    const target = `daily-${Date.now()}@test.local`;
    for (let i = 0; i < 3; i++) {
      await storeIssueOtp('email', target);
    }
    await assert.rejects(storeIssueOtp('email', target), (err) => {
      assert.ok(err instanceof OtpRateLimitedError);
      assert.ok(err.retryAfterMs > 0);
      return true;
    });
  } finally {
    Object.assign(otpRateConfig, prev);
  }
});

test('consumeOtp locks the target after 5 wrong attempts (15min)', async () => {
  __accountStoreTest.poolOverride = () => null;
  const target = `lock-${Date.now()}@test.local`;
  await storeIssueOtp('email', target);
  for (let i = 0; i < 4; i++) {
    assert.equal(await storeConsumeOtp('email', target, '111111'), false);
  }
  // 第 5 次错误 → 触发锁并抛 429 语义错误
  await assert.rejects(storeConsumeOtp('email', target, '111111'), (err) => {
    assert.ok(err instanceof OtpTooManyAttemptsError);
    assert.ok(err.retryAfterMs > 0);
    return true;
  });
  // 锁定期内:正确码也被拒,连 send 也被拒(码值无关,固定字面量即可)
  await assert.rejects(storeConsumeOtp('email', target, '000000'), OtpTooManyAttemptsError);
  await assert.rejects(storeIssueOtp('email', target), OtpTooManyAttemptsError);
});

test('correct code resets the wrong-attempt counter', async () => {
  __accountStoreTest.poolOverride = () => null;
  const prev = { ...otpRateConfig };
  otpRateConfig.cooldownMs = 0;
  try {
    const target = `reset-${Date.now()}@test.local`;
    const { code } = await storeIssueOtp('email', target);
    for (let i = 0; i < 4; i++) {
      assert.equal(await storeConsumeOtp('email', target, '111111'), false);
    }
    // 第 5 次用正确码 → 成功并清零计数(email 为随机码,用 issueOtp 返回值)
    assert.equal(await storeConsumeOtp('email', target, code), true);
    await storeIssueOtp('email', target);
    // 若未清零,再 1 次错误就到 5 直接抛;清零后前 4 次只是普通失败
    for (let i = 0; i < 4; i++) {
      assert.equal(await storeConsumeOtp('email', target, '222222'), false);
    }
  } finally {
    Object.assign(otpRateConfig, prev);
  }
});

test('issueOtp sweeps expired challenge rows for the target before insert (DB path)', async () => {
  // DB 路径:插入前先清理过期行;SQL 与 consumeOtp 的清扫同款(见 account.test.mjs 契约断言)
  let sqlCalls = [];
  __accountStoreTest.poolOverride = () => {
    const client = {
      query: async (sql) => {
        sqlCalls.push(sql);
        return { rows: [], rowCount: 0 };
      },
      release() {},
    };
    return { connect: async () => client };
  };
  try {
    await storeIssueOtp('phone', '13800138000');
  } finally {
    __accountStoreTest.poolOverride = undefined;
  }
  assert.ok(
    sqlCalls.some((sql) => sql.includes('DELETE FROM auth_otp_challenges WHERE provider = $1 AND target = $2 AND expires_at <= now()')),
    'expected expired-row sweep before insert',
  );
});

test('write paths throw DbUnavailableError instead of silently degrading to memory', async () => {
  __accountStoreTest.poolOverride = () => failingPool;
  try {
    const target = `w-${Date.now()}@test.local`;
    await assert.rejects(storeIssueOtp('email', target), DbUnavailableError);
    await assert.rejects(storeConsumeOtp('email', target, '000000'), DbUnavailableError);
    await assert.rejects(storeUpsert({ provider: 'email', subject: target, email: target }), DbUnavailableError);
    await assert.rejects(
      storeSavePlace('1', { poiId: 'p1', name: 'x', mode: 'work', kind: 'recruitment' }),
      DbUnavailableError,
    );
    await assert.rejects(
      storeRecordApplication('1', { positionId: 'p1', companyPoiId: 'c1', title: 't', companyName: 'c' }),
      DbUnavailableError,
    );
    await assert.rejects(
      storeEnqueueNotification('1', { kind: 'job', positionId: 'p1', companyPoiId: 'c1', title: 't' }),
      DbUnavailableError,
    );
    await assert.rejects(storeCreateSession('1'), DbUnavailableError);
    await assert.rejects(storeAddHistory('1', '西溪', 'work'), DbUnavailableError);
    await assert.rejects(storeUpdateUser('1', { displayName: 'x' }), DbUnavailableError);
  } finally {
    __accountStoreTest.poolOverride = undefined;
  }
});

test('read paths still fall back to memory on DB failure', async () => {
  __accountStoreTest.poolOverride = () => null; // 内存模式落数据
  const target = `r-${Date.now()}@test.local`;
  const user = await storeUpsert({ provider: 'email', subject: target, email: target });
  await storeSavePlace(user.id, { poiId: 'alibaba-xixi', name: '阿里巴巴', mode: 'work', kind: 'recruitment' });
  const { token } = await storeCreateSession(user.id);

  __accountStoreTest.poolOverride = () => failingPool; // DB 故障
  try {
    const saved = await storeListSaved(user.id); // 读 → 降级内存,不抛
    assert.equal(saved.length, 1);
    assert.equal(saved[0].poiId, 'alibaba-xixi');
    assert.ok(Array.isArray(await storeListHistory(user.id)));
    assert.equal((await storeGetSessionUser(token))?.id, user.id);
  } finally {
    __accountStoreTest.poolOverride = undefined;
  }
});

test('send/verify routes map rate-limit to 429, DB failure to 503, phone SMS errors to SMS_*', () => {
  const send = readFileSync(join(srcRoot, 'app/api/auth/otp/send/route.ts'), 'utf8');
  const verify = readFileSync(join(srcRoot, 'app/api/auth/otp/verify/route.ts'), 'utf8');
  assert.match(send, /RATE_LIMITED/);
  assert.match(send, /TOO_MANY_ATTEMPTS/);
  assert.match(send, /status: 429/);
  assert.match(send, /DB_UNAVAILABLE/);
  assert.match(send, /status: 503/);
  assert.match(send, /requestId/); // phone 经阿里云短信真发,返回 requestId(不再有 demo/hint)
  assert.doesNotMatch(send, /demo|hint/);
  assert.match(send, /messageId/); // email 真发返回 messageId
  assert.match(send, /EMAIL_NOT_CONFIGURED/);
  assert.match(send, /EMAIL_RATE_LIMITED/);
  assert.match(send, /EMAIL_PROVIDER_ERROR/);
  assert.match(send, /EMAIL_SEND_FAILED/);
  assert.match(send, /SMS_NOT_CONFIGURED/);
  assert.match(send, /SMS_RATE_LIMITED/);
  assert.match(send, /SMS_DAY_LIMITED/);
  assert.match(send, /SMS_PROVIDER_ERROR/);
  assert.match(send, /SMS_SEND_FAILED/);
  assert.match(verify, /TOO_MANY_ATTEMPTS/);
  assert.match(verify, /status: 429/);
  assert.match(verify, /DB_UNAVAILABLE/);
  assert.match(verify, /status: 503/);
  assert.match(verify, /INVALID_CODE/);
});
