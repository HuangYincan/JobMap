// 客户端读取同会话路线 artifact。只经 GET /api/navigation/routes/:routeId,
// credentials: 'include'(cookie 由浏览器随请求发送,不写入 JS 可读存储)。
// 成功路径把 geometry 交给 MapBridge.drawRoute;本模块不把 geometry 打日志。

import { MAX_GEOMETRY_POINTS, OPAQUE_ROUTE_ID_PATTERN } from './constants.ts';

export type RouteArtifactFetchError =
  | 'EXPIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'INTERNAL'
  | 'OFFLINE'
  | 'INVALID';

export interface RouteOverlayMeta {
  provider: string;
  fetchedAt: string;
  quality: 'provider_route';
  trafficAware: false;
}

export interface RouteArtifactFetchOk {
  ok: true;
  path: Array<{ lng: number; lat: number }>;
  meta: RouteOverlayMeta;
}

export interface RouteArtifactFetchFail {
  ok: false;
  code: RouteArtifactFetchError;
}

export type RouteArtifactFetchResult = RouteArtifactFetchOk | RouteArtifactFetchFail;

export type FetchLike = (
  input: string,
  init?: { credentials?: RequestCredentials; method?: string },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

function statusToCode(status: number): RouteArtifactFetchError {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 410) return 'EXPIRED';
  return 'INTERNAL';
}

function isLngLat(value: unknown): value is { lng: number; lat: number } {
  if (!value || typeof value !== 'object') return false;
  const rec = value as { lng?: unknown; lat?: unknown };
  return (
    typeof rec.lng === 'number' &&
    typeof rec.lat === 'number' &&
    Number.isFinite(rec.lng) &&
    Number.isFinite(rec.lat)
  );
}

function readPath(body: unknown): Array<{ lng: number; lat: number }> | null {
  if (!body || typeof body !== 'object') return null;
  const geometry = (body as { geometry?: unknown }).geometry;
  if (!Array.isArray(geometry) || geometry.length < 2 || geometry.length > MAX_GEOMETRY_POINTS) {
    return null;
  }
  const path: Array<{ lng: number; lat: number }> = [];
  for (const point of geometry) {
    if (!isLngLat(point)) return null;
    path.push({ lng: point.lng, lat: point.lat });
  }
  return path;
}

export function navigationRouteUrl(routeId: string): string {
  return `/api/navigation/routes/${encodeURIComponent(routeId)}`;
}

export async function fetchPublicRouteArtifact(
  routeId: string,
  fetchImpl: FetchLike,
): Promise<RouteArtifactFetchResult> {
  if (typeof routeId !== 'string' || !OPAQUE_ROUTE_ID_PATTERN.test(routeId)) {
    return { ok: false, code: 'INVALID' };
  }
  if (typeof fetchImpl !== 'function') {
    return { ok: false, code: 'OFFLINE' };
  }
  let response: { ok: boolean; status: number; json(): Promise<unknown> };
  try {
    response = await fetchImpl(navigationRouteUrl(routeId), {
      method: 'GET',
      credentials: 'include',
    });
  } catch {
    return { ok: false, code: 'OFFLINE' };
  }
  if (!response.ok) {
    return { ok: false, code: statusToCode(response.status) };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: 'INVALID' };
  }
  const path = readPath(body);
  if (!path) return { ok: false, code: 'INVALID' };
  const rec = body as { provider?: unknown; fetchedAt?: unknown };
  const provider = typeof rec.provider === 'string' && rec.provider.length > 0 ? rec.provider : 'unknown';
  const fetchedAt = typeof rec.fetchedAt === 'string' && rec.fetchedAt.length > 0 ? rec.fetchedAt : '';
  return {
    ok: true,
    path,
    meta: {
      provider,
      fetchedAt,
      quality: 'provider_route',
      trafficAware: false,
    },
  };
}
