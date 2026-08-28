import {
  CoordinateSystems,
  LocationKinds,
  LocationPrecisions,
  MAX_APPOINTMENT_TIME_LENGTH,
  MAX_ARRIVAL_BUFFER_MINUTES,
  MAX_CANDIDATE_IDS,
  MAX_CITY_LENGTH,
  MAX_COMMUTE_MINUTES,
  MAX_GEOMETRY_POINTS,
  MAX_ID_LENGTH,
  MAX_LABEL_LENGTH,
  MAX_MISSING_SLOTS,
  MAX_PREFERRED_MODES,
  MAX_QUERY_LENGTH,
  MAX_ROUTE_DISTANCE_METERS,
  MAX_ROUTE_DURATION_SECONDS,
  MAX_ROUTE_ID_LENGTH,
  MAX_ROUTE_TTL_SECONDS,
  MAX_ROUTE_WARNINGS,
  MAX_SESSION_ID_LENGTH,
  MAX_TIMEZONE_LENGTH,
  MAX_TRANSFER_COUNT,
  MAX_WARNING_LENGTH,
  MIN_ARRIVAL_BUFFER_MINUTES,
  MIN_COMMUTE_MINUTES,
  MissingSlotNames,
  NavigationTasks,
  OPAQUE_ROUTE_ID_PATTERN,
  RouteProviderIds,
  RouteQualities,
  TravelModes,
} from './constants.ts';
import type {
  CoordinateSystem,
  MissingSlot,
  NavigationContractError,
  NavigationContractErrorCode,
  NavigationIntent,
  NavigationLocationRef,
  NavigationParseResult,
  RouteArtifact,
  RoutePlan,
  EstimateRoutePlan,
  ProviderRoutePlan,
  RouteProviderId,
  RouteRequest,
  TravelMode,
} from './types.ts';

const ERROR_MESSAGES: Record<NavigationContractErrorCode, string> = {
  INVALID_OBJECT: '对象结构无效',
  UNKNOWN_FIELD: '包含不支持的字段',
  MISSING_FIELD: '缺少必要字段',
  INVALID_ENUM: '枚举值无效',
  INVALID_TEXT: '文本值无效',
  TEXT_TOO_LONG: '文本超过长度上限',
  ARRAY_TOO_LONG: '数组超过长度上限',
  INVALID_NUMBER: '数值无效',
  VALUE_OUT_OF_RANGE: '数值超出范围',
  INVALID_COORDINATE: '坐标无效',
  COORDINATE_REQUIRED: '路线位置必须包含坐标',
  COORDINATE_SYSTEM_REQUIRED: '坐标必须声明坐标系',
  INVALID_TIME: '时间必须是带时区的 ISO 8601 时间',
  INVALID_TIMEZONE: '时区必须是有效的 IANA 时区',
  POSITION_IDS_COUNT: '岗位 ID 数量不符合任务要求',
  ROUTE_ID_INVALID: '路线引用格式无效',
  ROUTE_ID_FORBIDDEN: '估算路线不得携带路线引用',
  ROUTE_QUALITY_MISMATCH: '路线供应商与质量标签不一致',
  TIME_ORDER_INVALID: '时间顺序无效',
  TTL_INVALID: '路线有效期超出上限',
  ROUTE_ARTIFACT_PROVIDER_INVALID: '估算结果不得生成路线产物',
  SESSION_ID_INVALID: '会话引用无效',
  GEOMETRY_INVALID: '路线几何无效',
  INVALID_ARRIVAL_BUFFER: '提前到达分钟数无效',
};

const MISSING_SLOT_ORDER = MissingSlotNames;
const ABSOLUTE_ISO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;

type Failure = { ok: false; error: NavigationContractError };

function fail(code: NavigationContractErrorCode, path?: string): Failure {
  return {
    ok: false,
    error: {
      code,
      message: ERROR_MESSAGES[code],
      ...(path ? { path } : {}),
    },
  };
}

function success<T>(value: T): NavigationParseResult<T> {
  return { ok: true, value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function rejectUnknownFields(record: Record<string, unknown>, allowed: readonly string[], path: string): Failure | null {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) return fail('UNKNOWN_FIELD', path ? `${path}.${key}` : key);
  }
  return null;
}

