// ============================================================
// 账户 / 偏好 / 会话契约
//
// 默认地图模式是 work。语言：已登录读偏好，未登录跟浏览器。
// Recent 只记已提交的 persistable 搜索（work / internship）。
// 已登录走 /api/me/search-history；游客走浏览器 dm.guest-search-history.v1。
// ============================================================

import type { Language } from './i18n.ts';
import type { MapMode } from './types.ts';
import { canonicalMode } from './modes.ts';

export type AuthProvider = 'phone' | 'email' | 'github' | 'google' | 'x' | 'wechat' | 'password';

export type JobSeekingStatus = 'open' | 'casually' | 'not-looking';

export type CareerStrength = 'algorithm' | 'frontend' | 'backend' | 'product' | 'design' | 'data';

export interface NotificationPreferences {
  emailJobs: boolean;
  smsJobs: boolean;
  emailSchools: boolean;
  smsSchools: boolean;
}

export interface CareerPreferences {
  status: JobSeekingStatus;
  families: Array<'intern' | 'campus' | 'social'>;
  industries: string[];
  strengths: CareerStrength[];
}

export interface UserPreferences {
  language: Language;
  defaultMode: MapMode;
  notifications: NotificationPreferences;
  career: CareerPreferences;
}

export interface AccountUser {
  id: string;
  displayName: string;
  /** 侧栏 <small>：手机、邮箱或用户名 */
  accountLabel: string;
  avatarUrl?: string;
  phone?: string;
  email?: string;
  /** 密码登录账号(provider='password')的用户名 */
  username?: string;
  /** password_hash 非空(前端据此区分「设置密码」/「修改密码」) */
  hasPassword: boolean;
  provider: AuthProvider;
  preferences: UserPreferences;
}

export interface SessionState {
  user: AccountUser | null;
}

/** 搜索历史条目可选的实体引用：记录时查询确定落在一个实体（建议选中）时
 *  一并存下，点击「最近」直接回到该实体（飞行 + 详情），而非仅回放查询串。
 *  旧条目（localStorage / DB 迁移前）无此字段 → 保持纯搜索回放。 */
export interface SearchHistoryEntityRef {
  kind: 'company' | 'poi';
  id: string;
  name: string;
  lng?: number;
  lat?: number;
  address?: string;
}

/** Persisted entity refs are bounded so malformed client snapshots cannot bloat rows. */
const MAX_ENTITY_REF_ID_LENGTH = 200;
const MAX_ENTITY_REF_NAME_LENGTH = 100;
const MAX_ENTITY_REF_ADDRESS_LENGTH = 500;
const MIN_LNG = -180;
const MAX_LNG = 180;
const MIN_LAT = -90;
const MAX_LAT = 90;

export interface SearchHistoryEntry {
  id: string;
  query: string;
  mode: MapMode;
  createdAt: string;
  entity?: SearchHistoryEntityRef;
}

/** 校验/规范化实体引用：结构不符（旧数据、脏数据、恶意 body）一律返回
 *  undefined，调用方据此省略字段而不是写坏行。 */
export function sanitizeEntityRef(raw: unknown): SearchHistoryEntityRef | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const ref = raw as Record<string, unknown>;
  const id = typeof ref.id === 'string' ? ref.id.trim() : '';
  const name = typeof ref.name === 'string' ? ref.name.trim() : '';
  if (!id || !name) return undefined;
  if (
    id.length > MAX_ENTITY_REF_ID_LENGTH ||
    name.length > MAX_ENTITY_REF_NAME_LENGTH ||
    (typeof ref.address === 'string' && ref.address.length > MAX_ENTITY_REF_ADDRESS_LENGTH)
  ) {
    return undefined;
  }
  const out: SearchHistoryEntityRef = {
    kind: ref.kind === 'poi' ? 'poi' : 'company',
    id,
    name,
  };
  if (typeof ref.lng === 'number' && Number.isFinite(ref.lng)) out.lng = ref.lng;
  if (typeof ref.lat === 'number' && Number.isFinite(ref.lat)) out.lat = ref.lat;
  if (
    out.lng !== undefined &&
    (out.lng < MIN_LNG || out.lng > MAX_LNG)
  ) delete out.lng;
  if (
    out.lat !== undefined &&
    (out.lat < MIN_LAT || out.lat > MAX_LAT)
  ) delete out.lat;
  if (typeof ref.address === 'string' && ref.address) out.address = ref.address;
  return out;
}

/** 建议选中 → 实体引用（结构化入参，避免 account.ts 依赖 suggestion 类型）。
 *  poiId 缺失（纯关键词 / 标签 / 区域）时不记实体。 */
export function entityRefFromSelection(
  input: {
    poiId?: string;
    name: string;
    location?: { lng?: number; lat?: number; address?: string } | null;
  },
  mode: MapMode,
): SearchHistoryEntityRef | undefined {
  if (!input.poiId || !input.name) return undefined;
  const loc = input.location;
  return {
    kind: canonicalMode(mode) === 'domain' ? 'poi' : 'company',
    id: input.poiId,
    name: input.name,
    ...(typeof loc?.lng === 'number' ? { lng: loc.lng } : {}),
    ...(typeof loc?.lat === 'number' ? { lat: loc.lat } : {}),
    ...(loc?.address ? { address: loc.address } : {}),
  };
}

export interface SavedPlace {
  id: string;
  poiId: string;
  name: string;
  mode: MapMode;
  kind: 'domain' | 'recruitment';
  address?: string;
  lng?: number;
  lat?: number;
  createdAt: string;
}

