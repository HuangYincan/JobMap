// ============================================================
// 账号安全后端 API(ws-backend):邮箱密码登录 + 改密 + 换绑手机/邮箱
//
// 参照仓库既有模式(oauth.test.mjs / otp-guard.test.mjs):
//   - 行为逻辑全部在 store 层直测(memory 模式,__accountStoreTest.poolOverride
//     = () => null 强制走 session-store;23505 占用走 fake 池)。
//   - route 薄壳用 readFileSync + 正则断言守卫(401/400/409/429/503 码与接线)。
// route.ts 使用 next/server + `@/` 别名,node:test 无法直接 import(仓库既有契约)。
// ============================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  __accountStoreTest,
  bindEmail as storeBindEmail,
  bindPhone as storeBindPhone,
  consumeOtp as storeConsumeOtp,
  createSession as storeCreateSession,
  EmailTakenError,
  getSessionUser as storeGetSessionUser,
  issueOtp as storeIssueOtp,
  loginWithPassword as storeLogin,
  PhoneTakenError,
  registerWithPassword as storeRegister,
  setPassword as storeSetPassword,
  upsertIdentity as storeUpsert,
  verifyUserPassword as storeVerifyPassword,
} from '../src/lib/account-store.ts';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function src(rel) {
  return readFileSync(join(srcRoot, rel), 'utf8');
}

function memoryMode() {
  __accountStoreTest.poolOverride = () => null;
  return () => {
    __accountStoreTest.poolOverride = undefined;
  };
}

// ============================================================
// 1. loginWithPassword 支持邮箱(username 登录保持)
// ============================================================

