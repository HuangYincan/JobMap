// Agent 附近检索 / 岗位检索起点:用户位置优先,视野中心仅作回退。

import type { AgentContext } from './types.ts';

export interface AgentLngLat {
  lng: number;
  lat: number;
}

export function coerceFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function isFiniteLngLat(value: unknown): value is AgentLngLat {
  const loc = parseAgentLngLat(value);
  return Boolean(loc);
}

/** 解析经纬度:接受 number 或数字字符串;越界/NaN → undefined。 */
export function parseAgentLngLat(value: unknown): AgentLngLat | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const loc = value as { lng?: unknown; lat?: unknown };
  const lng = coerceFiniteNumber(loc.lng);
  const lat = coerceFiniteNumber(loc.lat);
  if (lng === undefined || lat === undefined) return undefined;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return undefined;
  return { lng, lat };
}

export function parseAgentUserLocation(value: unknown): AgentLngLat | undefined {
  return parseAgentLngLat(value);
}

export interface AgentViewportFields {
  center: AgentLngLat;
  zoom: number;
  bounds?: { minLng: number; minLat: number; maxLng: number; maxLat: number };
}

/** 可选视野:缺 zoom/中心或非 finite → undefined(调用方应省略字段,不要 400 整轮对话)。 */
export function parseAgentViewport(value: unknown): AgentViewportFields | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const vp = value as { center?: unknown; zoom?: unknown; bounds?: unknown };
  const center = parseAgentLngLat(vp.center);
  const zoom = coerceFiniteNumber(vp.zoom);
  if (!center || zoom === undefined) return undefined;
  let bounds: AgentViewportFields['bounds'];
  if (vp.bounds != null) {
    if (typeof vp.bounds !== 'object' || Array.isArray(vp.bounds)) return undefined;
    const raw = vp.bounds as { minLng?: unknown; minLat?: unknown; maxLng?: unknown; maxLat?: unknown };
    const minLng = coerceFiniteNumber(raw.minLng);
    const minLat = coerceFiniteNumber(raw.minLat);
    const maxLng = coerceFiniteNumber(raw.maxLng);
    const maxLat = coerceFiniteNumber(raw.maxLat);
    if (minLng === undefined || minLat === undefined || maxLng === undefined || maxLat === undefined) {
      return undefined;
    }
    bounds = { minLng, minLat, maxLng, maxLat };
  }
  return bounds ? { center, zoom, bounds } : { center, zoom };
}

/** 岗位/附近检索原点:用户位置 > 视野中心。 */
export function agentSearchOrigin(
  ctx: Pick<AgentContext, 'userLocation' | 'viewport'>,
): AgentLngLat | undefined {
  if (isFiniteLngLat(ctx.userLocation)) return { lng: ctx.userLocation.lng, lat: ctx.userLocation.lat };
  const center = ctx.viewport?.center;
  if (isFiniteLngLat(center)) return { lng: center.lng, lat: center.lat };
  return undefined;
}

function fmtCoord(n: number): string {
  return n.toFixed(6);
}

/**
 * 注入系统提示的地图上下文(纯文本,无 secret)。
 * 明确区分用户位置与视野中心,避免模型把相机中心当成人所在地。
 */
export function formatAgentMapContext(
  ctx: Pick<AgentContext, 'userLocation' | 'viewport'>,
  lang: 'zh' | 'en' = 'zh',
): string | undefined {
  const user = isFiniteLngLat(ctx.userLocation) ? ctx.userLocation : undefined;
  const view = ctx.viewport;
  if (!user && !view) return undefined;
  const lines: string[] = [];
  if (lang === 'en') {
    if (user) {
      lines.push(`User location (search origin): ${fmtCoord(user.lng)},${fmtCoord(user.lat)}`);
    } else {
      lines.push('User location unknown; nearby/job search may fall back to the view center.');
    }
    if (view) {
      lines.push(
        `View center: ${fmtCoord(view.center.lng)},${fmtCoord(view.center.lat)}; zoom: ${view.zoom}`,
      );
    }
  } else {
    if (user) {
      lines.push(`用户位置(附近检索/岗位检索起点): ${fmtCoord(user.lng)},${fmtCoord(user.lat)}`);
    } else {
      lines.push('用户位置未知,附近检索/岗位检索可回退视野中心。');
    }
    if (view) {
      lines.push(`视野中心: ${fmtCoord(view.center.lng)},${fmtCoord(view.center.lat)}; zoom: ${view.zoom}`);
    }
  }
  return lines.join('\n');
}
