// ============================================================
// 账户 / 偏好 / 会话契约
//
// 默认地图模式是 work。语言：已登录读偏好，未登录跟浏览器。
// Recent 只记已提交的搜索，按用户落库。
// ============================================================

import type { Language } from './i18n.ts';
import type { MapMode } from './types.ts';
import { canonicalMode } from './modes.ts';

export type AuthProvider = 'phone' | 'email' | 'github';

export interface UserPreferences {
  language: Language;
  defaultMode: MapMode;
}

export interface AccountUser {
  id: string;
  displayName: string;
  /** 侧栏 <small>：手机或邮箱 */
  accountLabel: string;
  avatarUrl?: string;
  phone?: string;
  email?: string;
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

export const DEFAULT_PREFERENCES: UserPreferences = {
  language: 'zh',
  defaultMode: 'work',
};

export const SESSION_COOKIE = 'dm_session';

export function resolvePreferences(
  user: AccountUser | null,
  browserLang: Language,
): UserPreferences {
  if (!user) {
    return { language: browserLang, defaultMode: 'work' };
  }
  return {
    language: user.preferences.language || browserLang,
    defaultMode: canonicalMode(user.preferences.defaultMode || 'work'),
  };
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
