import type {
  CoordinateSystem,
  RoutePlanSummary,
  RouteRequest,
  TravelMode,
} from './types.ts';

export const LiveRouteProviderIds = ['amap', 'tencent', 'baidu'] as const;
export type LiveRouteProviderId = (typeof LiveRouteProviderIds)[number];

export const ProviderRouteFailureCodes = [
  'UNSUPPORTED',
  'UNCONFIGURED',
  'ABORTED',
  'TIMEOUT',
  'RATE_LIMITED',
  'UNAUTHORIZED',
  'NO_ROUTE',
  'COORDINATE_ERROR',
  'PROVIDER_ERROR',
] as const;
export type ProviderRouteFailureCode = (typeof ProviderRouteFailureCodes)[number];

/**
 * Closed, provider-neutral success shape. Provider adapters never control
 * route/session IDs, and raw provider responses have no place in this type.
 */
export interface ProviderRouteResult {
  provider: LiveRouteProviderId;
  quality: 'provider_route';
  mode: TravelMode;
  durationSeconds: number;
  distanceMeters: number;
  departureAt?: string;
  arrivalAt?: string;
  trafficAware: boolean;
  fetchedAt: string;
  expiresAt: string;
  summary?: RoutePlanSummary;
  warnings: string[];
  coordinateSystem: CoordinateSystem;
  geometry: Array<{ lng: number; lat: number }>;
}

export type ProviderPlanResult =
  | { ok: true; value: ProviderRouteResult }
  | { ok: false; error: ProviderRouteFailureCode };

/**
 * Deliberately small injection seam. Product authorization and provider
 * registration remain outside this interface.
 */
export interface RouteProvider {
  readonly id: LiveRouteProviderId;
  isConfigured(): boolean;
  supports(request: RouteRequest): boolean;
  plan(request: RouteRequest, signal: AbortSignal): Promise<ProviderPlanResult>;
}
