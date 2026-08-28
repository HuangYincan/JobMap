// Offline navigation eval runner. Deterministic contract/policy measurement,
// not an online LLM eval. Inject work/navigation tools and RouteService.
// Production chat / RouteService do not persist or default-emit these events.

import { validateAction } from '../agent/action-schema.ts';
import type { AgentContext, AgentTool } from '../agent/types.ts';
import { navigationTools } from '../agent/tools/navigation.ts';
import { resolvePositionsFromCatalog, workTools } from '../agent/tools/work.ts';
import type { POI } from '../types.ts';
import {
  createCompositeSink,
  createMemorySink,
  type MemoryNavigationEventSink,
  type NavigationEventSink,
  type NavigationProductEvent,
} from './analytics.ts';
import {
  computeOfflineMetrics,
  expectedMissingSlotsFromFixture,
  resolvePlaybookCase,
  selectFirstNavigationTool,
  shouldForbidPlanning,
  type IllegalActionObservation,
  type NavigationEvalPlaybook,
  type OfflineEvalMetrics,
  type RouteObservation,
  type SlotObservation,
  type ToolObservation,
} from './eval-policy.ts';
import { createRouteArtifactStore } from './route-artifacts.ts';
import { createRouteService, type RouteService } from './route-service.ts';
import type { RouteProvider } from './route-provider.ts';
import type {
  NavigationIntent,
  NavigationLocationRef,
  RoutePlan,
  TravelMode,
} from './types.ts';
import { parseNavigationIntent } from './validation.ts';
import { TravelModes } from './constants.ts';

export const EVAL_SESSION_FINGERPRINT = 'c'.repeat(64);
export const EVAL_NOW_MS = Date.parse('2026-08-28T12:00:00.000Z');

const SYNTH_ORIGIN = {
  lng: 120.1,
  lat: 30.2,
} as const;
const SYNTH_DEST_OFFSETS: Record<string, { lng: number; lat: number }> = {
  'position-synthetic-a': { lng: 120.12, lat: 30.28 },
  'position-synthetic-b': { lng: 120.13, lat: 30.29 },
  'position-synthetic-c': { lng: 120.11, lat: 30.27 },
  'position-synthetic-d': { lng: 120.14, lat: 30.26 },
  'position-synthetic-e': { lng: 120.15, lat: 30.25 },
  'position-synthetic-f': { lng: 120.16, lat: 30.24 },
};

export interface NavigationEvalFixture {
  id: string;
  scenario: string;
  utterance: string;
  candidate: Record<string, unknown>;
  expected: {
    task: string;
    ok: boolean;
    missingSlots?: string[];
    errorCode?: string;
  };
}

export interface NavigationEvalCaseResult {
  id: string;
  scenario: string;
  expectedOk: boolean;
  parseOk: boolean;
  expectedMissingSlots: string[];
  predictedMissingSlots: string[];
  predictedFirstTool: string | null;
  playbookFirstTool: string | null;
  toolsInvoked: string[];
  planningAttempted: boolean;
  planningForbiddenExpected: boolean;
  forbiddenActionRejected: boolean;
  forbiddenActionCount: number;
  searchResultCount?: number;
  failureClass?: string;
  extra?: boolean;
}

export interface NavigationEvalReport {
  generatedAt: string;
  fixtureCount: number;
  extraCaseCount: number;
  cases: NavigationEvalCaseResult[];
  extraCases: NavigationEvalCaseResult[];
  slots: SlotObservation[];
  tools: ToolObservation[];
  routes: RouteObservation[];
  illegalActions: IllegalActionObservation[];
  events: NavigationProductEvent[];
  metrics: OfflineEvalMetrics;
}

