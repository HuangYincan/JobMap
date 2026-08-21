// ============================================================
// 账户仓储门面
//
// 有 DATABASE_URL 且 005 已应用：identities / sessions / OTP / history 上云。
// 否则回落到进程内 session-store，单测不依赖库。
//
// 读路径：DB 查询失败允许回落到内存实现（降级合理）。
// 写路径：DB 故障直接抛 DbUnavailableError（route 层转 503），
//         绝不静默回落内存——否则数据在内存与 DB 间分裂，保存看似成功实则丢失。
// ============================================================

import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import {
  DEFAULT_PREFERENCES,
  mergePreferences,
  sanitizeEntityRef,
  type AccountUser,
  type AuthProvider,
  type ApplicationRecord,
  type NotificationRecord,
  type SavedPlace,
  type SearchHistoryEntry,
  type SearchHistoryEntityRef,
  type UserPreferences,
} from './account.ts';
import { getPool } from './db.ts';
import { canonicalMode } from './modes.ts';
import { hashPassword, verifyPassword } from './password.ts';
import type { MapMode } from './types.ts';
import {
  addHistory as memAddHistory,
  clearHistory as memClearHistory,
  consumeOtp as memConsumeOtp,
  createSession as memCreateSession,
  destroySession as memDestroySession,
  getSessionUser as memGetSessionUser,
  issueOtp as memIssueOtp,
  listHistory as memListHistory,
  listApplications as memListApplications,
  listNotifications as memListNotifications,
  listSaved as memListSaved,
  enqueueNotification as memEnqueueNotification,
  recordApplication as memRecordApplication,
  removeSaved as memRemoveSaved,
  savePlace as memSavePlace,
  updateUser as memUpdateUser,
  updateAvatar as memUpdateAvatar,
  getAvatarData as memGetAvatarData,
  upsertIdentity as memUpsertIdentity,
  registerWithPassword as memRegisterWithPassword,
  loginWithPassword as memLoginWithPassword,
  UsernameTakenError,
} from './session-store.ts';

export { UsernameTakenError };

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function hashOtp(code: string): string {
  return createHash('sha256').update(`otp:${code.trim()}`).digest('hex');
}

function subjectKey(provider: AuthProvider, subject: string): string {
  return `${provider}:${subject.trim().toLowerCase()}`;
}

function asUser(row: {
  id: string | number;
  display_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  email: string | null;
  username?: string | null;
  preferences: UserPreferences | null;
  provider: AuthProvider | null;
}): AccountUser {
  const phone = row.phone ?? undefined;
  const email = row.email ?? undefined;
  const prefs = row.preferences ?? DEFAULT_PREFERENCES;
  return {
    id: String(row.id),
    displayName: row.display_name || defaultName(row.provider, phone, email),
    accountLabel: phone || email || (row.username ?? ''),
    avatarUrl: row.avatar_url ?? undefined,
    phone,
    email,
    username: row.username ?? undefined,
    provider: row.provider ?? 'email',
    preferences: mergePreferences(prefs),
  };
}

function defaultName(provider: AuthProvider | null, phone?: string, email?: string): string {
  if (provider === 'phone' && phone) {
    const digits = phone.replace(/\D/g, '');
    return digits.length >= 4 ? `用户 ${digits.slice(-4)}` : '用户';
  }
  if (email) return email.split('@')[0] || 'User';
  return 'GitHub User';
}

// ---- 错误类型(route 层映射 HTTP 状态) ----

/** 发送限流(60s 冷却 / 24h 上限):route 层转 429 RATE_LIMITED。 */
export class OtpRateLimitedError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number, message: string) {
    super(message);
    this.name = 'OtpRateLimitedError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** 验证尝试超限锁(15min 窗口 ≥5 错 → 锁 15min):route 层转 429 TOO_MANY_ATTEMPTS。 */
export class OtpTooManyAttemptsError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number, message: string) {
    super(message);
    this.name = 'OtpTooManyAttemptsError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** 写路径 DB 不可用:route 层转 503 DB_UNAVAILABLE,绝不静默回落内存。 */
export class DbUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`database unavailable: ${(cause as Error)?.message ?? String(cause)}`);
    this.name = 'DbUnavailableError';
  }
}

