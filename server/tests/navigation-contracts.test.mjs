import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_CANDIDATE_IDS,
  MAX_GEOMETRY_POINTS,
  MAX_PREFERRED_MODES,
  MAX_ROUTE_TTL_SECONDS,
  createRouteError,
  parseNavigationIntent,
  parseRouteRequest,
  parseRouteArtifact,
  parseRoutePlan,
  TravelModes,
} from '../src/lib/navigation/index.ts';

const fixtures = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/navigation-eval-cases.json'), 'utf8'),
);

function findFixture(id) {
  const fixture = fixtures.find((entry) => entry.id === id);
  assert.ok(fixture, `fixture ${id} should exist`);
  return fixture;
}

function copy(value) {
  return structuredClone(value);
}

function collectObjectKeys(value, keys = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, keys);
    return keys;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      collectObjectKeys(child, keys);
    }
  }
  return keys;
}

function collectLocationRefs(value, locations = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectLocationRefs(item, locations);
    return locations;
  }
  if (value !== null && typeof value === 'object') {
    if (typeof value.kind === 'string' && Object.hasOwn(value, 'precision')) locations.push(value);
    for (const child of Object.values(value)) collectLocationRefs(child, locations);
  }
  return locations;
}

const TEST_ROUTE_IDS = [
  'rte_9f4c2d1a7b3e5f081c6d2a4e8b0f3c5d9a1e7b2c4d6f8a0e3c5b7d9f1a2c4e6',
  'rte_4b7d1e9a0c3f5a8d2e6b1f4c9a7d0e5b3c8f2a6d1e4b9c0f7a3e5d8b2c6f1',
  'rte_c2a8f5e1b7d0c4a9f3e6b2d8a1c5f0e7b4d9a2c6f8e3b1d5a7c0e4f6b9',
  'rte_7e3b9a1d5c0f4e8b2a6d9c3f7e1b5a0d4c8f2a9e6b3c1d7f5a8e0b6c4',
];

function validRoutePlan(overrides = {}) {
  return {
    mode: 'transit',
    originLabel: '杭州合成地铁站A',
    destinationLabel: '杭州合成办公点B',
    durationSeconds: 1_800,
    distanceMeters: 12_000,
    provider: 'tencent',
    quality: 'provider_route',
    trafficAware: false,
    fetchedAt: '2026-08-27T08:00:00Z',
    expiresAt: '2026-08-27T08:30:00Z',
    routeId: TEST_ROUTE_IDS[0],
    warnings: [],
    ...overrides,
  };
}

function validRouteArtifact(overrides = {}) {
  return {
    routeId: TEST_ROUTE_IDS[1],
    sessionId: 'session-synthetic-1',
    provider: 'amap',
    mode: 'drive',
    coordinateSystem: 'gcj02',
    geometry: [
      { lng: 120.1, lat: 30.2 },
      { lng: 120.2, lat: 30.3 },
    ],
    fetchedAt: '2026-08-27T08:00:00Z',
    expiresAt: '2026-08-27T08:30:00Z',
    ...overrides,
  };
}

test('navigation eval fixture has exactly 40 cases and fixed coverage', () => {
  assert.ok(Array.isArray(fixtures));
  assert.equal(fixtures.length, 40);
  assert.deepEqual(
    Object.fromEntries(
      ['commute_search', 'job_compare', 'interview_arrival', 'safety'].map((tag) => [
        tag,
        fixtures.filter((entry) => entry.scenario === tag).length,
      ]),
    ),
    {
      commute_search: 12,
      job_compare: 10,
      interview_arrival: 10,
      safety: 8,
    },
  );

  const ids = fixtures.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const entry of fixtures) {
    assert.match(entry.id, /^[a-z0-9-]+$/);
    assert.equal(typeof entry.utterance, 'string');
    assert.equal(typeof entry.candidate, 'object');
    assert.equal(typeof entry.expected, 'object');
    assert.equal(typeof entry.expected.task, 'string');
    assert.equal(typeof entry.expected.ok, 'boolean');
  }
});