test('password register: body limit + registration rate limit precede scrypt and durable writes', () => {
  const route = src('app/api/auth/password/register/route.ts');
  assert.match(route, /const MAX_BODY_CHARS = 4 \* 1024/);
  assert.match(route, /readJsonBody<typeof body>\(request, MAX_BODY_CHARS\)/);
  assert.match(route, /RequestBodyTooLargeError/);
  assert.match(route, /const REGISTER_MAX_PER_KEY = 5/);
  assert.match(route, /registrationAttempts = new BoundedRateStore<number\[\]>\(/);
  assert.match(route, /REGISTRATION_GUARD_CAPACITY = 10_000/);
  assert.match(route, /clientIpBucketKey\(request, await readSessionToken\(\)\)/);

  const parseIdx = route.indexOf('readJsonBody<typeof body>');
  const bucketIdx = route.indexOf('clientIpBucketKey(request');
  const recordIdx = route.indexOf('recordRegistration(bucketKey)');
  const registerIdx = route.indexOf('registerWithPassword(username, password)');
  const lateRecordIdx = route.indexOf('recordRegistration(bucketKey)', registerIdx);
  assert.ok(bucketIdx > parseIdx && recordIdx > bucketIdx && registerIdx > recordIdx,
    'body parsing → rate-limit key → reserve attempt → scrypt/register ordering must be enforced');
  assert.equal(lateRecordIdx, -1, 'duplicate-username attempts must consume the registration quota');
});

test('loginWithPassword accepts a bound email (memory store)', async () => {
  const restore = memoryMode();
  try {
    const target = `mail-login-${Date.now()}@test.local`;
    const user = await storeUpsert({ provider: 'email', subject: target, email: target });
    assert.equal(user.hasPassword, false);
    await storeSetPassword(user.id, 'password-123');

    const loggedIn = await storeLogin(target, 'password-123');
    assert.equal(loggedIn?.id, user.id);
    assert.equal(loggedIn?.hasPassword, true);
    // 邮箱大小写不敏感
    assert.equal((await storeLogin(target.toUpperCase(), 'password-123'))?.id, user.id);
    // 错误密码 / 未知账号 → null(与 username 登录同消息路径,不泄露)
    assert.equal(await storeLogin(target, 'wrong-password'), null);
    assert.equal(await storeLogin(`nobody-${Date.now()}@test.local`, 'password-123'), null);
  } finally {
    restore();
  }
});

test('username + password login unchanged; registered users report hasPassword true', async () => {
  const restore = memoryMode();
  try {
    const name = `pwuser-${Date.now()}`;
    const user = await storeRegister(name, 'password-123');
    assert.equal(user.hasPassword, true);
    assert.equal((await storeLogin(name, 'password-123'))?.id, user.id);
    assert.equal((await storeLogin(name.toUpperCase(), 'password-123'))?.id, user.id);
    assert.equal(await storeLogin(name, 'wrong-pass'), null);
    // username 或 email 均可;无密码账号即使猜中凭证也 401(null)
    const noHash = await storeUpsert({
      provider: 'email',
      subject: `nohash-${Date.now()}@test.local`,
      email: `nohash-${Date.now()}@test.local`,
    });
    assert.equal(await storeLogin(noHash.email, 'password-123'), null);
  } finally {
    restore();
  }
});

// ============================================================
// 2. hasPassword:设密码前后 user JSON false → true,绝不泄漏 password_hash
// ============================================================

test('hasPassword flips false→true via setPassword; GET me / session 均带且无 hash 泄漏', async () => {
  const restore = memoryMode();
  try {
    const target = `pw-${Date.now()}@test.local`;
    const user = await storeUpsert({ provider: 'email', subject: target, email: target });
    assert.equal(user.hasPassword, false);
    assert.equal('password_hash' in user, false, 'user JSON 不得含 password_hash');

    const { token } = await storeCreateSession(user.id); // GET /api/auth/me 同路径(getSessionUser)
    const viaSession = await storeGetSessionUser(token);
    assert.equal(viaSession?.hasPassword, false);
    assert.equal('password_hash' in viaSession, false);

    const updated = await storeSetPassword(user.id, 'new-pass-123');
    assert.equal(updated?.hasPassword, true);
    assert.equal('password_hash' in updated, false, '改密响应不得含 password_hash');

    // 旧密码校验(me/password 的 WRONG_PASSWORD 判定依据)
    assert.equal(await storeVerifyPassword(user.id, 'new-pass-123'), true);
    assert.equal(await storeVerifyPassword(user.id, 'wrong'), false);
    // 新密码可登录,旧密码不可
    assert.equal((await storeLogin(target, 'new-pass-123'))?.id, user.id);
    assert.equal(await storeLogin(target, 'password-123'), null);
    // 会话内用户 hasPassword 同步翻 true
    assert.equal((await storeGetSessionUser(token))?.hasPassword, true);
  } finally {
    restore();
  }
});

// ============================================================
// 3. setPassword 的 OTP 门:consumeOtp 失败 → 不更新(route 层 401 INVALID_CODE)
// ============================================================

test('setPassword via OTP:consumeOtp gates the update (memory store)', async () => {
  const restore = memoryMode();
  try {
    const target = `otp-pw-${Date.now()}@test.local`;
    const user = await storeUpsert({ provider: 'email', subject: target, email: target });
    // 错误码:consumeOtp false → route 401 INVALID_CODE,密码不被设置
    assert.equal(await storeConsumeOtp('email', target, '000000'), false);
    assert.equal(await storeLogin(target, 'otp-pass-123'), null);

    const { code } = await storeIssueOtp('email', target);
    assert.equal(await storeConsumeOtp('email', target, code), true);
    const updated = await storeSetPassword(user.id, 'otp-pass-123');
    assert.equal(updated?.hasPassword, true);
    assert.equal((await storeLogin(target, 'otp-pass-123'))?.id, user.id);
  } finally {
    restore();
  }
});

// ============================================================
// 4. bindPhone / bindEmail:更新 + 身份 upsert 新行 / 删旧行 + 占用冲突
// ============================================================

test('bindPhone updates phone + identities;old phone identity removed (memory)', async () => {
  const restore = memoryMode();
  try {
    const stamp = Date.now();
    const oldPhone = `138${String(stamp).slice(-8)}`;
    const newPhone = `139${String(stamp).slice(-8)}`;
    const user = await storeUpsert({ provider: 'phone', subject: oldPhone, phone: oldPhone });

    const updated = await storeBindPhone(user.id, newPhone);
    assert.equal(updated?.phone, newPhone);
    assert.equal(updated?.id, user.id);
    // 新手机 OTP 登录 → 复用同一用户(身份已 upsert)
    const relogin = await storeUpsert({ provider: 'phone', subject: newPhone, phone: newPhone });
    assert.equal(relogin.id, user.id);
    // 旧手机身份已删:再用旧手机登录 → 新建独立用户,不再挂到原用户
    const oldPhoneLogin = await storeUpsert({ provider: 'phone', subject: oldPhone, phone: oldPhone });
    assert.notEqual(oldPhoneLogin.id, user.id);
  } finally {
    restore();
  }
});

test('bindEmail updates email + identities;old email identity removed (memory)', async () => {
  const restore = memoryMode();
  try {
    const stamp = Date.now();
    const oldEmail = `old-${stamp}@test.local`;
    const newEmail = `new-${stamp}@test.local`;
    const user = await storeUpsert({ provider: 'email', subject: oldEmail, email: oldEmail });

    const updated = await storeBindEmail(user.id, newEmail);
    assert.equal(updated?.email, newEmail);
    assert.equal(updated?.id, user.id);
    const relogin = await storeUpsert({ provider: 'email', subject: newEmail, email: newEmail });
    assert.equal(relogin.id, user.id);
    const oldLogin = await storeUpsert({ provider: 'email', subject: oldEmail, email: oldEmail });
    assert.notEqual(oldLogin.id, user.id);
  } finally {
    restore();
  }
});

test('bindPhone/bindEmail: 已被他人绑定 → PhoneTakenError / EmailTakenError;绑自己的当前值幂等', async () => {
  const restore = memoryMode();
  try {
    const stamp = Date.now();
    const phone = `137${String(stamp).slice(-8)}`;
    const email = `bind-taken-${stamp}@test.local`;
    const a = await storeUpsert({ provider: 'phone', subject: phone, phone });
    const b = await storeUpsert({ provider: 'email', subject: email, email });

    await assert.rejects(() => storeBindPhone(b.id, phone), PhoneTakenError);
    await assert.rejects(() => storeBindEmail(a.id, email), EmailTakenError);
    // 绑定自己的当前值 → 幂等成功(不触发占用)
    assert.equal((await storeBindPhone(a.id, phone))?.id, a.id);
    assert.equal((await storeBindEmail(b.id, email))?.id, b.id);
  } finally {
    restore();
  }
});

test('bindPhone/bindEmail DB 路径:23505 唯一冲突 → PhoneTakenError / EmailTakenError(409 语义)', async () => {
  __accountStoreTest.poolOverride = () => {
    const client = {
      query: async (sql) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
        if (sql.includes('UPDATE users')) {
          throw { code: '23505', message: 'duplicate key value violates unique constraint (test)' };
        }
        throw new Error(`unexpected SQL: ${sql}`);
      },
      release() {},
    };
    return { connect: async () => client };
  };
  try {
    await assert.rejects(() => storeBindPhone('1', '13800138000'), PhoneTakenError);
    await assert.rejects(() => storeBindEmail('1', 'taken@test.dev'), EmailTakenError);
  } finally {
    __accountStoreTest.poolOverride = undefined;
  }
});

