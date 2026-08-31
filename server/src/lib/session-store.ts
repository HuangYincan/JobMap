// ============================================================
// Demo 会话存储（进程内）
//
// 无 DATABASE_URL 时 API 走这里，满足开发。
// 有库后同一契约切到 Postgres，不改前端。
// 邮箱/手机验证码均为真实随机码(email 经 Resend 真发,phone 经阿里云短信真发)。
// 未配置 OAuth 的 GitHub/Google/微信为开发期演示账号,生产禁用。
// ============================================================

import { createHash, createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { AccountUser, ApplicationRecord, AuthProvider, NotificationRecord, SavedPlace, SearchHistoryEntry, UserPreferences } from './account.ts';
import { emptyPreferences, mergePreferences } from './account.ts';
import { sanitizeApplicationStatusId } from './application-pipeline.ts';
import { BoundedLruStore } from './bounded-lru-store.ts';
import { normalizeContact, normalizeEmail, normalizePhone } from './contact-validation.ts';
import { hashPassword, verifyPassword } from './password.ts';

const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;

/** 6 位随机验证码(OTP 真发用,email 经 Resend / phone 经阿里云短信):randomInt [0, 1_000_000) + padStart 保证前导零。 */
export function randomOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** 登录「查无此账号」时执行的 dummy 校验:真实 scrypt 抹平时间侧信道(与 account-store 同款)。
 *  lazy 生成(仅首次命中时 50ms);非秘密。 */
let dummyVerifyHash: string | null = null;
function dummyVerifyPassword(password: string): void {
  if (!dummyVerifyHash) dummyVerifyHash = hashPassword('domain-map-dummy-verify');
  verifyPassword(password, dummyVerifyHash);
}

interface StoredUser extends AccountUser {
  createdAt: number;
  /** 仅 password provider 用户有,绝不随 publicUser 返回 */
  passwordHash?: string;
  /** 上传头像的原始字节(JPEG/PNG),只服务 GET /api/me/avatar,绝不随 publicUser 返回 */
  avatarData?: Uint8Array;
}

interface StoredSession {
  token: string;
  userId: string;
  expiresAt: number;
}

interface OtpChallenge {
  target: string;
  provider: 'phone' | 'email';
  codeHash: string;
  expiresAt: number;
}

/** Fallback user/identity/collection store ceiling, including avatar bytes. */
export const FALLBACK_ACCOUNT_MEMORY_MAX = 1_000;
const users = new BoundedLruStore<StoredUser>(FALLBACK_ACCOUNT_MEMORY_MAX);
const sessions = new Map<string, StoredSession>();
/** Successful login is not rate-limited; the process mirror still needs a ceiling. */
export const SESSION_MEMORY_MAX = 10_000;
const identities = new BoundedLruStore<string>(FALLBACK_ACCOUNT_MEMORY_MAX);
/** Unique rotated targets must not turn the always-written process mirror into a leak. */
export const OTP_CHALLENGE_MEMORY_MAX = 10_000;
const otps = new BoundedLruStore<OtpChallenge>(OTP_CHALLENGE_MEMORY_MAX);

function sweepExpiredOtpChallenges(now = Date.now()): void {
  for (const [key, challenge] of otps) {
    if (challenge.expiresAt <= now) otps.delete(key);
  }
}

function hashOtpForMemory(code: string): string {
  return createHash('sha256').update(`memory-otp:${code}`).digest('hex');
}

/** Test hook: the challenge map intentionally has no public production reader. */
export function otpChallengeMemorySize(): number {
  sweepExpiredOtpChallenges();
  return otps.size;
}

export function resetOtpChallengeMemory(): void {
  otps.clear();
}

function sweepExpiredSessions(now = Date.now()): void {
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}

export function sessionMemorySize(): number {
  sweepExpiredSessions();
  return sessions.size;
}

export function resetSessionMemory(): void {
  sessions.clear();
}

/** Number of process-local users retained by the fallback account store. */
export function fallbackAccountMemorySize(): number {
  return users.size;
}

const history = new BoundedLruStore<SearchHistoryEntry[]>(FALLBACK_ACCOUNT_MEMORY_MAX);
const saved = new BoundedLruStore<SavedPlace[]>(FALLBACK_ACCOUNT_MEMORY_MAX);
const applications = new BoundedLruStore<ApplicationRecord[]>(FALLBACK_ACCOUNT_MEMORY_MAX);
const notifications = new BoundedLruStore<NotificationRecord[]>(FALLBACK_ACCOUNT_MEMORY_MAX);
/** Authenticated collections need durable-style ceilings in the fallback store too. */
export const SAVED_PLACES_MEMORY_MAX = 500;
export const APPLICATIONS_MEMORY_MAX = 500;
export const NOTIFICATIONS_MEMORY_MAX = 200;

function identityKey(provider: AuthProvider, subject: string): string {
  const value = provider === 'phone' || provider === 'email'
    ? normalizeContact(provider, subject)
    : subject.trim().toLowerCase();
  return `${provider}:${value}`;
}

/** target(phone/email subject)是否已绑定账户(内存路径):返回 userId,未绑定 → null。
 *  只服务 OTP 发送的账号级限流键(account-store resolveOtpAccountKey),非秘密。 */
export function resolveAccountBySubject(provider: AuthProvider, subject: string): string | null {
  return identities.get(identityKey(provider, subject)) ?? null;
}

/**
 * 会话 token 与 oauth_state 共用的 HMAC 签名密钥(scan #4):
 * - 优先 `SESSION_SECRET`(生产必配,见 tech/15 / tech/27);
 * - 未设置且非生产 → 进程启动时随机(bootSecret,与 oauth-state 同源:oauth-state
 *   直接复用本函数,不再各自回退);
 * - 未设置且 NODE_ENV=production → 抛错拒绝签名(杜绝公开常量回退值成为未来
 *   「校验签名/客户端提供 token」路径的伪造入口)。
 */
let bootSecret: string | null = null;
export function sessionSigningSecret(): string {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET is required in production: refusing to sign session tokens');
  }
  bootSecret ??= randomBytes(32).toString('hex');
  return bootSecret;
}

