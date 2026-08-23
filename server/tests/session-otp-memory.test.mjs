import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FALLBACK_ACCOUNT_MEMORY_MAX,
  OTP_CHALLENGE_MEMORY_MAX,
  SESSION_MEMORY_MAX,
  consumeOtp,
  fallbackAccountMemorySize,
  getSessionUser,
  issueOtp,
  createSession,
  upsertIdentity,
  otpChallengeMemorySize,
  resetOtpChallengeMemory,
  resetSessionMemory,
  sessionMemorySize,
} from '../src/lib/session-store.ts';

test('in-memory OTP challenges are bounded when targets rotate', () => {
  resetOtpChallengeMemory();

  const first = `user-${0}@example.com`;
  for (let i = 0; i < OTP_CHALLENGE_MEMORY_MAX; i += 1) {
    issueOtp('email', `user-${i}@example.com`);
  }
  assert.equal(otpChallengeMemorySize(), OTP_CHALLENGE_MEMORY_MAX);

  const latest = issueOtp('email', 'latest@example.com');
  assert.equal(otpChallengeMemorySize(), OTP_CHALLENGE_MEMORY_MAX);
  assert.equal(consumeOtp('email', 'latest@example.com', latest.code), true);
  assert.equal(consumeOtp('email', first, '000000'), false, 'the oldest rotated target was evicted');

  resetOtpChallengeMemory();
});

test('in-memory sessions are bounded under login floods', () => {
  resetSessionMemory();

  const user = upsertIdentity({
    provider: 'github',
    subject: `flood-${Date.now()}-${process.pid}`,
  });
  const first = createSession(user.id);
  for (let i = 1; i < SESSION_MEMORY_MAX; i += 1) {
    createSession('flood-user');
  }
  assert.equal(sessionMemorySize(), SESSION_MEMORY_MAX);

  createSession('flood-user');
  assert.equal(sessionMemorySize(), SESSION_MEMORY_MAX);
  assert.equal(getSessionUser(first.token), null, 'the oldest session was evicted');

  resetSessionMemory();
});

test('in-memory account store is bounded and evicts inactive users', () => {
  const run = `${Date.now()}-${process.pid}`;
  const firstUser = upsertIdentity({
    provider: 'github',
    subject: `account-flood-first-${run}`,
  });
  const firstToken = createSession(firstUser.id);
  for (let i = 0; i < FALLBACK_ACCOUNT_MEMORY_MAX + 1; i += 1) {
    upsertIdentity({
      provider: 'github',
      subject: `account-flood-${run}-${i}`,
    });
  }

  assert.equal(fallbackAccountMemorySize(), FALLBACK_ACCOUNT_MEMORY_MAX);
  assert.equal(getSessionUser(firstToken.token), null, 'the inactive oldest user was evicted');
  const latestUser = upsertIdentity({
    provider: 'github',
    subject: `account-flood-latest-${run}`,
  });
  assert.equal(getSessionUser(createSession(latestUser.id).token)?.id, latestUser.id);
});
