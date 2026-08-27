import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const config = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'next.config.ts'),
  'utf8',
);

function policySource(name) {
  const start = config.indexOf(`const ${name} = [`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = config.indexOf('].join("; ");', start);
  assert.notEqual(end, -1, `unterminated ${name}`);
  return config.slice(start, end);
}

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
  assert.match(config, /https:\/\/\*\.amap\.com/);
  assert.match(config, /Strict-Transport-Security/);
});

test('map-only CSP relaxations do not spread to non-map routes', () => {
  const mapPolicy = policySource('MAP_CSP');
  const strictPolicy = policySource('STRICT_CSP');

  // `/` is the only route that mounts MapShell. `:path+` excludes `/`, so
  // API and future non-map routes select the strict policy instead.
  assert.match(config, /source: "\/",\s+headers: securityHeaders\(MAP_CSP\)/);
  assert.match(config, /source: "\/:path\+",\s+headers: securityHeaders\(STRICT_CSP\)/);

  assert.match(mapPolicy, /script-src 'self' 'unsafe-inline'/);
  assert.match(mapPolicy, /style-src 'self' 'unsafe-inline'/);
  assert.doesNotMatch(strictPolicy, /unsafe-(?:inline|eval)/);
  assert.match(strictPolicy, /"script-src 'self'"/);
  assert.match(strictPolicy, /"style-src 'self'"/);
});

test('map CSP keeps explicit SDK script hosts and limits unsafe-eval to development', () => {
  const mapPolicy = policySource('MAP_CSP');
  const scriptDirective = mapPolicy.match(/`script-src [^`]+`/u)?.[0];
  assert.ok(scriptDirective, 'map script-src directive is missing');

  for (const host of [
    'https://*.amap.com',
    'https://*.map.baidu.com',
    'https://map.qq.com',
    'https://*.map.qq.com',
  ]) {
    assert.ok(scriptDirective.includes(host), `map script host is not allowed: ${host}`);
  }
  assert.doesNotMatch(scriptDirective, /script-src[^`]*\shttps:\s/u);
  assert.match(
    config,
    /process\.env\.NODE_ENV === "development" \? " 'unsafe-eval'" : ""/u,
  );
});
