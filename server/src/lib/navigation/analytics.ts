// Replaceable product-analytics sink for job-navigation eval (tech/31 §7.1).
// Closed event names, allowlisted fields, fail-closed unknown/forbidden payload.
// Not wired to production chat or RouteService; runners inject a sink explicitly.
// Must not persist, and must not reuse Postgres audit_events.

import { NavigationTasks, RouteQualities, TravelModes } from './constants.ts';
import type { NavigationTask, RouteQuality, TravelMode } from './types.ts';

export const NAVIGATION_EVENT_NAMES = [
  'navigation_intent_parsed',
  'navigation_slot_clarified',
  'navigation_job_search_completed',
  'navigation_route_requested',
  'navigation_route_resolved',
  'navigation_route_degraded',
  'navigation_comparison_viewed',
  'navigation_route_action_applied',
  'navigation_task_completed',
] as const;

export type NavigationEventName = (typeof NAVIGATION_EVENT_NAMES)[number];

export const NAVIGATION_EVENT_FIELDS = [
  'event',
  'occurredAt',
  'caseId',
  'task',
  'city',
  'mode',
  'candidateCount',
  'durationMs',
  'resultCount',
  'quality',
  'failureClass',
  'completed',
] as const;

export type NavigationEventField = (typeof NAVIGATION_EVENT_FIELDS)[number];

const EVENT_NAME_SET = new Set<string>(NAVIGATION_EVENT_NAMES);
const ALLOWED_FIELD_SET = new Set<string>(NAVIGATION_EVENT_FIELDS);
const TASK_SET = new Set<string>(NavigationTasks);
const MODE_SET = new Set<string>(TravelModes);
const QUALITY_SET = new Set<string>(RouteQualities);

const FORBIDDEN_KEYS = new Set([
  'utterance',
  'conversation',
  'address',
  'fullAddress',
  'rawAddress',
  'polyline',
  'geometry',
  'path',
  'coordinates',
  'points',
  'lng',
  'lat',
  'origin',
  'destination',
  'cookie',
  'cookies',
  'apiKey',
  'api_key',
  'accessToken',
  'access_token',
  'rawResponse',
  'providerRaw',
  'provider_response',
  'memory',
  'password',
  'secret',
  'AMAP_WEB_KEY',
  'BAIDU_MAP_AK',
  'TENCENT_MAP_KEY',
]);

const FORBIDDEN_KEY_PATTERN =
  /(?:full|home|precise)?address|polyline|geometry|api[_-]?key|access[_-]?token|raw[_-]?(?:provider|response)|conversation|utterance|cookie/i;

const FORBIDDEN_VALUE_PATTERN =
  /AMAP_WEB_KEY|BAIDU_MAP_AK|TENCENT_MAP_KEY|dm_navigation_session|(?:sk|pk)[-_][a-z0-9]{16,}/i;

const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const CASE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FAILURE_CLASS_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const MAX_CITY_CHARS = 64;

export type NavigationEventErrorCode = 'UNKNOWN_FIELD' | 'FORBIDDEN_FIELD' | 'INVALID_EVENT';

export interface NavigationEventContractError {
  code: NavigationEventErrorCode;
  message: string;
  path?: string;
}

export interface NavigationProductEvent {
  event: NavigationEventName;
  occurredAt: string;
  caseId?: string;
  task?: NavigationTask;
  city?: string;
  mode?: TravelMode;
  candidateCount?: number;
  durationMs?: number;
  resultCount?: number;
  quality?: RouteQuality;
  failureClass?: string;
  completed?: boolean;
}

export type NavigationEventParseResult =
  | { ok: true; value: NavigationProductEvent }
  | { ok: false; error: NavigationEventContractError };

export interface NavigationEventSink {
  emit(event: unknown): void;
}

export interface MemoryNavigationEventSink extends NavigationEventSink {
  readonly events: readonly NavigationProductEvent[];
}

export interface JsonlWritable {
  write(chunk: string): unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(code: NavigationEventErrorCode, message: string, path?: string): NavigationEventParseResult {
  return { ok: false, error: { code, message, ...(path ? { path } : {}) } };
}

function scanForbidden(value: unknown, path: string): NavigationEventParseResult | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    if (FORBIDDEN_VALUE_PATTERN.test(value)) {
      return fail('FORBIDDEN_FIELD', '事件值包含禁止的密钥或会话材料', path);
    }
    return null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const nested = scanForbidden(value[i], `${path}[${i}]`);
      if (nested) return nested;
    }
    return null;
  }
  if (!isRecord(value)) return fail('INVALID_EVENT', '事件结构无效', path);
  if (Object.prototype.hasOwnProperty.call(value, 'lng') || Object.prototype.hasOwnProperty.call(value, 'lat')) {
    return fail('FORBIDDEN_FIELD', '事件不得包含精确坐标', path);
  }
  for (const [key, nestedValue] of Object.entries(value)) {
    const nestedPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_KEYS.has(key) || FORBIDDEN_KEY_PATTERN.test(key)) {
      return fail('FORBIDDEN_FIELD', '事件包含禁止字段', nestedPath);
    }
    const nested = scanForbidden(nestedValue, nestedPath);
    if (nested) return nested;
  }
  return null;
}