// ---- OTP 限流与尝试上限(进程内守卫;DB 行仍是权威的 code/过期) ----
// 演示为单实例部署,进程内守卫足够;多实例需换 Redis 等共享状态(deferred)。
// 选内存+DB 双写而非给 auth_otp_challenges 加列:迁移 apply 是 Env-only,
// 守卫必须在无库测试与内存模式下同样生效。

const OTP_COOLDOWN_MS = 60_000;
const OTP_DAILY_LIMIT = 10;
const OTP_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const OTP_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const OTP_MAX_WRONG_ATTEMPTS = 5;
const OTP_LOCK_MS = 15 * 60 * 1000;

/** OTP 限流参数(生产用默认常量;测试可临时缩小窗口,用后还原)。 */
export const otpRateConfig = {
  cooldownMs: OTP_COOLDOWN_MS,
  dailyLimit: OTP_DAILY_LIMIT,
  dailyWindowMs: OTP_DAILY_WINDOW_MS,
  attemptWindowMs: OTP_ATTEMPT_WINDOW_MS,
  maxWrongAttempts: OTP_MAX_WRONG_ATTEMPTS,
  lockMs: OTP_LOCK_MS,
};

interface OtpGuard {
  lastSentAt: number;
  sentAt: number[]; // 24h 窗口内的发送时间戳
  wrongAt: number[]; // 15min 窗口内的错误尝试时间戳
  lockedUntil: number; // 0 = 未锁
}

const otpGuards = new Map<string, OtpGuard>();

function otpKey(provider: 'phone' | 'email', target: string): string {
  return `${provider}:${target.trim().toLowerCase()}`;
}

function getOtpGuard(key: string): OtpGuard {
  let guard = otpGuards.get(key);
  if (!guard) {
    guard = { lastSentAt: 0, sentAt: [], wrongAt: [], lockedUntil: 0 };
    otpGuards.set(key, guard);
  }
  return guard;
}

function pruneOtpGuard(guard: OtpGuard, now: number): void {
  const cfg = otpRateConfig;
  guard.sentAt = guard.sentAt.filter((t) => t > now - cfg.dailyWindowMs);
  guard.wrongAt = guard.wrongAt.filter((t) => t > now - cfg.attemptWindowMs);
  if (guard.lockedUntil <= now) guard.lockedUntil = 0;
}

// ---- DB 连接与故障策略 ----

/**
 * 测试钩子(仅测试使用,生产调用方不碰):
 * - poolOverride:注入 fake 池(可让 query 抛错模拟 DB 故障)或 null(强制内存模式),
 *   绕过 getPool 的进程级缓存,让「写路径抛 / 读路径降级」可被确定性单测覆盖。
 */
export const __accountStoreTest = {
  poolOverride: undefined as (() => Pool | null) | undefined,
};

function getPoolForCall(): Pool | null {
  return __accountStoreTest.poolOverride ? __accountStoreTest.poolOverride() : getPool();
}

/** 读路径:DB 故障回落内存(降级合理,读不到不至于崩)。 */
async function withDbRead<T>(fn: (pool: Pool) => Promise<T>, fallback: () => T | Promise<T>): Promise<T> {
  const db = getPoolForCall();
  if (!db) return fallback();
  try {
    return await fn(db);
  } catch (err) {
    // 用户名冲突不是「库不可用」,必须原样抛出(409),不能回落内存。
    if (err instanceof UsernameTakenError) throw err;
    console.warn('[account-store] postgres unavailable, using memory:', (err as Error).message);
    return fallback();
  }
}

/** 写路径:DB 故障直接抛 DbUnavailableError,绝不静默回落内存造成数据分裂。 */
async function withDbWrite<T>(fn: (pool: Pool) => Promise<T>, memory: () => T | Promise<T>): Promise<T> {
  const db = getPoolForCall();
  if (!db) return memory(); // 未配置 DB:内存模式本身就是存储,写内存。
  try {
    return await fn(db);
  } catch (err) {
    if (err instanceof UsernameTakenError) throw err;
    throw new DbUnavailableError(err);
  }
}

type UpsertUserRow = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  email: string | null;
  username: string | null;
  preferences: UserPreferences | null;
};