test('bindPhone/bindEmail SQL 契约:users 更新 + 旧 identity 删除 + 新行 upsert(ON CONFLICT DO NOTHING)', () => {
  const store = src('lib/account-store.ts');
  assert.match(store, /UPDATE users SET phone = \$2/);
  assert.match(store, /UPDATE users SET email = \$2/);
  assert.match(store, /DELETE FROM auth_identities WHERE user_id = \$1 AND provider = 'phone'/);
  assert.match(store, /DELETE FROM auth_identities WHERE user_id = \$1 AND provider = 'email'/);
  const inserts = store.match(/INSERT INTO auth_identities \(user_id, provider, subject\)/g) ?? [];
  assert.ok(inserts.length >= 5, `expected ≥5 identity inserts (phone/email bind + 既有), got ${inserts.length}`);
  assert.match(store, /ON CONFLICT \(provider, subject\) DO NOTHING/);
  // 登录 SQL:username OR email,密码非空
  assert.match(store, /\(lower\(u\.username\) = \$1 OR lower\(u\.email\) = \$1\) AND u\.password_hash IS NOT NULL/);
});

// ============================================================
// 5. route 薄壳契约(readFileSync + 正则,仓库既有模式)
// ============================================================

test('route me/password:401 UNAUTHORIZED / PASSWORD_TOO_SHORT / WRONG_PASSWORD / NOT_BOUND / INVALID_CODE / 429 / 503', () => {
  const route = src('app/api/auth/me/password/route.ts');
  assert.match(route, /readSessionUser\(\)/);
  assert.match(route, /code: 'UNAUTHORIZED'/);
  assert.match(route, /status: 401/);
  assert.match(route, /isValidPassword\(newPassword\)/);
  assert.match(route, /code: 'PASSWORD_TOO_SHORT'/);
  assert.match(route, /status: 400/);
  assert.match(route, /verifyUserPassword\(user\.id, oldPassword\)/);
  assert.match(route, /code: 'WRONG_PASSWORD'/);
  assert.match(route, /code: 'NOT_BOUND'/);
  assert.match(route, /consumeOtp\(otp\.provider, otp\.target, otp\.code\)/);
  assert.match(route, /code: 'INVALID_CODE'/);
  assert.match(route, /setPassword\(user\.id, newPassword\)/);
  assert.match(route, /ok: true, user: next/);
  assert.match(route, /code: 'TOO_MANY_ATTEMPTS'/);
  assert.match(route, /status: 429/);
  assert.match(route, /code: 'DB_UNAVAILABLE'/);
  assert.match(route, /status: 503/);
  assert.doesNotMatch(route, /password_hash/, 'route 不得出现 password_hash(只在 store 层)');
});

