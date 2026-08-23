import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const proxy = readFileSync(new URL('../src/proxy.ts', import.meta.url), 'utf8');
const avatarRoute = readFileSync(new URL('../src/app/api/me/avatar/route.ts', import.meta.url), 'utf8');

test('authenticated APIs receive an explicit no-store cache policy', () => {
  assert.match(proxy, /Cache-Control['"]*, ['"]no-store/);
  for (const path of [
    '/api/auth/:path*',
    '/api/agent/:path*',
    '/api/me/applications/:path*',
    '/api/me/memories/:path*',
    '/api/me/notifications/:path*',
    '/api/me/saved/:path*',
    '/api/me/search-history/:path*',
  ]) {
    assert.ok(proxy.includes(`'${path}'`), `${path} must be covered`);
  }
});

test('versioned private avatar caching is not overridden by the proxy', () => {
  assert.ok(!proxy.includes("'/api/me/avatar'"));
  assert.match(avatarRoute, /private, max-age=31536000, immutable/);
});