/**
 * 23505 邮箱冲突分支(users_email_uidx):Google 邮箱撞已有 OTP 邮箱用户时
 * INSERT 抛 23505 → 按 lower(email) 查到已有用户 → 为其挂接 auth_identities
 * (provider, subject) → 返回该用户,不新建。只在 23505 时走此分支;
 * 其余错误照旧上抛(外层 withDbWrite 包 DbUnavailableError)。
 */
async function attachIdentityToExistingEmailUser(
  db: Pool,
  input: { provider: AuthProvider; subject: string; email?: string },
  originalError: unknown,
): Promise<AccountUser> {
  if (!input.email) throw originalError; // 理论上 23505 只可能来自 email 唯一键
  const existing = await db.query<UpsertUserRow>(
    `SELECT id::text, display_name, avatar_url, phone, email, username, preferences
     FROM users
     WHERE lower(email) = lower($1)`,
    [input.email],
  );
  const row = existing.rows[0];
  if (!row) throw originalError; // 竞态下查无此人 → 原样上抛,不静默
  await db.query(
    `INSERT INTO auth_identities (user_id, provider, subject)
     VALUES ($1, $2, $3)
     ON CONFLICT (provider, subject) DO NOTHING`,
    [row.id, input.provider, input.subject.trim().toLowerCase()],
  );
  return asUser({ ...row, provider: input.provider });
}

export async function upsertIdentity(input: {
  provider: AuthProvider;
  subject: string;
  email?: string;
  phone?: string;
  displayName?: string;
  avatarUrl?: string;
}): Promise<AccountUser> {
  return withDbWrite(async (db) => {
    const subject = subjectKey(input.provider, input.subject);
    const prefs = JSON.stringify(DEFAULT_PREFERENCES);
    let inserted: { rows: UpsertUserRow[] };
    try {
      inserted = await db.query<UpsertUserRow>(
        `INSERT INTO users (subject, display_name, phone, email, avatar_url, preferences)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (subject) DO UPDATE SET
           display_name = COALESCE(users.display_name, EXCLUDED.display_name),
           phone = COALESCE(EXCLUDED.phone, users.phone),
           email = COALESCE(EXCLUDED.email, users.email),
           avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
           updated_at = now()
         RETURNING id::text, display_name, avatar_url, phone, email, username, preferences`,
        [
          subject,
          input.displayName ?? null,
          input.phone ?? null,
          input.email ?? null,
          input.avatarUrl ?? null,
          prefs,
        ],
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return attachIdentityToExistingEmailUser(db, input, err);
      }
      throw err;
    }
    const user = inserted.rows[0];
    await db.query(
      `INSERT INTO auth_identities (user_id, provider, subject)
       VALUES ($1, $2, $3)
       ON CONFLICT (provider, subject) DO NOTHING`,
      [user.id, input.provider, input.subject.trim().toLowerCase()],
    );
    return asUser({ ...user, provider: input.provider });
  }, () => memUpsertIdentity(input));
}

/** 注册密码账号:subject = password:<username>;用户名冲突抛 UsernameTakenError(→409)。 */
export async function registerWithPassword(
  username: string,
  password: string,
  displayName?: string,
): Promise<AccountUser> {
  const name = username.trim();
  const subject = `password:${name.toLowerCase()}`;
  const prefs = JSON.stringify(DEFAULT_PREFERENCES);
  return withDbWrite(
    async (db) => {
      const existing = await db.query<{ id: string }>(
        `SELECT id::text FROM users WHERE lower(username) = $1`,
        [name.toLowerCase()],
      );
      if (existing.rows[0]) throw new UsernameTakenError(name);
      const inserted = await db.query<{
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        phone: string | null;
        email: string | null;
        username: string | null;
        preferences: UserPreferences;
      }>(
        `INSERT INTO users (subject, display_name, username, password_hash, preferences)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING id::text, display_name, avatar_url, phone, email, username, preferences`,
        [subject, displayName?.trim() || name, name, hashPassword(password), prefs],
      ).catch((err: unknown) => {
        if ((err as { code?: string }).code === '23505') throw new UsernameTakenError(name);
        throw err;
      });
      const user = inserted.rows[0];
      await db.query(
        `INSERT INTO auth_identities (user_id, provider, subject)
         VALUES ($1, 'password', $2)
         ON CONFLICT (provider, subject) DO NOTHING`,
        [user.id, name.toLowerCase()],
      );
      return asUser({ ...user, provider: 'password' });
    },
    () => memRegisterWithPassword(username, password, displayName),
  );
}

