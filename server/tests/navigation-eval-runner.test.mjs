import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertSafeNavigationEvent,
  createJsonlSink,
  createMemorySink,
  parseNavigationEvent,
} from '../src/lib/navigation/analytics.ts';
import {
  EVAL_THRESHOLDS,
  computeOfflineMetrics,
  selectFirstNavigationTool,
  shouldForbidPlanning,
} from '../src/lib/navigation/eval-policy.ts';
import {
  runNavigationEval,
  toPythonReportInput,
} from '../src/lib/navigation/eval-runner.ts';
import { parseNavigationIntent } from '../src/lib/navigation/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, 'fixtures/navigation-eval-cases.json'), 'utf8'));
const playbook = JSON.parse(readFileSync(join(here, 'fixtures/navigation-eval-playbook.json'), 'utf8'));
const exampleJsonl = readFileSync(
  join(here, '..', 'scripts/navigation-eval/events.example.jsonl'),
  'utf8',
);

const FORBIDDEN_KEY_PATTERN =
  /(?:full|home|precise)?address|polyline|geometry|api[_-]?key|access[_-]?token|raw[_-]?(?:provider|response)|conversation|utterance|cookie/i;

function collectKeys(value, keys = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

function assertNoSensitive(value, label) {
  for (const key of collectKeys(value)) {
    assert.doesNotMatch(key, FORBIDDEN_KEY_PATTERN, `${label} forbidden key ${key}`);
    assert.notEqual(key, 'lng', label);
    assert.notEqual(key, 'lat', label);
    assert.notEqual(key, 'utterance', label);
  }
  const text = JSON.stringify(value);
  assert.doesNotMatch(text, /AMAP_WEB_KEY|BAIDU_MAP_AK|TENCENT_MAP_KEY/);
  assert.doesNotMatch(text, /dm_navigation_session/);
  assert.doesNotMatch(text, /(?:sk|pk)[-_][a-z0-9]{16,}/i);
}

test('sink accepts allowlisted fields and rejects forbidden or unknown fields', () => {
  const sink = createMemorySink();
  sink.emit({
    event: 'navigation_intent_parsed',
    occurredAt: '2026-08-28T12:00:00.000Z',
    caseId: 'commute-01',
    task: 'job_search',
    city: '杭州',
    completed: true,
  });
  assert.equal(sink.events.length, 1);
  assert.equal(sink.events[0].event, 'navigation_intent_parsed');

  assert.equal(parseNavigationEvent({ event: 'navigation_intent_parsed' }).ok, false);
  assert.equal(
    parseNavigationEvent({
      event: 'navigation_intent_parsed',
      occurredAt: '2026-08-28T12:00:00.000Z',
      utterance: '杭州找实习',
    }).error.code,
    'FORBIDDEN_FIELD',
  );
  assert.equal(
    parseNavigationEvent({
      event: 'navigation_intent_parsed',
      occurredAt: '2026-08-28T12:00:00.000Z',
      lng: 120.1,
    }).error.code,
    'FORBIDDEN_FIELD',
  );
  assert.equal(
    parseNavigationEvent({
      event: 'navigation_intent_parsed',
      occurredAt: '2026-08-28T12:00:00.000Z',
      debug: true,
    }).error.code,
    'UNKNOWN_FIELD',
  );
  assert.equal(
    parseNavigationEvent({
      event: 'not_a_real_event',
      occurredAt: '2026-08-28T12:00:00.000Z',
    }).error.code,
    'INVALID_EVENT',
  );
  assert.throws(() =>
    assertSafeNavigationEvent({
      event: 'navigation_intent_parsed',
      occurredAt: '2026-08-28T12:00:00.000Z',
      geometry: [{ lng: 1, lat: 2 }],
    }),
  );

  const chunks = [];
  const jsonl = createJsonlSink({ write: (chunk) => chunks.push(chunk) });
  jsonl.emit({
    event: 'navigation_task_completed',
    occurredAt: '2026-08-28T12:00:00.000Z',
    caseId: 'commute-01',
    completed: true,
  });
  assert.equal(chunks.length, 1);
  assert.match(chunks[0], /\n$/);
  assertNoSensitive(JSON.parse(chunks[0]), 'jsonl');
});

test('first-tool policy is deterministic and forbids planning on missing slots', () => {
  assert.equal(
    selectFirstNavigationTool({ ok: true, task: 'job_search', missingSlots: [] }),
    'work__searchPositions',
  );
  assert.equal(
    selectFirstNavigationTool({ ok: true, task: 'job_compare', missingSlots: [] }),
    'navigation__compareCommutes',
  );
  assert.equal(
    selectFirstNavigationTool({ ok: true, task: 'interview_arrival', missingSlots: [] }),
    'navigation__planRoute',
  );
  assert.equal(
    selectFirstNavigationTool({ ok: true, task: 'job_search', missingSlots: ['origin'] }),
    null,
  );
  assert.equal(selectFirstNavigationTool({ ok: false, missingSlots: [] }), null);
  assert.equal(shouldForbidPlanning({ ok: true, missingSlots: ['city'] }), true);
});

test('playbook covers all 40 fixture ids and matches the first-tool policy', () => {
  assert.equal(fixtures.length, 40);
  assert.equal(Object.keys(playbook.cases).length, 40);
  for (const fixture of fixtures) {
    const entry = playbook.cases[fixture.id];
    assert.ok(entry, fixture.id);
    const parsed = parseNavigationIntent(fixture.candidate);
    assert.equal(parsed.ok, fixture.expected.ok, fixture.id);
    const predicted = selectFirstNavigationTool(
      parsed.ok
        ? { ok: true, task: parsed.value.task, missingSlots: parsed.value.missingSlots }
        : { ok: false, missingSlots: [] },
    );
    assert.equal(predicted, entry.allowedToolSequence[0] ?? null, fixture.id);
    assert.equal(entry.forbidPlanningWhenMissingSlots, true, fixture.id);
  }
});

let cachedReport;

async function evalReport() {
  if (!cachedReport) {
    cachedReport = await runNavigationEval({
      fixtures,
      playbook,
      includeExtraCases: true,
    });
  }
  return cachedReport;
}

test('40 fixtures keep 12/10/10/8 coverage and slot/tool metrics meet thresholds', async () => {
  const report = await evalReport();
  assert.equal(report.fixtureCount, 40);
  assert.deepEqual(
    Object.fromEntries(
      ['commute_search', 'job_compare', 'interview_arrival', 'safety'].map((tag) => [
        tag,
        fixtures.filter((entry) => entry.scenario === tag).length,
      ]),
    ),
    { commute_search: 12, job_compare: 10, interview_arrival: 10, safety: 8 },
  );
  assert.ok(report.metrics.slotAccuracy.accuracy >= EVAL_THRESHOLDS.slotAccuracy);
  assert.ok(report.metrics.toolAccuracy.accuracy >= EVAL_THRESHOLDS.toolAccuracy);
  assert.equal(report.metrics.slotAccuracy.total, 200);
  for (const row of report.cases) {
    assert.equal(row.parseOk, row.expectedOk, row.id);
    if (row.planningForbiddenExpected) {
      assert.equal(row.planningAttempted, false, row.id);
      assert.deepEqual(row.toolsInvoked, []);
    }
  }
});

test('illegal actions are blocked and estimate routes have no routeId or geometry', async () => {
  const report = await evalReport();
  assert.equal(report.metrics.illegalActionBlockRate.accuracy, 1);
  assert.ok(report.illegalActions.length > 0);
  for (const action of report.illegalActions) assert.equal(action.rejected, true);
  const estimates = report.routes.filter((row) => row.quality === 'estimate' || row.provider === 'estimate');
  assert.ok(estimates.length > 0);
  for (const row of estimates) {
    assert.equal(row.hasRouteId, false);
    assert.equal(row.hasGeometry, false);
    assert.equal(row.quality, 'estimate');
    assert.equal(row.provider, 'estimate');
  }
  assert.equal(report.metrics.explicitDegradationRate.accuracy, 1);
  assert.equal(report.metrics.qualityLabelRate.accuracy, 1);
});

test('fake provider success paths keep routeId in tool text but not in events or geometry', async () => {
  const report = await evalReport();
  const scenarioA = report.extraCases.find((row) => row.id === 'extra-scenario-a-search');
  const scenarioB = report.extraCases.find((row) => row.id === 'extra-scenario-b-compare');
  const scenarioC = report.extraCases.find((row) => row.id === 'extra-scenario-c-interview');
  assert.equal(scenarioA.parseOk, true);
  assert.equal(scenarioB.parseOk, true);
  assert.equal(scenarioC.parseOk, true);
  const providerRoutes = report.routes.filter((row) => row.quality === 'provider_route');
  assert.ok(providerRoutes.some((row) => row.hasRouteId));
  for (const row of providerRoutes) assert.equal(row.hasGeometry, false);
  assertNoSensitive(report.events, 'events');
  for (const event of report.events) {
    assert.equal(Object.hasOwn(event, 'routeId'), false);
    assert.equal(Object.hasOwn(event, 'utterance'), false);
  }
  const timeout = report.extraCases.find((row) => row.id === 'extra-timeout');
  const noSilent = report.extraCases.find((row) => row.id === 'extra-timeout-no-silent-success');
  const estimate = report.extraCases.find((row) => row.id === 'extra-estimate-no-route-id');
  assert.equal(timeout.parseOk, true);
  assert.equal(noSilent.parseOk, true);
  assert.equal(estimate.parseOk, true);
});

test('python report numbers match node metrics', async () => {
  const report = await evalReport();
  const dir = mkdtempSync(join(tmpdir(), 'navigation-eval-'));
  const inputPath = join(dir, 'results.json');
  const eventsPath = join(dir, 'events.jsonl');
  const mdPath = join(dir, 'report.md');
  const csvPath = join(dir, 'metrics.csv');
  const jsonPath = join(dir, 'metrics.json');
  writeFileSync(inputPath, `${JSON.stringify(toPythonReportInput(report), null, 2)}\n`);
  writeFileSync(eventsPath, report.events.map((event) => JSON.stringify(event)).join('\n') + '\n');
  const spawned = spawnSync(
    'python3',
    [
      join(here, '..', 'scripts/navigation-eval/report.py'),
      '--input',
      inputPath,
      '--events',
      eventsPath,
      '--sql',
      join(here, '..', 'scripts/navigation-eval/funnel.sql'),
      '--out-md',
      mdPath,
      '--out-csv',
      csvPath,
      '--out-json',
      jsonPath,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(spawned.status, 0, spawned.stderr || spawned.stdout);
  const pythonMetrics = JSON.parse(readFileSync(jsonPath, 'utf8')).metrics;
  const nodeMetrics = computeOfflineMetrics({
    slots: report.slots,
    tools: report.tools,
    routes: report.routes,
    illegalActions: report.illegalActions,
  });
  for (const key of Object.keys(nodeMetrics)) {
    assert.equal(pythonMetrics[key].correct, nodeMetrics[key].correct, key);
    assert.equal(pythonMetrics[key].total, nodeMetrics[key].total, key);
    assert.ok(Math.abs(pythonMetrics[key].accuracy - nodeMetrics[key].accuracy) < 1e-9, key);
  }
  const markdown = readFileSync(mdPath, 'utf8');
  assert.match(markdown, /slotAccuracy/);
  assert.doesNotMatch(markdown, /INSERT INTO audit_events/i);
  assertNoSensitive(JSON.parse(readFileSync(jsonPath, 'utf8')), 'python-json');
});

test('example jsonl and eval sources never write audit_events or leak forbidden fields', () => {
  for (const line of exampleJsonl.trim().split('\n')) {
    const parsed = parseNavigationEvent(JSON.parse(line));
    assert.equal(parsed.ok, true, line);
    assertNoSensitive(parsed.value, 'example');
  }

  const roots = [
    join(here, '..', 'src/lib/navigation'),
    join(here, '..', 'scripts/navigation-eval'),
  ];
  const files = [];
  for (const root of roots) {
    for (const name of readdirSync(root)) {
      if (/\.(ts|sql|py|md|jsonl)$/.test(name)) files.push(join(root, name));
    }
  }
  files.push(join(here, 'fixtures/navigation-eval-playbook.json'));
  const writeNeedle = ['INSERT INTO', 'audit_events'].join(' ');
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.equal(text.toLowerCase().includes(writeNeedle.toLowerCase()), false, file);
    assert.equal(/into audit_events/i.test(text), false, file);
  }

  const chat = readFileSync(join(here, '..', 'src/app/api/agent/chat/route.ts'), 'utf8');
  const routeService = readFileSync(join(here, '..', 'src/lib/navigation/route-service.ts'), 'utf8');
  const runtime = readFileSync(join(here, '..', 'src/lib/navigation/route-runtime.ts'), 'utf8');
  for (const [label, text] of [
    ['chat', chat],
    ['route-service', routeService],
    ['runtime', runtime],
  ]) {
    assert.doesNotMatch(text, /createMemorySink|createJsonlSink|parseNavigationEvent/, label);
  }
  assert.doesNotMatch(chat, /navigation_intent_parsed/);

  const fixtureSnapshot = JSON.stringify(fixtures);
  assert.match(fixtureSnapshot, /"id":"commute-01"/);
  assert.equal(fixtures.length, 40);
});
