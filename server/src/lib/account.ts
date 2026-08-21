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
  if (typeof ref.id !== 'string' || !ref.id) return undefined;
  if (typeof ref.name !== 'string' || !ref.name) return undefined;
  const out: SearchHistoryEntityRef = {
    kind: ref.kind === 'poi' ? 'poi' : 'company',
    id: ref.id,
    name: ref.name,
  };
  if (typeof ref.lng === 'number' && Number.isFinite(ref.lng)) out.lng = ref.lng;
  if (typeof ref.lat === 'number' && Number.isFinite(ref.lat)) out.lat = ref.lat;
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
  return {
    language: patch?.language ?? start.language,
    defaultMode: canonicalMode(patch?.defaultMode ?? start.defaultMode ?? 'work'),
    notifications: { ...DEFAULT_NOTIFICATIONS, ...start.notifications, ...patch?.notifications },
    career: {
      ...DEFAULT_CAREER,
      ...start.career,
      ...patch?.career,
      families: patch?.career?.families ?? start.career?.families ?? [...DEFAULT_CAREER.families],
      industries: patch?.career?.industries ?? start.career?.industries ?? [...DEFAULT_CAREER.industries],
      strengths: patch?.career?.strengths ?? start.career?.strengths ?? [],
    },
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