/** 密码登录:失败统一返回 null(调用方 401,不泄露账号是否存在)。 */
export async function loginWithPassword(username: string, password: string): Promise<AccountUser | null> {
  const name = username.trim();
  return withDbRead(
    async (db) => {
      const result = await db.query<{
        id: string;
        display_name: string | null;
        avatar_url: string | null;
        phone: string | null;
        email: string | null;
        username: string | null;
        password_hash: string | null;
        preferences: UserPreferences;
        provider: AuthProvider | null;
      }>(
        `SELECT u.id::text, u.display_name, u.avatar_url, u.phone, u.email, u.username, u.password_hash, u.preferences, i.provider
         FROM users u
         LEFT JOIN LATERAL (
           SELECT provider FROM auth_identities
           WHERE user_id = u.id
           ORDER BY created_at DESC
           LIMIT 1
         ) i ON true
         WHERE lower(u.username) = $1 AND u.password_hash IS NOT NULL`,
        [name.toLowerCase()],
      );
      const row = result.rows[0];
      if (!row || !row.password_hash) return null;
      if (!verifyPassword(password, row.password_hash)) return null;
      const { password_hash: _hash, ...rest } = row;
      return asUser({ ...rest, provider: row.provider ?? 'password' });
    },
    () => memLoginWithPassword(username, password),
  );
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: number }> {
  return withDbWrite(async (db) => {
    const memory = memCreateSession(userId);
    await db.query(
      `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, to_timestamp($3 / 1000.0))`,
      [userId, hashToken(memory.token), memory.expiresAt],
    );
    return memory;
  }, () => memCreateSession(userId));
}

