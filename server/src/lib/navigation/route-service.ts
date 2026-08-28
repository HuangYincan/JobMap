import { randomBytes } from 'node:crypto';
import { haversineDistance } from '../types.ts';
import {
  MAX_ROUTE_DISTANCE_METERS,
  MAX_ROUTE_DURATION_SECONDS,
  OPAQUE_ROUTE_ID_PATTERN,
} from './constants.ts';
import { createEstimateRoutePlan } from './estimate-provider.ts';
import { createRouteError } from './errors.ts';
import {
  createRouteArtifactStore,
  NAVIGATION_SESSION_FINGERPRINT_PATTERN,
  type RouteArtifactStore,
} from './route-artifacts.ts';
import {
  ProviderRouteFailureCodes,
  type ProviderPlanResult,
  type ProviderRouteFailureCode,
  type ProviderRouteResult,
  type RouteProvider,
} from './route-provider.ts';
import type {
  ProviderRoutePlan,
  RouteError,
  RouteErrorCode,
  RoutePlan,
  RouteRequest,
} from './types.ts';
import {
  parseRouteArtifact,
  parseRoutePlan,
  parseRouteRequest,
} from './validation.ts';

export const DEFAULT_ROUTE_PROVIDER_TIMEOUT_MS = 5_000;
export const MAX_GEOMETRY_ENDPOINT_DEVIATION_METERS = 2_000;
const MAX_PROVIDER_CLOCK_SKEW_MS = 60_000;
const ID_ISSUE_ATTEMPTS = 3;
const DUMMY_ROUTE_ID = `rte_${'0'.repeat(32)}`;
const PROVIDER_RESULT_FIELDS = new Set([
  'provider',
  'quality',
  'mode',
  'durationSeconds',
  'distanceMeters',
  'departureAt',
  'arrivalAt',
  'trafficAware',
  'fetchedAt',
  'expiresAt',
  'summary',
  'warnings',
  'coordinateSystem',
  'geometry',
]);

export interface NavigationRouteSession {
  /** Irreversible SHA-256 fingerprint; never the raw cookie token. */
  fingerprint: string;
}

export type RouteServiceResult =
  | { ok: true; plan: RoutePlan }
  | { ok: false; error: RouteError };

export interface RouteService {
  plan(
    request: unknown,
    session: NavigationRouteSession,
    signal?: AbortSignal,
  ): Promise<RouteServiceResult>;
}

type TimerHandle = unknown;

export interface RouteServiceOptions {
  providers?: RouteProvider[];
  artifactStore?: RouteArtifactStore;
  clock?: () => number;
  timeoutMs?: number;
  allowEstimateFallback?: boolean;
  idGenerator?: () => string;
  setTimeoutFn?: (callback: () => void, milliseconds: number) => TimerHandle;
  clearTimeoutFn?: (handle: TimerHandle) => void;
}

type ProviderValidation =
  | { ok: true; plan: ProviderRoutePlan; geometry: ProviderRouteResult['geometry']; coordinateSystem: ProviderRouteResult['coordinateSystem'] }
  | { ok: false; error: RouteErrorCode };

