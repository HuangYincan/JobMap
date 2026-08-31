import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchPublicRouteArtifact,
  navigationRouteUrl,
} from '../src/lib/navigation/route-client.ts';

const ROUTE_ID = `rte_${'a'.repeat(32)}`;
const PATH = [
  { lng: 120.1, lat: 30.2 },
  { lng: 120.2, lat: 30.3 },
];

function fakeFetch(status, body, { throwNetwork = false } = {}) {
  return async (url, init) => {
    fakeFetch.last = { url, init };
    if (throwNetwork) throw new Error('network');
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
}

test('navigationRouteUrl 不把 cookie 写入可读存储,只拼 GET 路径', () => {
  assert.equal(navigationRouteUrl(ROUTE_ID), `/api/navigation/routes/${ROUTE_ID}`);
});

test('fetchPublicRouteArtifact:200 + geometry → path + meta,credentials include', async () => {
  const result = await fetchPublicRouteArtifact(
    ROUTE_ID,
    fakeFetch(200, {
      provider: 'amap',
      fetchedAt: '2026-08-28T12:00:00.000Z',
      geometry: PATH,
    }),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.path, PATH);
    assert.equal(result.meta.provider, 'amap');
    assert.equal(result.meta.quality, 'provider_route');
    assert.equal(result.meta.trafficAware, false);
  }
  assert.equal(fakeFetch.last.init.credentials, 'include');
  assert.equal(fakeFetch.last.init.method, 'GET');
});

test('fetchPublicRouteArtifact:410/403/404/401 映射错误码且无 path', async () => {
  const cases = [
    [410, 'EXPIRED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [401, 'UNAUTHORIZED'],
    [503, 'INTERNAL'],
  ];
  for (const [status, code] of cases) {
    const result = await fetchPublicRouteArtifact(ROUTE_ID, fakeFetch(status, { code }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, code, String(status));
  }
});

test('fetchPublicRouteArtifact:网络失败 → OFFLINE;缺 geometry → INVALID', async () => {
  const offline = await fetchPublicRouteArtifact(ROUTE_ID, fakeFetch(200, {}, { throwNetwork: true }));
  assert.equal(offline.ok, false);
  if (!offline.ok) assert.equal(offline.code, 'OFFLINE');
  const invalid = await fetchPublicRouteArtifact(
    ROUTE_ID,
    fakeFetch(200, { provider: 'amap', geometry: [{ lng: 1, lat: 2 }] }),
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.code, 'INVALID');
});