test('navigation eval fixture stays synthetic and excludes sensitive payload fields', () => {
  const forbiddenKeyPattern = /(?:full|home|precise)?address|polyline|geometry|api[_-]?key|access[_-]?token|raw[_-]?(?:provider|response)|conversation/i;
  for (const key of collectObjectKeys(fixtures)) {
    assert.doesNotMatch(key, forbiddenKeyPattern, `sensitive fixture key: ${key}`);
  }
  const locations = collectLocationRefs(fixtures);
  assert.ok(locations.length > 0);
  for (const location of locations) assert.equal(location.precision, 'approximate');
  assert.doesNotMatch(JSON.stringify(fixtures), /(?:sk|pk)[-_][a-z0-9]{16,}/i);
});

test('every fixture candidate matches the expected navigation contract result', () => {
  for (const fixture of fixtures) {
    const result = parseNavigationIntent(fixture.candidate);
    assert.equal(result.ok, fixture.expected.ok, fixture.id);
    if (result.ok) {
      assert.equal(result.value.task, fixture.expected.task, fixture.id);
      assert.deepEqual(result.value.missingSlots, fixture.expected.missingSlots, fixture.id);
    } else {
      assert.equal(result.error.code, fixture.expected.errorCode, fixture.id);
    }
  }
});

test('unknown fields are rejected at top-level and nested contract boundaries', () => {
  const base = copy(findFixture('commute-01').candidate);

  assert.equal(parseNavigationIntent({ ...base, debug: true }).error.code, 'UNKNOWN_FIELD');
  assert.equal(
    parseNavigationIntent({ ...base, origin: { ...base.origin, rawAddress: 'redacted' } }).error.code,
    'UNKNOWN_FIELD',
  );
  assert.equal(
    parseNavigationIntent({ ...base, commute: { ...base.commute, provider: 'amap' } }).error.code,
    'UNKNOWN_FIELD',
  );
  assert.equal(
    parseNavigationIntent({
      ...copy(findFixture('interview-01').candidate),
      appointment: { ...findFixture('interview-01').candidate.appointment, confidence: 0.9 },
    }).error.code,
    'UNKNOWN_FIELD',
  );
});

test('non-finite numbers and out-of-range values fail closed', () => {
  const base = copy(findFixture('commute-01').candidate);
  assert.equal(
    parseNavigationIntent({ ...base, commute: { ...base.commute, maxMinutes: Number.NaN } }).error.code,
    'INVALID_NUMBER',
  );
  assert.equal(
    parseNavigationIntent({ ...base, commute: { ...base.commute, maxMinutes: Number.POSITIVE_INFINITY } }).error.code,
    'INVALID_NUMBER',
  );
  assert.equal(
    parseNavigationIntent({ ...base, commute: { ...base.commute, maxMinutes: 1_441 } }).error.code,
    'VALUE_OUT_OF_RANGE',
  );

  assert.equal(
    parseNavigationIntent({ ...base, origin: { ...base.origin, lng: Number.NaN, coordinateSystem: 'gcj02' } }).error.code,
    'INVALID_COORDINATE',
  );
  assert.equal(
    parseNavigationIntent({ ...base, origin: { ...base.origin, lng: 120, lat: Number.POSITIVE_INFINITY, coordinateSystem: 'gcj02' } }).error.code,
    'INVALID_COORDINATE',
  );
});

test('bounded arrays are normalized and cannot exceed contract limits', () => {
  const compare = copy(findFixture('compare-03').candidate);
  const normalized = parseNavigationIntent(compare);
  assert.equal(normalized.ok, true);
  assert.deepEqual(normalized.value.positionIds, ['position-synthetic-a', 'position-synthetic-b']);

  const tooManyIds = copy(findFixture('compare-02').candidate);
  tooManyIds.positionIds = Array.from({ length: MAX_CANDIDATE_IDS + 1 }, (_, index) => `position-${index}`);
  assert.equal(parseNavigationIntent(tooManyIds).error.code, 'ARRAY_TOO_LONG');

  const tooManyModes = copy(findFixture('commute-01').candidate);
  tooManyModes.commute.preferredModes = Array.from({ length: MAX_PREFERRED_MODES + 1 }, () => 'transit');
  assert.equal(parseNavigationIntent(tooManyModes).error.code, 'ARRAY_TOO_LONG');

  const unknownMode = copy(findFixture('commute-01').candidate);
  unknownMode.commute.preferredModes = ['transit', 'teleport'];
  assert.equal(parseNavigationIntent(unknownMode).error.code, 'INVALID_ENUM');
  assert.deepEqual(TravelModes, ['walk', 'bike', 'transit', 'drive']);
});

