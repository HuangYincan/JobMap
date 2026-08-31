// 折线入参校验(三引擎共用)。非法/空/超长 → null,调用方返回 no-op remove,不挂图。

import {
  MAX_POLYLINE_POINTS,
  type LngLat,
  type MapPolyline,
  type MapPolylineOptions,
} from './types.ts';

export { MAX_POLYLINE_POINTS };

const MAX_LNG = 180;
const MAX_LAT = 90;
const DEFAULT_COLOR = '#007AFF';
const DEFAULT_WEIGHT = 6;

export function noopPolyline(): MapPolyline {
  return { raw: null, remove() {} };
}

export function normalizePolylinePath(
  opts: MapPolylineOptions | null | undefined,
): LngLat[] | null {
  const path = opts?.path;
  if (!Array.isArray(path) || path.length < 2 || path.length > MAX_POLYLINE_POINTS) {
    return null;
  }
  const out: LngLat[] = [];
  for (const point of path) {
    if (!point || typeof point !== 'object') return null;
    const lng = point.lng;
    const lat = point.lat;
    if (typeof lng !== 'number' || typeof lat !== 'number') return null;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    if (lng < -MAX_LNG || lng > MAX_LNG || lat < -MAX_LAT || lat > MAX_LAT) return null;
    out.push({ lng, lat });
  }
  return out;
}

export function polylineVisuals(opts: MapPolylineOptions): {
  color: string;
  dashed: boolean;
  weight: number;
} {
  const weight = opts.weight;
  return {
    color: typeof opts.color === 'string' && opts.color.length > 0 ? opts.color : DEFAULT_COLOR,
    dashed: Boolean(opts.dashed),
    weight:
      typeof weight === 'number' && Number.isFinite(weight) && weight > 0
        ? weight
        : DEFAULT_WEIGHT,
  };
}
