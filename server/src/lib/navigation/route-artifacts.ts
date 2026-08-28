import {
  MAX_ROUTE_ID_LENGTH,
  OPAQUE_ROUTE_ID_PATTERN,
} from './constants.ts';
import type { RouteArtifact } from './types.ts';
import { parseRouteArtifact } from './validation.ts';

export const DEFAULT_ROUTE_ARTIFACT_CAPACITY = 1_000;
export const DEFAULT_ROUTE_ARTIFACT_GEOMETRY_POINT_BUDGET = 50_000;
export const NAVIGATION_SESSION_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

export type PublicRouteArtifact = Omit<RouteArtifact, 'sessionId'>;

export type RouteArtifactReadResult =
  | { status: 'ok'; artifact: PublicRouteArtifact }
  | { status: 'malformed' }
  | { status: 'unauthorized' }
  | { status: 'not_found' }
  | { status: 'wrong_session' }
  | { status: 'expired' };

export type RouteArtifactWriteResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'expired' | 'duplicate' | 'point_budget' };

export interface RouteArtifactReader {
  read(routeId: unknown, sessionFingerprint: string | null): RouteArtifactReadResult;
}

export interface RouteArtifactStore extends RouteArtifactReader {
  readonly size: number;
  readonly geometryPointCount: number;
  readonly geometryPointBudget: number;
  write(candidate: unknown): RouteArtifactWriteResult;
  clearExpired(): number;
}

export interface RouteArtifactStoreOptions {
  capacity?: number;
  geometryPointBudget?: number;
  clock?: () => number;
}

function cloneArtifact(artifact: RouteArtifact): RouteArtifact {
  return {
    ...artifact,
    geometry: artifact.geometry.map((point) => ({ ...point })),
  };
}

export function publicRouteArtifact(artifact: RouteArtifact): PublicRouteArtifact {
  return {
    routeId: artifact.routeId,
    provider: artifact.provider,
    mode: artifact.mode,
    coordinateSystem: artifact.coordinateSystem,
    geometry: artifact.geometry.map((point) => ({ ...point })),
    fetchedAt: artifact.fetchedAt,
    expiresAt: artifact.expiresAt,
  };
}

/**
 * Process-local store with entry-count and aggregate geometry-point ceilings.
 * Reads never extend TTL, and an unauthorized read never mutates the owning
 * session's entry.
 */
export function createRouteArtifactStore(
  options: RouteArtifactStoreOptions = {},
): RouteArtifactStore {
  const capacity = options.capacity ?? DEFAULT_ROUTE_ARTIFACT_CAPACITY;
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError('route artifact capacity must be a positive integer');
  }
  const geometryPointBudget =
    options.geometryPointBudget ??
    DEFAULT_ROUTE_ARTIFACT_GEOMETRY_POINT_BUDGET;
  if (
    !Number.isSafeInteger(geometryPointBudget) ||
    geometryPointBudget < 2
  ) {
    throw new RangeError(
      'route artifact geometry point budget must be an integer of at least 2',
    );
  }
  const clock = options.clock ?? Date.now;
  const entries = new Map<string, RouteArtifact>();
  let geometryPointCount = 0;

  const deleteEntry = (id: string): boolean => {
    const artifact = entries.get(id);
    if (!artifact) return false;
    entries.delete(id);
    geometryPointCount -= artifact.geometry.length;
    return true;
  };

  const clearExpired = (): number => {
    const now = clock();
    let removed = 0;
    for (const [id, artifact] of entries) {
      if (Date.parse(artifact.expiresAt) <= now) {
        if (deleteEntry(id)) removed += 1;
      }
    }
    return removed;
  };

  return {
    get size() {
      return entries.size;
    },

    get geometryPointCount() {
      return geometryPointCount;
    },

    get geometryPointBudget() {
      return geometryPointBudget;
    },

    clearExpired,

    write(candidate: unknown): RouteArtifactWriteResult {
      const parsed = parseRouteArtifact(candidate);
      if (
        !parsed.ok ||
        !NAVIGATION_SESSION_FINGERPRINT_PATTERN.test(
          parsed.ok ? parsed.value.sessionId : '',
        )
      ) {
        return { ok: false, reason: 'invalid' };
      }
      if (Date.parse(parsed.value.expiresAt) <= clock()) {
        return { ok: false, reason: 'expired' };
      }
      clearExpired();
      if (entries.has(parsed.value.routeId)) {
        return { ok: false, reason: 'duplicate' };
      }
      const points = parsed.value.geometry.length;
      if (points > geometryPointBudget) {
        return { ok: false, reason: 'point_budget' };
      }
      while (
        entries.size >= capacity ||
        geometryPointCount + points > geometryPointBudget
      ) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        deleteEntry(oldest);
      }
      entries.set(parsed.value.routeId, cloneArtifact(parsed.value));
      geometryPointCount += points;
      return { ok: true };
    },

    read(routeId: unknown, sessionFingerprint: string | null): RouteArtifactReadResult {
      if (
        typeof routeId !== 'string' ||
        routeId.length === 0 ||
        routeId.length > MAX_ROUTE_ID_LENGTH ||
        !OPAQUE_ROUTE_ID_PATTERN.test(routeId)
      ) {
        return { status: 'malformed' };
      }
      if (
        !sessionFingerprint ||
        !NAVIGATION_SESSION_FINGERPRINT_PATTERN.test(sessionFingerprint)
      ) {
        return { status: 'unauthorized' };
      }
      const artifact = entries.get(routeId);
      if (!artifact) return { status: 'not_found' };
      if (artifact.sessionId !== sessionFingerprint) {
        return { status: 'wrong_session' };
      }
      if (Date.parse(artifact.expiresAt) <= clock()) {
        deleteEntry(routeId);
        return { status: 'expired' };
      }
      return { status: 'ok', artifact: publicRouteArtifact(artifact) };
    },
  };
}
