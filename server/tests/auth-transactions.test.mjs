import test from 'node:test';
import assert from 'node:assert/strict';

import {
  __accountStoreTest,
  bindEmail,
  bindPhone,
  DbUnavailableError,
  registerWithPassword,
  upsertIdentity,
} from '../src/lib/account-store.ts';

const prefs = {
  language: 'zh',
  defaultMode: 'work',
  notifications: { emailJobs: false, smsJobs: false, emailSchools: false, smsSchools: false },
  career: { status: 'casually', families: ['intern', 'campus'], industries: ['internet'], strengths: [] },
};

function cloneState(state) {
  return {
    users: state.users.map((user) => ({ ...user })),
    identities: state.identities.map((identity) => ({ ...identity })),
  };
}

/** Small transactional fake: uncommitted rows disappear on ROLLBACK. */
function transactionalPool({ users = [], identities = [], failOnce, rollbackError = false } = {}) {
  let committed = cloneState({ users, identities });
  let working;
  let failure = failOnce;
  let releases = 0;
  const sqlLog = [];

  const client = {
    async query(sql, params = []) {
      const statement = sql.trim();
      sqlLog.push(statement);
      if (statement === 'BEGIN') {
        working = cloneState(committed);
        return { rows: [], rowCount: 0 };
      }
      if (statement === 'COMMIT') {
        committed = working;
        working = undefined;
        return { rows: [], rowCount: 0 };
      }
      if (statement === 'ROLLBACK') {
        working = undefined;
        if (rollbackError) throw new Error('rollback failed (test)');
        return { rows: [], rowCount: 0 };
      }
      if (
        statement === 'SAVEPOINT oauth_user_insert' ||
        statement === 'RELEASE SAVEPOINT oauth_user_insert' ||
        statement === 'ROLLBACK TO SAVEPOINT oauth_user_insert'
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (failure && failure(statement, params)) {
        failure = undefined;
        throw new Error(`injected SQL failure: ${statement}`);
      }

      const state = working ?? committed;
      if (statement.includes('SELECT id::text FROM users WHERE lower(username) = $1')) {
        const username = String(params[0]).toLowerCase();
        return { rows: state.users.filter((user) => user.username?.toLowerCase() === username).map((user) => ({ id: user.id })) };
      }
      if (statement.includes('WHERE lower(email) = lower($1)')) {
        const email = String(params[0]).toLowerCase();
        return { rows: state.users.filter((user) => user.email?.toLowerCase() === email) };
      }
      if (statement.includes('INSERT INTO users')) {
        const isPassword = statement.includes('username, password_hash');
        const row = isPassword
          ? {
              id: `u-${state.users.length + 1}`,
              display_name: params[1],
              avatar_url: null,
              phone: null,
              email: null,
              username: params[2],
              password_hash: params[3],
              preferences: JSON.parse(params[4]),
            }
          : {
              id: `u-${state.users.length + 1}`,
              display_name: params[1],
              avatar_url: params[4],
              phone: params[2],
              email: params[3],
              username: null,
              password_hash: null,
              preferences: JSON.parse(params[5]),
            };
        state.users.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (statement.includes('UPDATE users SET phone = $2')) {
        const user = state.users.find((candidate) => String(candidate.id) === String(params[0]));
        if (!user) return { rows: [] };
        user.phone = params[1];
        return { rows: [{ ...user, provider: 'phone' }], rowCount: 1 };
      }
      if (statement.includes('UPDATE users SET email = $2')) {
        const user = state.users.find((candidate) => String(candidate.id) === String(params[0]));
        if (!user) return { rows: [] };
        user.email = params[1];
        return { rows: [{ ...user, provider: 'email' }], rowCount: 1 };
      }
      if (statement.includes('DELETE FROM auth_identities')) {
        const provider = statement.includes("provider = 'phone'") ? 'phone' : 'email';
        state.identities = state.identities.filter(
          (identity) => !(String(identity.user_id) === String(params[0]) && identity.provider === provider),
        );
        return { rows: [], rowCount: 1 };
      }
      if (statement.includes('INSERT INTO auth_identities')) {
        const provider = statement.includes("'password'") ? 'password' : params[1];
        const subject = statement.includes("'password'") ? params[1] : params[2];
        state.identities.push({ user_id: String(params[0]), provider, subject });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected SQL in transactional fake: ${statement}`);
    },
    release() {
      releases += 1;
    },
  };

  return {
    connect: async () => client,
    get releases() {
      return releases;
    },
    get sqlLog() {
      return [...sqlLog];
    },
    snapshot() {
      return cloneState(committed);
    },
  };
}

function withPool(pool) {
  __accountStoreTest.poolOverride = () => pool;
  return () => {
    __accountStoreTest.poolOverride = undefined;
  };
}

async function assertAtomicRetry({ pool, operation, expectedUsers, expectedIdentities }) {
  const restore = withPool(pool);
  try {
    await assert.rejects(operation(), DbUnavailableError);
    assert.equal(pool.releases, 1, 'failed transaction must release its client');
    assert.equal(pool.sqlLog.filter((sql) => sql === 'ROLLBACK').length, 1, 'failed transaction must roll back');
    assert.deepEqual(pool.snapshot(), { users: [], identities: [] }, 'rollback must discard partial rows');

    const result = await operation();
    assert.ok(result);
    assert.equal(pool.releases, 2, 'retry must release its client too');
    assert.equal(pool.sqlLog.filter((sql) => sql === 'COMMIT').length, 1, 'only the retry should commit');
    assert.equal(pool.snapshot().users.length, expectedUsers);
    assert.equal(pool.snapshot().identities.length, expectedIdentities);
  } finally {
    restore();
  }
}

test('password registration rolls back when the second SQL (user insert) fails, then retries cleanly', async () => {
  const pool = transactionalPool({ failOnce: (sql) => sql.includes('INSERT INTO users') });
  await assertAtomicRetry({
    pool,
    operation: () => registerWithPassword(`tx-register-second-${Date.now()}`, 'password-123'),
    expectedUsers: 1,
    expectedIdentities: 1,
  });
});

test('password registration rolls back when the third SQL (identity insert) fails, with no orphan user', async () => {
  const username = `tx-register-third-${Date.now()}`;
  const pool = transactionalPool({ failOnce: (sql) => sql.includes('INSERT INTO auth_identities') });
  await assertAtomicRetry({
    pool,
    operation: () => registerWithPassword(username, 'password-123'),
    expectedUsers: 1,
    expectedIdentities: 1,
  });
});

test('OAuth upsert rolls back identity failure and retry creates one user plus one identity', async () => {
  const input = { provider: 'google', subject: `tx-oauth-${Date.now()}`, email: `tx-oauth-${Date.now()}@test.dev` };
  const pool = transactionalPool({ failOnce: (sql) => sql.includes('INSERT INTO auth_identities') });
  await assertAtomicRetry({
    pool,
    operation: () => upsertIdentity(input),
    expectedUsers: 1,
    expectedIdentities: 1,
  });
});

test('phone and email rebinding roll back both the second and third SQL statements', async () => {
  for (const [kind, operation, failSql] of [
    ['phone-delete', () => bindPhone('1', '13900138000'), (sql) => sql.includes('DELETE FROM auth_identities')],
    ['phone-insert', () => bindPhone('1', '13900138000'), (sql) => sql.includes('INSERT INTO auth_identities')],
    ['email-delete', () => bindEmail('1', 'new-tx@example.dev'), (sql) => sql.includes('DELETE FROM auth_identities')],
    ['email-insert', () => bindEmail('1', 'new-tx@example.dev'), (sql) => sql.includes('INSERT INTO auth_identities')],
  ]) {
    const pool = transactionalPool({
      users: [{ id: '1', display_name: 'User', avatar_url: null, phone: '13800138000', email: 'old-tx@example.dev', username: null, password_hash: null, preferences: prefs }],
      identities: [
        { user_id: '1', provider: 'phone', subject: '13800138000' },
        { user_id: '1', provider: 'email', subject: 'old-tx@example.dev' },
      ],
      failOnce: failSql,
    });
    const restore = withPool(pool);
    try {
      await assert.rejects(operation(), DbUnavailableError, kind);
      assert.equal(pool.releases, 1, `${kind}: failed transaction must release client`);
      assert.equal(pool.sqlLog.filter((sql) => sql === 'ROLLBACK').length, 1, `${kind}: must rollback`);
      assert.equal(pool.snapshot().users[0].phone, '13800138000');
      assert.equal(pool.snapshot().users[0].email, 'old-tx@example.dev');
      await operation();
      assert.equal(pool.releases, 2, `${kind}: retry must release client`);
      const snapshot = pool.snapshot();
      assert.equal(snapshot.users.length, 1, `${kind}: no orphan user`);
      assert.equal(snapshot.identities.filter((identity) => identity.user_id === '1').length, 2, `${kind}: old and new identities remain consistent`);
    } finally {
      restore();
    }
  }
});

test('client release survives a rollback error while original DB error remains mapped', async () => {
  const pool = transactionalPool({
    rollbackError: true,
    failOnce: (sql) => sql.includes('INSERT INTO auth_identities'),
  });
  const restore = withPool(pool);
  try {
    await assert.rejects(
      () => registerWithPassword(`tx-rollback-fail-${Date.now()}`, 'password-123'),
      DbUnavailableError,
    );
    assert.equal(pool.releases, 1);
    assert.equal(pool.snapshot().users.length, 0);
  } finally {
    restore();
  }
});
