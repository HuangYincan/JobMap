import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRouteError } from '../src/lib/navigation/index.ts';
import {
  NAVIGATION_ROUTE_BODY_MAX_CHARS,
  handleNavigationArtifactRequest,
  handleNavigationPlanRequest,
} from '../src/lib/navigation/route-http.ts';
import {
  NAVIGATION_SESSION_COOKIE,
  NAVIGATION_SESSION_COOKIE_MAX_AGE_SECONDS,
  NAVIGATION_SESSION_COOKIE_PATH,
  fingerprintNavigationSession,
} from '../src/lib/navigation/navigation-session.ts';
import { createRouteArtifactStore } from '../src/lib/navigation/route-artifacts.ts';
import { createRouteService } from '../src/lib/navigation/route-service.ts';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const NOW = Date.parse('2026-08-28T08:00:00.000Z');
const TOKEN_A = `nav_${'a'.repeat(64)}`;
const TOKEN_B = `nav_${'b'.repeat(64)}`;

function routeId(char = 'a') {
  return `rte_${char.repeat(32)}`;
}

function requestBody() {
  return {
    origin: {
      kind: 'coordinate',
      label: '合成起点',
      lng: 120.1,
      lat: 30.2,
      coordinateSystem: 'gcj02',
      precision: 'approximate',
    },
    destination: {
      kind: 'coordinate',
      label: '合成终点',
      lng: 120.2,
      lat: 30.3,
      coordinateSystem: 'gcj02',
      precision: 'approximate',
    },
    mode: 'transit',
  };
}

function postRequest(body = requestBody(), headers = {}) {
  return new Request('http://localhost/api/navigation/routes/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function cookieRequest(token) {
  return new Request(`http://localhost/api/navigation/routes/${routeId()}`, {
    headers: token ? { cookie: `${NAVIGATION_SESSION_COOKIE}=${token}` } : {},
  });
}

function artifact(id, token, overrides = {}) {
  return {
    routeId: id,
    sessionId: fingerprintNavigationSession(token),
    provider: 'amap',
    mode: 'transit',
    coordinateSystem: 'gcj02',
    geometry: [
      { lng: 120.1, lat: 30.2 },
      { lng: 120.2, lat: 30.3 },
    ],
    fetchedAt: '2026-08-28T08:00:00.000Z',
    expiresAt: '2026-08-28T08:10:00.000Z',
    ...overrides,
  };
}

test('POST production-default behavior returns an explicit estimate and a hardened independent cookie', async () => {
  const store = createRouteArtifactStore({ clock: () => NOW });
  const service = createRouteService({ artifactStore: store, clock: () => NOW });
  const response = await handleNavigationPlanRequest(postRequest(), {
    service,
    createSessionToken: () => TOKEN_A,
    secureCookie: true,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.provider, 'estimate');
  assert.equal(body.quality, 'estimate');
  assert.equal(body.trafficAware, false);
  assert.equal(Object.hasOwn(body, 'routeId'), false);
  assert.equal(Object.hasOwn(body, 'geometry'), false);

  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, new RegExp(`^${NAVIGATION_SESSION_COOKIE}=${TOKEN_A}`));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, new RegExp(`Path=${NAVIGATION_SESSION_COOKIE_PATH.replaceAll('/', '\\/')}`));
  assert.match(setCookie, new RegExp(`Max-Age=${NAVIGATION_SESSION_COOKIE_MAX_AGE_SECONDS}`));
  assert.doesNotMatch(JSON.stringify(body), new RegExp(TOKEN_A));
  assert.equal(store.size, 0);
});

test('POST reuses a valid navigation cookie without reflecting or reissuing it', async () => {
  const service = createRouteService({
    artifactStore: createRouteArtifactStore({ clock: () => NOW }),
    clock: () => NOW,
  });
  const response = await handleNavigationPlanRequest(
    postRequest(requestBody(), { cookie: `${NAVIGATION_SESSION_COOKIE}=${TOKEN_A}` }),
    { service, createSessionToken: () => TOKEN_B },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.doesNotMatch(await response.text(), new RegExp(TOKEN_A));
});

test('POST rejects bad and oversized JSON with no-store responses', async (t) => {
  const service = createRouteService({
    artifactStore: createRouteArtifactStore({ clock: () => NOW }),
    clock: () => NOW,
  });
  await t.test('bad JSON', async () => {
    const response = await handleNavigationPlanRequest(postRequest('{not-json'), { service });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).error.code, 'INVALID_REQUEST');
  });
  await t.test('oversized JSON', async () => {
    const response = await handleNavigationPlanRequest(
      postRequest(JSON.stringify({ padding: 'x'.repeat(NAVIGATION_ROUTE_BODY_MAX_CHARS + 1) })),
      { service },
    );
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).error.code, 'INVALID_REQUEST');
  });
});