function parseEnum<T extends readonly string[]>(value: unknown, values: T, path: string): NavigationParseResult<T[number]> {
  if (typeof value !== 'string' || !values.includes(value)) return fail('INVALID_ENUM', path);
  return success(value as T[number]);
}

function parseRequiredString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
  path: string,
): NavigationParseResult<string> {
  if (!hasOwn(record, key) || record[key] === undefined) return fail('MISSING_FIELD', `${path}.${key}`);
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0) {
    return fail('INVALID_TEXT', `${path}.${key}`);
  }
  if (value.length > maxLength) return fail('TEXT_TOO_LONG', `${path}.${key}`);
  return success(value);
}

function parseOptionalString(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
  path: string,
): NavigationParseResult<string | undefined> {
  if (!hasOwn(record, key) || record[key] === undefined) return success(undefined);
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0) {
    return fail('INVALID_TEXT', `${path}.${key}`);
  }
  if (value.length > maxLength) return fail('TEXT_TOO_LONG', `${path}.${key}`);
  return success(value);
}

function parseStringArray(
  value: unknown,
  maxLength: number,
  itemMaxLength: number,
  path: string,
): NavigationParseResult<string[]> {
  if (!Array.isArray(value)) return fail('INVALID_OBJECT', path);
  if (value.length > maxLength) return fail('ARRAY_TOO_LONG', path);
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== 'string' || item.length === 0 || item.trim().length === 0) {
      return fail('INVALID_TEXT', `${path}[${index}]`);
    }
    if (item.length > itemMaxLength) return fail('TEXT_TOO_LONG', `${path}[${index}]`);
    if (!seen.has(item)) {
      seen.add(item);
      normalized.push(item);
    }
  }
  return success(normalized);
}

function parseBoundedNumber(
  value: unknown,
  path: string,
  min: number,
  max: number,
  integer = false,
): NavigationParseResult<number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail('INVALID_NUMBER', path);
  if (integer && !Number.isInteger(value)) return fail('INVALID_NUMBER', path);
  if (value < min || value > max) return fail('VALUE_OUT_OF_RANGE', path);
  return success(value);
}