function signToken(): string {
  const raw = randomBytes(24).toString('hex');
  const mac = createHmac('sha256', sessionSigningSecret()).update(raw).digest('hex').slice(0, 16);
  return `${raw}.${mac}`;
}

function accountLabel(input: { phone?: string; email?: string; username?: string }): string {
  return input.phone || input.email || input.username || '';
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
  const subjectValue = input.provider === 'phone' || input.provider === 'email'
    ? normalizeContact(input.provider, input.subject)
    : input.subject.trim().toLowerCase();
  const phone = input.provider === 'phone'
    ? normalizePhone(input.phone ?? subjectValue)
    : input.phone?.trim();
  const email = input.provider === 'email'
    ? normalizeEmail(input.email ?? subjectValue)
    : input.email?.trim();

  const key = identityKey(input.provider, subjectValue);
  const existingId = identities.get(key);
  if (existingId) {
    const user = users.get(existingId);
    if (user) return publicUser(user);
  }

  const id = randomUUID();
  const user: StoredUser = {
    id,
    displayName: input.displayName || defaultDisplayName(input.provider, subjectValue),
    accountLabel: accountLabel({ phone: phone ?? undefined, email: email ?? undefined }),
    avatarUrl: input.avatarUrl,
    phone,
    email,
    hasPassword: false,
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
  const { createdAt: _createdAt, passwordHash: _passwordHash, avatarData: _avatarData, ...rest } = user;
  return {
    ...rest,
    hasPassword: !!user.passwordHash,
    accountLabel: accountLabel(rest),
    preferences: mergePreferences(user.preferences),
  };
}

/** 用户名已被占用(内存路径)。account-store 对 Postgres 路径抛同一类型。 */
export class UsernameTakenError extends Error {
  constructor(username: string) {
    super(`username taken: ${username}`);
    this.name = 'UsernameTakenError';
  }
}

/** 注册密码账号:subject = password:<username>,密码只存 scrypt 哈希。 */
export function registerWithPassword(username: string, password: string, displayName?: string): AccountUser {
  const name = username.trim();
  const key = identityKey('password', name);
  if (identities.has(key)) throw new UsernameTakenError(name);
  const id = randomUUID();
  const user: StoredUser = {
    id,
    displayName: displayName?.trim() || name,
    accountLabel: name,
    username: name,
    hasPassword: true,
    passwordHash: hashPassword(password),
    provider: 'password',
    preferences: emptyPreferences(),
    createdAt: Date.now(),
  };
  users.set(id, user);
  identities.set(key, id);
  history.set(id, []);
  return publicUser(user);
}

/** 密码登录(username 或邮箱):失败统一返回 null(调用方 401「账号或密码错误」,不泄露哪个错)。 */
export function loginWithPassword(username: string, password: string): AccountUser | null {
  const key = identityKey('password', username);
  const id = identities.get(key);
  let user = id ? users.get(id) : undefined;
  if (!user) {
    // 与 DB 路径对齐:username 或已绑定邮箱均可登录(邮箱登录用户无 password identity)。
    const name = username.trim().toLowerCase();
    user = [...users.values()].find(
      (u) => u.username?.toLowerCase() === name || u.email?.toLowerCase() === name,
    );
  }
  if (!user?.passwordHash) {
    // 查无此账号/无密码:也执行一次真实 scrypt,抹平「账号不存在」时间侧信道(scan #3/#17)。
    dummyVerifyPassword(password);
    return null;
  }
  if (!verifyPassword(password, user.passwordHash)) return null;
  return publicUser(user);
}

/** 校验当前密码(mem 分支):无密码或错 → false,不泄露。 */
export function verifyUserPassword(userId: string, password: string): boolean {
  const user = users.get(userId);
  if (!user?.passwordHash) return false;
  return verifyPassword(password, user.passwordHash);
}

/** 设置/修改密码(mem 分支):hashPassword 落库,hasPassword 翻 true。 */
export function setPassword(userId: string, newPassword: string): AccountUser | null {
  const user = users.get(userId);
  if (!user) return null;
  user.passwordHash = hashPassword(newPassword);
  users.set(userId, user);
  return publicUser(user);
}

/** 手机已被他人绑定(内存路径)。account-store 对 Postgres 路径抛同一类型。 */
export class PhoneTakenError extends Error {
  constructor(phone: string) {
    super(`phone taken: ${phone}`);
    this.name = 'PhoneTakenError';
  }
}

/** 邮箱已被他人绑定(内存路径)。account-store 对 Postgres 路径抛同一类型。 */
export class EmailTakenError extends Error {
  constructor(email: string) {
    super(`email taken: ${email}`);
    this.name = 'EmailTakenError';
  }
}

/** 绑定/更换手机(mem 分支):users.phone 更新 + 身份 upsert 新行/删旧行;占用 → PhoneTakenError。 */
export function bindPhone(userId: string, phone: string): AccountUser | null {
  const user = users.get(userId);
  if (!user) return null;
  const norm = normalizePhone(phone);
  for (const u of users.values()) {
    if (u.id !== userId && normalizeContact('phone', u.phone ?? '') === norm) {
      throw new PhoneTakenError(norm);
    }
  }
  const oldKey = user.phone ? identityKey('phone', user.phone) : null;
  user.phone = norm;
  users.set(userId, user);
  if (oldKey && identities.get(oldKey) === userId) identities.delete(oldKey);
  identities.set(`phone:${norm}`, userId);
  return publicUser(user);
}

/** 绑定/更换邮箱(mem 分支):users.email 更新 + 身份 upsert 新行/删旧行;占用 → EmailTakenError。 */
export function bindEmail(userId: string, email: string): AccountUser | null {
  const user = users.get(userId);
  if (!user) return null;
  const norm = normalizeEmail(email);
  for (const u of users.values()) {
    if (u.id !== userId && normalizeEmail(u.email ?? '') === norm) throw new EmailTakenError(norm);
  }
  const oldKey = user.email ? identityKey('email', user.email) : null;
  user.email = norm;
  users.set(userId, user);
  if (oldKey && identities.get(oldKey) === userId) identities.delete(oldKey);
  identities.set(`email:${norm}`, userId);
  return publicUser(user);
}

export function createSession(userId: string): { token: string; expiresAt: number } {
  const token = signToken();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sweepExpiredSessions();
  while (sessions.size >= SESSION_MEMORY_MAX) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
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
  if (!user) return null;
  // Keep active sessions at the LRU tail so a login flood evicts idle tokens first.
  sessions.delete(token);
  sessions.set(token, session);
  return publicUser(user);
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
  if (patch.avatarUrl !== undefined) {
    user.avatarUrl = patch.avatarUrl;
    // 清空头像(avatarUrl='')时同步清掉二进制,避免两列状态分裂。
    if (patch.avatarUrl === '') user.avatarData = undefined;
  }
  if (patch.preferences) {
    user.preferences = mergePreferences(user.preferences, patch.preferences);
  }
  users.set(userId, user);
  return publicUser(user);
}

/** 上传头像:data 非空 → 存二进制 + 写服务端头像路径;data=null → 整头像清空。 */
export function updateAvatar(
  userId: string,
  input: { data: Uint8Array; url: string } | { data: null },
): AccountUser | null {
  const user = users.get(userId);
  if (!user) return null;
  if (input.data === null) {
    user.avatarData = undefined;
    user.avatarUrl = undefined;
  } else {
    user.avatarData = input.data;
    user.avatarUrl = input.url;
  }
  users.set(userId, user);
  return publicUser(user);
}

/** 取上传头像字节(无 → null)。只在 GET /api/me/avatar 内部使用。 */
export function getAvatarData(userId: string): Uint8Array | null {
  return users.get(userId)?.avatarData ?? null;
}

export function issueOtp(provider: 'phone' | 'email', target: string): { expiresAt: number; code: string } {
  const normalized = normalizeContact(provider, target);
  const expiresAt = Date.now() + OTP_TTL_MS;
  // phone/email 统一随机码(phone 经阿里云短信真发,见 aliyun-sms-client)。
  const code = randomOtpCode();
  const key = `${provider}:${normalized}`;
  otps.delete(key);
  sweepExpiredOtpChallenges();
  while (otps.size >= OTP_CHALLENGE_MEMORY_MAX) {
    const oldest = otps.keys().next().value;
    if (oldest === undefined) break;
    otps.delete(oldest);
  }
  otps.set(key, {
    target: normalized,
    provider,
    codeHash: hashOtpForMemory(code),
    expiresAt,
  });
  return { expiresAt, code };
}

/** 撤销尚未消费的内存 OTP(DB 写入失败时用于回滚进程镜像)。 */
export function revokeOtpChallenge(provider: 'phone' | 'email', target: string): void {
  otps.delete(`${provider}:${normalizeContact(provider, target)}`);
}

export function consumeOtp(provider: 'phone' | 'email', target: string, code: string): boolean {
  const normalizedCode = code.trim();
  const key = `${provider}:${normalizeContact(provider, target)}`;
  const challenge = otps.get(key);
  if (!challenge || challenge.expiresAt < Date.now()) {
    otps.delete(key);
    return false;
  }
  if (challenge.codeHash !== hashOtpForMemory(normalizedCode)) return false;
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
  entity?: SearchHistoryEntry['entity'],
): SearchHistoryEntry | null {
  const q = query.trim();
  if (!q) return null;
  const items = history.get(userId) ?? [];
  const last = items[0];
  if (last && last.query === q && last.mode === mode) {
    last.createdAt = new Date().toISOString();
    if (entity) last.entity = entity;
    history.set(userId, items);
    return last;
  }
  const entry: SearchHistoryEntry = {
    id: randomUUID(),
    query: q,
    mode,
    createdAt: new Date().toISOString(),
    ...(entity ? { entity } : {}),
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
  saved.set(userId, [entry, ...items].slice(0, SAVED_PLACES_MEMORY_MAX));
  return entry;
}

export function removeSaved(userId: string, poiId: string): boolean {
  const items = saved.get(userId) ?? [];
  const next = items.filter((item) => item.poiId !== poiId);
  saved.set(userId, next);
  return next.length !== items.length;
}

function normalizeApplication(item: ApplicationRecord): ApplicationRecord {
  const status = sanitizeApplicationStatusId(item.status) ?? 'applied';
  return {
    ...item,
    status,
    updatedAt: item.updatedAt || item.createdAt,
  };
}

export function listApplications(userId: string): ApplicationRecord[] {
  return [...(applications.get(userId) ?? [])]
    .map(normalizeApplication)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function recordApplication(
  userId: string,
  input: Omit<ApplicationRecord, 'id' | 'createdAt' | 'updatedAt' | 'status'> & {
    status?: ApplicationRecord['status'];
    createdAt?: string;
  },
): ApplicationRecord {
  const items = applications.get(userId) ?? [];
  const existing = items.find((item) => item.positionId === input.positionId);
  const now = new Date().toISOString();
  const status = sanitizeApplicationStatusId(input.status) ?? 'applied';
  if (existing) {
    const next: ApplicationRecord = {
      ...existing,
      title: input.title,
      companyName: input.companyName,
      companyPoiId: input.companyPoiId,
      applyUrl: input.applyUrl !== undefined ? input.applyUrl : existing.applyUrl,
      status,
      createdAt: input.createdAt || existing.createdAt,
      updatedAt: now,
    };
    applications.set(userId, [next, ...items.filter((item) => item.id !== existing.id)]);
    return normalizeApplication(next);
  }
  const entry: ApplicationRecord = {
    positionId: input.positionId,
    companyPoiId: input.companyPoiId,
    title: input.title,
    companyName: input.companyName,
    applyUrl: input.applyUrl,
    status,
    id: randomUUID(),
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
  applications.set(userId, [entry, ...items].slice(0, APPLICATIONS_MEMORY_MAX));
  return normalizeApplication(entry);
}

export function updateApplicationStatus(
  userId: string,
  id: string,
  status: string,
): ApplicationRecord | null {
  const nextStatus = sanitizeApplicationStatusId(status);
  if (!nextStatus) return null;
  const items = applications.get(userId) ?? [];
  const current = items.find((item) => item.id === id);
  if (!current) return null;
  const next = { ...current, status: nextStatus, updatedAt: new Date().toISOString() };
  applications.set(userId, [next, ...items.filter((item) => item.id !== id)]);
  return next;
}

export function reassignApplicationStatuses(
  userId: string,
  fromIds: string[],
  toId: string,
): number {
  const nextStatus = sanitizeApplicationStatusId(toId);
  if (!nextStatus || fromIds.length === 0) return 0;
  const from = new Set(fromIds.map((id) => sanitizeApplicationStatusId(id) ?? id));
  const items = applications.get(userId) ?? [];
  const now = new Date().toISOString();
  let changed = 0;
  applications.set(
    userId,
    items.map((item) => {
      if (!from.has(item.status)) return item;
      changed += 1;
      return { ...item, status: nextStatus, updatedAt: now };
    }),
  );
  return changed;
}

export function listNotifications(userId: string): NotificationRecord[] {
  return [...(notifications.get(userId) ?? [])];
}

export function enqueueNotification(
  userId: string,
  input: Omit<NotificationRecord, 'id' | 'createdAt' | 'status'> & { status?: NotificationRecord['status'] },
): NotificationRecord {
  const items = notifications.get(userId) ?? [];
  const existing = items.find(
    (item) => item.kind === input.kind && item.positionId && item.positionId === input.positionId,
  );
  if (existing) return existing;
  const entry: NotificationRecord = {
    ...input,
    status: input.status ?? 'queued',
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  notifications.set(userId, [entry, ...items].slice(0, NOTIFICATIONS_MEMORY_MAX));
  return entry;
}