test('coordinate locations require an explicit supported coordinate system', () => {
  const base = copy(findFixture('commute-01').candidate);
  base.origin = {
    kind: 'coordinate',
    label: '杭州合成起点',
    lng: 120.12,
    lat: 30.28,
    precision: 'approximate',
  };
  assert.equal(parseNavigationIntent(base).error.code, 'COORDINATE_SYSTEM_REQUIRED');

  base.origin.coordinateSystem = 'gcj02';
  const parsed = parseNavigationIntent(base);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.origin.coordinateSystem, 'gcj02');

  base.origin.lng = 181;
  assert.equal(parseNavigationIntent(base).error.code, 'INVALID_COORDINATE');
});

test('missingSlots is recomputed in a fixed order and candidate values are not trusted', () => {
  const incomplete = copy(findFixture('commute-05').candidate);
  incomplete.missingSlots = ['destination', 'origin', 'origin'];
  const parsedIncomplete = parseNavigationIntent(incomplete);
  assert.equal(parsedIncomplete.ok, true);
  assert.deepEqual(parsedIncomplete.value.missingSlots, ['origin', 'city']);

  const complete = copy(findFixture('commute-01').candidate);
  complete.missingSlots = ['origin', 'city'];
  const parsedComplete = parseNavigationIntent(complete);
  assert.equal(parsedComplete.ok, true);
  assert.deepEqual(parsedComplete.value.missingSlots, []);

  const interviewOr = parseNavigationIntent(findFixture('interview-05').candidate);
  assert.equal(interviewOr.ok, true);
  assert.deepEqual(interviewOr.value.missingSlots, ['destination']);

  const invalidCandidateSlots = copy(findFixture('commute-01').candidate);
  invalidCandidateSlots.missingSlots = ['not-a-slot'];
  assert.equal(parseNavigationIntent(invalidCandidateSlots).error.code, 'INVALID_ENUM');
});

test('appointment accepts absolute offsets and rejects relative time or invalid IANA zones', () => {
  const absolute = parseNavigationIntent(findFixture('interview-01').candidate);
  assert.equal(absolute.ok, true);
  assert.equal(absolute.value.appointment.startsAt, '2026-09-01T09:00:00+08:00');

  const relative = copy(findFixture('interview-01').candidate);
  relative.appointment.startsAt = '明天9点';
  assert.equal(parseNavigationIntent(relative).error.code, 'INVALID_TIME');

  const noOffset = copy(findFixture('interview-01').candidate);
  noOffset.appointment.startsAt = '2026-09-01T09:00:00';
  assert.equal(parseNavigationIntent(noOffset).error.code, 'INVALID_TIME');

  const invalidTimezone = copy(findFixture('interview-01').candidate);
  invalidTimezone.appointment.timezone = 'Mars/Olympus';
  assert.equal(parseNavigationIntent(invalidTimezone).error.code, 'INVALID_TIMEZONE');

  const utc = copy(findFixture('interview-01').candidate);
  utc.appointment.timezone = 'UTC';
  assert.equal(parseNavigationIntent(utc).ok, true);

  for (const timezone of ['+08:00', 'CST', 'PST']) {
    const ambiguousTimezone = copy(findFixture('interview-01').candidate);
    ambiguousTimezone.appointment.timezone = timezone;
    assert.equal(parseNavigationIntent(ambiguousTimezone).error.code, 'INVALID_TIMEZONE', timezone);
  }
});

