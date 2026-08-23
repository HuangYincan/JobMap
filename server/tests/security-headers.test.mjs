import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const config = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'next.config.ts'),
  'utf8',
);

test('Next responses ship framing, MIME, referrer, permission, and CSP defenses', () => {
  for (const header of [
    'Content-Security-Policy',
    'Referrer-Policy',
    'Permissions-Policy',
    'Cross-Origin-Opener-Policy',
    'X-Content-Type-Options',
    'X-Frame-Options',
  ]) {
    assert.ok(config.includes(header), `missing ${header}`);
  }

  assert.match(config, /"frame-ancestors 'none'"/);
  assert.match(config, /"same-origin"/);
  assert.match(config, /"object-src 'none'"/);
  assert.match(config, /"base-uri 'self'"/);
  assert.match(config, /https:\*\.amap\.com|https:\/\/\*\.amap\.com/);
  assert.match(config, /Strict-Transport-Security/);
});
