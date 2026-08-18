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
  provider: AuthProvider;
  preferences: UserPreferences;
}

export interface SessionState {
  user: AccountUser | null;
}

export interface SearchHistoryEntry {
  id: string;
  query: string;
  mode: MapMode;
  createdAt: string;
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
