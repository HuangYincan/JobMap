// 岗位工具带回的办公点提示 → 在 LLM 漏发地图动作时合成 flyTo / addMarkers / select。
// 纯函数,零 IO;合成结果仍走 validateAction,非法项不会下发。

import { haversineDistance } from '../types.ts';
import { validateAction } from './action-schema.ts';
import type { AgentAction, AgentMapHint } from './types.ts';

const MAX_LNG = 180;
const MAX_LAT = 90;
const MAX_LABEL_CHARS = 50;
const MAX_ID_CHARS = 128;
const MAX_POINTS = 50;
/** 超过此唯一办公点数不再自动落点(避免把整页 20 条搜索结果全钉上)。 */
export const AUTO_ANNOTATE_MAX = 8;

export interface WorkHintBuckets {
  search: AgentMapHint[];
  detail: AgentMapHint[];
}

export function emptyWorkHintBuckets(): WorkHintBuckets {
  return { search: [], detail: [] };
}

export function sanitizeMapHints(raw: unknown): AgentMapHint[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentMapHint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const lng = rec.lng;
    const lat = rec.lat;
    if (typeof lng !== 'number' || typeof lat !== 'number') continue;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (Math.abs(lng) > MAX_LNG || Math.abs(lat) > MAX_LAT) continue;
    const hint: AgentMapHint = { lng, lat };
    if (typeof rec.label === 'string') {
      const label = rec.label.trim().slice(0, MAX_LABEL_CHARS);
      if (label) hint.label = label;
    }
    if (typeof rec.mapId === 'string') {
      const mapId = rec.mapId.trim().slice(0, MAX_ID_CHARS);
      if (mapId) hint.mapId = mapId;
    }
    if (typeof rec.positionId === 'string') {
      const positionId = rec.positionId.trim().slice(0, MAX_ID_CHARS);
      if (positionId) hint.positionId = positionId;
    }
    out.push(hint);
  }
  return out;
}

function hintKey(hint: AgentMapHint): string {
  if (hint.mapId) return `id:${hint.mapId}`;
  return `ll:${hint.lng.toFixed(5)},${hint.lat.toFixed(5)}`;
}

export function mergeMapHints(existing: AgentMapHint[], incoming: AgentMapHint[]): AgentMapHint[] {
  const byKey = new Map<string, AgentMapHint>();
  for (const hint of [...existing, ...incoming]) {
    const key = hintKey(hint);
    if (!byKey.has(key)) byKey.set(key, hint);
  }
  return [...byKey.values()].slice(0, MAX_POINTS);
}

export function ingestWorkMapHints(
  buckets: WorkHintBuckets,
  toolName: string,
  hints: AgentMapHint[] | undefined,
): WorkHintBuckets {
  const clean = sanitizeMapHints(hints);
  if (toolName === 'work__searchPositions') {
    return { ...buckets, search: mergeMapHints([], clean) };
  }
  if (toolName === 'work__getPositionDetail') {
    if (clean.length === 0) return buckets;
    return { ...buckets, detail: mergeMapHints(buckets.detail, clean) };
  }
  return buckets;
}

export function hintsForJobMapActions(buckets: WorkHintBuckets): AgentMapHint[] {
  return buckets.detail.length > 0 ? buckets.detail : buckets.search;
}

function centroid(hints: AgentMapHint[]): { lng: number; lat: number } {
  const n = hints.length;
  return {
    lng: hints.reduce((sum, item) => sum + item.lng, 0) / n,
    lat: hints.reduce((sum, item) => sum + item.lat, 0) / n,
  };
}

function zoomForHints(hints: AgentMapHint[]): number {
  if (hints.length === 1) return 15;
  const center = centroid(hints);
  let maxMeters = 0;
  for (const hint of hints) {
    maxMeters = Math.max(maxMeters, haversineDistance(center, hint));
  }
  if (maxMeters < 1500) return 14;
  if (maxMeters < 4000) return 13;
  if (maxMeters < 10000) return 12;
  return 11;
}

/**
 * LLM 已发的动作优先;缺口用工具办公点补:addMarkers(标注) + flyTo(跳转) + select(点亮公司 pin)。
 * 唯一办公点 > AUTO_ANNOTATE_MAX 时不自动落点。
 */
export function synthesizeJobMapActions(
  llmActions: AgentAction[],
  hints: AgentMapHint[],
): AgentAction[] {
  const unique = mergeMapHints([], sanitizeMapHints(hints));
  if (unique.length === 0 || unique.length > AUTO_ANNOTATE_MAX) return [];

  const types = new Set(llmActions.map((action) => action.type));
  const out: AgentAction[] = [];

  if (!types.has('addMarkers')) {
    const points = unique.map((hint) => {
      const point: { lng: number; lat: number; label?: string } = { lng: hint.lng, lat: hint.lat };
      if (hint.label) point.label = hint.label;
      return point;
    });
    const action = validateAction({ type: 'addMarkers', payload: { points } });
    if (action) out.push(action);
  }

  if (!types.has('flyTo')) {
    const center = centroid(unique);
    const action = validateAction({
      type: 'flyTo',
      payload: { center, zoom: zoomForHints(unique) },
    });
    if (action) out.push(action);
  }

  if (!types.has('select') && !types.has('openDetail')) {
    const mapId = unique.find((hint) => hint.mapId)?.mapId;
    if (mapId) {
      const action = validateAction({ type: 'select', payload: { id: mapId, mode: 'card' } });
      if (action) out.push(action);
    }
  }

  return out;
}
