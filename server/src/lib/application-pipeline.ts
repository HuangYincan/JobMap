// ============================================================
// 投递监视阶段词表
//
// 默认 6 档（已投递 / 面试中 / Offer / 未通过 / 已撤回 / 已接受）。
// 用户可在 Recent L2 加减、改名、改分组；自定义 id 为 c_* 。
// 未改过的旧 12 档词表读时收成 6 档；等面/一面… → 面试中，一面挂… → 未通过。
// 旧库 viewed → applied。删阶段时调用方把仍在用的行归到 fallback。
// ============================================================

import { t, type Language, type TranslationKey } from './i18n.ts';

export const APPLICATION_STATUS_MAX = 24;
export const APPLICATION_STATUS_LABEL_MAX = 16;
export const APPLICATION_STATUS_ID_MAX = 32;

export type ApplicationStatusGroup = 'active' | 'closed';

export interface ApplicationStatusDef {
  id: string;
  /** 空 = 内置档走 i18n；自定义 / 改名后写用户原文。 */
  label: string;
  group: ApplicationStatusGroup;
  builtin: boolean;
}

export interface ApplicationPipelinePreferences {
  statuses: ApplicationStatusDef[];
}

export type ApplicationWatchFilter =
  | { kind: 'all' }
  | { kind: 'group'; group: ApplicationStatusGroup }
  | { kind: 'status'; id: string };

const CUSTOM_ID = /^c_[a-z0-9]{6,16}$/;

const BUILTIN_GROUP: Record<string, ApplicationStatusGroup> = {
  applied: 'active',
  interview: 'active',
  offer: 'active',
  rejected: 'closed',
  withdrawn: 'closed',
  accepted: 'closed',
  waiting: 'active',
  r1: 'active',
  r2: 'active',
  r3: 'active',
  rejected_r1: 'closed',
  rejected_r2: 'closed',
  rejected_r3: 'closed',
};

const BUILTIN_LABEL_KEY: Record<string, TranslationKey> = {
  applied: 'appStatusApplied',
  interview: 'appStatusInterview',
  offer: 'appStatusOffer',
  rejected: 'appStatusRejected',
  withdrawn: 'appStatusWithdrawn',
  accepted: 'appStatusAccepted',
  waiting: 'appStatusWaiting',
  r1: 'appStatusR1',
  r2: 'appStatusR2',
  r3: 'appStatusR3',
  rejected_r1: 'appStatusRejectedR1',
  rejected_r2: 'appStatusRejectedR2',
  rejected_r3: 'appStatusRejectedR3',
};

/** 未改过的旧默认 12 档。读路径收成 DEFAULT_APPLICATION_STATUS_IDS。 */
export const LEGACY_DEFAULT_STATUS_IDS = [
  'applied',
  'waiting',
  'r1',
  'r2',
  'r3',
  'offer',
  'rejected_r1',
  'rejected_r2',
  'rejected_r3',
  'rejected',
  'withdrawn',
  'accepted',
] as const;

/** 旧轮次 id → 默认 6 档。词表里仍留着旧 id 时不改写。 */
export const LEGACY_STATUS_ALIAS: Record<string, string> = {
  waiting: 'interview',
  r1: 'interview',
  r2: 'interview',
  r3: 'interview',
  rejected_r1: 'rejected',
  rejected_r2: 'rejected',
  rejected_r3: 'rejected',
};

export const DEFAULT_APPLICATION_STATUS_IDS = [
  'applied',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
  'accepted',
] as const;

export function isBuiltinStatusId(id: string): boolean {
  return Object.hasOwn(BUILTIN_GROUP, id);
}

export function defaultApplicationStatuses(): ApplicationStatusDef[] {
  return DEFAULT_APPLICATION_STATUS_IDS.map((id) => ({
    id,
    label: '',
    group: BUILTIN_GROUP[id],
    builtin: true,
  }));
}

export function defaultApplicationPipeline(): ApplicationPipelinePreferences {
  return { statuses: defaultApplicationStatuses() };
}