export interface NavigationEvalOptions {
  fixtures: NavigationEvalFixture[];
  playbook: NavigationEvalPlaybook;
  sink?: NavigationEventSink;
  clock?: () => number;
  catalog?: POI[];
  routeService?: RouteService;
  workToolList?: AgentTool[];
  navigationToolList?: AgentTool[];
  includeExtraCases?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createEvalClock(startMs = EVAL_NOW_MS): () => number {
  let now = startMs;
  return () => {
    now += 5;
    return now;
  };
}

function position(overrides: Record<string, unknown>) {
  return {
    id: 'position-synthetic-a',
    siteId: 'site-eval-a',
    title: 'AI 产品实习',
    type: 'intern',
    taxonomy: { family: 'intern' },
    salary: { min: 8000, max: 12000 },
    status: 'open',
    deadline: '2026-12-31',
    apply: { source: 'official', url: 'https://careers.example/eval' },
    description: 'FULL_JD_SHOULD_NEVER_APPEAR',
    ...overrides,
  };
}

export function createEvalCatalog(): POI[] {
  const sites = Object.entries(SYNTH_DEST_OFFSETS).map(([id, loc]) => ({
    id: `site-eval-${id.slice(-1)}`,
    name: `杭州合成办公点 ${id.slice(-1).toUpperCase()}`,
    location: { lng: loc.lng, lat: loc.lat },
    city: '杭州',
  }));
  const titles: Record<string, string> = {
    'position-synthetic-a': 'AI 产品实习',
    'position-synthetic-b': 'AI 岗位',
    'position-synthetic-c': '设计实习',
    'position-synthetic-d': '数据岗位',
    'position-synthetic-e': '运营岗位',
    'position-synthetic-f': '产品岗位',
  };
  return [
    {
      id: 'company-synthetic-c',
      kind: 'recruitment',
      name: '杭州合成公司',
      mode: 'work',
      source: 'api',
      location: { lng: 120.12, lat: 30.28, address: '杭州' },
      company: {
        name: '杭州合成公司',
        industries: ['internet'],
        scale: 'bigtech',
        tier: 3,
        category: '64',
      },
      sites,
      positions: Object.keys(SYNTH_DEST_OFFSETS).map((id) =>
        position({
          id,
          siteId: `site-eval-${id.slice(-1)}`,
          title: titles[id],
          type: id.endsWith('b') ? 'social' : 'intern',
          taxonomy: { family: id.endsWith('b') ? 'social' : 'intern' },
        }),
      ),
    } as POI,
  ];
}

function hydrateLocation(
  ref: NavigationLocationRef | undefined,
  fallback: { lng: number; lat: number },
): NavigationLocationRef {
  if (
    ref &&
    typeof ref.lng === 'number' &&
    typeof ref.lat === 'number' &&
    ref.coordinateSystem
  ) {
    return ref;
  }
  return {
    kind: 'coordinate',
    label: ref?.label ?? 'eval-synthetic-location',
    lng: fallback.lng,
    lat: fallback.lat,
    coordinateSystem: 'gcj02',
    ...(ref?.city ? { city: ref.city } : { city: '杭州' }),
    precision: 'approximate',
  };
}

function preferredMode(intent: NavigationIntent): TravelMode {
  const mode = intent.commute?.preferredModes[0];
  if (mode && (TravelModes as readonly string[]).includes(mode)) return mode;
  return 'transit';
}

function agentContext(caseId: string, signal: AbortSignal): AgentContext {
  return {
    lang: 'zh',
    requestId: `eval-${caseId}`,
    signal,
    navigationSession: { fingerprint: EVAL_SESSION_FINGERPRINT },
  };
}

function countSearchResults(text: string): number {
  const match = text.match(/找到 (\d+) 个岗位摘要/);
  if (match) return Number(match[1]);
  if (text.includes('未找到符合条件的在招岗位')) return 0;
  return 0;
}

function planToRouteObservation(
  caseId: string,
  plan: RoutePlan,
  extras: Partial<RouteObservation> = {},
): RouteObservation {
  return {
    caseId,
    provider: plan.provider,
    quality: plan.quality,
    fetchedAt: plan.fetchedAt,
    hasRouteId: Boolean('routeId' in plan && plan.routeId),
    hasGeometry: false,
    ok: true,
    ...extras,
  };
}

function hasGeometryPayload(value: unknown): boolean {
  const text = JSON.stringify(value);
  return /"geometry"|"polyline"|"lng"\s*:/.test(text);
}

export function createFakeProvider(clock: () => number): RouteProvider {
  return {
    id: 'amap',
    isConfigured: () => true,
    supports: () => true,
    async plan(request) {
      const now = clock();
      return {
        ok: true,
        value: {
          provider: 'amap',
          quality: 'provider_route',
          mode: request.mode,
          durationSeconds: 1_200,
          distanceMeters: 8_000,
          trafficAware: false,
          fetchedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 600_000).toISOString(),
          coordinateSystem: request.origin.coordinateSystem ?? 'gcj02',
          geometry: [
            { lng: request.origin.lng as number, lat: request.origin.lat as number },
            { lng: request.destination.lng as number, lat: request.destination.lat as number },
          ],
          warnings: [],
        },
      };
    },
  };
}

