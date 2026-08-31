import { estimateMinutes } from '../commute.ts';
import { haversineDistance } from '../types.ts';
import {
  MAX_ROUTE_TTL_SECONDS,
  MAX_ROUTE_WARNINGS,
  MAX_WARNING_LENGTH,
} from './constants.ts';
import { createRouteError } from './errors.ts';
import type { EstimateRoutePlan, RouteError, RouteRequest } from './types.ts';
import { parseRoutePlan } from './validation.ts';

export const DEFAULT_ESTIMATE_TTL_SECONDS = 5 * 60;
export const ESTIMATE_LIMITATION_WARNING =
  '基于两点直线距离估算，不代表道路路线、实时路况或可信路线几何';

export type EstimateRouteResult =
  | { ok: true; plan: EstimateRoutePlan }
  | { ok: false; error: RouteError };

export interface EstimateRouteOptions {
  clock?: () => number;
  ttlSeconds?: number;
  additionalWarnings?: string[];
}

function coordinateFailure(): EstimateRouteResult {
  return { ok: false, error: createRouteError('COORDINATE_ERROR') };
}

function safeWarnings(additional: string[] | undefined): string[] {
  const warnings = [ESTIMATE_LIMITATION_WARNING, ...(additional ?? [])]
    .filter((warning): warning is string => typeof warning === 'string' && warning.trim().length > 0)
    .map((warning) => warning.trim().slice(0, MAX_WARNING_LENGTH));
  return [...new Set(warnings)].slice(0, MAX_ROUTE_WARNINGS);
}

/**
 * Explicit straight-line fallback. It reuses the existing commute speed/
 * overhead rules and the repository haversine implementation.
 */
export function createEstimateRoutePlan(
  request: RouteRequest,
  options: EstimateRouteOptions = {},
): EstimateRouteResult {
  const origin = request.origin;
  const destination = request.destination;
  if (
    typeof origin.lng !== 'number' ||
    typeof origin.lat !== 'number' ||
    typeof destination.lng !== 'number' ||
    typeof destination.lat !== 'number' ||
    !Number.isFinite(origin.lng) ||
    !Number.isFinite(origin.lat) ||
    !Number.isFinite(destination.lng) ||
    !Number.isFinite(destination.lat) ||
    !origin.coordinateSystem ||
    !destination.coordinateSystem ||
    origin.coordinateSystem !== destination.coordinateSystem
  ) {
    return coordinateFailure();
  }

  const now = (options.clock ?? Date.now)();
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_ESTIMATE_TTL_SECONDS;
  if (
    !Number.isFinite(now) ||
    !Number.isInteger(ttlSeconds) ||
    ttlSeconds < 1 ||
    ttlSeconds > MAX_ROUTE_TTL_SECONDS
  ) {
    return { ok: false, error: createRouteError('INTERNAL') };
  }

  const distanceMeters = haversineDistance(
    { lng: origin.lng, lat: origin.lat },
    { lng: destination.lng, lat: destination.lat },
  );
  const durationSeconds = estimateMinutes(distanceMeters, request.mode) * 60;
  const warnings = safeWarnings(options.additionalWarnings);
  let departureAt: string | undefined;
  let arrivalAt: string | undefined;

  if (request.departureAt) {
    const departureMs = Date.parse(request.departureAt);
    if (!Number.isFinite(departureMs)) {
      return { ok: false, error: createRouteError('INVALID_REQUEST') };
    }
    departureAt = request.departureAt;
    arrivalAt = new Date(departureMs + durationSeconds * 1_000).toISOString();
    if (request.arrivalAt && Date.parse(arrivalAt) > Date.parse(request.arrivalAt)) {
      warnings.push('按出发时间估算的到达时间晚于请求到达时间');
    }
  } else if (request.arrivalAt) {
    const arrivalMs = Date.parse(request.arrivalAt);
    if (!Number.isFinite(arrivalMs)) {
      return { ok: false, error: createRouteError('INVALID_REQUEST') };
    }
    arrivalAt = request.arrivalAt;
    departureAt = new Date(arrivalMs - durationSeconds * 1_000).toISOString();
    warnings.push('出发时间按估算时长倒推，不代表供应商支持 arrival-by');
  }

  const candidate = {
    mode: request.mode,
    originLabel: origin.label?.trim() || '起点',
    destinationLabel: destination.label?.trim() || '终点',
    durationSeconds,
    distanceMeters,
    ...(departureAt ? { departureAt } : {}),
    ...(arrivalAt ? { arrivalAt } : {}),
    provider: 'estimate' as const,
    quality: 'estimate' as const,
    trafficAware: false as const,
    fetchedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlSeconds * 1_000).toISOString(),
    warnings: safeWarnings(warnings),
  };
  const parsed = parseRoutePlan(candidate);
  if (!parsed.ok || parsed.value.quality !== 'estimate') {
    return { ok: false, error: createRouteError('INTERNAL') };
  }
  return { ok: true, plan: parsed.value };
}
