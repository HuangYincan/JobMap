import {
  RequestBodyTooLargeError,
  readJsonObjectBody,
} from '../request-body.ts';
import { createRouteError } from './errors.ts';
import {
  createNavigationSessionToken,
  fingerprintNavigationSession,
  readNavigationSessionToken,
  serializeNavigationSessionCookie,
} from './navigation-session.ts';
import type { RouteArtifactReader } from './route-artifacts.ts';
import {
  navigationRouteArtifacts,
  navigationRouteService,
} from './route-runtime.ts';
import type {
  RouteService,
  RouteServiceResult,
} from './route-service.ts';
import type { RouteError, RouteErrorCode } from './types.ts';

export const NAVIGATION_ROUTE_BODY_MAX_CHARS = 8 * 1024;

export interface NavigationPlanHttpOptions {
  service?: RouteService;
  createSessionToken?: () => string;
  secureCookie?: boolean;
}

export interface NavigationArtifactHttpOptions {
  store?: RouteArtifactReader;
}

const ROUTE_ERROR_STATUS: Record<RouteErrorCode, number> = {
  INVALID_REQUEST: 400,
  UNSUPPORTED_MODE: 400,
  PROVIDER_UNAVAILABLE: 503,
  TIMEOUT: 504,
  RATE_LIMITED: 429,
  UNAUTHORIZED: 503,
  NO_ROUTE: 404,
  EXPIRED: 410,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  COORDINATE_ERROR: 400,
  PROVIDER_ERROR: 503,
  INTERNAL: 500,
};

function jsonResponse(
  body: unknown,
  status = 200,
  setCookie?: string,
): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  if (setCookie) headers.append('Set-Cookie', setCookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(error: RouteError, setCookie?: string): Response {
  return jsonResponse(error, ROUTE_ERROR_STATUS[error.code], setCookie);
}

function planResponse(
  result: RouteServiceResult,
  setCookie?: string,
): Response {
  return result.ok
    ? jsonResponse(result.plan, 200, setCookie)
    : errorResponse(result.error, setCookie);
}

export async function handleNavigationPlanRequest(
  request: Request,
  options: NavigationPlanHttpOptions = {},
): Promise<Response> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (
    Number.isFinite(contentLength) &&
    contentLength > NAVIGATION_ROUTE_BODY_MAX_CHARS
  ) {
    return errorResponse(createRouteError('INVALID_REQUEST'));
  }

  let body: unknown;
  try {
    body = await readJsonObjectBody(request, NAVIGATION_ROUTE_BODY_MAX_CHARS);
  } catch (error) {
    if (
      error instanceof RequestBodyTooLargeError ||
      error instanceof SyntaxError
    ) {
      return errorResponse(createRouteError('INVALID_REQUEST'));
    }
    return errorResponse(createRouteError('INVALID_REQUEST'));
  }

  const existingToken = readNavigationSessionToken(request);
  let token = existingToken;
  let setCookie: string | undefined;
  try {
    if (!token) {
      token = (options.createSessionToken ?? createNavigationSessionToken)();
      setCookie = serializeNavigationSessionCookie(
        token,
        options.secureCookie,
      );
    }
    const result = await (options.service ?? navigationRouteService).plan(
      body,
      { fingerprint: fingerprintNavigationSession(token) },
      request.signal,
    );
    return planResponse(result, setCookie);
  } catch {
    return errorResponse(createRouteError('INTERNAL'), setCookie);
  }
}

export async function handleNavigationArtifactRequest(
  request: Request,
  routeId: unknown,
  options: NavigationArtifactHttpOptions = {},
): Promise<Response> {
  const token = readNavigationSessionToken(request);
  const fingerprint = token ? fingerprintNavigationSession(token) : null;
  const result = (options.store ?? navigationRouteArtifacts).read(
    routeId,
    fingerprint,
  );
  switch (result.status) {
    case 'ok':
      return jsonResponse(result.artifact);
    case 'malformed':
      return errorResponse(createRouteError('INVALID_REQUEST'));
    case 'unauthorized':
      return jsonResponse(
        createRouteError('UNAUTHORIZED'),
        401,
      );
    case 'not_found':
      return errorResponse(createRouteError('NOT_FOUND'));
    case 'wrong_session':
      return errorResponse(createRouteError('FORBIDDEN'));
    case 'expired':
      return errorResponse(createRouteError('EXPIRED'));
  }
}
