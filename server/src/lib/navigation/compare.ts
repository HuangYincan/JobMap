// Deep module: commute comparison matrix and constraint hits.
// No composite recommendation score. Callers inject RouteService.

import {
  MAX_CANDIDATE_IDS,
  MAX_COMMUTE_MINUTES,
  MIN_COMMUTE_MINUTES,
} from './constants.ts';
import type { RouteService, RouteServiceResult } from './route-service.ts';
import type {
  NavigationLocationRef,
  RoutePlan,
  TravelMode,
} from './types.ts';

export const DEFAULT_COMMUTE_TOP_K = 5;
export const COMMUTE_COMPARE_CONCURRENCY = 3;
export const MAX_COMMUTE_ROUTE_CALLS = MAX_CANDIDATE_IDS;
export const MIN_COMPARE_DESTINATIONS = 2;

export interface CompareDestination {
  id: string;
  label: string;
  location: NavigationLocationRef;
}

export interface CommuteCompareInput {
  origin: NavigationLocationRef;
  destinations: CompareDestination[];
  mode: TravelMode;
}

export interface CommuteFilterInput {
  origin: NavigationLocationRef;
  candidates: CompareDestination[];
  mode: TravelMode;
  maxMinutes: number;
  topK?: number;
}

export interface CommuteMatrixSuccess {
  id: string;
  label: string;
  status: 'ok';
  durationSeconds: number;
  distanceMeters: number;
  quality: RoutePlan['quality'];
  provider: RoutePlan['provider'];
  fetchedAt: string;
  warnings: string[];
  constraintHit?: boolean;
  routeId?: string;
}

export interface CommuteMatrixFailure {
  id: string;
  label: string;
  status: 'error';
  code: string;
  message: string;
}

export type CommuteMatrixEntry = CommuteMatrixSuccess | CommuteMatrixFailure;

export interface CommuteMatrix {
  originLabel: string;
  mode: TravelMode;
  entries: CommuteMatrixEntry[];
  routeCalls: number;
  budgetNote?: string;
}

export interface CommuteFilterResult {
  matrix: CommuteMatrix;
  hits: CommuteMatrixSuccess[];
  nearest?: CommuteMatrixSuccess;
  relaxedMinutes?: number;
}

export interface CompareRuntime {
  routeService: RouteService;
  fingerprint: string;
  signal?: AbortSignal;
  concurrency?: number;
  maxRouteCalls?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function formatRoutePlanSummary(plan: RoutePlan): string {
  const parts = [
    `quality=${plan.quality}`,
    `provider=${plan.provider}`,
    `mode=${plan.mode}`,
    `origin=${plan.originLabel}`,
    `destination=${plan.destinationLabel}`,
    `durationSeconds=${plan.durationSeconds}`,
    `distanceMeters=${plan.distanceMeters}`,
    `fetchedAt=${plan.fetchedAt}`,
  ];
  if (plan.quality === 'provider_route') parts.push(`routeId=${plan.routeId}`);
  if (plan.departureAt) parts.push(`departureAt=${plan.departureAt}`);
  if (plan.arrivalAt) parts.push(`arrivalAt=${plan.arrivalAt}`);
  if (plan.trafficAware) parts.push('trafficAware=true');
  if (plan.summary?.transferCount != null) parts.push(`transfers=${plan.summary.transferCount}`);
  if (plan.summary?.walkingMeters != null) parts.push(`walkingMeters=${plan.summary.walkingMeters}`);
  if (plan.warnings.length > 0) parts.push(`warnings=${plan.warnings.join('; ')}`);
  return parts.join(' ');
}

function successFromPlan(dest: CompareDestination, plan: RoutePlan): CommuteMatrixSuccess {
  const entry: CommuteMatrixSuccess = {
    id: dest.id,
    label: dest.label,
    status: 'ok',
    durationSeconds: plan.durationSeconds,
    distanceMeters: plan.distanceMeters,
    quality: plan.quality,
    provider: plan.provider,
    fetchedAt: plan.fetchedAt,
    warnings: plan.warnings,
  };
  if (plan.quality === 'provider_route') entry.routeId = plan.routeId;
  return entry;
}

function failureFromResult(dest: CompareDestination, result: RouteServiceResult): CommuteMatrixFailure {
  if (result.ok) {
    return { id: dest.id, label: dest.label, status: 'error', code: 'INTERNAL', message: '路线结果无效' };
  }
  return {
    id: dest.id,
    label: dest.label,
    status: 'error',
    code: result.error.code,
    message: result.error.message,
  };
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      if (signal?.aborted) return;
      const index = cursor;
      cursor += 1;
      out[index] = await worker(items[index]);
    }
  }
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, () => run()));
  return out;
}

async function planDestinations(
  input: { origin: NavigationLocationRef; destinations: CompareDestination[]; mode: TravelMode },
  runtime: CompareRuntime,
): Promise<CommuteMatrix> {
  const concurrency = runtime.concurrency ?? COMMUTE_COMPARE_CONCURRENCY;
  const maxRouteCalls = runtime.maxRouteCalls ?? MAX_COMMUTE_ROUTE_CALLS;
  const planned = input.destinations.slice(0, maxRouteCalls);
  const skipped = input.destinations.length - planned.length;
  let routeCalls = 0;
  const entries = await mapPool(
    planned,
    concurrency,
    async (dest) => {
      routeCalls += 1;
      const result = await runtime.routeService.plan(
        {
          origin: input.origin,
          destination: dest.location,
          mode: input.mode,
        },
        { fingerprint: runtime.fingerprint },
        runtime.signal,
      );
      return result.ok ? successFromPlan(dest, result.plan) : failureFromResult(dest, result);
    },
    runtime.signal,
  );
  const matrix: CommuteMatrix = {
    originLabel: input.origin.label?.trim() || '起点',
    mode: input.mode,
    entries,
    routeCalls,
  };
  if (skipped > 0) {
    matrix.budgetNote = `路线调用预算 ${maxRouteCalls}，其余 ${skipped} 个候选未请求路线`;
  }
  return matrix;
}

