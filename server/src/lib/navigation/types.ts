import type {
  CoordinateSystems,
  LocationKinds,
  LocationPrecisions,
  MissingSlotNames,
  NavigationTasks,
  RouteProviderIds,
  RouteQualities,
  TravelModes,
} from './constants.ts';

export type NavigationTask = (typeof NavigationTasks)[number];
export type TravelMode = (typeof TravelModes)[number];
export type CoordinateSystem = (typeof CoordinateSystems)[number];
export type NavigationLocationKind = (typeof LocationKinds)[number];
export type NavigationLocationPrecision = (typeof LocationPrecisions)[number];
export type MissingSlot = (typeof MissingSlotNames)[number];
export type RouteProviderId = (typeof RouteProviderIds)[number];
export type RouteQuality = (typeof RouteQualities)[number];

export interface NavigationLocationRef {
  kind: NavigationLocationKind;
  label?: string;
  lng?: number;
  lat?: number;
  coordinateSystem?: CoordinateSystem;
  city?: string;
  precision: NavigationLocationPrecision;
}

export interface NavigationIntent {
  task: NavigationTask;
  query?: string;
  city?: string;
  companyIds?: string[];
  positionIds?: string[];
  origin?: NavigationLocationRef;
  destination?: NavigationLocationRef;
  commute?: {
    preferredModes: TravelMode[];
    maxMinutes?: number;
  };
  appointment?: {
    startsAt: string;
    timezone: string;
    arrivalBufferMinutes: number;
  };
  missingSlots: MissingSlot[];
}

export interface RouteRequest {
  origin: NavigationLocationRef;
  destination: NavigationLocationRef;
  mode: TravelMode;
  departureAt?: string;
  arrivalAt?: string;
  timezone?: string;
}

export interface RoutePlanSummary {
  transferCount?: number;
  walkingMeters?: number;
}

interface RoutePlanBase {
  mode: TravelMode;
  originLabel: string;
  destinationLabel: string;
  durationSeconds: number;
  distanceMeters: number;
  departureAt?: string;
  arrivalAt?: string;
  provider: RouteProviderId;
  quality: RouteQuality;
  trafficAware: boolean;
  fetchedAt: string;
  expiresAt: string;
  summary?: RoutePlanSummary;
  warnings: string[];
}

export interface ProviderRoutePlan extends RoutePlanBase {
  routeId: string;
  provider: Exclude<RouteProviderId, 'estimate'>;
  quality: 'provider_route';
}

export interface EstimateRoutePlan extends RoutePlanBase {
  routeId?: never;
  provider: 'estimate';
  quality: 'estimate';
  trafficAware: false;
}

export type RoutePlan = ProviderRoutePlan | EstimateRoutePlan;

/**
 * Server-internal trusted geometry. It is deliberately separate from RoutePlan:
 * no serializer here should expose geometry or provider internals to an LLM.
 */
export interface RouteArtifact {
  routeId: string;
  sessionId: string;
  provider: Exclude<RouteProviderId, 'estimate'>;
  mode: TravelMode;
  coordinateSystem: CoordinateSystem;
  geometry: Array<{ lng: number; lat: number }>;
  fetchedAt: string;
  expiresAt: string;
}

export type RouteErrorCode =
  | 'INVALID_REQUEST'
  | 'UNSUPPORTED_MODE'
  | 'PROVIDER_UNAVAILABLE'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'NO_ROUTE'
  | 'EXPIRED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'COORDINATE_ERROR'
  | 'PROVIDER_ERROR'
  | 'INTERNAL';

export interface RouteError {
  code: RouteErrorCode;
  message: string;
  retryable: boolean;
}

export type NavigationContractErrorCode =
  | 'INVALID_OBJECT'
  | 'UNKNOWN_FIELD'
  | 'MISSING_FIELD'
  | 'INVALID_ENUM'
  | 'INVALID_TEXT'
  | 'TEXT_TOO_LONG'
  | 'ARRAY_TOO_LONG'
  | 'INVALID_NUMBER'
  | 'VALUE_OUT_OF_RANGE'
  | 'INVALID_COORDINATE'
  | 'COORDINATE_REQUIRED'
  | 'COORDINATE_SYSTEM_REQUIRED'
  | 'INVALID_TIME'
  | 'INVALID_TIMEZONE'
  | 'POSITION_IDS_COUNT'
  | 'ROUTE_ID_INVALID'
  | 'ROUTE_ID_FORBIDDEN'
  | 'ROUTE_QUALITY_MISMATCH'
  | 'TIME_ORDER_INVALID'
  | 'TTL_INVALID'
  | 'ROUTE_ARTIFACT_PROVIDER_INVALID'
  | 'SESSION_ID_INVALID'
  | 'GEOMETRY_INVALID'
  | 'INVALID_ARRIVAL_BUFFER';

export interface NavigationContractError {
  code: NavigationContractErrorCode;
  message: string;
  path?: string;
}

export type NavigationParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: NavigationContractError };
