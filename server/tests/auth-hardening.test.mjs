// ============================================================
// 认证安全加固(scan 批次 A:ws-a)
//   #1 OTP 单次消费契约(DB 模式可重放缺陷,account-store consumeOtp)
//   #2 OTP 发送 per-IP / per-账号 24h 桶(checkOtpSendLimits)
//   #3  密码登录防爆破(route 滑动窗口)+ 查无此人 dummy verify(时间侧信道)
//   #4  SESSION_SECRET:生产必配 / 非生产 boot 随机并与 oauth-state 统一
//
// 参照仓库既有模式(otp-guard / account-security / oauth):
//   - store 层直测:__accountStoreTest.poolOverride 注入 fake 池 / 强制内存模式;
//   - route 薄壳用 readFileSync + 正则断言守卫(route.ts 用 next/server + `@/`
//     别名,node:test 无法直接 import,仓库既有契约)。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  __accountStoreTest,
  bindPhone as storeBindPhone,
  checkOtpSendLimits as storeCheckOtpSendLimits,
  consumeOtp as storeConsumeOtp,
  issueOtp as storeIssueOtp,
  loginWithPassword as storeLogin,
  otpRateConfig,
  OtpRateLimitedError,
  upsertIdentity as storeUpsert,
} from '../src/lib/account-store.ts';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
function src(rel) {
  return readFileSync(join(srcRoot, rel), 'utf8');
}