export async function compareCommutes(
  input: CommuteCompareInput,
  runtime: CompareRuntime,
): Promise<{ ok: true; matrix: CommuteMatrix } | { ok: false; error: string }> {
  if (!Array.isArray(input.destinations)) {
    return { ok: false, error: '候选办公点无效' };
  }
  if (input.destinations.length < MIN_COMPARE_DESTINATIONS) {
    return { ok: false, error: '通勤比较需要 2–5 个候选办公点' };
  }
  if (input.destinations.length > MAX_CANDIDATE_IDS) {
    return { ok: false, error: '通勤比较最多 5 个候选办公点' };
  }
  if (!isRecord(input.origin) || !input.mode) {
    return { ok: false, error: '起点或出行方式无效' };
  }
  const matrix = await planDestinations(input, runtime);
  return { ok: true, matrix };
}

export async function filterCandidatesByCommute(
  input: CommuteFilterInput,
  runtime: CompareRuntime,
): Promise<{ ok: true; result: CommuteFilterResult } | { ok: false; error: string }> {
  if (!Number.isFinite(input.maxMinutes) || input.maxMinutes < MIN_COMMUTE_MINUTES || input.maxMinutes > MAX_COMMUTE_MINUTES) {
    return { ok: false, error: '通勤上限分钟无效' };
  }
  if (!Array.isArray(input.candidates)) {
    return { ok: false, error: '候选岗位无效' };
  }
  const topK = Math.min(
    MAX_CANDIDATE_IDS,
    Math.max(1, Math.floor(input.topK ?? DEFAULT_COMMUTE_TOP_K)),
  );
  const maxRouteCalls = Math.min(runtime.maxRouteCalls ?? MAX_COMMUTE_ROUTE_CALLS, topK);
  const selected = input.candidates.slice(0, maxRouteCalls);
  const matrix = await planDestinations(
    { origin: input.origin, destinations: selected, mode: input.mode },
    { ...runtime, maxRouteCalls },
  );
  if (input.candidates.length > selected.length && !matrix.budgetNote) {
    matrix.budgetNote = `Top-K=${topK}，已限制路线请求以免 N+1`;
  }
  const successes = matrix.entries.filter((entry): entry is CommuteMatrixSuccess => entry.status === 'ok');
  const limitSeconds = input.maxMinutes * 60;
  const hits = successes
    .filter((entry) => entry.durationSeconds <= limitSeconds)
    .map((entry) => ({ ...entry, constraintHit: true }));
  const overLimit = successes
    .filter((entry) => entry.durationSeconds > limitSeconds)
    .sort((a, b) => a.durationSeconds - b.durationSeconds);
  const nearest = hits[0]
    ?? overLimit[0]
    ?? successes.slice().sort((a, b) => a.durationSeconds - b.durationSeconds)[0];
  const result: CommuteFilterResult = { matrix, hits };
  if (nearest) result.nearest = nearest;
  if (hits.length === 0 && overLimit[0]) {
    result.relaxedMinutes = Math.ceil(overLimit[0].durationSeconds / 60);
  }
  return { ok: true, result };
}

export function formatCommuteMatrix(matrix: CommuteMatrix): string {
  const lines = [
    `通勤矩阵 origin=${matrix.originLabel} mode=${matrix.mode} 调用=${matrix.routeCalls}`,
  ];
  if (matrix.budgetNote) lines.push(matrix.budgetNote);
  for (const entry of matrix.entries) {
    if (entry.status === 'ok') {
      const hit = entry.constraintHit === true ? '约束命中' : entry.constraintHit === false ? '超出上限' : '已规划';
      lines.push(
        `- ${entry.id} ${entry.label}: ${hit} durationSeconds=${entry.durationSeconds} quality=${entry.quality} provider=${entry.provider}${entry.routeId ? ` routeId=${entry.routeId}` : ''}`,
      );
    } else {
      lines.push(`- ${entry.id} ${entry.label}: 失败 ${entry.code} ${entry.message}`);
    }
  }
  return lines.join('\n');
}

export function formatFilterResult(result: CommuteFilterResult, maxMinutes: number): string {
  const lines = [
    `严格通勤过滤: 上限 ${maxMinutes} 分钟, 严格命中 ${result.hits.length} 个`,
    formatCommuteMatrix(result.matrix),
  ];
  if (result.hits.length === 0) {
    lines.push('严格命中 0 个,不得把超限结果伪装成命中。');
    if (result.nearest && result.nearest.status === 'ok') {
      const minutes = Math.ceil(result.nearest.durationSeconds / 60);
      lines.push(
        `最接近候选: ${result.nearest.id} ${result.nearest.label} 约 ${minutes} 分钟(${result.nearest.quality})。` +
          (result.relaxedMinutes ? `可考虑放宽到 ${result.relaxedMinutes} 分钟。` : ''),
      );
    }
  }
  return lines.join('\n');
}