test('appointment rejects impossible calendar dates and clock or offset values', () => {
  const invalidDate = copy(findFixture('interview-01').candidate);
  invalidDate.appointment.startsAt = '2026-02-29T09:00:00+08:00';
  assert.equal(parseNavigationIntent(invalidDate).error.code, 'INVALID_TIME');

  const invalidMonthDate = copy(findFixture('interview-01').candidate);
  invalidMonthDate.appointment.startsAt = '2026-04-31T09:00:00+08:00';
  assert.equal(parseNavigationIntent(invalidMonthDate).error.code, 'INVALID_TIME');

  const invalidHour = copy(findFixture('interview-01').candidate);
  invalidHour.appointment.startsAt = '2026-09-01T24:00:00+08:00';
  assert.equal(parseNavigationIntent(invalidHour).error.code, 'INVALID_TIME');

  const invalidOffset = copy(findFixture('interview-01').candidate);
  invalidOffset.appointment.startsAt = '2026-09-01T09:00:00+24:00';
  assert.equal(parseNavigationIntent(invalidOffset).error.code, 'INVALID_TIME');

  const leapDay = copy(findFixture('interview-01').candidate);
  leapDay.appointment.startsAt = '2024-02-29T09:00:00+08:00';
  assert.equal(parseNavigationIntent(leapDay).ok, true);
});

test('route plan enforces provider and quality pairing, opaque references, and no geometry', () => {
  const valid = parseRoutePlan(validRoutePlan());
  assert.equal(valid.ok, true);

  assert.equal(
    parseRoutePlan(validRoutePlan({ provider: 'estimate', quality: 'provider_route' })).error.code,
    'ROUTE_QUALITY_MISMATCH',
  );
  assert.equal(
    parseRoutePlan(validRoutePlan({ provider: 'amap', quality: 'estimate', routeId: undefined })).error.code,
    'ROUTE_QUALITY_MISMATCH',
  );
  assert.equal(
    parseRoutePlan(validRoutePlan({ provider: 'estimate', quality: 'estimate', routeId: validRoutePlan().routeId })).error.code,
    'ROUTE_ID_FORBIDDEN',
  );
  assert.equal(
    parseRoutePlan({ ...validRoutePlan(), geometry: [{ lng: 120, lat: 30 }] }).error.code,
    'UNKNOWN_FIELD',
  );
  assert.equal(
    parseRoutePlan(validRoutePlan({ routeId: 'route-1' })).error.code,
    'ROUTE_ID_INVALID',
  );
});

test('estimate route plans are explicit, traffic-unaware, and route-id-free', () => {
  const estimate = validRoutePlan({ provider: 'estimate', quality: 'estimate', trafficAware: false });
  delete estimate.routeId;
  const parsed = parseRoutePlan(estimate);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.provider, 'estimate');
  assert.equal(parsed.value.quality, 'estimate');
  assert.equal(parsed.value.trafficAware, false);
  assert.equal(Object.hasOwn(parsed.value, 'routeId'), false);
  assert.equal(Object.hasOwn(parsed.value, 'geometry'), false);

  assert.equal(
    parseRoutePlan({ ...estimate, routeId: undefined }).error.code,
    'ROUTE_ID_FORBIDDEN',
  );
  assert.equal(
    parseRoutePlan({ ...estimate, trafficAware: true }).error.code,
    'ROUTE_QUALITY_MISMATCH',
  );
});

test('route plan validates absolute time ordering and non-negative measurements', () => {
  assert.equal(
    parseRoutePlan(
      validRoutePlan({
        departureAt: '2026-08-27T09:00:00Z',
        arrivalAt: '2026-08-27T08:59:00Z',
      }),
    ).error.code,
    'TIME_ORDER_INVALID',
  );
  assert.equal(
    parseRoutePlan(
      validRoutePlan({
        fetchedAt: '2026-08-27T08:30:00Z',
        expiresAt: '2026-08-27T08:00:00Z',
      }),
    ).error.code,
    'TIME_ORDER_INVALID',
  );
  assert.equal(parseRoutePlan(validRoutePlan({ durationSeconds: -1 })).error.code, 'VALUE_OUT_OF_RANGE');
  assert.equal(parseRoutePlan(validRoutePlan({ distanceMeters: Number.POSITIVE_INFINITY })).error.code, 'INVALID_NUMBER');
});