export async function getSessionUser(token: string | undefined | null): Promise<AccountUser | null> {
  if (!token) return null;
  return withDbRead(async (db) => {
    const result = await db.query<{
      id: string;
      display_name: string | null;
      avatar_url: string | null;
      phone: string | null;
      email: string | null;
      username: string | null;
      preferences: UserPreferences;
      provider: AuthProvider | null;
    }>(
      `SELECT u.id::text, u.display_name, u.avatar_url, u.phone, u.email, u.username, u.preferences, i.provider
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN LATERAL (
         SELECT provider FROM auth_identities
         WHERE user_id = u.id
         ORDER BY created_at DESC
         LIMIT 1
       ) i ON true
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hashToken(token)],
    );
    if (result.rows[0]) return asUser(result.rows[0]);
    await db.query(`DELETE FROM auth_sessions WHERE expires_at <= now() OR token_hash = $1`, [
      hashToken(token),
    ]);
    return memGetSessionUser(token);
  }, () => memGetSessionUser(token));
}

export async function destroySession(token: string | undefined | null): Promise<void> {
  memDestroySession(token);
  if (!token) return;
  await withDbWrite(async (db) => {
    await db.query(`DELETE FROM auth_sessions WHERE token_hash = $1`, [hashToken(token)]);
    return undefined;
  }, () => undefined);
}

export async function updateUser(
  userId: string,
  patch: Partial<Pick<AccountUser, 'displayName' | 'avatarUrl'>> & {
    preferences?: Partial<UserPreferences>;
  },
): Promise<AccountUser | null> {
  return withDbWrite(async (db) => {
    const current = await db.query<{ preferences: UserPreferences | null }>(
      `SELECT preferences FROM users WHERE id = $1`,
      [userId],
    );
    if (!current.rows[0]) return memUpdateUser(userId, patch);
    const nextPrefs = patch.preferences
      ? mergePreferences(current.rows[0].preferences, patch.preferences)
      : null;
    const result = await db.query<{
      id: string;
      display_name: string | null;
      avatar_url: string | null;
      phone: string | null;
      email: string | null;
      username: string | null;
      preferences: UserPreferences;
      provider: AuthProvider | null;
    }>(
      `UPDATE users SET
         display_name = COALESCE($2, display_name),
         avatar_url = COALESCE($3, avatar_url),
         avatar_data = CASE WHEN $3 = '' THEN NULL ELSE avatar_data END,
         preferences = COALESCE($4::jsonb, preferences),
         updated_at = now()
       WHERE id = $1
       RETURNING id::text, display_name, avatar_url, phone, email, username, preferences,
         (SELECT provider FROM auth_identities WHERE user_id = users.id ORDER BY created_at DESC LIMIT 1) AS provider`,
      [
        userId,
        patch.displayName ?? null,
        patch.avatarUrl ?? null,
        nextPrefs ? JSON.stringify(nextPrefs) : null,
      ],
    );
    return result.rows[0] ? asUser(result.rows[0]) : memUpdateUser(userId, patch);
  }, () => memUpdateUser(userId, patch));
}

/** 上传头像:data 非空 → avatar_data 存字节 + avatar_url 写服务端路径;data=null → 整头像清空。 */
export async function updateAvatar(
  userId: string,
  input: { data: Uint8Array; url: string } | { data: null },
): Promise<AccountUser | null> {
  return withDbWrite(async (db) => {
    const result = await db.query<{
      id: string;
      display_name: string | null;
      avatar_url: string | null;
      phone: string | null;
      email: string | null;
      username: string | null;
      preferences: UserPreferences;
      provider: AuthProvider | null;
    }>(
      `UPDATE users SET
         avatar_data = $2,
         avatar_url = $3,
         updated_at = now()
       WHERE id = $1
       RETURNING id::text, display_name, avatar_url, phone, email, username, preferences,
         (SELECT provider FROM auth_identities WHERE user_id = users.id ORDER BY created_at DESC LIMIT 1) AS provider`,
      [
        userId,
        input.data === null ? null : Buffer.from(input.data),
        input.data === null ? null : input.url,
      ],
    );
    return result.rows[0] ? asUser(result.rows[0]) : memUpdateAvatar(userId, input);
  }, () => memUpdateAvatar(userId, input));
}

/** 取上传头像字节(无 → null)。只在 GET /api/me/avatar 内部使用,绝不进 user 对象。 */
export async function getAvatarData(userId: string): Promise<Uint8Array | null> {
  return withDbRead(async (db) => {
    const result = await db.query<{ avatar_data: Buffer | null }>(
      `SELECT avatar_data FROM users WHERE id = $1`,
      [userId],
    );
    const buf = result.rows[0]?.avatar_data;
    return buf ? new Uint8Array(buf) : null;
  }, () => memGetAvatarData(userId));
}

export async function issueOtp(
  provider: 'phone' | 'email',
  target: string,
): Promise<{ expiresAt: number; code: string }> {
  const normalized = target.trim().toLowerCase();
  const now = Date.now();
  const cfg = otpRateConfig;
  const guard = getOtpGuard(otpKey(provider, normalized));
  pruneOtpGuard(guard, now);
  // 锁定期内不允许补发新码(防止绕过尝试上限)。
  if (guard.lockedUntil > now) {
    throw new OtpTooManyAttemptsError(guard.lockedUntil - now, 'too many failed attempts, try again later');
  }
  if (now - guard.lastSentAt < cfg.cooldownMs) {
    const retryAfterMs = cfg.cooldownMs - (now - guard.lastSentAt);
    throw new OtpRateLimitedError(retryAfterMs, 'resend too soon');
  }
  if (guard.sentAt.length >= cfg.dailyLimit) {
    const retryAfterMs = Math.max(cfg.cooldownMs, guard.sentAt[0] + cfg.dailyWindowMs - now);
    throw new OtpRateLimitedError(retryAfterMs, 'daily send limit reached');
  }
  guard.lastSentAt = now;
  guard.sentAt.push(now);

  const memory = memIssueOtp(provider, normalized);
  await withDbWrite(async (db) => {
    // 顺手清掉该 target 的过期挑战行,控制 auth_otp_challenges 膨胀。
    await db.query(
      `DELETE FROM auth_otp_challenges WHERE provider = $1 AND target = $2 AND expires_at <= now()`,
      [provider, normalized],
    );
    await db.query(
      `INSERT INTO auth_otp_challenges (provider, target, code_hash, expires_at)
       VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))`,
      [provider, normalized, hashOtp(memory.code), memory.expiresAt],
    );
    return undefined;
  }, () => undefined);
  return memory;
}

export async function consumeOtp(provider: 'phone' | 'email', target: string, code: string): Promise<boolean> {
  const normalized = target.trim().toLowerCase();
  const now = Date.now();
  const cfg = otpRateConfig;
  const guard = getOtpGuard(otpKey(provider, normalized));
  pruneOtpGuard(guard, now);
  if (guard.lockedUntil > now) {
    throw new OtpTooManyAttemptsError(guard.lockedUntil - now, 'too many failed attempts, locked');
  }

  const ok = await withDbWrite(async (db) => {
    const result = await db.query<{ id: string }>(
      `SELECT id::text
       FROM auth_otp_challenges
       WHERE provider = $1 AND target = $2 AND consumed_at IS NULL AND expires_at > now()
         AND code_hash = $3
       ORDER BY created_at DESC
       LIMIT 1`,
      [provider, normalized, hashOtp(code)],
    );
    const row = result.rows[0];
    if (!row) {
      await db.query(
        `DELETE FROM auth_otp_challenges WHERE provider = $1 AND target = $2 AND expires_at <= now()`,
        [provider, normalized],
      );
      return false;
    }
    await db.query(`UPDATE auth_otp_challenges SET consumed_at = now() WHERE id = $1`, [row.id]);
    return true;
  }, () => memConsumeOtp(provider, normalized, code));

  const succeeded = ok || memConsumeOtp(provider, normalized, code);
  if (succeeded) {
    guard.wrongAt = [];
    return true;
  }
  // 记录错误尝试;15min 窗口内 ≥5 次 → 锁 15min。
  guard.wrongAt.push(now);
  if (guard.wrongAt.length >= cfg.maxWrongAttempts) {
    guard.lockedUntil = now + cfg.lockMs;
    guard.wrongAt = [];
    throw new OtpTooManyAttemptsError(cfg.lockMs, 'too many failed attempts, locked');
  }
  return false;
}

// ---- search_history 实体引用列（db/migrations/014_recent_entity.sql）----
// 迁移 apply 是 Env-only，未 apply 时 entity 列不存在：SELECT/INSERT/UPDATE
// 遇到 42703(undefined_column) 自动退回不含 entity 列的语句，系统不崩。

type HistoryRow = {
  id: string;
  query: string;
  mode: MapMode;
  created_at: Date;
  entity?: unknown;
};

function toHistoryEntry(row: HistoryRow): SearchHistoryEntry {
  const base = {
    id: row.id,
    query: row.query,
    mode: canonicalMode(row.mode),
    createdAt: row.created_at.toISOString(),
  };
  const entity = sanitizeEntityRef(row.entity);
  return entity ? { ...base, entity } : base;
}

async function withEntityColumnFallback<T>(
  withEntity: () => Promise<T>,
  withoutEntity: () => Promise<T>,
): Promise<T> {
  try {
    return await withEntity();
  } catch (err) {
    if ((err as { code?: string })?.code !== '42703') throw err;
    return withoutEntity();
  }
}

const HISTORY_SELECT = `
  SELECT id::text, query, mode, created_at
  FROM search_history
  WHERE user_id = $1
  ORDER BY created_at DESC
  LIMIT $2`;
const HISTORY_SELECT_WITH_ENTITY = `
  SELECT id::text, query, mode, entity, created_at
  FROM search_history
  WHERE user_id = $1
  ORDER BY created_at DESC
  LIMIT $2`;

export async function listHistory(userId: string, limit = 30): Promise<SearchHistoryEntry[]> {
  return withDbRead(async (db) => {
    const result = await withEntityColumnFallback(
      () => db.query<HistoryRow>(HISTORY_SELECT_WITH_ENTITY, [userId, limit]),
      () => db.query<HistoryRow>(HISTORY_SELECT, [userId, limit]),
    );
    return result.rows.map(toHistoryEntry);
  }, () => memListHistory(userId, limit));
}

export async function addHistory(
  userId: string,
  query: string,
  mode: SearchHistoryEntry['mode'],
  entity?: SearchHistoryEntityRef,
): Promise<SearchHistoryEntry | null> {
  const q = query.trim();
  if (!q) return null;
  const canon = canonicalMode(mode);
  const ent = sanitizeEntityRef(entity) ?? null;
  return withDbWrite(async (db) => {
    const last = await withEntityColumnFallback(
      () => db.query<HistoryRow>(
        `SELECT id::text, query, mode, entity, created_at
         FROM search_history
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId],
      ),
      () => db.query<HistoryRow>(
        `SELECT id::text, query, mode, created_at
         FROM search_history
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId],
      ),
    );
    const prev = last.rows[0];
    if (prev && prev.query === q && canonicalMode(prev.mode) === canon) {
      const updated = await withEntityColumnFallback(
        () => db.query<HistoryRow>(
          `UPDATE search_history
           SET created_at = now(), entity = COALESCE($2::jsonb, entity)
           WHERE id = $1
           RETURNING id::text, query, mode, entity, created_at`,
          [prev.id, ent],
        ),
        () => db.query<HistoryRow>(
          `UPDATE search_history SET created_at = now() WHERE id = $1
           RETURNING id::text, query, mode, created_at`,
          [prev.id],
        ),
      );
      return toHistoryEntry(updated.rows[0]);
    }
    const inserted = await withEntityColumnFallback(
      () => db.query<HistoryRow>(
        `INSERT INTO search_history (user_id, query, mode, entity)
         VALUES ($1, $2, $3, $4::jsonb)
         RETURNING id::text, query, mode, entity, created_at`,
        [userId, q, canon, ent],
      ),
      () => db.query<HistoryRow>(
        `INSERT INTO search_history (user_id, query, mode)
         VALUES ($1, $2, $3)
         RETURNING id::text, query, mode, created_at`,
        [userId, q, canon],
      ),
    );
    return toHistoryEntry(inserted.rows[0]);
  }, () => memAddHistory(userId, q, canon, entity));
}

export async function clearHistory(userId: string): Promise<void> {
  memClearHistory(userId);
  await withDbWrite(async (db) => {
    await db.query(`DELETE FROM search_history WHERE user_id = $1`, [userId]);
    return undefined;
  }, () => undefined);
}

function asSaved(row: {
  id: string;
  poi_id: string;
  name: string;
  mode: MapMode;
  kind: SavedPlace['kind'];
  address: string | null;
  lng: number | null;
  lat: number | null;
  created_at: Date;
}): SavedPlace {
  return {
    id: row.id,
    poiId: row.poi_id,
    name: row.name,
    mode: canonicalMode(row.mode),
    kind: row.kind,
    address: row.address ?? undefined,
    lng: row.lng ?? undefined,
    lat: row.lat ?? undefined,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listSaved(userId: string): Promise<SavedPlace[]> {
  return withDbRead(async (db) => {
    const result = await db.query<{
      id: string;
      poi_id: string;
      name: string;
      mode: MapMode;
      kind: SavedPlace['kind'];
      address: string | null;
      lng: number | null;
      lat: number | null;
      created_at: Date;
    }>(
      `SELECT id::text, poi_id, name, mode, kind, address, lng, lat, created_at
       FROM saved_places
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );
    return result.rows.map(asSaved);
  }, () => memListSaved(userId));
}

