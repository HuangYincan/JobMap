import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hashPassword,
  isValidPassword,
  isValidUsername,
  verifyPassword,
} from '../src/lib/password.ts';
import {
  loginWithPassword as storeLogin,
  registerWithPassword as storeRegister,
  UsernameTakenError,
} from '../src/lib/account-store.ts';
import {
  createSession,
  getSessionUser,
  loginWithPassword,
  registerWithPassword,
  UsernameTakenError as MemUsernameTakenError,
} from '../src/lib/session-store.ts';

test('hashPassword produces scrypt format and verifyPassword round-trips', () => {
  const stored = hashPassword('secret-123');
  assert.match(stored, /^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.equal(verifyPassword('secret-123', stored), true);
  assert.equal(verifyPassword('wrong-pass', stored), false);
  // 随机 salt:同一密码两次哈希结果不同
  assert.notEqual(stored, hashPassword('secret-123'));
});

test('verifyPassword rejects malformed stored strings', () => {
  assert.equal(verifyPassword('secret-123', 'plaintext'), false);
  assert.equal(verifyPassword('secret-123', 'scrypt$16384$8$1$abcd'), false);
  assert.equal(verifyPassword('secret-123', 'bcrypt$10$abcd$efgh$ijkl$mnop'), false);
  assert.equal(verifyPassword('secret-123', ''), false);
});

test('username / password validation rules', () => {
  assert.equal(isValidUsername('alice'), true);
  assert.equal(isValidUsername('user_1'), true);
  assert.equal(isValidUsername('李雷'), true);
  assert.equal(isValidUsername('ab'), true);
  assert.equal(isValidUsername('a'), false);
  assert.equal(isValidUsername('a'.repeat(33)), false);
  assert.equal(isValidUsername('has-hyphen'), false);
  assert.equal(isValidUsername('has space'), false);
  assert.equal(isValidUsername(''), false);

  assert.equal(isValidPassword('12345678'), true);
  assert.equal(isValidPassword('1234567'), false);
  assert.equal(isValidPassword(''), false);
});

test('register + login via memory store, session works, hash never leaks', () => {
  const user = registerWithPassword('alice', 'password-123', 'Alice');
  assert.equal(user.provider, 'password');
  assert.equal(user.username, 'alice');
  assert.equal(user.accountLabel, 'alice');
  assert.equal(user.displayName, 'Alice');
  assert.equal('passwordHash' in user, false, 'public user must not expose passwordHash');

  const { token } = createSession(user.id);
  const viaSession = getSessionUser(token);
  assert.equal(viaSession?.id, user.id);
  assert.equal('passwordHash' in viaSession, false);

  const loggedIn = loginWithPassword('alice', 'password-123');
  assert.equal(loggedIn?.id, user.id);
  // 大小写不敏感登录
  assert.equal(loginWithPassword('ALICE', 'password-123')?.id, user.id);
  // 错误密码 / 不存在用户 → null(统一失败,不泄露)
  assert.equal(loginWithPassword('alice', 'wrong-password'), null);
  assert.equal(loginWithPassword('nobody', 'password-123'), null);
});

test('duplicate username throws UsernameTakenError (case-insensitive)', () => {
  registerWithPassword('bob', 'password-123');
  assert.throws(() => registerWithPassword('bob', 'other-pass-123'), UsernameTakenError);
  assert.throws(() => registerWithPassword('BOB', 'other-pass-123'), UsernameTakenError);
  assert.throws(() => registerWithPassword('bob', 'other-pass-123'), MemUsernameTakenError);
});

test('account-store facade stays in memory and maps 409/401 semantics', async () => {
  delete process.env.DATABASE_URL;
  const user = await storeRegister('carol', 'password-123');
  assert.equal(user.provider, 'password');
  assert.equal(user.username, 'carol');
  assert.equal(user.accountLabel, 'carol');

  const loggedIn = await storeLogin('carol', 'password-123');
  assert.equal(loggedIn?.id, user.id);
  assert.equal(await storeLogin('carol', 'wrong-pass'), null);
  assert.equal(await storeLogin('dave', 'password-123'), null);

  await assert.rejects(() => storeRegister('carol', 'other-pass-123'), UsernameTakenError);
});
