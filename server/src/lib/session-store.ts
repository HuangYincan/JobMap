// ============================================================
// Demo 会话存储（进程内）
//
// 无 DATABASE_URL 时 API 走这里，满足开发。
// 有库后同一契约切到 Postgres，不改前端。
// 验证码固定 000000，GitHub 为演示账号。
// ============================================================

import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { AccountUser, ApplicationRecord, AuthProvider, SavedPlace, SearchHistoryEntry, UserPreferences } from './account.ts';
import { emptyPreferences, mergePreferences } from './account.ts';

const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;
const DEMO_OTP = '000000';

export const DEMO_OTP_CODE = DEMO_OTP;

interface StoredUser extends AccountUser {
  createdAt: number;
}

interface StoredSession {
  token: string;
  userId: string;
  expiresAt: number;
}

interface OtpChallenge {
  target: string;
  provider: 'phone' | 'email';
  code: string;
  expiresAt: number;
}

const users = new Map<string, StoredUser>();
const sessions = new Map<string, StoredSession>();
const identities = new Map<string, string>();
const otps = new Map<string, OtpChallenge>();
const history = new Map<string, SearchHistoryEntry[]>();
const saved = new Map<string, SavedPlace[]>();
const applications = new Map<string, ApplicationRecord[]>();

function identityKey(provider: AuthProvider, subject: string): string {
  return `${provider}:${subject.trim().toLowerCase()}`;
}

function signToken(): string {
  const raw = randomBytes(24).toString('hex');
  const secret = process.env.SESSION_SECRET || 'domain-map-demo-session';
  const mac = createHmac('sha256', secret).update(raw).digest('hex').slice(0, 16);
  return `${raw}.${mac}`;
}

function accountLabel(input: { phone?: string; email?: string }): string {
  return input.phone || input.email || '';
}

function defaultDisplayName(provider: AuthProvider, subject: string): string {
  if (provider === 'phone') {
    const digits = subject.replace(/\D/g, '');
    if (digits.length >= 7) return `用户 ${digits.slice(-4)}`;
    return '用户';
  }
  if (provider === 'email') return subject.split('@')[0] || 'User';
  return 'GitHub User';
}

export function upsertIdentity(input: {
  provider: AuthProvider;
  subject: string;
  email?: string;
  phone?: string;
  displayName?: string;
  avatarUrl?: string;
}): AccountUser {
  const key = identityKey(input.provider, input.subject);
  const existingId = identities.get(key);
  if (existingId) {
    const user = users.get(existingId);
    if (user) return publicUser(user);
  }

  const id = randomUUID();
  const phone = input.phone;
  const email = input.email;
  const user: StoredUser = {
    id,
    displayName: input.displayName || defaultDisplayName(input.provider, input.subject),
    accountLabel: accountLabel({ phone, email }),
    avatarUrl: input.avatarUrl,
    phone,
    email,
    provider: input.provider,
    preferences: emptyPreferences(),
    createdAt: Date.now(),
  };
  users.set(id, user);
  identities.set(key, id);
  history.set(id, []);
  return publicUser(user);
}

function publicUser(user: StoredUser): AccountUser {
  const { createdAt: _createdAt, ...rest } = user;
  return {
    ...rest,
    accountLabel: accountLabel(rest),
    preferences: mergePreferences(user.preferences),
  };
}

export function createSession(userId: string): { token: string; expiresAt: number } {
  const token = signToken();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, { token, userId, expiresAt });
  return { token, expiresAt };
}

export function getSessionUser(token: string | undefined | null): AccountUser | null {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (session) sessions.delete(token);
    return null;
  }
  const user = users.get(session.userId);
  return user ? publicUser(user) : null;
}

export function destroySession(token: string | undefined | null): void {
  if (token) sessions.delete(token);
}

export function updateUser(
  userId: string,
  patch: Partial<Pick<AccountUser, 'displayName' | 'avatarUrl'>> & {
    preferences?: Partial<UserPreferences>;
  },
): AccountUser | null {
  const user = users.get(userId);
  if (!user) return null;
  if (typeof patch.displayName === 'string' && patch.displayName.trim()) {
    user.displayName = patch.displayName.trim();
  }
  if (patch.avatarUrl !== undefined) user.avatarUrl = patch.avatarUrl;
  if (patch.preferences) {
    user.preferences = mergePreferences(user.preferences, patch.preferences);
  }
  users.set(userId, user);
  return publicUser(user);
}

export function issueOtp(provider: 'phone' | 'email', target: string): { expiresAt: number } {
  const normalized = target.trim().toLowerCase();
  const expiresAt = Date.now() + OTP_TTL_MS;
  otps.set(`${provider}:${normalized}`, {
    target: normalized,
    provider,
    code: DEMO_OTP,
    expiresAt,
  });
  return { expiresAt };
}

export function consumeOtp(provider: 'phone' | 'email', target: string, code: string): boolean {
  const key = `${provider}:${target.trim().toLowerCase()}`;
  const challenge = otps.get(key);
  if (!challenge || challenge.expiresAt < Date.now()) {
    otps.delete(key);
    return false;
  }
  if (challenge.code !== code.trim()) return false;
  otps.delete(key);
  return true;
}

export function listHistory(userId: string, limit = 30): SearchHistoryEntry[] {
  return (history.get(userId) ?? []).slice(0, limit);
}

export function addHistory(
  userId: string,
  query: string,
  mode: SearchHistoryEntry['mode'],
): SearchHistoryEntry | null {
  const q = query.trim();
  if (!q) return null;
  const items = history.get(userId) ?? [];
  const last = items[0];
  if (last && last.query === q && last.mode === mode) {
    last.createdAt = new Date().toISOString();
    history.set(userId, items);
    return last;
  }
  const entry: SearchHistoryEntry = {
    id: randomUUID(),
    query: q,
    mode,
    createdAt: new Date().toISOString(),
  };
  history.set(userId, [entry, ...items].slice(0, 50));
  return entry;
}

export function clearHistory(userId: string): void {
  history.set(userId, []);
}

export function listSaved(userId: string): SavedPlace[] {
  return [...(saved.get(userId) ?? [])];
}

export function savePlace(userId: string, place: Omit<SavedPlace, 'id' | 'createdAt'>): SavedPlace {
  const items = saved.get(userId) ?? [];
  const existing = items.find((item) => item.poiId === place.poiId);
  if (existing) return existing;
  const entry: SavedPlace = {
    ...place,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  saved.set(userId, [entry, ...items]);
  return entry;
}

export function removeSaved(userId: string, poiId: string): boolean {
  const items = saved.get(userId) ?? [];
  const next = items.filter((item) => item.poiId !== poiId);
  saved.set(userId, next);
  return next.length !== items.length;
}

export function listApplications(userId: string): ApplicationRecord[] {
  return [...(applications.get(userId) ?? [])];
}

export function recordApplication(
  userId: string,
  input: Omit<ApplicationRecord, 'id' | 'createdAt' | 'status'> & { status?: ApplicationRecord['status'] },
): ApplicationRecord {
  const items = applications.get(userId) ?? [];
  const existing = items.find((item) => item.positionId === input.positionId);
  if (existing) return existing;
  const entry: ApplicationRecord = {
    ...input,
    status: input.status ?? 'applied',
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  applications.set(userId, [entry, ...items]);
  return entry;
}
