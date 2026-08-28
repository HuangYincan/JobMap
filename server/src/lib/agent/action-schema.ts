// 动作校验(纯函数,无 IO)。LLM 输出的结构化动作 JSON 必须逐字段通过这里,
// 其它越界/未知字段/未知 type 一律返回 null(丢弃),不给前端地图引擎。
// flyTo.zoom 的有限值会按项目/引擎共同支持范围[3,20]规范化,非 finite 仍拒绝。

import type { AgentAction } from './types.ts';
import { clampMapZoom } from '../map-engine/zoom.ts';
import { OPAQUE_ROUTE_ID_PATTERN } from '../navigation/constants.ts';

const MAX_LAT = 90;
const MAX_LNG = 180;
const MAX_RADIUS_M = 50_000;
const MIN_RADIUS_M = 10;
const MAX_POINTS = 50;
const MAX_ID_CHARS = 128;
const MAX_QUERY_CHARS = 100;
const MAX_MODE_CHARS = 32;
const MAX_LABEL_CHARS = 50;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** GCJ-02 经纬度:finite 且在合法范围内。 */
function isLng(v: unknown): boolean {
  return isFiniteNumber(v) && v >= -MAX_LNG && v <= MAX_LNG;
}

function isLat(v: unknown): boolean {
  return isFiniteNumber(v) && v >= -MAX_LAT && v <= MAX_LAT;
}

function isOptionalString(v: unknown, max: number): boolean {
  return v === undefined || (typeof v === 'string' && v.length <= max);
}

function isValidCenter(v: unknown): boolean {
  return isRecord(v) && isLng(v.lng) && isLat(v.lat);
}

/** Keys that would smuggle geometry or provider raw data into showRoute. */
const SHOW_ROUTE_GEOMETRY_KEYS = new Set([
  'geometry',
  'polyline',
  'path',
  'coordinates',
  'points',
  'providerRaw',
  'rawResponse',
  'provider_response',
  'lng',
  'lat',
]);

function containsForbiddenGeometry(value: unknown, depth = 0): boolean {
  if (depth > 4 || value == null) return false;
  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenGeometry(item, depth + 1));
  }
  if (!isRecord(value)) return false;
  for (const [key, nested] of Object.entries(value)) {
    if (SHOW_ROUTE_GEOMETRY_KEYS.has(key)) return true;
    if (containsForbiddenGeometry(nested, depth + 1)) return true;
  }
  return false;
}

/**
 * 校验一个未知来源的动作对象。通过 → 规范化的 AgentAction;任何字段越界、
 * 类型错误、或 type 不在白名单 → null。payload 上的多余字段被忽略(容忍
 * LLM 输出多余键,只校验约束字段)。
 */
export function validateAction(raw: unknown): AgentAction | null {
  if (!isRecord(raw)) return null;
  const type = raw.type;
  if (typeof type !== 'string') return null;
  const payload = raw.payload;
  if (!isRecord(payload)) return null;
  if (!isOptionalString(payload.mode, MAX_MODE_CHARS)) return null;
  const mode = payload.mode as string | undefined;

  switch (type) {
    case 'flyTo': {
      if (!isValidCenter(payload.center)) return null;
      const zoom = payload.zoom === undefined ? undefined : clampMapZoom(payload.zoom);
      if (payload.zoom !== undefined && zoom === null) return null;
      return {
        type: 'flyTo',
        payload: {
          center: { lng: (payload.center as { lng: number }).lng, lat: (payload.center as { lat: number }).lat },
          ...(zoom !== undefined && zoom !== null ? { zoom } : {}),
        },
      };
    }
    case 'select': {
      if (typeof payload.id !== 'string' || payload.id.length === 0 || payload.id.length > MAX_ID_CHARS) return null;
      return { type: 'select', payload: { id: payload.id, ...(mode !== undefined ? { mode } : {}) } };
    }
    case 'addMarkers': {
      const points = payload.points;
      if (!Array.isArray(points) || points.length === 0 || points.length > MAX_POINTS) return null;
      const out: Array<{ lng: number; lat: number; label?: string }> = [];
      for (const p of points) {
        if (!isRecord(p) || !isLng(p.lng) || !isLat(p.lat)) return null;
        if (!isOptionalString(p.label, MAX_LABEL_CHARS)) return null;
        out.push({ lng: p.lng as number, lat: p.lat as number, ...(typeof p.label === 'string' ? { label: p.label } : {}) });
      }
      return { type: 'addMarkers', payload: { points: out } };
    }
    case 'drawCircle': {
      if (!isValidCenter(payload.center)) return null;
      if (!isFiniteNumber(payload.radiusMeters)) return null;
      if (payload.radiusMeters < MIN_RADIUS_M || payload.radiusMeters > MAX_RADIUS_M) return null;
      if (!isOptionalString(payload.label, MAX_LABEL_CHARS)) return null;
      return {
        type: 'drawCircle',
        payload: {
          center: { lng: (payload.center as { lng: number }).lng, lat: (payload.center as { lat: number }).lat },
          radiusMeters: payload.radiusMeters,
          ...(typeof payload.label === 'string' ? { label: payload.label } : {}),
        },
      };
    }
    case 'openDetail': {
      if (typeof payload.id !== 'string' || payload.id.length === 0 || payload.id.length > MAX_ID_CHARS) return null;
      return { type: 'openDetail', payload: { id: payload.id, ...(mode !== undefined ? { mode } : {}) } };
    }
    case 'search': {
      if (typeof payload.query !== 'string' || payload.query.length === 0 || payload.query.length > MAX_QUERY_CHARS) return null;
      return { type: 'search', payload: { query: payload.query, ...(mode !== undefined ? { mode } : {}) } };
    }
    case 'showRoute': {
      // Format-only: do not look up the artifact store. Reject geometry /
      // polyline / provider-raw even if nested under extra keys.
      if (containsForbiddenGeometry(raw) || containsForbiddenGeometry(payload)) return null;
      if (typeof payload.routeId !== 'string' || !OPAQUE_ROUTE_ID_PATTERN.test(payload.routeId)) {
        return null;
      }
      return { type: 'showRoute', payload: { routeId: payload.routeId } };
    }
    default:
      return null;
  }
}