export type ApplicationStatus = 'applied' | 'viewed' | 'withdrawn';

export interface ApplicationRecord {
  id: string;
  positionId: string;
  companyPoiId: string;
  title: string;
  companyName: string;
  applyUrl?: string;
  status: ApplicationStatus;
  createdAt: string;
}

export type NotificationKind = 'job' | 'school';
export type NotificationStatus = 'queued' | 'read' | 'sent' | 'failed';

export interface NotificationRecord {
  id: string;
  kind: NotificationKind;
  positionId?: string;
  companyPoiId?: string;
  title: string;
  companyName?: string;
  applyUrl?: string;
  channels: Array<'inbox' | 'email' | 'sms'>;
  status: NotificationStatus;
  createdAt: string;
}

export const DEFAULT_NOTIFICATIONS: NotificationPreferences = {
  emailJobs: false,
  smsJobs: false,
  emailSchools: false,
  smsSchools: false,
};

export const DEFAULT_CAREER: CareerPreferences = {
  status: 'casually',
  families: ['intern', 'campus'],
  industries: ['internet'],
  strengths: [],
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  language: 'zh',
  defaultMode: 'work',
  notifications: { ...DEFAULT_NOTIFICATIONS },
  career: { ...DEFAULT_CAREER, families: [...DEFAULT_CAREER.families], industries: [...DEFAULT_CAREER.industries], strengths: [] },
};

const LANGUAGES = ['zh', 'en'] as const;
const JOB_SEEKING_STATUSES = ['open', 'casually', 'not-looking'] as const;
const CAREER_FAMILY_VALUES = ['intern', 'campus', 'social'] as const;
const CAREER_STRENGTH_VALUES = ['algorithm', 'frontend', 'backend', 'product', 'design', 'data'] as const;

/** Client preferences are persisted only after every field is normalized. */
function sanitizeLanguage(value: unknown, fallback: Language = 'zh'): Language {
  return (LANGUAGES as readonly string[]).includes(value as string)
    ? value as Language
    : fallback;
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitizeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value as string) ? value as T : fallback;
}

function sanitizeBoundedStrings(
  value: unknown,
  maxItems: number,
  maxLength: number,
  fallback: string[] = [],
): string[] {
  if (!Array.isArray(value)) return fallback;
  const out = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const normalized = item.trim();
    if (!normalized || normalized.length > maxLength) continue;
    out.add(normalized);
    if (out.size === maxItems) break;
  }
  return [...out];
}

function sanitizeNotificationPreferences(value: unknown): NotificationPreferences {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    emailJobs: sanitizeBoolean(raw.emailJobs, false),
    smsJobs: sanitizeBoolean(raw.smsJobs, false),
    emailSchools: sanitizeBoolean(raw.emailSchools, false),
    smsSchools: sanitizeBoolean(raw.smsSchools, false),
  };
}

function sanitizeCareerPreferences(value: unknown): CareerPreferences {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const families = sanitizeBoundedStrings(
    raw.families,
    CAREER_FAMILY_VALUES.length,
    16,
    [...DEFAULT_CAREER.families],
  )
    .filter((item): item is typeof CAREER_FAMILY_VALUES[number] =>
      (CAREER_FAMILY_VALUES as readonly string[]).includes(item));
  const strengths = sanitizeBoundedStrings(
    raw.strengths,
    CAREER_STRENGTH_VALUES.length,
    16,
    [...DEFAULT_CAREER.strengths],
  )
    .filter((item): item is typeof CAREER_STRENGTH_VALUES[number] =>
      (CAREER_STRENGTH_VALUES as readonly string[]).includes(item));
  return {
    status: sanitizeEnum(raw.status, JOB_SEEKING_STATUSES, DEFAULT_CAREER.status),
    families,
    industries: sanitizeBoundedStrings(raw.industries, 20, 40, [...DEFAULT_CAREER.industries]),
    strengths,
  };
}

export const SESSION_COOKIE = 'dm_session';

export function emptyPreferences(language: Language = 'zh'): UserPreferences {
  return {
    language,
    defaultMode: 'work',
    notifications: { ...DEFAULT_NOTIFICATIONS },
    career: {
      ...DEFAULT_CAREER,
      families: [...DEFAULT_CAREER.families],
      industries: [...DEFAULT_CAREER.industries],
      strengths: [],
    },
  };
}

export function mergePreferences(
  base: UserPreferences | null | undefined,
  patch?: Partial<UserPreferences>,
): UserPreferences {
  const start = base ?? emptyPreferences();
  const patchNotifications = patch?.notifications === undefined
    ? {}
    : sanitizeNotificationPreferences(patch.notifications);
  return {
    language: sanitizeLanguage(patch?.language, sanitizeLanguage(start.language)),
    defaultMode: canonicalMode(patch?.defaultMode ?? start.defaultMode ?? 'work'),
    notifications: { ...sanitizeNotificationPreferences(start.notifications), ...patchNotifications },
    career: sanitizeCareerPreferences({
      ...sanitizeCareerPreferences(start.career),
      ...(patch?.career && typeof patch.career === 'object' ? patch.career : {}),
    }),
  };
}

export function resolvePreferences(
  user: AccountUser | null,
  browserLang: Language,
): UserPreferences {
  if (!user) return emptyPreferences(browserLang);
  return mergePreferences(user.preferences, { language: user.preferences.language || browserLang });
}

export function initialsFromName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}