test('route me/phone:UNAUTHORIZED / BAD_REQUEST / INVALID_CODE / PHONE_TAKEN / 429 / 503', () => {
  const route = src('app/api/auth/me/phone/route.ts');
  assert.match(route, /readSessionUser\(\)/);
  assert.match(route, /code: 'UNAUTHORIZED'/);
  assert.match(route, /status: 401/);
  assert.match(route, /isValidPhone/);
  assert.match(route, /code: 'BAD_REQUEST'/);
  assert.match(route, /status: 400/);
  assert.match(route, /consumeOtp\('phone', phone, code\)/);
  assert.match(route, /code: 'INVALID_CODE'/);
  assert.match(route, /bindPhone\(user\.id, phone\)/);
  assert.match(route, /code: 'PHONE_TAKEN'/);
  assert.match(route, /status: 409/);
  assert.match(route, /ok: true, user: next/);
  assert.match(route, /code: 'TOO_MANY_ATTEMPTS'/);
  assert.match(route, /status: 429/);
  assert.match(route, /code: 'DB_UNAVAILABLE'/);
  assert.match(route, /status: 503/);
  assert.doesNotMatch(route, /password_hash/);
});

test('route me/email:UNAUTHORIZED / BAD_REQUEST / INVALID_CODE / EMAIL_TAKEN / 429 / 503', () => {
  const route = src('app/api/auth/me/email/route.ts');
  assert.match(route, /readSessionUser\(\)/);
  assert.match(route, /code: 'UNAUTHORIZED'/);
  assert.match(route, /status: 401/);
  assert.match(route, /isValidEmail/);
  assert.match(route, /code: 'BAD_REQUEST'/);
  assert.match(route, /status: 400/);
  assert.match(route, /consumeOtp\('email', email, code\)/);
  assert.match(route, /code: 'INVALID_CODE'/);
  assert.match(route, /bindEmail\(user\.id, email\)/);
  assert.match(route, /code: 'EMAIL_TAKEN'/);
  assert.match(route, /status: 409/);
  assert.match(route, /ok: true, user: next/);
  assert.match(route, /code: 'TOO_MANY_ATTEMPTS'/);
  assert.match(route, /status: 429/);
  assert.match(route, /code: 'DB_UNAVAILABLE'/);
  assert.match(route, /status: 503/);
  assert.doesNotMatch(route, /password_hash/);
});