test('POST maps stable service failures without exposing provider details', async (t) => {
  const cases = [
    ['RATE_LIMITED', 429],
    ['PROVIDER_UNAVAILABLE', 503],
    ['UNAUTHORIZED', 503],
    ['PROVIDER_ERROR', 503],
    ['TIMEOUT', 504],
  ];
  for (const [code, status] of cases) {
    await t.test(code, async () => {
      const response = await handleNavigationPlanRequest(postRequest(), {
        service: {
          plan: async () => ({ ok: false, error: createRouteError(code) }),
        },
        createSessionToken: () => TOKEN_A,
      });
      assert.equal(response.status, status);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.json();
      assert.deepEqual(body, { error: createRouteError(code) });
      assert.equal(Object.hasOwn(body, 'geometry'), false);
    });
  }
});

test('GET distinguishes malformed, missing session, not found, wrong session, expired, and success', async (t) => {
  let now = NOW;
  const store = createRouteArtifactStore({ clock: () => now });
  assert.equal(store.write(artifact(routeId('a'), TOKEN_A)).ok, true);

  await t.test('malformed', async () => {
    const response = await handleNavigationArtifactRequest(cookieRequest(TOKEN_A), 'route-guess', { store });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_REQUEST');
  });
  await t.test('missing session', async () => {
    const response = await handleNavigationArtifactRequest(cookieRequest(), routeId('a'), { store });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'UNAUTHORIZED');
  });
  await t.test('not found', async () => {
    const response = await handleNavigationArtifactRequest(cookieRequest(TOKEN_A), routeId('b'), { store });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'NOT_FOUND');
  });
  await t.test('wrong session', async () => {
    const response = await handleNavigationArtifactRequest(cookieRequest(TOKEN_B), routeId('a'), { store });
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error.code, 'FORBIDDEN');
    assert.equal(Object.hasOwn(body, 'geometry'), false);
  });
  await t.test('same session', async () => {
    const response = await handleNavigationArtifactRequest(cookieRequest(TOKEN_A), routeId('a'), { store });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.routeId, routeId('a'));
    assert.equal(body.geometry.length, 2);
    assert.equal(Object.hasOwn(body, 'sessionId'), false);
  });
  await t.test('expired', async () => {
    now = Date.parse('2026-08-28T08:10:00.001Z');
    const response = await handleNavigationArtifactRequest(cookieRequest(TOKEN_A), routeId('a'), { store });
    assert.equal(response.status, 410);
    const body = await response.json();
    assert.equal(body.error.code, 'EXPIRED');
    assert.equal(Object.hasOwn(body, 'geometry'), false);
  });
});

test('GET cross-session denial neither deletes nor renews the valid session artifact', async () => {
  const store = createRouteArtifactStore({ clock: () => NOW });
  assert.equal(store.write(artifact(routeId('c'), TOKEN_A)).ok, true);
  const denied = await handleNavigationArtifactRequest(cookieRequest(TOKEN_B), routeId('c'), { store });
  assert.equal(denied.status, 403);
  const allowed = await handleNavigationArtifactRequest(cookieRequest(TOKEN_A), routeId('c'), { store });
  assert.equal(allowed.status, 200);
});

test('Next.js route files are node handlers that delegate to the tested navigation HTTP module', () => {
  const plan = readFileSync(join(srcRoot, 'app/api/navigation/routes/plan/route.ts'), 'utf8');
  const get = readFileSync(join(srcRoot, 'app/api/navigation/routes/[routeId]/route.ts'), 'utf8');
  for (const source of [plan, get]) {
    assert.match(source, /export const runtime = 'nodejs'/);
    assert.doesNotMatch(source, /console\.(?:log|warn|info|debug|error)/);
    assert.doesNotMatch(source, /AMAP_WEB_KEY|BAIDU_MAP_AK|TENCENT_MAP_KEY/);
  }
  assert.match(plan, /handleNavigationPlanRequest\(request\)/);
  assert.match(get, /await context\.params/);
  assert.match(get, /handleNavigationArtifactRequest\(request, routeId\)/);
});
