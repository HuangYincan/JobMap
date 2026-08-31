import test from 'node:test';
import assert from 'node:assert/strict';

import { demoLoginGate } from '../src/lib/demo-login-gate.ts';

const DEV = { NODE_ENV: 'development' };
const PROD = { NODE_ENV: 'production' };

test('development allows the demo identity when no real OAuth credentials exist', () => {
  assert.deepEqual(demoLoginGate('github', DEV), { ok: true });
});

test('a configured provider disables its development demo shortcut', () => {
  const env = { ...DEV, GITHUB_OAUTH_CLIENT_ID: 'id', GITHUB_OAUTH_CLIENT_SECRET: 'secret' };
  const gate = demoLoginGate('github', env);
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'DEMO_LOGIN_DISABLED');
  assert.match(gate.message, /api\/auth\/oauth\/start\?provider=github/);
});

test('production rejects an anonymous demo session even without credentials', () => {
  const gate = demoLoginGate('google', PROD);
  assert.equal(gate.ok, false);
  assert.equal(gate.code, 'DEMO_LOGIN_DISABLED_IN_PRODUCTION');
});