function parseAbsoluteTimestamp(value: unknown, path: string): NavigationParseResult<{ value: string; milliseconds: number }> {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_APPOINTMENT_TIME_LENGTH) {
    return typeof value === 'string' && value.length > MAX_APPOINTMENT_TIME_LENGTH
      ? fail('TEXT_TOO_LONG', path)
      : fail('INVALID_TIME', path);
  }
  const match = ABSOLUTE_ISO_PATTERN.exec(value);
  if (!match) return fail('INVALID_TIME', path);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  const offset = match[8];
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return fail('INVALID_TIME', path);
  }
  if (offset !== 'Z') {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return fail('INVALID_TIME', path);
  }

  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return fail('INVALID_TIME', path);
  return success({ value, milliseconds });
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isValidIanaTimezone(value: string): boolean {
  if (value === 'UTC') return true;
  if (!/^[A-Za-z_][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)+$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function parseTimezone(value: unknown, path: string): NavigationParseResult<string> {
  if (typeof value !== 'string' || value.length === 0) return fail('INVALID_TIMEZONE', path);
  if (value.length > MAX_TIMEZONE_LENGTH || !isValidIanaTimezone(value)) return fail('INVALID_TIMEZONE', path);
  return success(value);
}

function parseLocation(raw: unknown, path: string): NavigationParseResult<NavigationLocationRef> {
  if (!isRecord(raw)) return fail('INVALID_OBJECT', path);
  const unknown = rejectUnknownFields(
    raw,
    ['kind', 'label', 'lng', 'lat', 'coordinateSystem', 'city', 'precision'],
    path,
  );
  if (unknown) return unknown;

  const kind = parseEnum(raw.kind, LocationKinds, `${path}.kind`);
  if (!kind.ok) return kind;
  const precision = parseEnum(raw.precision, LocationPrecisions, `${path}.precision`);
  if (!precision.ok) return precision;
  const label = parseOptionalString(raw, 'label', MAX_LABEL_LENGTH, path);
  if (!label.ok) return label;
  const city = parseOptionalString(raw, 'city', MAX_CITY_LENGTH, path);
  if (!city.ok) return city;

  const hasLng = hasOwn(raw, 'lng') && raw.lng !== undefined;
  const hasLat = hasOwn(raw, 'lat') && raw.lat !== undefined;
  const hasCoordinates = hasLng || hasLat;
  if (hasLng !== hasLat) return fail('INVALID_COORDINATE', path);
  if (kind.value === 'coordinate' && !hasCoordinates) return fail('INVALID_COORDINATE', path);

  let coordinateSystem: CoordinateSystem | undefined;
  let lng: number | undefined;
  let lat: number | undefined;
  if (hasCoordinates) {
    if (typeof raw.lng !== 'number' || typeof raw.lat !== 'number' || !Number.isFinite(raw.lng) || !Number.isFinite(raw.lat)) {
      return fail('INVALID_COORDINATE', path);
    }
    if (raw.lng < -180 || raw.lng > 180 || raw.lat < -90 || raw.lat > 90) return fail('INVALID_COORDINATE', path);
    if (!hasOwn(raw, 'coordinateSystem') || raw.coordinateSystem === undefined) {
      return fail('COORDINATE_SYSTEM_REQUIRED', `${path}.coordinateSystem`);
    }
    const parsedCoordinateSystem = parseEnum(raw.coordinateSystem, CoordinateSystems, `${path}.coordinateSystem`);
    if (!parsedCoordinateSystem.ok) return parsedCoordinateSystem;
    coordinateSystem = parsedCoordinateSystem.value;
    lng = raw.lng;
    lat = raw.lat;
  } else if (hasOwn(raw, 'coordinateSystem') && raw.coordinateSystem !== undefined) {
    return fail('COORDINATE_SYSTEM_REQUIRED', `${path}.coordinateSystem`);
  }

  if ((kind.value === 'poi' || kind.value === 'text') && label.value === undefined) {
    return fail('MISSING_FIELD', `${path}.label`);
  }

  return success({
    kind: kind.value,
    ...(label.value !== undefined ? { label: label.value } : {}),
    ...(lng !== undefined ? { lng, lat } : {}),
    ...(coordinateSystem !== undefined ? { coordinateSystem } : {}),
    ...(city.value !== undefined ? { city: city.value } : {}),
    precision: precision.value,
  });
}

function parseCommute(raw: unknown, path: string): NavigationParseResult<NavigationIntent['commute']> {
  if (!isRecord(raw)) return fail('INVALID_OBJECT', path);
  const unknown = rejectUnknownFields(raw, ['preferredModes', 'maxMinutes'], path);
  if (unknown) return unknown;
  if (!hasOwn(raw, 'preferredModes') || raw.preferredModes === undefined) {
    return fail('MISSING_FIELD', `${path}.preferredModes`);
  }
  if (!Array.isArray(raw.preferredModes) || raw.preferredModes.length === 0) {
    return fail('MISSING_FIELD', `${path}.preferredModes`);
  }
  if (raw.preferredModes.length > MAX_PREFERRED_MODES) return fail('ARRAY_TOO_LONG', `${path}.preferredModes`);
  const preferredModes: TravelMode[] = [];
  const seen = new Set<TravelMode>();
  for (let index = 0; index < raw.preferredModes.length; index += 1) {
    const mode = parseEnum(raw.preferredModes[index], TravelModes, `${path}.preferredModes[${index}]`);
    if (!mode.ok) return mode;
    if (!seen.has(mode.value)) {
      seen.add(mode.value);
      preferredModes.push(mode.value);
    }
  }

  let maxMinutes: number | undefined;
  if (hasOwn(raw, 'maxMinutes') && raw.maxMinutes !== undefined) {
    const parsedMaxMinutes = parseBoundedNumber(
      raw.maxMinutes,
      `${path}.maxMinutes`,
      MIN_COMMUTE_MINUTES,
      MAX_COMMUTE_MINUTES,
      true,
    );
    if (!parsedMaxMinutes.ok) return parsedMaxMinutes;
    maxMinutes = parsedMaxMinutes.value;
  }
  return success({ preferredModes, ...(maxMinutes !== undefined ? { maxMinutes } : {}) });
}

function parseAppointment(raw: unknown, path: string): NavigationParseResult<NavigationIntent['appointment']> {
  if (!isRecord(raw)) return fail('INVALID_OBJECT', path);
  const unknown = rejectUnknownFields(raw, ['startsAt', 'timezone', 'arrivalBufferMinutes'], path);
  if (unknown) return unknown;

  if (!hasOwn(raw, 'startsAt') || raw.startsAt === undefined) return fail('INVALID_TIME', `${path}.startsAt`);
  const startsAt = parseAbsoluteTimestamp(raw.startsAt, `${path}.startsAt`);
  if (!startsAt.ok) return startsAt;
  if (!hasOwn(raw, 'timezone') || raw.timezone === undefined) return fail('INVALID_TIMEZONE', `${path}.timezone`);
  const timezone = parseTimezone(raw.timezone, `${path}.timezone`);
  if (!timezone.ok) return timezone;
  if (!hasOwn(raw, 'arrivalBufferMinutes') || raw.arrivalBufferMinutes === undefined) {
    return fail('INVALID_ARRIVAL_BUFFER', `${path}.arrivalBufferMinutes`);
  }
  const arrivalBufferMinutes = parseBoundedNumber(
    raw.arrivalBufferMinutes,
    `${path}.arrivalBufferMinutes`,
    MIN_ARRIVAL_BUFFER_MINUTES,
    MAX_ARRIVAL_BUFFER_MINUTES,
    true,
  );
  if (!arrivalBufferMinutes.ok) return arrivalBufferMinutes;
  return success({
    startsAt: startsAt.value.value,
    timezone: timezone.value,
    arrivalBufferMinutes: arrivalBufferMinutes.value,
  });
}

function validateCandidateMissingSlots(raw: Record<string, unknown>): Failure | null {
  if (!hasOwn(raw, 'missingSlots') || raw.missingSlots === undefined) return null;
  const slots = parseStringArray(raw.missingSlots, MAX_MISSING_SLOTS, MAX_LABEL_LENGTH, 'missingSlots');
  if (!slots.ok) return slots;
  for (const slot of slots.value) {
    if (!MissingSlotNames.includes(slot as MissingSlot)) return fail('INVALID_ENUM', 'missingSlots');
  }
  return null;
}

export function parseNavigationIntent(raw: unknown): NavigationParseResult<NavigationIntent> {
  if (!isRecord(raw)) return fail('INVALID_OBJECT');
  const unknown = rejectUnknownFields(
    raw,
    ['task', 'query', 'city', 'companyIds', 'positionIds', 'origin', 'destination', 'commute', 'appointment', 'missingSlots'],
    '',
  );
  if (unknown) return unknown;
  const candidateMissingSlotsError = validateCandidateMissingSlots(raw);
  if (candidateMissingSlotsError) return candidateMissingSlotsError;

  const task = parseEnum(raw.task, NavigationTasks, 'task');
  if (!task.ok) return task;
  const query = parseOptionalString(raw, 'query', MAX_QUERY_LENGTH, 'intent');
  if (!query.ok) return query;
  const city = parseOptionalString(raw, 'city', MAX_CITY_LENGTH, 'intent');
  if (!city.ok) return city;

  let companyIds: string[] | undefined;
  if (hasOwn(raw, 'companyIds') && raw.companyIds !== undefined) {
    const parsedCompanyIds = parseStringArray(raw.companyIds, MAX_CANDIDATE_IDS, MAX_ID_LENGTH, 'companyIds');
    if (!parsedCompanyIds.ok) return parsedCompanyIds;
    companyIds = parsedCompanyIds.value;
  }

  let positionIds: string[] | undefined;
  if (hasOwn(raw, 'positionIds') && raw.positionIds !== undefined) {
    const parsedPositionIds = parseStringArray(raw.positionIds, MAX_CANDIDATE_IDS, MAX_ID_LENGTH, 'positionIds');
    if (!parsedPositionIds.ok) return parsedPositionIds;
    positionIds = parsedPositionIds.value;
  }

  let origin: NavigationLocationRef | undefined;
  if (hasOwn(raw, 'origin') && raw.origin !== undefined) {
    const parsedOrigin = parseLocation(raw.origin, 'origin');
    if (!parsedOrigin.ok) return parsedOrigin;
    origin = parsedOrigin.value;
  }

  let destination: NavigationLocationRef | undefined;
  if (hasOwn(raw, 'destination') && raw.destination !== undefined) {
    const parsedDestination = parseLocation(raw.destination, 'destination');
    if (!parsedDestination.ok) return parsedDestination;
    destination = parsedDestination.value;
  }

  let commute: NavigationIntent['commute'] | undefined;
  if (hasOwn(raw, 'commute') && raw.commute !== undefined) {
    const parsedCommute = parseCommute(raw.commute, 'commute');
    if (!parsedCommute.ok) return parsedCommute;
    commute = parsedCommute.value;
  }

  let appointment: NavigationIntent['appointment'] | undefined;
  if (hasOwn(raw, 'appointment') && raw.appointment !== undefined) {
    const parsedAppointment = parseAppointment(raw.appointment, 'appointment');
    if (!parsedAppointment.ok) return parsedAppointment;
    appointment = parsedAppointment.value;
  }

  if (task.value === 'job_compare' && positionIds !== undefined && positionIds.length > 0 && positionIds.length < 2) {
    return fail('POSITION_IDS_COUNT', 'positionIds');
  }
  if (task.value === 'interview_arrival' && positionIds !== undefined && positionIds.length > 1) {
    return fail('POSITION_IDS_COUNT', 'positionIds');
  }

  const missing = new Set<MissingSlot>();
  if (task.value === 'job_search') {
    if (city.value === undefined) missing.add('city');
    if (commute !== undefined && origin === undefined) missing.add('origin');
  }
  if (task.value === 'job_compare') {
    if (origin === undefined) missing.add('origin');
    if (positionIds === undefined || positionIds.length === 0) missing.add('position');
  }
  if (task.value === 'interview_arrival') {
    if (origin === undefined) missing.add('origin');
    if (appointment === undefined) missing.add('appointment_time');
    if (destination === undefined && (positionIds === undefined || positionIds.length === 0)) {
      missing.add('destination');
    }
  }
  if (commute !== undefined && origin === undefined) missing.add('origin');

  return success({
    task: task.value,
    ...(query.value !== undefined ? { query: query.value } : {}),
    ...(city.value !== undefined ? { city: city.value } : {}),
    ...(companyIds !== undefined ? { companyIds } : {}),
    ...(positionIds !== undefined ? { positionIds } : {}),
    ...(origin !== undefined ? { origin } : {}),
    ...(destination !== undefined ? { destination } : {}),
    ...(commute !== undefined ? { commute } : {}),
    ...(appointment !== undefined ? { appointment } : {}),
    missingSlots: MISSING_SLOT_ORDER.filter((slot) => missing.has(slot)),
  });
}

function parseRouteId(value: unknown, path: string): NavigationParseResult<string> {
  // Syntax is the only property this validator can establish. WS1 must issue IDs with a server-side CSPRNG;
  // neither LLM input nor provider input can supply or imply the ID's entropy.
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ROUTE_ID_LENGTH) {
    return typeof value === 'string' && value.length > MAX_ROUTE_ID_LENGTH
      ? fail('TEXT_TOO_LONG', path)
      : fail('ROUTE_ID_INVALID', path);
  }
  if (!OPAQUE_ROUTE_ID_PATTERN.test(value)) return fail('ROUTE_ID_INVALID', path);
  return success(value);
}

function parseWarnings(value: unknown, path: string): NavigationParseResult<string[]> {
  const warnings = parseStringArray(value, MAX_ROUTE_WARNINGS, MAX_WARNING_LENGTH, path);
  if (!warnings.ok) return warnings;
  return success(warnings.value);
}

function parseSummary(raw: unknown, path: string): NavigationParseResult<RoutePlan['summary']> {
  if (!isRecord(raw)) return fail('INVALID_OBJECT', path);
  const unknown = rejectUnknownFields(raw, ['transferCount', 'walkingMeters'], path);
  if (unknown) return unknown;
  let transferCount: number | undefined;
  if (hasOwn(raw, 'transferCount') && raw.transferCount !== undefined) {
    const parsed = parseBoundedNumber(raw.transferCount, `${path}.transferCount`, 0, MAX_TRANSFER_COUNT, true);
    if (!parsed.ok) return parsed;
    transferCount = parsed.value;
  }
  let walkingMeters: number | undefined;
  if (hasOwn(raw, 'walkingMeters') && raw.walkingMeters !== undefined) {
    const parsed = parseBoundedNumber(raw.walkingMeters, `${path}.walkingMeters`, 0, MAX_ROUTE_DISTANCE_METERS);
    if (!parsed.ok) return parsed;
    walkingMeters = parsed.value;
  }
  return success({
    ...(transferCount !== undefined ? { transferCount } : {}),
    ...(walkingMeters !== undefined ? { walkingMeters } : {}),
  });
}

function validateRouteTimes(
  fetchedAt: { value: string; milliseconds: number },
  expiresAt: { value: string; milliseconds: number },
): Failure | null {
  if (expiresAt.milliseconds <= fetchedAt.milliseconds) return fail('TIME_ORDER_INVALID', 'expiresAt');
  if ((expiresAt.milliseconds - fetchedAt.milliseconds) / 1_000 > MAX_ROUTE_TTL_SECONDS) {
    return fail('TTL_INVALID', 'expiresAt');
  }
  return null;
}

export function parseRoutePlan(raw: unknown): NavigationParseResult<RoutePlan> {
  if (!isRecord(raw)) return fail('INVALID_OBJECT');
  const unknown = rejectUnknownFields(
    raw,
    [
      'routeId',
      'mode',
      'originLabel',
      'destinationLabel',
      'durationSeconds',
      'distanceMeters',
      'departureAt',
      'arrivalAt',
      'provider',
      'quality',
      'trafficAware',
      'fetchedAt',
      'expiresAt',
      'summary',
      'warnings',
    ],
    '',
  );
  if (unknown) return unknown;

  const mode = parseEnum(raw.mode, TravelModes, 'mode');
  if (!mode.ok) return mode;
  const originLabel = parseRequiredString(raw, 'originLabel', MAX_LABEL_LENGTH, 'route');
  if (!originLabel.ok) return originLabel;
  const destinationLabel = parseRequiredString(raw, 'destinationLabel', MAX_LABEL_LENGTH, 'route');
  if (!destinationLabel.ok) return destinationLabel;
  const durationSeconds = parseBoundedNumber(raw.durationSeconds, 'durationSeconds', 0, MAX_ROUTE_DURATION_SECONDS);
  if (!durationSeconds.ok) return durationSeconds;
  const distanceMeters = parseBoundedNumber(raw.distanceMeters, 'distanceMeters', 0, MAX_ROUTE_DISTANCE_METERS);
  if (!distanceMeters.ok) return distanceMeters;
  const provider = parseEnum(raw.provider, RouteProviderIds, 'provider');
  if (!provider.ok) return provider;
  const quality = parseEnum(raw.quality, RouteQualities, 'quality');
  if (!quality.ok) return quality;
  if ((provider.value === 'estimate') !== (quality.value === 'estimate')) {
    return fail('ROUTE_QUALITY_MISMATCH', 'provider');
  }
  if (typeof raw.trafficAware !== 'boolean') return fail('INVALID_ENUM', 'trafficAware');
  if (provider.value === 'estimate' && raw.trafficAware) return fail('ROUTE_QUALITY_MISMATCH', 'trafficAware');

  const fetchedAt = parseAbsoluteTimestamp(raw.fetchedAt, 'fetchedAt');
  if (!fetchedAt.ok) return fetchedAt;
  const expiresAt = parseAbsoluteTimestamp(raw.expiresAt, 'expiresAt');
  if (!expiresAt.ok) return expiresAt;
  const timeError = validateRouteTimes(fetchedAt.value, expiresAt.value);
  if (timeError) return timeError;

  let routeId: string | undefined;
  const hasRouteId = hasOwn(raw, 'routeId');
  if (provider.value === 'estimate') {
    if (hasRouteId) return fail('ROUTE_ID_FORBIDDEN', 'routeId');
  } else {
    if (!hasRouteId) return fail('ROUTE_ID_INVALID', 'routeId');
    const parsedRouteId = parseRouteId(raw.routeId, 'routeId');
    if (!parsedRouteId.ok) return parsedRouteId;
    routeId = parsedRouteId.value;
  }

  let departureAt: string | undefined;
  if (hasOwn(raw, 'departureAt') && raw.departureAt !== undefined) {
    const parsedDepartureAt = parseAbsoluteTimestamp(raw.departureAt, 'departureAt');
    if (!parsedDepartureAt.ok) return parsedDepartureAt;
    departureAt = parsedDepartureAt.value.value;
  }
  let arrivalAt: string | undefined;
  let arrivalMilliseconds: number | undefined;
  if (hasOwn(raw, 'arrivalAt') && raw.arrivalAt !== undefined) {
    const parsedArrivalAt = parseAbsoluteTimestamp(raw.arrivalAt, 'arrivalAt');
    if (!parsedArrivalAt.ok) return parsedArrivalAt;
    arrivalAt = parsedArrivalAt.value.value;
    arrivalMilliseconds = parsedArrivalAt.value.milliseconds;
  }
  if (departureAt !== undefined && arrivalMilliseconds !== undefined) {
    const departureMilliseconds = Date.parse(departureAt);
    if (arrivalMilliseconds <= departureMilliseconds) return fail('TIME_ORDER_INVALID', 'arrivalAt');
  }

  if (!hasOwn(raw, 'warnings') || raw.warnings === undefined) return fail('MISSING_FIELD', 'warnings');
  const warnings = parseWarnings(raw.warnings, 'warnings');
  if (!warnings.ok) return warnings;

  let summary: RoutePlan['summary'] | undefined;
  if (hasOwn(raw, 'summary') && raw.summary !== undefined) {
    const parsedSummary = parseSummary(raw.summary, 'summary');
    if (!parsedSummary.ok) return parsedSummary;
    summary = parsedSummary.value;
  }

  const commonPlanFields = {
    mode: mode.value,
    originLabel: originLabel.value,
    destinationLabel: destinationLabel.value,
    durationSeconds: durationSeconds.value,
    distanceMeters: distanceMeters.value,
    ...(departureAt !== undefined ? { departureAt } : {}),
    ...(arrivalAt !== undefined ? { arrivalAt } : {}),
    trafficAware: raw.trafficAware,
    fetchedAt: fetchedAt.value.value,
    expiresAt: expiresAt.value.value,
    ...(summary !== undefined ? { summary } : {}),
    warnings: warnings.value,
  };

  if (provider.value === 'estimate') {
    const plan: EstimateRoutePlan = {
      ...commonPlanFields,
      provider: 'estimate',
      quality: 'estimate',
      trafficAware: false,
    };
    return success(plan);
  }

  const plan: ProviderRoutePlan = {
    ...commonPlanFields,
    routeId: routeId as string,
    provider: provider.value,
    quality: 'provider_route',
  };
  return success(plan);
}

function parseResolvedRouteLocation(raw: unknown, path: string): NavigationParseResult<NavigationLocationRef> {
  const location = parseLocation(raw, path);
  if (!location.ok) return location;
  if (
    location.value.lng === undefined ||
    location.value.lat === undefined ||
    location.value.coordinateSystem === undefined
  ) {
    return fail('COORDINATE_REQUIRED', path);
  }
  return location;
}

export function parseRouteRequest(raw: unknown): NavigationParseResult<RouteRequest> {
  if (!isRecord(raw)) return fail('INVALID_OBJECT');
  const unknown = rejectUnknownFields(raw, ['origin', 'destination', 'mode', 'departureAt', 'arrivalAt', 'timezone'], '');
  if (unknown) return unknown;
  const origin = parseResolvedRouteLocation(raw.origin, 'origin');
  if (!origin.ok) return origin;
  const destination = parseResolvedRouteLocation(raw.destination, 'destination');
  if (!destination.ok) return destination;
  const mode = parseEnum(raw.mode, TravelModes, 'mode');
  if (!mode.ok) return mode;

  let departureAt: string | undefined;
  let departureMilliseconds: number | undefined;
  if (hasOwn(raw, 'departureAt') && raw.departureAt !== undefined) {
    const parsed = parseAbsoluteTimestamp(raw.departureAt, 'departureAt');
    if (!parsed.ok) return parsed;
    departureAt = parsed.value.value;
    departureMilliseconds = parsed.value.milliseconds;
  }
  let arrivalAt: string | undefined;
  if (hasOwn(raw, 'arrivalAt') && raw.arrivalAt !== undefined) {
    const parsed = parseAbsoluteTimestamp(raw.arrivalAt, 'arrivalAt');
    if (!parsed.ok) return parsed;
    arrivalAt = parsed.value.value;
    if (departureMilliseconds !== undefined && parsed.value.milliseconds <= departureMilliseconds) {
      return fail('TIME_ORDER_INVALID', 'arrivalAt');
    }
  }
  let timezone: string | undefined;
  if (hasOwn(raw, 'timezone') && raw.timezone !== undefined) {
    const parsed = parseTimezone(raw.timezone, 'timezone');
    if (!parsed.ok) return parsed;
    timezone = parsed.value;
  }
  return success({
    origin: origin.value,
    destination: destination.value,
    mode: mode.value,
    ...(departureAt !== undefined ? { departureAt } : {}),
    ...(arrivalAt !== undefined ? { arrivalAt } : {}),
    ...(timezone !== undefined ? { timezone } : {}),
  });
}

function parseGeometryPoint(raw: unknown, path: string): NavigationParseResult<{ lng: number; lat: number }> {
  if (!isRecord(raw)) return fail('GEOMETRY_INVALID', path);
  const unknown = rejectUnknownFields(raw, ['lng', 'lat'], path);
  if (unknown) return unknown;
  if (typeof raw.lng !== 'number' || typeof raw.lat !== 'number' || !Number.isFinite(raw.lng) || !Number.isFinite(raw.lat)) {
    return fail('GEOMETRY_INVALID', path);
  }
  if (raw.lng < -180 || raw.lng > 180 || raw.lat < -90 || raw.lat > 90) return fail('GEOMETRY_INVALID', path);
  return success({ lng: raw.lng, lat: raw.lat });
}

function parseSessionId(value: unknown, path: string): NavigationParseResult<string> {
  const sessionId = parseRequiredString({ sessionId: value }, 'sessionId', MAX_SESSION_ID_LENGTH, 'artifact');
  if (!sessionId.ok) return sessionId;
  if (/\s/.test(sessionId.value)) return fail('SESSION_ID_INVALID', path);
  return sessionId;
}

export function parseRouteArtifact(raw: unknown): NavigationParseResult<RouteArtifact> {
  if (!isRecord(raw)) return fail('INVALID_OBJECT');
  const unknown = rejectUnknownFields(
    raw,
    ['routeId', 'sessionId', 'provider', 'mode', 'coordinateSystem', 'geometry', 'fetchedAt', 'expiresAt'],
    '',
  );
  if (unknown) return unknown;
  const routeId = parseRouteId(raw.routeId, 'routeId');
  if (!routeId.ok) return routeId;
  const sessionId = parseSessionId(raw.sessionId, 'sessionId');
  if (!sessionId.ok) return sessionId;
  const provider = parseEnum(raw.provider, RouteProviderIds, 'provider');
  if (!provider.ok) return provider;
  if (provider.value === 'estimate') return fail('ROUTE_ARTIFACT_PROVIDER_INVALID', 'provider');
  const mode = parseEnum(raw.mode, TravelModes, 'mode');
  if (!mode.ok) return mode;
  const coordinateSystem = parseEnum(raw.coordinateSystem, CoordinateSystems, 'coordinateSystem');
  if (!coordinateSystem.ok) return coordinateSystem;
  if (!Array.isArray(raw.geometry)) return fail('GEOMETRY_INVALID', 'geometry');
  if (raw.geometry.length < 2) return fail('GEOMETRY_INVALID', 'geometry');
  if (raw.geometry.length > MAX_GEOMETRY_POINTS) return fail('ARRAY_TOO_LONG', 'geometry');
  const geometry: Array<{ lng: number; lat: number }> = [];
  for (let index = 0; index < raw.geometry.length; index += 1) {
    const point = parseGeometryPoint(raw.geometry[index], `geometry[${index}]`);
    if (!point.ok) return point;
    geometry.push(point.value);
  }
  const fetchedAt = parseAbsoluteTimestamp(raw.fetchedAt, 'fetchedAt');
  if (!fetchedAt.ok) return fetchedAt;
  const expiresAt = parseAbsoluteTimestamp(raw.expiresAt, 'expiresAt');
  if (!expiresAt.ok) return expiresAt;
  const timeError = validateRouteTimes(fetchedAt.value, expiresAt.value);
  if (timeError) return timeError;
  return success({
    routeId: routeId.value,
    sessionId: sessionId.value,
    provider: provider.value as Exclude<RouteProviderId, 'estimate'>,
    mode: mode.value,
    coordinateSystem: coordinateSystem.value,
    geometry,
    fetchedAt: fetchedAt.value.value,
    expiresAt: expiresAt.value.value,
  });
}
