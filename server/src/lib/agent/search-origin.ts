// Agent 附近检索 / 岗位检索起点:用户位置优先,视野中心仅作回退。

import type { AgentContext } from './types.ts';

export interface AgentLngLat {
  lng: number;
  lat: number;
}

export function isFiniteLngLat(value: unknown): value is AgentLngLat {
  if (!value || typeof value !== 'object') return false;
  const loc = value as { lng?: unknown; lat?: unknown };
  return typeof loc.lng === 'number' && Number.isFinite(loc.lng)
    && typeof loc.lat === 'number' && Number.isFinite(loc.lat)
    && loc.lng >= -180 && loc.lng <= 180
    && loc.lat >= -90 && loc.lat <= 90;
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
