import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateMinutes } from '../src/lib/commute.ts';
import { haversineDistance } from '../src/lib/types.ts';
import {
  MAX_GEOMETRY_POINTS,
  createRouteError,
} from '../src/lib/navigation/index.ts';
import { createEstimateRoutePlan } from '../src/lib/navigation/estimate-provider.ts';
import {
  createRouteArtifactStore,
  publicRouteArtifact,
} from '../src/lib/navigation/route-artifacts.ts';
import { createRouteService } from '../src/lib/navigation/route-service.ts';

const NOW = Date.parse('2026-08-28T08:00:00.000Z');
const SESSION_A = 'a'.repeat(64);
const SESSION_B = 'b'.repeat(64);

function routeId(char = 'a') {
  return `rte_${char.repeat(32)}`;
}

function routeRequest(overrides = {}) {
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
    ...overrides,
  };
}

function providerValue(overrides = {}) {
  return {
    provider: 'amap',
    quality: 'provider_route',
    mode: 'transit',
    durationSeconds: 1_800,
    distanceMeters: 15_000,
    trafficAware: false,
    fetchedAt: '2026-08-28T08:00:00.000Z',
    expiresAt: '2026-08-28T08:10:00.000Z',
    coordinateSystem: 'gcj02',
    geometry: [
      { lng: 120.1, lat: 30.2 },
      { lng: 120.15, lat: 30.25 },
      { lng: 120.2, lat: 30.3 },
    ],
    summary: { transferCount: 1, walkingMeters: 500 },
    warnings: [],
    ...overrides,
  };
}