/** 模拟 auth_otp_challenges 的 DB fake 池:按 code_hash 匹配、consumed 即失效。 */
function otpDbPool() {
  let seq = 0;
  const challenges = [];
  return {
    query: async (sql, params = []) => {
      if (sql.includes('DELETE FROM auth_otp_challenges')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('INSERT INTO auth_otp_challenges')) {
        challenges.push({
          id: String(++seq),
          provider: params[0],
          target: params[1],
          codeHash: params[2],
          expiresAtMs: params[3],
          consumed: false,
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM auth_otp_challenges') && sql.includes('code_hash')) {
        const row = challenges.find(
          (c) =>
            !c.consumed &&
            c.provider === params[0] &&
            c.target === params[1] &&
            c.expiresAtMs > Date.now() &&
            c.codeHash === params[2],
        );
        return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.includes('UPDATE auth_otp_challenges SET consumed_at')) {
        const hit = challenges.find((c) => c.id === params[0]);
        if (hit) hit.consumed = true;
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected SQL in otp fake pool: ${sql}`);
    },
  };
}

// ============================================================
// #1 OTP 单次消费契约
// ============================================================

test('#1 内存模式:同一 code 二次 consume 必 false', async () => {
  __accountStoreTest.poolOverride = () => null;
  try {
    const target = `mem-single-${Date.now()}@test.local`;
    const { code } = await storeIssueOtp('email', target);
    assert.equal(await storeConsumeOtp('email', target, code), true);
    assert.equal(await storeConsumeOtp('email', target, code), false);
  } finally {
    __accountStoreTest.poolOverride = undefined;
  }
});

test('#1 DB 模式:同一 code 二次 consume 必 false(成功路径已消费内存挑战,不可重放)', async () => {
  // poolOverride 每次调用 getPoolForCall 都会取一次:必须共享同一池实例(状态在池内)。
  const pool = otpDbPool();
  __accountStoreTest.poolOverride = () => pool;
  try {
    const target = `db-single-${Date.now()}@test.local`;
    const { code } = await storeIssueOtp('email', target);
    assert.equal(await storeConsumeOtp('email', target, code), true);
    assert.equal(await storeConsumeOtp('email', target, code), false);
    // 独立 target 不受影响:错码 false → 正确码 true(原契约保持)
    const t2 = `db-single2-${Date.now()}@test.local`;
    const { code: code2 } = await storeIssueOtp('email', t2);
    assert.equal(await storeConsumeOtp('email', t2, '000000'), false);
    assert.equal(await storeConsumeOtp('email', t2, code2), true);
  } finally {
    __accountStoreTest.poolOverride = undefined;
  }
});

// ============================================================
// #2 OTP 发送 per-IP / per-账号 24h 桶
// ============================================================

test('#2 per-IP 24h 发送桶:同 IP 轮换 target 超出即限流(429 语义)', async () => {
  __accountStoreTest.poolOverride = () => null;
  const prev = { ...otpRateConfig };
  otpRateConfig.ipDailyLimit = 2;
  try {
    const stamp = Date.now();
    const ip = `test-ip-${stamp}-1`;
    await storeCheckOtpSendLimits(ip, 'email', `a-${stamp}@test.local`);
    await storeCheckOtpSendLimits(ip, 'phone', `138${String(stamp).slice(-8)}`);
    await assert.rejects(
      storeCheckOtpSendLimits(ip, 'email', `c-${stamp}@test.local`),
      (err) => err instanceof OtpRateLimitedError && err.retryAfterMs > 0,
    );
  } finally {
    Object.assign(otpRateConfig, prev);
    __accountStoreTest.poolOverride = undefined;
  }
});

test('#2 per-账号 24h 发送桶:同一用户的手机/邮箱共享;未绑定 target 独立', async () => {
  __accountStoreTest.poolOverride = () => null;
  const prev = { ...otpRateConfig };
  otpRateConfig.accountDailyLimit = 2;
  try {
    const stamp = Date.now();
    const email = `acct-${stamp}@test.local`;
    const phone = `138${String(stamp).slice(-8)}`;
    const ip = `acct-ip-${stamp}-1`;
    const user = await storeUpsert({ provider: 'email', subject: email, email });
    await storeBindPhone(user.id, phone);

    await storeCheckOtpSendLimits(ip, 'email', email);
    await storeCheckOtpSendLimits(ip, 'email', email.toUpperCase()); // 规范化后同账号
    // 换手机号仍共享同一账号桶 → 超出(防同账号两标识轮流发送翻倍配额)
    await assert.rejects(storeCheckOtpSendLimits(ip, 'phone', phone), OtpRateLimitedError);
    // 未绑定 target 使用独立账号桶(同 IP 未超时不受影响)
    await storeCheckOtpSendLimits(ip, 'email', `fresh-${stamp}@test.local`);
  } finally {
    Object.assign(otpRateConfig, prev);
    __accountStoreTest.poolOverride = undefined;
  }
});

test('#2 DB 模式:账号桶按 auth_identities 解析(user_id 相同即共享)', async () => {
  __accountStoreTest.poolOverride = () => ({
    query: async (sql) => {
      if (sql.includes('FROM auth_identities')) return { rows: [{ user_id: '42' }], rowCount: 1 };
      throw new Error(`unexpected SQL: ${sql}`);
    },
  });
  const prev = { ...otpRateConfig };
  otpRateConfig.accountDailyLimit = 2;
  try {
    const ip = `db-acct-ip-${Date.now()}`;
    await storeCheckOtpSendLimits(ip, 'email', 'bound-a@test.local');
    await storeCheckOtpSendLimits(ip, 'phone', '13800001111');
    await assert.rejects(storeCheckOtpSendLimits(ip, 'email', 'bound-c@test.local'), OtpRateLimitedError);
  } finally {
    Object.assign(otpRateConfig, prev);
    __accountStoreTest.poolOverride = undefined;
  }
});

test('#2 otp/send 路由:per-IP / per-账号桶接线在 issueOtp 之前', () => {
  const route = src('app/api/auth/otp/send/route.ts');
  assert.match(route, /checkOtpSendLimits\(clientIp\(request\), provider, target\)/);
  assert.match(route, /function clientIp\(request: Request\)/);
  const guardIdx = route.indexOf('checkOtpSendLimits(clientIp(request), provider, target)');
  const issueIdx = route.indexOf('await issueOtp(provider, target)');
  assert.ok(guardIdx !== -1 && issueIdx !== -1 && guardIdx < issueIdx, '桶校验先于 issueOtp');
});

// ============================================================
// #3 密码登录防爆破 + 查无此人 dummy verify
// ============================================================

test('#3 密码登录路由:429 防爆破滑动窗口接线(守卫先于 scrypt)', () => {
  const route = src('app/api/auth/password/login/route.ts');
  assert.match(route, /LOGIN_MAX_FAILURES/);
  assert.match(route, /LOGIN_IP_MAX_FAILURES/);
  assert.match(route, /LOGIN_ATTEMPT_WINDOW_MS = 15 \* 60 \* 1000/);
  assert.match(route, /const loginGuards = new Map<string, LoginGuard>\(\)/);
  assert.match(route, /checkLoginRateLimit\(ipKey\)/);
  assert.match(route, /recordLoginFailure\(ipKey, LOGIN_IP_MAX_FAILURES\)/);
  assert.match(route, /clearLoginFailures\(ipKey\)/);
  assert.match(route, /clientIp\(request\)/);
  assert.match(route, /code: 'TOO_MANY_ATTEMPTS'/);
  assert.match(route, /status: 429/);
  assert.match(route, /retryAfterMs/);
  const guardIdx = route.indexOf('checkLoginRateLimit(accountKey)');
  const loginIdx = route.indexOf('loginWithPassword(username, password)');
  assert.ok(guardIdx !== -1 && loginIdx !== -1 && guardIdx < loginIdx, '限流先于密码校验(锁定期不跑 scrypt)');
  // 原契约保持:统一 401 语义,不泄露账号存在性
  assert.match(route, /code: 'INVALID_CREDENTIALS'/);
  assert.match(route, /status: 401/);
  assert.match(route, /invalid username or password/);
});

test('#3/#17 查无此人 dummy verify:DB(account-store)与内存(session-store)两路径均抹平时序', () => {
  const store = src('lib/account-store.ts');
  const mem = src('lib/session-store.ts');
  assert.match(store, /dummyVerifyPassword\(password\)/);
  assert.match(mem, /dummyVerifyPassword\(password\)/);
  assert.match(store, /hashPassword\('domain-map-dummy-verify'\)/);
  assert.match(mem, /hashPassword\('domain-map-dummy-verify'\)/);
  // 内存路径登录失败语义不变(统一 null)
  assert.match(mem, /if \(!user\?\.passwordHash\) \{/);
});

test('#3 行为:未知账号登录仍统一返回 null(dummy 校验不改变契约)', async () => {
  __accountStoreTest.poolOverride = () => null;
  try {
    assert.equal(await storeLogin(`ghost-${Date.now()}@test.local`, 'password-123'), null);
  } finally {
    __accountStoreTest.poolOverride = undefined;
  }
});
