// Navigation-domain Agent tools (tech/31 §5.5). Plan / compare / commute
// filter go through the WS1 RouteService. Tool text is a RoutePlan summary
// only: never geometry, cookies, or provider raw payloads.

import type { AgentContext, AgentTool, ToolResult } from '../types.ts';
import { sanitizeToolText } from '../run-agent.ts';
import {
  MAX_CANDIDATE_IDS,
  MAX_COMMUTE_MINUTES,
  MAX_ID_LENGTH,
  MIN_COMMUTE_MINUTES,
} from '../../navigation/constants.ts';
import {
  parseNavigationIntent,
  parseRouteRequest,
} from '../../navigation/validation.ts';
import { navigationRouteService } from '../../navigation/route-runtime.ts';
import type { RouteService } from '../../navigation/route-service.ts';
import { NAVIGATION_SESSION_FINGERPRINT_PATTERN } from '../../navigation/route-artifacts.ts';
import type {
  NavigationLocationRef,
  TravelMode,
} from '../../navigation/types.ts';
import { TravelModes } from '../../navigation/constants.ts';
import {
  COMMUTE_COMPARE_CONCURRENCY,
  compareCommutes,
  filterCandidatesByCommute,
  formatCommuteMatrix,
  formatFilterResult,
  formatRoutePlanSummary,
  parseCommuteTopK,
  type CompareDestination,
} from '../../navigation/compare.ts';
import {
  type WorkPositionDetailRecord,
} from '../../recruitment-store.ts';
import { loadWorkPositionsByExternalIdsFromDb } from '../../navigation/position-resolver.ts';

const MAX_FILTER_CANDIDATE_IDS = 20;

export interface NavigationToolDeps {
  routeService?: RouteService;
  resolvePositions?: (ids: string[]) => Promise<WorkPositionDetailRecord[]>;
  concurrency?: number;
}

function textOk(text: string): ToolResult {
  return { ok: true, text: sanitizeToolText(text) };
}

function textErr(text: string): ToolResult {
  return { ok: false, error: sanitizeToolText(text) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asMode(value: unknown): TravelMode | undefined {
  return typeof value === 'string' && (TravelModes as readonly string[]).includes(value)
    ? (value as TravelMode)
    : undefined;
}

function sessionFingerprint(ctx: AgentContext): string | null {
  const fingerprint = ctx.navigationSession?.fingerprint;
  if (!fingerprint || !NAVIGATION_SESSION_FINGERPRINT_PATTERN.test(fingerprint)) {
    return null;
  }
  return fingerprint;
}

function missingRouteSlots(input: Record<string, unknown>): boolean {
  if (
    Array.isArray(input.missingSlots) &&
    input.missingSlots.some((slot) => slot === 'origin' || slot === 'destination')
  ) {
    return true;
  }
  if (typeof input.task === 'string') {
    const parsed = parseNavigationIntent(input);
    if (
      parsed.ok &&
      (parsed.value.missingSlots.includes('origin') ||
        parsed.value.missingSlots.includes('destination'))
    ) {
      return true;
    }
  }
  return false;
}

function extractRouteRequestRaw(input: Record<string, unknown>): Record<string, unknown> {
  const commute = isRecord(input.commute) ? input.commute : undefined;
  const appointment = isRecord(input.appointment) ? input.appointment : undefined;
  const preferred = Array.isArray(commute?.preferredModes) ? commute.preferredModes : [];
  const mode = asMode(input.mode) ?? asMode(preferred[0]);
  const raw: Record<string, unknown> = {
    origin: input.origin,
    destination: input.destination,
    mode,
  };
  if (typeof input.departureAt === 'string') raw.departureAt = input.departureAt;
  if (typeof input.arrivalAt === 'string') raw.arrivalAt = input.arrivalAt;
  else if (typeof appointment?.startsAt === 'string') raw.arrivalAt = appointment.startsAt;
  if (typeof input.timezone === 'string') raw.timezone = input.timezone;
  else if (typeof appointment?.timezone === 'string') raw.timezone = appointment.timezone;
  return raw;
}

function locationFromDetail(record: WorkPositionDetailRecord): NavigationLocationRef | null {
  if (!record.location) return null;
  return {
    kind: 'coordinate',
    label: record.siteLabel ?? record.companyName,
    lng: record.location.lng,
    lat: record.location.lat,
    coordinateSystem: record.location.coordinateSystem,
    city: record.city,
    precision: 'approximate',
  };
}

function destinationFromDetail(record: WorkPositionDetailRecord): CompareDestination | null {
  const location = locationFromDetail(record);
  if (!location) return null;
  return {
    id: record.positionId,
    label: `${record.title} · ${record.siteLabel ?? record.companyName}`,
    location,
  };
}

async function defaultResolvePositions(ids: string[]): Promise<WorkPositionDetailRecord[]> {
  return loadWorkPositionsByExternalIdsFromDb(ids);
}

function parseOrigin(raw: unknown): NavigationLocationRef | null {
  if (!isRecord(raw)) return null;
  const parsed = parseRouteRequest({
    origin: raw,
    destination: raw,
    mode: 'walk',
  });
  if (!parsed.ok) return null;
  return parsed.value.origin;
}

function parseIdList(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0 || value.length > max) return null;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim() || item.length > MAX_ID_LENGTH) return null;
    const id = item.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (ids.length === 0 || ids.length > max) return null;
  return ids;
}