function artifact(id, sessionId = SESSION_A, overrides = {}) {
  return {
    routeId: id,
    sessionId,
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

function fakeProvider(overrides = {}) {
  return {
    id: 'amap',
    isConfigured: () => true,
    supports: () => true,
    plan: async () => ({ ok: true, value: providerValue() }),
    ...overrides,
  };
}

test('estimate adapter reuses commute and haversine rules for every travel mode', () => {
  const request = routeRequest();
  const meters = haversineDistance(request.origin, request.destination);

  for (const mode of ['walk', 'bike', 'transit', 'drive']) {
    const result = createEstimateRoutePlan(
      { ...request, mode },
      { clock: () => NOW, ttlSeconds: 300 },
    );
    assert.equal(result.ok, true);
    assert.equal(result.plan.mode, mode);
    assert.equal(result.plan.distanceMeters, meters);
    assert.equal(result.plan.durationSeconds, estimateMinutes(meters, mode) * 60);
    assert.equal(result.plan.provider, 'estimate');
    assert.equal(result.plan.quality, 'estimate');
    assert.equal(result.plan.trafficAware, false);
    assert.equal(result.plan.fetchedAt, '2026-08-28T08:00:00.000Z');
    assert.equal(result.plan.expiresAt, '2026-08-28T08:05:00.000Z');
    assert.equal(Object.hasOwn(result.plan, 'routeId'), false);
    assert.equal(Object.hasOwn(result.plan, 'geometry'), false);
    assert.match(result.plan.warnings.join(' '), /直线距离估算/);
    assert.match(result.plan.warnings.join(' '), /不代表道路路线/);
    assert.match(result.plan.warnings.join(' '), /实时路况/);
  }
});

test('estimate adapter derives ordered absolute times without claiming provider arrival-by', () => {
  const byDeparture = createEstimateRoutePlan(
    routeRequest({ departureAt: '2026-08-28T09:00:00+08:00' }),
    { clock: () => NOW },
  );
  assert.equal(byDeparture.ok, true);
  assert.equal(byDeparture.plan.departureAt, '2026-08-28T09:00:00+08:00');
  assert.ok(Date.parse(byDeparture.plan.arrivalAt) > Date.parse(byDeparture.plan.departureAt));

  const byArrival = createEstimateRoutePlan(
    routeRequest({ arrivalAt: '2026-08-28T10:00:00+08:00' }),
    { clock: () => NOW },
  );
  assert.equal(byArrival.ok, true);
  assert.equal(byArrival.plan.arrivalAt, '2026-08-28T10:00:00+08:00');
  assert.ok(Date.parse(byArrival.plan.departureAt) < Date.parse(byArrival.plan.arrivalAt));
  assert.match(byArrival.plan.warnings.join(' '), /倒推/);
  assert.match(byArrival.plan.warnings.join(' '), /arrival-by/);
});

test('estimate adapter fails closed across coordinate systems', () => {
  const request = routeRequest({
    destination: {
      ...routeRequest().destination,
      coordinateSystem: 'wgs84',
    },
  });
  assert.deepEqual(
    createEstimateRoutePlan(request, { clock: () => NOW }),
    { ok: false, error: createRouteError('COORDINATE_ERROR') },
  );
});

test('artifact store is bounded, session-isolated, expiring, and exposes a dedicated public shape', () => {
  let now = NOW;
  const store = createRouteArtifactStore({ capacity: 2, clock: () => now });
  assert.equal(store.write(artifact(routeId('a'))).ok, true);
  assert.equal(store.write(artifact(routeId('b'))).ok, true);

  const wrong = store.read(routeId('b'), SESSION_B);
  assert.deepEqual(wrong, { status: 'wrong_session' });
  const same = store.read(routeId('b'), SESSION_A);
  assert.equal(same.status, 'ok');
  assert.equal(Object.hasOwn(same.artifact, 'sessionId'), false);
  assert.deepEqual(same.artifact, publicRouteArtifact(artifact(routeId('b'))));

  assert.equal(store.write(artifact(routeId('c'))).ok, true);
  assert.equal(store.size, 2);
  assert.deepEqual(store.read(routeId('a'), SESSION_A), { status: 'not_found' });
  assert.equal(store.read(routeId('b'), SESSION_A).status, 'ok');

  now = Date.parse('2026-08-28T08:10:00.001Z');
  assert.deepEqual(store.read(routeId('b'), SESSION_B), { status: 'wrong_session' });
  assert.deepEqual(store.read(routeId('b'), SESSION_A), { status: 'expired' });
  assert.deepEqual(store.read(routeId('b'), SESSION_A), { status: 'not_found' });
});

test('artifact reads distinguish malformed, missing session, and not found without geometry leakage', () => {
  const store = createRouteArtifactStore({ clock: () => NOW });
  assert.deepEqual(store.read('route-guess', SESSION_A), { status: 'malformed' });
  assert.deepEqual(store.read(routeId('d'), null), { status: 'unauthorized' });
  assert.deepEqual(store.read(routeId('d'), SESSION_A), { status: 'not_found' });
  assert.equal(store.write({ ...artifact(routeId('d')), provider: 'estimate' }).ok, false);
  assert.equal(store.size, 0);
});

test('provider success is validated, receives abort signal, gets a server ID, and writes one artifact', async () => {
  const store = createRouteArtifactStore({ clock: () => NOW });
  let receivedSignal;
  const service = createRouteService({
    providers: [
      fakeProvider({
        plan: async (_request, signal) => {
          receivedSignal = signal;
          return { ok: true, value: providerValue() };
        },
      }),
    ],
    artifactStore: store,
    clock: () => NOW,
    timeoutMs: 1_000,
  });

  const result = await service.plan(routeRequest(), { fingerprint: SESSION_A });
  assert.equal(result.ok, true);
  assert.equal(receivedSignal instanceof AbortSignal, true);
  assert.equal(result.plan.provider, 'amap');
  assert.equal(result.plan.quality, 'provider_route');
  assert.match(result.plan.routeId, /^rte_[a-f0-9]{32,124}$/);
  assert.equal(Object.hasOwn(result.plan, 'geometry'), false);

  const stored = store.read(result.plan.routeId, SESSION_A);
  assert.equal(stored.status, 'ok');
  assert.equal(stored.artifact.geometry.length, 3);
  assert.equal(Object.hasOwn(stored.artifact, 'sessionId'), false);
});

test('provider cannot supply route/session IDs or raw fields before server issuance', async () => {
  const store = createRouteArtifactStore({ clock: () => NOW });
  const service = createRouteService({
    providers: [
      fakeProvider({
        plan: async () => ({
          ok: true,
          value: {
            ...providerValue(),
            routeId: routeId('e'),
            sessionId: SESSION_B,
            rawResponse: { secret: true },
          },
        }),
      }),
    ],
    artifactStore: store,
    clock: () => NOW,
  });
  const result = await service.plan(routeRequest(), { fingerprint: SESSION_A });
  assert.equal(result.ok, true);
  assert.equal(result.plan.provider, 'estimate');
  assert.equal(Object.hasOwn(result.plan, 'routeId'), false);
  assert.match(result.plan.warnings.join(' '), /供应商结果无效/);
  assert.equal(store.size, 0);
});

test('provider failure classes degrade explicitly to a safe estimate', async (t) => {
  const cases = [
    ['unsupported', fakeProvider({ supports: () => false }), /不支持/],
    ['unconfigured', fakeProvider({ isConfigured: () => false }), /未配置/],
    [
      'rate limited',
      fakeProvider({ plan: async () => ({ ok: false, error: 'RATE_LIMITED' }) }),
      /限流/,
    ],
    [
      'unauthorized',
      fakeProvider({ plan: async () => ({ ok: false, error: 'UNAUTHORIZED' }) }),
      /未授权/,
    ],
    [
      'no route',
      fakeProvider({ plan: async () => ({ ok: false, error: 'NO_ROUTE' }) }),
      /未找到真实路线/,
    ],
    [
      'provider error',
      fakeProvider({ plan: async () => {
        throw new Error('internal URL and key must never escape');
      } }),
      /供应商失败/,
    ],
  ];

  for (const [name, provider, warning] of cases) {
    await t.test(name, async () => {
      const service = createRouteService({
        providers: [provider],
        artifactStore: createRouteArtifactStore({ clock: () => NOW }),
        clock: () => NOW,
      });
      const result = await service.plan(routeRequest(), { fingerprint: SESSION_A });
      assert.equal(result.ok, true);
      assert.equal(result.plan.provider, 'estimate');
      assert.equal(Object.hasOwn(result.plan, 'geometry'), false);
      assert.match(result.plan.warnings.join(' '), warning);
      assert.doesNotMatch(JSON.stringify(result), /internal URL|key must never escape/);
    });
  }
});

test('timeout and caller abort propagate to the provider and always clear timers', async (t) => {
  await t.test('timeout', async () => {
    let signal;
    let clearCount = 0;
    const service = createRouteService({
      providers: [
        fakeProvider({
          plan: async (_request, providerSignal) => {
            signal = providerSignal;
            return new Promise(() => {});
          },
        }),
      ],
      artifactStore: createRouteArtifactStore({ clock: () => NOW }),
      clock: () => NOW,
      timeoutMs: 25,
      setTimeoutFn(callback) {
        queueMicrotask(callback);
        return 1;
      },
      clearTimeoutFn() {
        clearCount += 1;
      },
    });
    const result = await service.plan(routeRequest(), { fingerprint: SESSION_A });
    assert.equal(result.ok, true);
    assert.equal(result.plan.provider, 'estimate');
    assert.match(result.plan.warnings.join(' '), /超时/);
    assert.equal(signal.aborted, true);
    assert.equal(clearCount, 1);
  });

  await t.test('caller abort', async () => {
    let signal;
    let started;
    const providerStarted = new Promise((resolve) => {
      started = resolve;
    });
    let clearCount = 0;
    const controller = new AbortController();
    const service = createRouteService({
      providers: [
        fakeProvider({
          plan: async (_request, providerSignal) => {
            signal = providerSignal;
            started();
            return new Promise(() => {});
          },
        }),
      ],
      artifactStore: createRouteArtifactStore({ clock: () => NOW }),
      clock: () => NOW,
      timeoutMs: 5_000,
      setTimeoutFn: () => 1,
      clearTimeoutFn() {
        clearCount += 1;
      },
    });
    const pending = service.plan(routeRequest(), { fingerprint: SESSION_A }, controller.signal);
    await providerStarted;
    controller.abort();
    const result = await pending;
    assert.deepEqual(result, { ok: false, error: createRouteError('TIMEOUT') });
    assert.equal(signal.aborted, true);
    assert.equal(clearCount, 1);
  });
});

test('malformed provider geometry and numeric fields never issue an artifact', async (t) => {
  const malformed = [
    ['non-finite duration', { durationSeconds: Number.NaN }],
    ['coordinate mismatch', { coordinateSystem: 'wgs84' }],
    ['non-finite geometry', { geometry: [{ lng: Number.NaN, lat: 30.2 }, { lng: 120.2, lat: 30.3 }] }],
    ['too few points', { geometry: [{ lng: 120.1, lat: 30.2 }] }],
    [
      'too many points',
      { geometry: Array.from({ length: MAX_GEOMETRY_POINTS + 1 }, () => ({ lng: 120.1, lat: 30.2 })) },
    ],
    [
      'origin deviation',
      { geometry: [{ lng: 121.1, lat: 31.2 }, { lng: 120.2, lat: 30.3 }] },
    ],
    [
      'destination deviation',
      { geometry: [{ lng: 120.1, lat: 30.2 }, { lng: 121.2, lat: 31.3 }] },
    ],
  ];

  for (const [name, patch] of malformed) {
    await t.test(name, async () => {
      const store = createRouteArtifactStore({ clock: () => NOW });
      const service = createRouteService({
        providers: [
          fakeProvider({
            plan: async () => ({ ok: true, value: providerValue(patch) }),
          }),
        ],
        artifactStore: store,
        clock: () => NOW,
      });
      const result = await service.plan(routeRequest(), { fingerprint: SESSION_A });
      assert.equal(result.ok, true);
      assert.equal(result.plan.provider, 'estimate');
      assert.equal(store.size, 0);
    });
  }
});

test('invalid input and invalid session fail before provider work', async () => {
  let calls = 0;
  const service = createRouteService({
    providers: [
      fakeProvider({
        plan: async () => {
          calls += 1;
          return { ok: true, value: providerValue() };
        },
      }),
    ],
    artifactStore: createRouteArtifactStore({ clock: () => NOW }),
    clock: () => NOW,
  });
  assert.deepEqual(
    await service.plan({ mode: 'teleport' }, { fingerprint: SESSION_A }),
    { ok: false, error: createRouteError('INVALID_REQUEST') },
  );
  assert.deepEqual(
    await service.plan(routeRequest(), { fingerprint: 'raw cookie token' }),
    { ok: false, error: createRouteError('INVALID_REQUEST') },
  );
  assert.equal(calls, 0);
});

test('cross-system requests fail closed before providers or estimates', async () => {
  let calls = 0;
  const service = createRouteService({
    providers: [
      fakeProvider({
        plan: async () => {
          calls += 1;
          return { ok: true, value: providerValue() };
        },
      }),
    ],
    artifactStore: createRouteArtifactStore({ clock: () => NOW }),
    clock: () => NOW,
  });
  const request = routeRequest({
    destination: {
      ...routeRequest().destination,
      coordinateSystem: 'wgs84',
    },
  });
  assert.deepEqual(
    await service.plan(request, { fingerprint: SESSION_A }),
    { ok: false, error: createRouteError('COORDINATE_ERROR') },
  );
  assert.equal(calls, 0);
});