export function createTimeoutProvider(): RouteProvider {
  return {
    id: 'amap',
    isConfigured: () => true,
    supports: () => true,
    async plan(_request, signal) {
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      return { ok: false, error: 'TIMEOUT' };
    },
  };
}

function toolByName(tools: AgentTool[], name: string): AgentTool {
  const found = tools.find((item) => item.name === name);
  if (!found) throw new Error(`missing eval tool ${name}`);
  return found;
}

async function runPlaybookSequence(args: {
  caseId: string;
  sequence: string[];
  intent: NavigationIntent;
  tools: AgentTool[];
  catalog: POI[];
  sink: NavigationEventSink;
  clock: () => number;
  signal: AbortSignal;
  routeResults: RouteObservation[];
}): Promise<{ toolsInvoked: string[]; planningAttempted: boolean; searchResultCount?: number }> {
  const toolsInvoked: string[] = [];
  let planningAttempted = false;
  let searchResultCount: number | undefined;
  const ctx = agentContext(args.caseId, args.signal);
  const origin = hydrateLocation(args.intent.origin, SYNTH_ORIGIN);
  const mode = preferredMode(args.intent);

  for (const name of args.sequence) {
    const started = args.clock();
    if (name === 'work__searchPositions') {
      const result = await toolByName(args.tools, name).call(
        {
          query: args.intent.query ?? '',
          city: args.intent.city,
        },
        ctx,
      );
      toolsInvoked.push(name);
      searchResultCount = result.ok ? countSearchResults(result.text) : 0;
      args.sink.emit({
        event: 'navigation_job_search_completed',
        occurredAt: new Date(args.clock()).toISOString(),
        caseId: args.caseId,
        task: args.intent.task,
        city: args.intent.city,
        resultCount: searchResultCount,
        durationMs: Math.max(0, args.clock() - started),
        completed: result.ok,
      });
    } else if (name === 'navigation__compareCommutes') {
      planningAttempted = true;
      args.sink.emit({
        event: 'navigation_route_requested',
        occurredAt: new Date(args.clock()).toISOString(),
        caseId: args.caseId,
        task: args.intent.task,
        city: args.intent.origin?.city ?? args.intent.city,
        mode,
        candidateCount: args.intent.positionIds?.length ?? 0,
      });
      const result = await toolByName(args.tools, name).call(
        {
          origin,
          mode,
          positionIds: args.intent.positionIds,
        },
        ctx,
      );
      toolsInvoked.push(name);
      const quality = result.ok && /quality=provider_route/.test(result.text) ? 'provider_route' : 'estimate';
      const provider = quality === 'provider_route' ? 'amap' : 'estimate';
      args.routeResults.push({
        caseId: args.caseId,
        provider,
        quality,
        fetchedAt: new Date(started).toISOString(),
        hasRouteId: result.ok && /routeId=rte_/.test(result.text),
        hasGeometry: result.ok && hasGeometryPayload(result.text),
        ok: result.ok,
      });
      args.sink.emit({
        event: quality === 'estimate' ? 'navigation_route_degraded' : 'navigation_route_resolved',
        occurredAt: new Date(args.clock()).toISOString(),
        caseId: args.caseId,
        task: args.intent.task,
        mode,
        quality,
        durationMs: Math.max(0, args.clock() - started),
        completed: result.ok,
        ...(result.ok ? {} : { failureClass: 'PROVIDER_ERROR' }),
      });
      args.sink.emit({
        event: 'navigation_comparison_viewed',
        occurredAt: new Date(args.clock()).toISOString(),
        caseId: args.caseId,
        task: args.intent.task,
        mode,
        candidateCount: args.intent.positionIds?.length ?? 0,
        completed: result.ok,
      });
    } else if (name === 'navigation__planRoute') {
      planningAttempted = true;
      const destination = hydrateLocation(
        args.intent.destination ??
          resolvePositionsFromCatalog(args.catalog, args.intent.positionIds ?? []).map((record) => ({
            kind: 'coordinate' as const,
            label: record.siteLabel ?? record.companyName,
            lng: record.location?.lng,
            lat: record.location?.lat,
            coordinateSystem: record.location?.coordinateSystem,
            city: record.city,
            precision: 'approximate' as const,
          }))[0],
        { lng: 120.12, lat: 30.28 },
      );
      args.sink.emit({
        event: 'navigation_route_requested',
        occurredAt: new Date(args.clock()).toISOString(),
        caseId: args.caseId,
        task: args.intent.task,
        mode,
      });
      const result = await toolByName(args.tools, name).call(
        {
          origin,
          destination,
          mode,
          ...(args.intent.appointment?.startsAt ? { arrivalAt: args.intent.appointment.startsAt } : {}),
          ...(args.intent.appointment?.timezone ? { timezone: args.intent.appointment.timezone } : {}),
        },
        ctx,
      );
      toolsInvoked.push(name);
      const quality = result.ok && /quality=provider_route/.test(result.text) ? 'provider_route' : 'estimate';
      const provider = quality === 'provider_route' ? 'amap' : 'estimate';
      args.routeResults.push({
        caseId: args.caseId,
        provider,
        quality,
        fetchedAt: new Date(started).toISOString(),
        hasRouteId: result.ok && /routeId=rte_/.test(result.text),
        hasGeometry: result.ok && hasGeometryPayload(result.text),
        ok: result.ok,
      });
      args.sink.emit({
        event: quality === 'estimate' ? 'navigation_route_degraded' : 'navigation_route_resolved',
        occurredAt: new Date(args.clock()).toISOString(),
        caseId: args.caseId,
        task: args.intent.task,
        mode,
        quality,
        durationMs: Math.max(0, args.clock() - started),
        completed: result.ok,
      });
    } else if (name === 'navigation__filterByCommute') {
      planningAttempted = true;
      const ids = Object.keys(SYNTH_DEST_OFFSETS).slice(0, 3);
      const result = await toolByName(args.tools, name).call(
        {
          positionIds: ids,
          origin,
          maxMinutes: args.intent.commute?.maxMinutes ?? 45,
          mode,
          topK: 5,
        },
        ctx,
      );
      toolsInvoked.push(name);
      const quality = result.ok && /quality=provider_route/.test(result.text) ? 'provider_route' : 'estimate';
      args.routeResults.push({
        caseId: args.caseId,
        provider: quality === 'provider_route' ? 'amap' : 'estimate',
        quality,
        fetchedAt: new Date(started).toISOString(),
        hasRouteId: result.ok && /routeId=rte_/.test(result.text),
        hasGeometry: result.ok && hasGeometryPayload(result.text),
        ok: result.ok,
      });
    }
  }
  return { toolsInvoked, planningAttempted, searchResultCount };
}