function parseOptionalInteger(
  record: Record<string, unknown>,
  key: string,
): { ok: true; value: number | undefined } | { ok: false; error: NavigationEventContractError } {
  if (!Object.prototype.hasOwnProperty.call(record, key) || record[key] === undefined) {
    return { ok: true, value: undefined };
  }
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1_000_000_000) {
    return {
      ok: false,
      error: { code: 'INVALID_EVENT', message: '计数字段必须是范围内的整数', path: key },
    };
  }
  return { ok: true, value };
}

export function parseNavigationEvent(raw: unknown): NavigationEventParseResult {
  if (!isRecord(raw)) return fail('INVALID_EVENT', '事件必须是对象');
  const forbidden = scanForbidden(raw, '');
  if (forbidden) return forbidden;
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_FIELD_SET.has(key)) return fail('UNKNOWN_FIELD', '包含不支持的字段', key);
  }

  const eventName = raw.event;
  if (typeof eventName !== 'string' || !EVENT_NAME_SET.has(eventName)) {
    return fail('INVALID_EVENT', '事件名不在首批闭合集合中', 'event');
  }
  const occurredAt = raw.occurredAt;
  if (typeof occurredAt !== 'string' || !ISO_UTC_PATTERN.test(occurredAt) || Number.isNaN(Date.parse(occurredAt))) {
    return fail('INVALID_EVENT', 'occurredAt 必须是 UTC ISO 时间', 'occurredAt');
  }

  const parsed: NavigationProductEvent = {
    event: eventName as NavigationEventName,
    occurredAt,
  };

  if (Object.prototype.hasOwnProperty.call(raw, 'caseId') && raw.caseId !== undefined) {
    if (typeof raw.caseId !== 'string' || !CASE_ID_PATTERN.test(raw.caseId)) {
      return fail('INVALID_EVENT', 'caseId 必须是稳定的合成标识', 'caseId');
    }
    parsed.caseId = raw.caseId;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'task') && raw.task !== undefined) {
    if (typeof raw.task !== 'string' || !TASK_SET.has(raw.task)) {
      return fail('INVALID_EVENT', 'task 枚举无效', 'task');
    }
    parsed.task = raw.task as NavigationTask;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'city') && raw.city !== undefined) {
    if (typeof raw.city !== 'string' || raw.city.trim().length === 0 || raw.city.length > MAX_CITY_CHARS) {
      return fail('INVALID_EVENT', 'city 无效', 'city');
    }
    parsed.city = raw.city;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'mode') && raw.mode !== undefined) {
    if (typeof raw.mode !== 'string' || !MODE_SET.has(raw.mode)) {
      return fail('INVALID_EVENT', 'mode 枚举无效', 'mode');
    }
    parsed.mode = raw.mode as TravelMode;
  }
  const candidateCount = parseOptionalInteger(raw, 'candidateCount');
  if (!candidateCount.ok) return candidateCount;
  if (candidateCount.value !== undefined) parsed.candidateCount = candidateCount.value;
  const durationMs = parseOptionalInteger(raw, 'durationMs');
  if (!durationMs.ok) return durationMs;
  if (durationMs.value !== undefined) parsed.durationMs = durationMs.value;
  const resultCount = parseOptionalInteger(raw, 'resultCount');
  if (!resultCount.ok) return resultCount;
  if (resultCount.value !== undefined) parsed.resultCount = resultCount.value;
  if (Object.prototype.hasOwnProperty.call(raw, 'quality') && raw.quality !== undefined) {
    if (typeof raw.quality !== 'string' || !QUALITY_SET.has(raw.quality)) {
      return fail('INVALID_EVENT', 'quality 枚举无效', 'quality');
    }
    parsed.quality = raw.quality as RouteQuality;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'failureClass') && raw.failureClass !== undefined) {
    if (typeof raw.failureClass !== 'string' || !FAILURE_CLASS_PATTERN.test(raw.failureClass)) {
      return fail('INVALID_EVENT', 'failureClass 无效', 'failureClass');
    }
    parsed.failureClass = raw.failureClass;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'completed') && raw.completed !== undefined) {
    if (typeof raw.completed !== 'boolean') return fail('INVALID_EVENT', 'completed 必须是布尔值', 'completed');
    parsed.completed = raw.completed;
  }
  return { ok: true, value: parsed };
}

export function assertSafeNavigationEvent(raw: unknown): NavigationProductEvent {
  const parsed = parseNavigationEvent(raw);
  if (!parsed.ok) {
    const error = new Error(parsed.error.message);
    error.name = 'NavigationEventError';
    throw error;
  }
  return parsed.value;
}

export function createMemorySink(): MemoryNavigationEventSink {
  const events: NavigationProductEvent[] = [];
  return {
    get events() {
      return events;
    },
    emit(event: unknown) {
      events.push(assertSafeNavigationEvent(event));
    },
  };
}

export function createJsonlSink(writable: JsonlWritable): NavigationEventSink {
  return {
    emit(event: unknown) {
      const parsed = assertSafeNavigationEvent(event);
      writable.write(`${JSON.stringify(parsed)}\n`);
    },
  };
}

export function createCompositeSink(sinks: NavigationEventSink[]): NavigationEventSink {
  return {
    emit(event: unknown) {
      const parsed = assertSafeNavigationEvent(event);
      for (const sink of sinks) sink.emit(parsed);
    },
  };
}