/** 规范化阶段 id：viewed → applied；非法返回 null。旧轮次 id 仍合法，收档在 coerce。 */
export function sanitizeApplicationStatusId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  if (!id || id.length > APPLICATION_STATUS_ID_MAX) return null;
  if (id === 'viewed') return 'applied';
  if (isBuiltinStatusId(id)) return id;
  if (CUSTOM_ID.test(id)) return id;
  return null;
}

function isUnmodifiedLegacyDefault(statuses: ApplicationStatusDef[]): boolean {
  if (statuses.length !== LEGACY_DEFAULT_STATUS_IDS.length) return false;
  const ids = new Set(statuses.map((item) => item.id));
  if (ids.size !== LEGACY_DEFAULT_STATUS_IDS.length) return false;
  for (const id of LEGACY_DEFAULT_STATUS_IDS) {
    if (!ids.has(id)) return false;
  }
  return statuses.every(
    (item) => !item.label && item.group === BUILTIN_GROUP[item.id],
  );
}

export function sanitizeApplicationPipeline(value: unknown): ApplicationPipelinePreferences {
  if (!value || typeof value !== 'object') return defaultApplicationPipeline();
  const raw = (value as { statuses?: unknown }).statuses;
  if (!Array.isArray(raw) || raw.length === 0) return defaultApplicationPipeline();

  const seen = new Set<string>();
  const statuses: ApplicationStatusDef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const id = sanitizeApplicationStatusId(rec.id);
    if (!id || seen.has(id)) continue;
    const builtin = isBuiltinStatusId(id);
    const label = typeof rec.label === 'string'
      ? rec.label.trim().slice(0, APPLICATION_STATUS_LABEL_MAX)
      : '';
    const group: ApplicationStatusGroup =
      rec.group === 'closed' || rec.group === 'active'
        ? rec.group
        : (BUILTIN_GROUP[id] ?? 'active');
    seen.add(id);
    statuses.push({ id, label, group, builtin });
    if (statuses.length === APPLICATION_STATUS_MAX) break;
  }
  if (statuses.length === 0) return defaultApplicationPipeline();
  if (isUnmodifiedLegacyDefault(statuses)) return defaultApplicationPipeline();
  return { statuses };
}

/**
 * 把存储里的阶段收到当前词表：词表里有原 id 则保留（含用户留下的一面/等面）；
 * 否则走轮次别名。对不上返回 null。
 */
export function coerceStatusToCatalog(
  statusId: unknown,
  catalog: ApplicationStatusDef[],
): string | null {
  const id = sanitizeApplicationStatusId(statusId);
  if (!id) return null;
  if (catalog.some((item) => item.id === id)) return id;
  const aliased = LEGACY_STATUS_ALIAS[id];
  if (aliased && catalog.some((item) => item.id === aliased)) return aliased;
  return null;
}

export function resolveStatusLabel(def: ApplicationStatusDef, lang: Language): string {
  if (def.label) return def.label;
  const key = BUILTIN_LABEL_KEY[def.id];
  return key ? t(key, lang) : def.id;
}

export function lookupStatusDef(
  catalog: ApplicationStatusDef[],
  statusId: string,
): ApplicationStatusDef {
  const id = sanitizeApplicationStatusId(statusId) ?? statusId;
  const direct = catalog.find((item) => item.id === id);
  if (direct) return direct;
  const aliased = LEGACY_STATUS_ALIAS[id];
  if (aliased) {
    const mapped = catalog.find((item) => item.id === aliased);
    if (mapped) return mapped;
  }
  return {
    id,
    label: '',
    group: BUILTIN_GROUP[id] ?? 'active',
    builtin: isBuiltinStatusId(id),
  };
}

export function fallbackStatusId(catalog: ApplicationStatusDef[]): string {
  return catalog.find((item) => item.id === 'applied')?.id
    ?? catalog[0]?.id
    ?? 'applied';
}