export function parseTopK(value: unknown): number | null {
  return parseCommuteTopK(value);
}

export function navigationTools(deps: NavigationToolDeps = {}): AgentTool[] {
  const routeService = deps.routeService ?? navigationRouteService;
  const resolvePositions = deps.resolvePositions ?? defaultResolvePositions;
  const concurrency = deps.concurrency ?? COMMUTE_COMPARE_CONCURRENCY;

  return [
    {
      name: 'navigation__planRoute',
      description:
        '规划一条已校验起终点的通勤路线,返回 RoutePlan 摘要(质量、时长、距离、警告)。仅 provider_route 含 routeId;不含 geometry。missingSlots 含 origin/destination 时拒绝规划。',
      inputSchema: {
        type: 'object',
        properties: {
          origin: { type: 'object' },
          destination: { type: 'object' },
          mode: { type: 'string', enum: [...TravelModes] },
          departureAt: { type: 'string' },
          arrivalAt: { type: 'string' },
          timezone: { type: 'string' },
          task: { type: 'string' },
          missingSlots: { type: 'array', items: { type: 'string' } },
          commute: { type: 'object' },
          appointment: { type: 'object' },
        },
      },
      provider: 'navigation',
      async call(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
        if (missingRouteSlots(input)) {
          return textErr('缺少出发地或目的地,不能规划路线');
        }
        const fingerprint = sessionFingerprint(ctx);
        if (!fingerprint) {
          return textErr('导航会话无效,不能规划路线');
        }
        const parsed = parseRouteRequest(extractRouteRequestRaw(input));
        if (!parsed.ok) {
          return textErr('路线请求无效,不能规划路线');
        }
        const result = await routeService.plan(parsed.value, { fingerprint }, ctx.signal);
        if (!result.ok) {
          return textErr(result.error.message);
        }
        return textOk(formatRoutePlanSummary(result.plan));
      },
    },
    {
      name: 'navigation__compareCommutes',
      description:
        '比较 1 个起点到 2–5 个候选办公点的通勤。返回统一口径矩阵(成功项、失败项、质量标签),不做推荐总分。',
      inputSchema: {
        type: 'object',
        properties: {
          origin: { type: 'object' },
          destinations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                location: { type: 'object' },
              },
            },
          },
          positionIds: { type: 'array', items: { type: 'string' } },
          mode: { type: 'string', enum: [...TravelModes] },
        },
        required: ['origin', 'mode'],
      },
      provider: 'navigation',
      async call(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
        const fingerprint = sessionFingerprint(ctx);
        if (!fingerprint) return textErr('导航会话无效,不能比较通勤');
        const origin = parseOrigin(input.origin);
        const mode = asMode(input.mode);
        if (!origin || !mode) return textErr('起点或出行方式无效');
        let destinations: CompareDestination[] = [];
        if (Array.isArray(input.destinations)) {
          for (const item of input.destinations) {
            if (!isRecord(item) || typeof item.id !== 'string') continue;
            const location = parseOrigin(item.location);
            if (!location) continue;
            destinations.push({
              id: item.id,
              label: typeof item.label === 'string' ? item.label : item.id,
              location,
            });
          }
        } else {
          const ids = parseIdList(input.positionIds, MAX_CANDIDATE_IDS);
          if (!ids) return textErr('通勤比较需要 2–5 个候选办公点');
          const records = await resolvePositions(ids);
          destinations = records
            .map(destinationFromDetail)
            .filter((item): item is CompareDestination => item != null);
        }
        const compared = await compareCommutes(
          { origin, destinations, mode },
          { routeService, fingerprint, signal: ctx.signal, concurrency },
        );
        if (!compared.ok) return textErr(compared.error);
        return textOk(formatCommuteMatrix(compared.matrix));
      },
    },
    {
      name: 'navigation__filterByCommute',
      description:
        '对候选岗位做通勤过滤:粗筛后仅对 Top-K 请求路线,再按上限分钟严格过滤。0 命中时单列最接近候选与放宽说明,不把超限伪装成命中。',
      inputSchema: {
        type: 'object',
        properties: {
          positionIds: { type: 'array', items: { type: 'string' } },
          origin: { type: 'object' },
          maxMinutes: { type: 'number' },
          mode: { type: 'string', enum: [...TravelModes] },
          topK: { type: 'number' },
        },
        required: ['positionIds', 'origin', 'maxMinutes', 'mode'],
      },
      provider: 'navigation',
      async call(input: Record<string, unknown>, ctx: AgentContext): Promise<ToolResult> {
        const fingerprint = sessionFingerprint(ctx);
        if (!fingerprint) return textErr('导航会话无效,不能过滤通勤');
        const origin = parseOrigin(input.origin);
        const mode = asMode(input.mode);
        const maxMinutes = typeof input.maxMinutes === 'number' ? input.maxMinutes : NaN;
        if (!origin || !mode) return textErr('起点或出行方式无效');
        if (!Number.isFinite(maxMinutes) || maxMinutes < MIN_COMMUTE_MINUTES || maxMinutes > MAX_COMMUTE_MINUTES) {
          return textErr('通勤上限分钟无效');
        }
        const ids = parseIdList(input.positionIds, MAX_FILTER_CANDIDATE_IDS);
        if (!ids) return textErr('候选岗位 ID 无效');
        const topK = parseTopK(input.topK);
        if (topK === null) return textErr('Top-K 必须是 1–5 的有限整数');
        const records = await resolvePositions(ids);
        const candidates = records
          .map(destinationFromDetail)
          .filter((item): item is CompareDestination => item != null);
        const filtered = await filterCandidatesByCommute(
          { origin, candidates, mode, maxMinutes, topK },
          { routeService, fingerprint, signal: ctx.signal, concurrency, maxRouteCalls: Math.min(MAX_CANDIDATE_IDS, topK) },
        );
        if (!filtered.ok) return textErr(filtered.error);
        if (Array.isArray(input.positionIds) && input.positionIds.length > topK && !filtered.result.matrix.budgetNote) {
          filtered.result.matrix.budgetNote = `Top-K=${topK}，已限制路线请求以免 N+1`;
        }
        return textOk(formatFilterResult(filtered.result, maxMinutes));
      },
    },
  ];
}
