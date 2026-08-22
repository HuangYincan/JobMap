// ============================================================
// Demo 会话存储（进程内）
//
// 无 DATABASE_URL 时 API 走这里，满足开发。
// 有库后同一契约切到 Postgres，不改前端。
// 邮箱/手机验证码均为真实随机码(email 经 Resend 真发,phone 经阿里云短信真发)。
// GitHub 为演示账号。
// ============================================================

import { createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { AccountUser, ApplicationRecord, AuthProvider, NotificationRecord, SavedPlace, SearchHistoryEntry, UserPreferences } from './account.ts';
import { emptyPreferences, mergePreferences } from './account.ts';
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
const notifications = new Map<string, NotificationRecord[]>();

function identityKey(provider: AuthProvider, subject: string): string {
  return `${provider}:${subject.trim().toLowerCase()}`;
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
  const norm = phone.trim().toLowerCase();
  for (const u of users.values()) {
    if (u.id !== userId && u.phone?.toLowerCase() === norm) throw new PhoneTakenError(phone);
  }
  const oldKey = user.phone ? `phone:${user.phone.trim().toLowerCase()}` : null;
  user.phone = phone.trim();
  users.set(userId, user);
  if (oldKey && identities.get(oldKey) === userId) identities.delete(oldKey);
  identities.set(`phone:${norm}`, userId);
  return publicUser(user);
}

/** 绑定/更换邮箱(mem 分支):users.email 更新 + 身份 upsert 新行/删旧行;占用 → EmailTakenError。 */
export function bindEmail(userId: string, email: string): AccountUser | null {
  const user = users.get(userId);
  if (!user) return null;
  const norm = email.trim().toLowerCase();
  for (const u of users.values()) {
    if (u.id !== userId && u.email?.toLowerCase() === norm) throw new EmailTakenError(email);
  }
  const oldKey = user.email ? `email:${user.email.trim().toLowerCase()}` : null;
  user.email = email.trim();
  users.set(userId, user);
  if (oldKey && identities.get(oldKey) === userId) identities.delete(oldKey);
  identities.set(`email:${norm}`, userId);
  return publicUser(user);
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
  const normalized = target.trim().toLowerCase();
  const expiresAt = Date.now() + OTP_TTL_MS;
  // phone/email 统一随机码(phone 经阿里云短信真发,见 aliyun-sms-client)。
  const code = randomOtpCode();
  otps.set(`${provider}:${normalized}`, {
    target: normalized,
    provider,
    code,
    expiresAt,
  });
  return { expiresAt, code };
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
  notifications.set(userId, [entry, ...items]);
  return entry;
}