function evaluateForbiddenActions(
  caseId: string,
  actions: unknown[],
  illegalActions: IllegalActionObservation[],
): { forbiddenActionRejected: boolean; forbiddenActionCount: number } {
  let rejected = 0;
  for (const action of actions) {
    const ok = validateAction(action) === null;
    illegalActions.push({ caseId, rejected: ok });
    if (ok) rejected += 1;
  }
  return {
    forbiddenActionRejected: actions.length === 0 ? true : rejected === actions.length,
    forbiddenActionCount: actions.length,
  };
}

function maybeTask(
  candidate: Record<string, unknown>,
): NavigationProductEvent['task'] | undefined {
  return typeof candidate.task === 'string' &&
    (candidate.task === 'job_search' ||
      candidate.task === 'job_compare' ||
      candidate.task === 'interview_arrival')
    ? candidate.task
    : undefined;
}

async function runFixtureCase(args: {
  fixture: NavigationEvalFixture;
  playbook: NavigationEvalPlaybook;
  tools: AgentTool[];
  catalog: POI[];
  sink: NavigationEventSink;
  clock: () => number;
  signal: AbortSignal;
  slots: SlotObservation[];
  toolsObs: ToolObservation[];
  routes: RouteObservation[];
  illegalActions: IllegalActionObservation[];
}): Promise<NavigationEvalCaseResult> {
  const playbookCase = resolvePlaybookCase(args.playbook, args.fixture.id);
  const parsed = parseNavigationIntent(args.fixture.candidate);
  const expectedMissing = expectedMissingSlotsFromFixture(args.fixture.expected);
  const predictedMissing = parsed.ok ? [...parsed.value.missingSlots] : [];
  const policyInput = parsed.ok
    ? { ok: true, task: parsed.value.task, missingSlots: parsed.value.missingSlots }
    : { ok: false, task: maybeTask(args.fixture.candidate), missingSlots: [] as string[] };
  const predictedFirstTool = selectFirstNavigationTool(policyInput);
  const playbookFirstTool = playbookCase.allowedToolSequence[0] ?? null;
  const planningForbiddenExpected =
    playbookCase.forbidPlanningWhenMissingSlots && shouldForbidPlanning(policyInput);

  args.sink.emit({
    event: 'navigation_intent_parsed',
    occurredAt: new Date(args.clock()).toISOString(),
    caseId: args.fixture.id,
    task: policyInput.task,
    city: parsed.ok ? parsed.value.city : typeof args.fixture.candidate.city === 'string' ? args.fixture.candidate.city : undefined,
    completed: parsed.ok && predictedMissing.length === 0,
    ...(parsed.ok ? {} : { failureClass: parsed.error.code }),
  });
  if (parsed.ok && predictedMissing.length > 0) {
    args.sink.emit({
      event: 'navigation_slot_clarified',
      occurredAt: new Date(args.clock()).toISOString(),
      caseId: args.fixture.id,
      task: parsed.value.task,
      city: parsed.value.city,
      completed: false,
      failureClass: 'MISSING_SLOTS',
    });
  }

  const forbidden = evaluateForbiddenActions(
    args.fixture.id,
    playbookCase.forbiddenActions,
    args.illegalActions,
  );

  let toolsInvoked: string[] = [];
  let planningAttempted = false;
  let searchResultCount: number | undefined;
  if (!planningForbiddenExpected && parsed.ok) {
    const ran = await runPlaybookSequence({
      caseId: args.fixture.id,
      sequence: playbookCase.allowedToolSequence,
      intent: parsed.value,
      tools: args.tools,
      catalog: args.catalog,
      sink: args.sink,
      clock: args.clock,
      signal: args.signal,
      routeResults: args.routes,
    });
    toolsInvoked = ran.toolsInvoked;
    planningAttempted = ran.planningAttempted;
    searchResultCount = ran.searchResultCount;
    if (ran.toolsInvoked.length > 0 && parsed.value.missingSlots.length === 0) {
      args.sink.emit({
        event: 'navigation_task_completed',
        occurredAt: new Date(args.clock()).toISOString(),
        caseId: args.fixture.id,
        task: parsed.value.task,
        city: parsed.value.city,
        completed: true,
      });
    }
  }

  const slot: SlotObservation = {
    caseId: args.fixture.id,
    expectedOk: args.fixture.expected.ok,
    parseOk: parsed.ok,
    expectedMissingSlots: expectedMissing,
    predictedMissingSlots: predictedMissing,
  };
  args.slots.push(slot);
  const tool: ToolObservation = {
    caseId: args.fixture.id,
    predictedFirstTool,
    playbookFirstTool,
    planningForbiddenExpected,
    planningAttempted,
  };
  args.toolsObs.push(tool);

  return {
    id: args.fixture.id,
    scenario: args.fixture.scenario,
    expectedOk: args.fixture.expected.ok,
    parseOk: parsed.ok,
    expectedMissingSlots: expectedMissing,
    predictedMissingSlots: predictedMissing,
    predictedFirstTool,
    playbookFirstTool,
    toolsInvoked,
    planningAttempted,
    planningForbiddenExpected,
    forbiddenActionRejected: forbidden.forbiddenActionRejected,
    forbiddenActionCount: forbidden.forbiddenActionCount,
    searchResultCount,
    ...(parsed.ok ? {} : { failureClass: parsed.error.code }),
  };
}