test('route plan validates summary schema and enforces the short TTL boundary', () => {
  assert.equal(MAX_ROUTE_TTL_SECONDS, 3_600);
  const summarized = parseRoutePlan(
    validRoutePlan({
      summary: { transferCount: 2, walkingMeters: 350.5 },
      warnings: ['synthetic provider delay warning'],
      expiresAt: '2026-08-27T09:00:00Z',
    }),
  );
  assert.equal(summarized.ok, true);
  assert.deepEqual(summarized.value.summary, { transferCount: 2, walkingMeters: 350.5 });
  assert.deepEqual(summarized.value.warnings, ['synthetic provider delay warning']);

  assert.equal(
    parseRoutePlan(validRoutePlan({ summary: { provider: 'amap' } })).error.code,
    'UNKNOWN_FIELD',
  );
  assert.equal(
    parseRoutePlan(validRoutePlan({ summary: { transferCount: 101 } })).error.code,
    'VALUE_OUT_OF_RANGE',
  );
  assert.equal(
    parseRoutePlan(validRoutePlan({ expiresAt: '2026-08-27T09:00:01Z' })).error.code,
    'TTL_INVALID',
  );

  assert.equal(
    parseRouteArtifact(validRouteArtifact({ expiresAt: '2026-08-27T09:00:00Z' })).ok,
    true,
  );
  assert.equal(
    parseRouteArtifact(validRouteArtifact({ expiresAt: '2026-08-27T09:00:01Z' })).error.code,
    'TTL_INVALID',
  );
});

test('route artifact is an internal session-bound geometry object and never an estimate', () => {
  const artifact = parseRouteArtifact(validRouteArtifact());
  assert.equal(artifact.ok, true);
  assert.equal(artifact.value.sessionId, 'session-synthetic-1');

  assert.equal(
    parseRouteArtifact(validRouteArtifact({ provider: 'estimate', routeId: TEST_ROUTE_IDS[2] })).error.code,
    'ROUTE_ARTIFACT_PROVIDER_INVALID',
  );
  assert.equal(
    parseRouteArtifact(
      validRouteArtifact({
        routeId: TEST_ROUTE_IDS[3],
        geometry: Array.from({ length: MAX_GEOMETRY_POINTS + 1 }, () => ({ lng: 120.1, lat: 30.2 })),
      }),
    ).error.code,
    'ARRAY_TOO_LONG',
  );
});

test('route artifact rejects invalid session and geometry payloads', () => {
  assert.equal(
    parseRouteArtifact(validRouteArtifact({ sessionId: 'session synthetic 1' })).error.code,
    'SESSION_ID_INVALID',
  );
  assert.equal(
    parseRouteArtifact(
      validRouteArtifact({ geometry: [{ lng: Number.NaN, lat: 30.2 }, { lng: 120.2, lat: 30.3 }] }),
    ).error.code,
    'GEOMETRY_INVALID',
  );
  assert.equal(
    parseRouteArtifact(
      validRouteArtifact({ geometry: [{ lng: 120.1, lat: 30.2, altitude: 10 }, { lng: 120.2, lat: 30.3 }] }),
    ).error.code,
    'UNKNOWN_FIELD',
  );
});

test('route errors have stable client-safe messages and retry semantics', () => {
  assert.deepEqual(createRouteError('TIMEOUT'), {
    code: 'TIMEOUT',
    message: '路线服务响应超时',
    retryable: true,
  });
  assert.deepEqual(createRouteError('INVALID_REQUEST'), {
    code: 'INVALID_REQUEST',
    message: '路线请求无效',
    retryable: false,
  });
});

test('route requests require resolved coordinates and validate absolute time ordering', () => {
  const request = {
    origin: {
      kind: 'coordinate',
      label: '合成起点',
      lng: 120.12,
      lat: 30.28,
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
    mode: 'drive',
    departureAt: '2026-08-27T08:00:00+08:00',
    arrivalAt: '2026-08-27T09:00:00+08:00',
    timezone: 'Asia/Shanghai',
  };
  assert.equal(parseRouteRequest(request).ok, true);

  const missingSystem = copy(request);
  delete missingSystem.origin.coordinateSystem;
  assert.equal(parseRouteRequest(missingSystem).error.code, 'COORDINATE_SYSTEM_REQUIRED');

  const unresolvedLocation = copy(request);
  unresolvedLocation.destination = {
    kind: 'poi',
    label: '合成办公点',
    precision: 'approximate',
  };
  assert.equal(parseRouteRequest(unresolvedLocation).error.code, 'COORDINATE_REQUIRED');

  const reversedTime = copy(request);
  reversedTime.arrivalAt = '2026-08-27T07:59:00+08:00';
  assert.equal(parseRouteRequest(reversedTime).error.code, 'TIME_ORDER_INVALID');
});