export async function savePlace(
  userId: string,
  place: Omit<SavedPlace, 'id' | 'createdAt'>,
): Promise<SavedPlace> {
  const canon = canonicalMode(place.mode);
  return withDbWrite(async (db) => {
    const result = await db.query<{
      id: string;
      poi_id: string;
      name: string;
      mode: MapMode;
      kind: SavedPlace['kind'];
      address: string | null;
      lng: number | null;
      lat: number | null;
      created_at: Date;
    }>(
      `INSERT INTO saved_places (user_id, poi_id, name, mode, kind, address, lng, lat)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, poi_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id::text, poi_id, name, mode, kind, address, lng, lat, created_at`,
      [userId, place.poiId, place.name, canon, place.kind, place.address ?? null, place.lng ?? null, place.lat ?? null],
    );
    return asSaved(result.rows[0]);
  }, () => memSavePlace(userId, { ...place, mode: canon }));
}

export async function removeSaved(userId: string, poiId: string): Promise<boolean> {
  return withDbWrite(async (db) => {
    const result = await db.query(`DELETE FROM saved_places WHERE user_id = $1 AND poi_id = $2`, [userId, poiId]);
    return (result.rowCount ?? 0) > 0;
  }, () => memRemoveSaved(userId, poiId));
}

function asApplication(row: {
  id: string;
  position_id: string;
  company_poi_id: string;
  title: string;
  company_name: string;
  apply_url: string | null;
  status: ApplicationRecord['status'];
  created_at: Date;
}): ApplicationRecord {
  return {
    id: row.id,
    positionId: row.position_id,
    companyPoiId: row.company_poi_id,
    title: row.title,
    companyName: row.company_name,
    applyUrl: row.apply_url ?? undefined,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listApplications(userId: string): Promise<ApplicationRecord[]> {
  return withDbRead(async (db) => {
    const result = await db.query<{
      id: string;
      position_id: string;
      company_poi_id: string;
      title: string;
      company_name: string;
      apply_url: string | null;
      status: ApplicationRecord['status'];
      created_at: Date;
    }>(
      `SELECT id::text, position_id, company_poi_id, title, company_name, apply_url, status, created_at
       FROM applications
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );
    return result.rows.map(asApplication);
  }, () => memListApplications(userId));
}

export async function recordApplication(
  userId: string,
  input: Omit<ApplicationRecord, 'id' | 'createdAt' | 'status'> & { status?: ApplicationRecord['status'] },
): Promise<ApplicationRecord> {
  return withDbWrite(async (db) => {
    const result = await db.query<{
      id: string;
      position_id: string;
      company_poi_id: string;
      title: string;
      company_name: string;
      apply_url: string | null;
      status: ApplicationRecord['status'];
      created_at: Date;
    }>(
      `INSERT INTO applications (user_id, position_id, company_poi_id, title, company_name, apply_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, position_id) DO UPDATE SET title = EXCLUDED.title
       RETURNING id::text, position_id, company_poi_id, title, company_name, apply_url, status, created_at`,
      [
        userId,
        input.positionId,
        input.companyPoiId,
        input.title,
        input.companyName,
        input.applyUrl ?? null,
        input.status ?? 'applied',
      ],
    );
    return asApplication(result.rows[0]);
  }, () => memRecordApplication(userId, input));
}

function asNotification(row: {
  id: string;
  kind: NotificationRecord['kind'];
  position_id: string | null;
  company_poi_id: string | null;
  title: string;
  company_name: string | null;
  apply_url: string | null;
  channels: string[] | null;
  status: NotificationRecord['status'];
  created_at: Date;
}): NotificationRecord {
  return {
    id: row.id,
    kind: row.kind,
    positionId: row.position_id ?? undefined,
    companyPoiId: row.company_poi_id ?? undefined,
    title: row.title,
    companyName: row.company_name ?? undefined,
    applyUrl: row.apply_url ?? undefined,
    channels: (row.channels ?? ['inbox']) as NotificationRecord['channels'],
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listNotifications(userId: string): Promise<NotificationRecord[]> {
  return withDbRead(async (db) => {
    const result = await db.query<{
      id: string;
      kind: NotificationRecord['kind'];
      position_id: string | null;
      company_poi_id: string | null;
      title: string;
      company_name: string | null;
      apply_url: string | null;
      channels: string[] | null;
      status: NotificationRecord['status'];
      created_at: Date;
    }>(
      `SELECT id::text, kind, position_id, company_poi_id, title, company_name, apply_url, channels, status, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );
    return result.rows.map(asNotification);
  }, () => memListNotifications(userId));
}

export async function enqueueNotification(
  userId: string,
  input: Omit<NotificationRecord, 'id' | 'createdAt' | 'status'> & { status?: NotificationRecord['status'] },
): Promise<NotificationRecord> {
  return withDbWrite(async (db) => {
    const result = await db.query<{
      id: string;
      kind: NotificationRecord['kind'];
      position_id: string | null;
      company_poi_id: string | null;
      title: string;
      company_name: string | null;
      apply_url: string | null;
      channels: string[] | null;
      status: NotificationRecord['status'];
      created_at: Date;
    }>(
      `INSERT INTO notifications (user_id, kind, position_id, company_poi_id, title, company_name, apply_url, channels, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id, kind, position_id) DO UPDATE SET title = EXCLUDED.title
       RETURNING id::text, kind, position_id, company_poi_id, title, company_name, apply_url, channels, status, created_at`,
      [
        userId,
        input.kind,
        input.positionId ?? null,
        input.companyPoiId ?? null,
        input.title,
        input.companyName ?? null,
        input.applyUrl ?? null,
        input.channels,
        input.status ?? 'queued',
      ],
    );
    return asNotification(result.rows[0]);
  }, () => memEnqueueNotification(userId, input));
}