type ProviderAttempt = {
  outcome: ProviderPlanResult;
  callerAborted: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultRouteId(): string {
  return `rte_${randomBytes(16).toString('hex')}`;
}

function routeFailure(code: RouteErrorCode): RouteServiceResult {
  return { ok: false, error: createRouteError(code) };
}

function mapProviderFailure(code: ProviderRouteFailureCode): RouteErrorCode {
  switch (code) {
    case 'UNSUPPORTED':
      return 'UNSUPPORTED_MODE';
    case 'UNCONFIGURED':
      return 'PROVIDER_UNAVAILABLE';
    case 'ABORTED':
    case 'TIMEOUT':
      return 'TIMEOUT';
    case 'RATE_LIMITED':
      return 'RATE_LIMITED';
    case 'UNAUTHORIZED':
      return 'UNAUTHORIZED';
    case 'NO_ROUTE':
      return 'NO_ROUTE';
    case 'COORDINATE_ERROR':
      return 'COORDINATE_ERROR';
    case 'PROVIDER_ERROR':
      return 'PROVIDER_ERROR';
  }
}

function fallbackWarning(code: RouteErrorCode): string {
  switch (code) {
    case 'UNSUPPORTED_MODE':
      return '真实路线供应商不支持该出行方式，已返回直线距离估算';
    case 'PROVIDER_UNAVAILABLE':
      return '真实路线供应商未配置或不可用，已返回直线距离估算';
    case 'TIMEOUT':
      return '真实路线供应商响应超时，已返回直线距离估算';
    case 'RATE_LIMITED':
      return '真实路线供应商限流，已返回直线距离估算';
    case 'UNAUTHORIZED':
      return '真实路线供应商未授权，已返回直线距离估算';
    case 'NO_ROUTE':
      return '未找到真实路线，已返回直线距离估算';
    case 'COORDINATE_ERROR':
      return '供应商结果坐标无效，已返回直线距离估算';
    case 'PROVIDER_ERROR':
      return '真实路线供应商失败或供应商结果无效，已返回直线距离估算';
    case 'INTERNAL':
      return '路线产物无法安全保存，已返回直线距离估算';
    default:
      return '真实路线供应商结果无效，已返回直线距离估算';
  }
}

function isProviderPlanResult(value: unknown): value is ProviderPlanResult {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false;
  if (value.ok) return Object.hasOwn(value, 'value');
  return (
    typeof value.error === 'string' &&
    ProviderRouteFailureCodes.includes(value.error as ProviderRouteFailureCode)
  );
}

function validateProviderResult(
  raw: unknown,
  provider: RouteProvider,
  request: RouteRequest,
  now: number,
): ProviderValidation {
  if (!isRecord(raw)) return { ok: false, error: 'PROVIDER_ERROR' };
  for (const key of Object.keys(raw)) {
    if (!PROVIDER_RESULT_FIELDS.has(key)) {
      return { ok: false, error: 'PROVIDER_ERROR' };
    }
  }
  const value = raw as unknown as ProviderRouteResult;
  if (
    value.provider !== provider.id ||
    value.quality !== 'provider_route' ||
    value.mode !== request.mode ||
    typeof value.durationSeconds !== 'number' ||
    !Number.isFinite(value.durationSeconds) ||
    value.durationSeconds < 0 ||
    value.durationSeconds > MAX_ROUTE_DURATION_SECONDS ||
    typeof value.distanceMeters !== 'number' ||
    !Number.isFinite(value.distanceMeters) ||
    value.distanceMeters < 0 ||
    value.distanceMeters > MAX_ROUTE_DISTANCE_METERS
  ) {
    return { ok: false, error: 'PROVIDER_ERROR' };
  }

  const requestSystem = request.origin.coordinateSystem;
  if (
    !requestSystem ||
    request.destination.coordinateSystem !== requestSystem ||
    value.coordinateSystem !== requestSystem
  ) {
    return { ok: false, error: 'COORDINATE_ERROR' };
  }

  const planCandidate = {
    routeId: DUMMY_ROUTE_ID,
    mode: value.mode,
    originLabel: request.origin.label?.trim() || '起点',
    destinationLabel: request.destination.label?.trim() || '终点',
    durationSeconds: value.durationSeconds,
    distanceMeters: value.distanceMeters,
    ...(value.departureAt !== undefined ? { departureAt: value.departureAt } : {}),
    ...(value.arrivalAt !== undefined ? { arrivalAt: value.arrivalAt } : {}),
    provider: value.provider,
    quality: value.quality,
    trafficAware: value.trafficAware,
    fetchedAt: value.fetchedAt,
    expiresAt: value.expiresAt,
    ...(value.summary !== undefined ? { summary: value.summary } : {}),
    warnings: value.warnings,
  };
  const parsedPlan = parseRoutePlan(planCandidate);
  if (!parsedPlan.ok || parsedPlan.value.quality !== 'provider_route') {
    return { ok: false, error: 'PROVIDER_ERROR' };
  }
  const fetchedAt = Date.parse(parsedPlan.value.fetchedAt);
  const expiresAt = Date.parse(parsedPlan.value.expiresAt);
  if (
    expiresAt <= now ||
    fetchedAt > now + MAX_PROVIDER_CLOCK_SKEW_MS
  ) {
    return { ok: false, error: 'PROVIDER_ERROR' };
  }

  const artifactCandidate = parseRouteArtifact({
    routeId: DUMMY_ROUTE_ID,
    sessionId: '0'.repeat(64),
    provider: value.provider,
    mode: value.mode,
    coordinateSystem: value.coordinateSystem,
    geometry: value.geometry,
    fetchedAt: value.fetchedAt,
    expiresAt: value.expiresAt,
  });
  if (!artifactCandidate.ok) {
    return { ok: false, error: 'COORDINATE_ERROR' };
  }

  const origin = {
    lng: request.origin.lng as number,
    lat: request.origin.lat as number,
  };
  const destination = {
    lng: request.destination.lng as number,
    lat: request.destination.lat as number,
  };
  const geometry = artifactCandidate.value.geometry;
  if (
    haversineDistance(origin, geometry[0]) > MAX_GEOMETRY_ENDPOINT_DEVIATION_METERS ||
    haversineDistance(destination, geometry[geometry.length - 1]) >
      MAX_GEOMETRY_ENDPOINT_DEVIATION_METERS
  ) {
    return { ok: false, error: 'COORDINATE_ERROR' };
  }

  return {
    ok: true,
    plan: parsedPlan.value,
    geometry,
    coordinateSystem: artifactCandidate.value.coordinateSystem,
  };
}

async function callProvider(
  provider: RouteProvider,
  request: RouteRequest,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  setTimeoutFn: NonNullable<RouteServiceOptions['setTimeoutFn']>,
  clearTimeoutFn: NonNullable<RouteServiceOptions['clearTimeoutFn']>,
): Promise<ProviderAttempt> {
  const controller = new AbortController();
  let callerAborted = false;
  let resolveBoundary: (outcome: ProviderPlanResult) => void = () => undefined;
  const boundary = new Promise<ProviderPlanResult>((resolve) => {
    resolveBoundary = resolve;
  });
  const onCallerAbort = () => {
    callerAborted = true;
    controller.abort(signal?.reason);
    resolveBoundary({ ok: false, error: 'ABORTED' });
  };
  if (signal?.aborted) onCallerAbort();
  else signal?.addEventListener('abort', onCallerAbort, { once: true });

  const timer = setTimeoutFn(() => {
    controller.abort(new Error('route provider timeout'));
    resolveBoundary({ ok: false, error: 'TIMEOUT' });
  }, timeoutMs);

  const providerCall = Promise.resolve()
    .then(() => provider.plan(request, controller.signal))
    .then((outcome): ProviderPlanResult => (
      isProviderPlanResult(outcome)
        ? outcome
        : { ok: false, error: 'PROVIDER_ERROR' }
    ))
    .catch((): ProviderPlanResult => ({ ok: false, error: 'PROVIDER_ERROR' }));

  try {
    return {
      outcome: await Promise.race([providerCall, boundary]),
      callerAborted,
    };
  } finally {
    clearTimeoutFn(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

function estimateFallback(
  request: RouteRequest,
  code: RouteErrorCode,
  clock: () => number,
): RouteServiceResult {
  const estimate = createEstimateRoutePlan(request, {
    clock,
    additionalWarnings: [fallbackWarning(code)],
  });
  return estimate.ok ? estimate : { ok: false, error: estimate.error };
}

export function createRouteService(
  options: RouteServiceOptions = {},
): RouteService {
  // Conservative production default: no live provider is registered here.
  const providers = [...(options.providers ?? [])];
  const artifactStore = options.artifactStore ?? createRouteArtifactStore({
    clock: options.clock,
  });
  const clock = options.clock ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_ROUTE_PROVIDER_TIMEOUT_MS;
  const allowEstimateFallback = options.allowEstimateFallback ?? true;
  const idGenerator = options.idGenerator ?? defaultRouteId;
  const setTimeoutFn = options.setTimeoutFn ??
    ((callback: () => void, milliseconds: number) => setTimeout(callback, milliseconds));
  const clearTimeoutFn = options.clearTimeoutFn ??
    ((handle: TimerHandle) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError('route provider timeout must be a positive integer');
  }

  return {
    async plan(
      rawRequest: unknown,
      session: NavigationRouteSession,
      signal?: AbortSignal,
    ): Promise<RouteServiceResult> {
      const parsed = parseRouteRequest(rawRequest);
      if (
        !parsed.ok ||
        !session ||
        !NAVIGATION_SESSION_FINGERPRINT_PATTERN.test(session.fingerprint)
      ) {
        return routeFailure('INVALID_REQUEST');
      }
      const request = parsed.value;
      if (request.origin.coordinateSystem !== request.destination.coordinateSystem) {
        return routeFailure('COORDINATE_ERROR');
      }
      if (signal?.aborted) return routeFailure('TIMEOUT');

      const failures: RouteErrorCode[] = [];
      for (const provider of providers) {
        let configured: boolean;
        let supported: boolean;
        try {
          configured = provider.isConfigured();
          if (!configured) {
            failures.push('PROVIDER_UNAVAILABLE');
            continue;
          }
          supported = provider.supports(request);
          if (!supported) {
            failures.push('UNSUPPORTED_MODE');
            continue;
          }
        } catch {
          failures.push('PROVIDER_ERROR');
          continue;
        }

        const attempt = await callProvider(
          provider,
          request,
          signal,
          timeoutMs,
          setTimeoutFn,
          clearTimeoutFn,
        );
        if (attempt.callerAborted) return routeFailure('TIMEOUT');
        if (!attempt.outcome.ok) {
          failures.push(mapProviderFailure(attempt.outcome.error));
          continue;
        }

        const validated = validateProviderResult(
          attempt.outcome.value,
          provider,
          request,
          clock(),
        );
        if (!validated.ok) {
          failures.push(validated.error);
          continue;
        }

        let issueFailure: RouteErrorCode = 'INTERNAL';
        for (let issue = 0; issue < ID_ISSUE_ATTEMPTS; issue += 1) {
          const routeId = idGenerator();
          if (!OPAQUE_ROUTE_ID_PATTERN.test(routeId)) continue;
          const write = artifactStore.write({
            routeId,
            sessionId: session.fingerprint,
            provider: validated.plan.provider,
            mode: validated.plan.mode,
            coordinateSystem: validated.coordinateSystem,
            geometry: validated.geometry,
            fetchedAt: validated.plan.fetchedAt,
            expiresAt: validated.plan.expiresAt,
          });
          if (write.ok) {
            return {
              ok: true,
              plan: {
                ...validated.plan,
                routeId,
              },
            };
          }
          if (write.reason !== 'duplicate') break;
          issueFailure = 'INTERNAL';
        }
        failures.push(issueFailure);
      }

      const failure = failures[0] ?? 'PROVIDER_UNAVAILABLE';
      return allowEstimateFallback
        ? estimateFallback(request, failure, clock)
        : routeFailure(failure);
    },
  };
}