function extraCaseResult(
  id: string,
  extras: Partial<NavigationEvalCaseResult>,
): NavigationEvalCaseResult {
  return {
    id,
    scenario: 'safety_extra',
    expectedOk: true,
    parseOk: true,
    expectedMissingSlots: [],
    predictedMissingSlots: [],
    predictedFirstTool: null,
    playbookFirstTool: null,
    toolsInvoked: [],
    planningAttempted: false,
    planningForbiddenExpected: false,
    forbiddenActionRejected: true,
    forbiddenActionCount: 0,
    extra: true,
    ...extras,
  };
}

async function runExtraCases(args: {
  catalog: POI[];
  sink: NavigationEventSink;
  clock: () => number;
  routes: RouteObservation[];
  illegalActions: IllegalActionObservation[];
}): Promise<NavigationEvalCaseResult[]> {
  const extra: NavigationEvalCaseResult[] = [];
  const origin = hydrateLocation(undefined, SYNTH_ORIGIN);
  const destination = hydrateLocation(undefined, { lng: 120.12, lat: 30.28 });

  const expiredStore = createRouteArtifactStore({ clock: args.clock });
  const expiredId = `rte_${'e'.repeat(32)}`;
  const writeExpired = expiredStore.write({
    routeId: expiredId,
    sessionId: EVAL_SESSION_FINGERPRINT,
    provider: 'amap',
    mode: 'transit',
    coordinateSystem: 'gcj02',
    geometry: [
      { lng: 120.1, lat: 30.2 },
      { lng: 120.12, lat: 30.28 },
    ],
    fetchedAt: new Date(args.clock()).toISOString(),
    expiresAt: new Date(args.clock() - 1).toISOString(),
  });
  extra.push(
    extraCaseResult('extra-expired-artifact', {
      parseOk: writeExpired.ok === false && writeExpired.reason === 'expired',
      expectedOk: false,
      failureClass: 'EXPIRED',
    }),
  );

  let now = args.clock();
  const ttlStore = createRouteArtifactStore({ clock: () => now });
  const liveId = `rte_${'a'.repeat(32)}`;
  const written = ttlStore.write({
    routeId: liveId,
    sessionId: EVAL_SESSION_FINGERPRINT,
    provider: 'amap',
    mode: 'transit',
    coordinateSystem: 'gcj02',
    geometry: [
      { lng: 120.1, lat: 30.2 },
      { lng: 120.12, lat: 30.28 },
    ],
    fetchedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
  });
  const wrong = ttlStore.read(liveId, 'b'.repeat(64));
  now += 70_000;
  const expiredRead = ttlStore.read(liveId, EVAL_SESSION_FINGERPRINT);
  extra.push(
    extraCaseResult('extra-unauthorized-artifact', {
      parseOk: written.ok && wrong.status === 'wrong_session',
      expectedOk: false,
      failureClass: 'FORBIDDEN',
    }),
  );
  extra.push(
    extraCaseResult('extra-expired-artifact-read', {
      parseOk: expiredRead.status === 'expired' || expiredRead.status === 'not_found',
      expectedOk: false,
      failureClass: 'EXPIRED',
    }),
  );

  const immediateTimeout = {
    setTimeoutFn: (callback: () => void) => {
      callback();
      return 0;
    },
    clearTimeoutFn: () => undefined,
  };
  const timeoutService = createRouteService({
    providers: [createTimeoutProvider()],
    timeoutMs: 20,
    allowEstimateFallback: true,
    clock: args.clock,
    ...immediateTimeout,
  });
  const timeoutResult = await timeoutService.plan(
    { origin, destination, mode: 'transit' },
    { fingerprint: EVAL_SESSION_FINGERPRINT },
  );
  if (timeoutResult.ok) {
    args.routes.push(planToRouteObservation('extra-timeout', timeoutResult.plan, { degradedFromProvider: true }));
    args.sink.emit({
      event: 'navigation_route_degraded',
      occurredAt: new Date(args.clock()).toISOString(),
      caseId: 'extra-timeout',
      task: 'interview_arrival',
      mode: 'transit',
      quality: timeoutResult.plan.quality,
      failureClass: 'TIMEOUT',
      completed: true,
    });
  }
  extra.push(
    extraCaseResult('extra-timeout', {
      planningAttempted: true,
      parseOk: timeoutResult.ok && timeoutResult.plan.quality === 'estimate' && !('routeId' in timeoutResult.plan),
      failureClass: 'TIMEOUT',
    }),
  );

  const hardFail = await createRouteService({
    providers: [createTimeoutProvider()],
    timeoutMs: 20,
    allowEstimateFallback: false,
    clock: args.clock,
    ...immediateTimeout,
  }).plan({ origin, destination, mode: 'transit' }, { fingerprint: EVAL_SESSION_FINGERPRINT });
  args.routes.push({
    caseId: 'extra-timeout-no-silent-success',
    provider: 'amap',
    quality: hardFail.ok ? hardFail.plan.quality : 'failed',
    fetchedAt: new Date(args.clock()).toISOString(),
    hasRouteId: hardFail.ok && 'routeId' in hardFail.plan && Boolean(hardFail.plan.routeId),
    hasGeometry: false,
    ok: hardFail.ok,
  });
  extra.push(
    extraCaseResult('extra-timeout-no-silent-success', {
      planningAttempted: true,
      parseOk: !hardFail.ok,
      expectedOk: false,
      failureClass: hardFail.ok ? 'INTERNAL' : hardFail.error.code,
    }),
  );

  const estimateService = createRouteService({ providers: [], clock: args.clock });
  const estimate = await estimateService.plan(
    { origin, destination, mode: 'transit' },
    { fingerprint: EVAL_SESSION_FINGERPRINT },
  );
  if (estimate.ok) {
    args.routes.push(planToRouteObservation('extra-estimate-no-route-id', estimate.plan));
  }
  extra.push(
    extraCaseResult('extra-estimate-no-route-id', {
      planningAttempted: true,
      parseOk: estimate.ok && estimate.plan.quality === 'estimate' && !('routeId' in estimate.plan),
    }),
  );

  const fakeService = createRouteService({
    providers: [createFakeProvider(args.clock)],
    clock: args.clock,
    artifactStore: createRouteArtifactStore({ clock: args.clock }),
  });
  const nav = navigationTools({
    routeService: fakeService,
    resolvePositions: async (ids) => resolvePositionsFromCatalog(args.catalog, ids),
  });
  const work = workTools({
    loadCatalog: async () => args.catalog,
    getPosition: async (id) => resolvePositionsFromCatalog(args.catalog, [id])[0],
    now: () => new Date(EVAL_NOW_MS),
  });
  const ctx = agentContext('extra-scenario', new AbortController().signal);

  const search = await toolByName(work, 'work__searchPositions').call(
    { query: 'AI', city: '杭州' },
    ctx,
  );
  const filtered = await toolByName(nav, 'navigation__filterByCommute').call(
    {
      positionIds: ['position-synthetic-a', 'position-synthetic-b'],
      origin,
      maxMinutes: 45,
      mode: 'transit',
    },
    ctx,
  );
  extra.push(
    extraCaseResult('extra-scenario-a-search', {
      predictedFirstTool: 'work__searchPositions',
      playbookFirstTool: 'work__searchPositions',
      toolsInvoked: ['work__searchPositions', 'navigation__filterByCommute'],
      planningAttempted: true,
      parseOk: search.ok && filtered.ok && !hasGeometryPayload(filtered.text),
      searchResultCount: search.ok ? countSearchResults(search.text) : 0,
    }),
  );
  if (filtered.ok) {
    args.routes.push({
      caseId: 'extra-scenario-a-search',
      provider: /quality=provider_route/.test(filtered.text) ? 'amap' : 'estimate',
      quality: /quality=provider_route/.test(filtered.text) ? 'provider_route' : 'estimate',
      fetchedAt: new Date(args.clock()).toISOString(),
      hasRouteId: /routeId=rte_/.test(filtered.text),
      hasGeometry: hasGeometryPayload(filtered.text),
      ok: true,
    });
  }
  args.sink.emit({
    event: 'navigation_job_search_completed',
    occurredAt: new Date(args.clock()).toISOString(),
    caseId: 'extra-scenario-a-search',
    task: 'job_search',
    city: '杭州',
    resultCount: search.ok ? countSearchResults(search.text) : 0,
    completed: search.ok,
  });

  const compared = await toolByName(nav, 'navigation__compareCommutes').call(
    {
      origin,
      mode: 'transit',
      positionIds: ['position-synthetic-a', 'position-synthetic-b'],
    },
    ctx,
  );
  extra.push(
    extraCaseResult('extra-scenario-b-compare', {
      predictedFirstTool: 'navigation__compareCommutes',
      playbookFirstTool: 'navigation__compareCommutes',
      toolsInvoked: ['navigation__compareCommutes'],
      planningAttempted: true,
      parseOk: compared.ok && /quality=provider_route/.test(compared.text) && /routeId=rte_/.test(compared.text) && !hasGeometryPayload(compared.text),
    }),
  );
  if (compared.ok) {
    args.routes.push({
      caseId: 'extra-scenario-b-compare',
      provider: 'amap',
      quality: 'provider_route',
      fetchedAt: new Date(args.clock()).toISOString(),
      hasRouteId: /routeId=rte_/.test(compared.text),
      hasGeometry: hasGeometryPayload(compared.text),
      ok: true,
    });
  }

  const planned = await toolByName(nav, 'navigation__planRoute').call(
    {
      origin,
      destination,
      mode: 'transit',
      arrivalAt: '2026-09-01T01:00:00.000Z',
      timezone: 'Asia/Shanghai',
    },
    ctx,
  );
  const routeIdMatch = planned.ok ? planned.text.match(/routeId=(rte_[a-f0-9]+)/) : null;
  if (planned.ok) {
    args.routes.push({
      caseId: 'extra-scenario-c-interview',
      provider: 'amap',
      quality: 'provider_route',
      fetchedAt: new Date(args.clock()).toISOString(),
      hasRouteId: Boolean(routeIdMatch),
      hasGeometry: hasGeometryPayload(planned.text),
      ok: true,
    });
    args.sink.emit({
      event: 'navigation_route_resolved',
      occurredAt: new Date(args.clock()).toISOString(),
      caseId: 'extra-scenario-c-interview',
      task: 'interview_arrival',
      mode: 'transit',
      quality: 'provider_route',
      completed: true,
    });
    if (routeIdMatch) {
      const applied = validateAction({ type: 'showRoute', payload: { routeId: routeIdMatch[1] } });
      args.sink.emit({
        event: 'navigation_route_action_applied',
        occurredAt: new Date(args.clock()).toISOString(),
        caseId: 'extra-scenario-c-interview',
        task: 'interview_arrival',
        completed: applied != null,
      });
    }
  }
  extra.push(
    extraCaseResult('extra-scenario-c-interview', {
      predictedFirstTool: 'navigation__planRoute',
      playbookFirstTool: 'navigation__planRoute',
      toolsInvoked: ['navigation__planRoute'],
      planningAttempted: true,
      parseOk: planned.ok && Boolean(routeIdMatch) && !hasGeometryPayload(planned.text),
    }),
  );

  const illegal = [
    { type: 'showRoute', payload: { routeId: 'rte_xx' } },
    { type: 'showRoute', payload: { routeId: 'short' } },
    {
      type: 'showRoute',
      payload: { routeId: `rte_${'f'.repeat(32)}`, geometry: [{ lng: 1, lat: 2 }] },
    },
    { type: 'launchMissiles', payload: { id: 'nope' } },
  ];
  const blocked = evaluateForbiddenActions('extra-illegal-actions', illegal, args.illegalActions);
  extra.push(
    extraCaseResult('extra-illegal-actions', {
      forbiddenActionCount: illegal.length,
      forbiddenActionRejected: blocked.forbiddenActionRejected,
      parseOk: blocked.forbiddenActionRejected,
    }),
  );

  return extra;
}