/** CSV / 手动添加:认阶段 id、别名、或当前词表中/英/自定义名；对不上落到 fallback。 */
export function resolveWatchStatus(
  raw: unknown,
  catalog: ApplicationStatusDef[],
  lang: Language = 'zh',
): string {
  const fallback = fallbackStatusId(catalog);
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const coerced = coerceStatusToCatalog(trimmed, catalog);
  if (coerced) return coerced;
  const lower = trimmed.toLowerCase();
  for (const def of catalog) {
    if (def.label && def.label.trim().toLowerCase() === lower) return def.id;
    if (resolveStatusLabel(def, 'zh').toLowerCase() === lower) return def.id;
    if (resolveStatusLabel(def, 'en').toLowerCase() === lower) return def.id;
    if (resolveStatusLabel(def, lang).toLowerCase() === lower) return def.id;
  }
  return fallback;
}

export function isOfferLike(id: string): boolean {
  return id === 'offer' || id === 'accepted';
}

export function pillTone(def: ApplicationStatusDef): 'active' | 'offer' | 'closed' {
  if (isOfferLike(def.id)) return 'offer';
  return def.group === 'closed' ? 'closed' : 'active';
}

export function matchesWatchFilter(
  statusId: string,
  filter: ApplicationWatchFilter,
  catalog: ApplicationStatusDef[],
): boolean {
  const def = lookupStatusDef(catalog, statusId);
  if (filter.kind === 'all') return true;
  if (filter.kind === 'group') return def.group === filter.group;
  return def.id === filter.id;
}

export function createCustomStatus(
  label: string,
  group: ApplicationStatusGroup,
  idFactory: () => string = newCustomStatusId,
): ApplicationStatusDef | null {
  const trimmed = label.trim().slice(0, APPLICATION_STATUS_LABEL_MAX);
  if (!trimmed) return null;
  const id = sanitizeApplicationStatusId(idFactory());
  if (!id || isBuiltinStatusId(id)) return null;
  return { id, label: trimmed, group, builtin: false };
}

export function newCustomStatusId(): string {
  const raw = globalThis.crypto?.randomUUID?.().replace(/-/g, '') ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `c_${raw.slice(0, 10)}`;
}

export function removeStatus(
  catalog: ApplicationStatusDef[],
  id: string,
): ApplicationStatusDef[] {
  const next = catalog.filter((item) => item.id !== id);
  return next.length === 0 ? catalog : next;
}

export function addStatus(
  catalog: ApplicationStatusDef[],
  next: ApplicationStatusDef,
): ApplicationStatusDef[] {
  if (catalog.some((item) => item.id === next.id)) return catalog;
  if (catalog.length >= APPLICATION_STATUS_MAX) return catalog;
  return [...catalog, next];
}

export function renameStatus(
  catalog: ApplicationStatusDef[],
  id: string,
  label: string,
): ApplicationStatusDef[] {
  const trimmed = label.trim().slice(0, APPLICATION_STATUS_LABEL_MAX);
  return catalog.map((item) => (item.id === id ? { ...item, label: trimmed } : item));
}

export function moveStatusGroup(
  catalog: ApplicationStatusDef[],
  id: string,
  group: ApplicationStatusGroup,
): ApplicationStatusDef[] {
  return catalog.map((item) => (item.id === id ? { ...item, group } : item));
}

export function formatRelativeTime(iso: string, lang: Language, now = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const delta = Math.max(0, now - then);
  if (delta < 60_000) return t('timeJustNow', lang);
  if (delta < 3_600_000) {
    return t('timeMinutesAgo', lang).replace('{n}', String(Math.floor(delta / 60_000)));
  }
  if (delta < 86_400_000) {
    return t('timeHoursAgo', lang).replace('{n}', String(Math.floor(delta / 3_600_000)));
  }
  if (delta < 7 * 86_400_000) {
    return t('timeDaysAgo', lang).replace('{n}', String(Math.floor(delta / 86_400_000)));
  }
  const date = new Date(then);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