export async function runNavigationEval(options: NavigationEvalOptions): Promise<NavigationEvalReport> {
  const clock = options.clock ?? createEvalClock();
  const catalog = options.catalog ?? createEvalCatalog();
  const memory: MemoryNavigationEventSink = createMemorySink();
  const sink = options.sink ? createCompositeSink([memory, options.sink]) : memory;
  const routeService =
    options.routeService ??
    createRouteService({
      providers: [],
      clock,
      artifactStore: createRouteArtifactStore({ clock }),
    });
  const workToolList =
    options.workToolList ??
    workTools({
      loadCatalog: async () => catalog,
      getPosition: async (id) => resolvePositionsFromCatalog(catalog, [id])[0],
      now: () => new Date(EVAL_NOW_MS),
    });
  const navigationToolList =
    options.navigationToolList ??
    navigationTools({
      routeService,
      resolvePositions: async (ids) => resolvePositionsFromCatalog(catalog, ids),
    });
  const tools = [...workToolList, ...navigationToolList];
  const controller = new AbortController();

  const slots: SlotObservation[] = [];
  const toolsObs: ToolObservation[] = [];
  const routes: RouteObservation[] = [];
  const illegalActions: IllegalActionObservation[] = [];
  const cases: NavigationEvalCaseResult[] = [];

  for (const fixture of options.fixtures) {
    cases.push(
      await runFixtureCase({
        fixture,
        playbook: options.playbook,
        tools,
        catalog,
        sink,
        clock,
        signal: controller.signal,
        slots,
        toolsObs,
        routes,
        illegalActions,
      }),
    );
  }

  const extraCases =
    options.includeExtraCases === false
      ? []
      : await runExtraCases({ catalog, sink, clock, routes, illegalActions });

  const metrics = computeOfflineMetrics({
    slots,
    tools: toolsObs,
    routes,
    illegalActions,
  });

  return {
    generatedAt: new Date(clock()).toISOString(),
    fixtureCount: options.fixtures.length,
    extraCaseCount: extraCases.length,
    cases,
    extraCases,
    slots,
    tools: toolsObs,
    routes,
    illegalActions,
    events: [...memory.events],
    metrics,
  };
}

export function toPythonReportInput(report: NavigationEvalReport): Record<string, unknown> {
  return {
    generatedAt: report.generatedAt,
    fixtureCount: report.fixtureCount,
    extraCaseCount: report.extraCaseCount,
    cases: report.cases,
    extraCases: report.extraCases,
    slots: report.slots,
    tools: report.tools,
    routes: report.routes,
    illegalActions: report.illegalActions,
    metrics: report.metrics,
  };
}
