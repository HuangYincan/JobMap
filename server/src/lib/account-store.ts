// ============================================================
// 账户仓储门面
//
// 有 DATABASE_URL 且 005 已应用：identities / sessions / OTP / history 上云。
// 否则（或查询失败）回落到进程内 session-store，单测不依赖库。
// ============================================================

import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import {
  DEFAULT_PREFERENCES,
  mergePreferences,
  type AccountUser,
  type AuthProvider,
  type ApplicationRecord,
  type NotificationRecord,
  type SavedPlace,
  type SearchHistoryEntry,
  type UserPreferences,
} from './account.ts';
import { getPool } from './db.ts';
import { canonicalMode } from './modes.ts';
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
  upsertIdentity as memUpsertIdentity,
  DEMO_OTP_CODE,
} from './session-store.ts';

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
  preferences: UserPreferences | null;
  provider: AuthProvider | null;
}): AccountUser {
  const phone = row.phone ?? undefined;
  const email = row.email ?? undefined;
  const prefs = row.preferences ?? DEFAULT_PREFERENCES;
  return {
    id: String(row.id),
    displayName: row.display_name || defaultName(row.provider, phone, email),
    accountLabel: phone || email || '',
    avatarUrl: row.avatar_url ?? undefined,
    phone,
    email,
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

async function withDb<T>(fn: (pool: Pool) => Promise<T>, fallback: () => T | Promise<T>): Promise<T> {
  const db = getPool();
  if (!db) return fallback();
  try {
    return await fn(db);
  } catch (err) {
    console.warn('[account-store] postgres unavailable, using memory:', (err as Error).message);
    return fallback();
  }
}

export async function upsertIdentity(input: {
  provider: AuthProvider;
  subject: string;
  email?: string;
  phone?: string;
  displayName?: string;
  avatarUrl?: string;
}): Promise<AccountUser> {
  return withDb(async (db) => {
    const subject = subjectKey(input.provider, input.subject);
    const prefs = JSON.stringify(DEFAULT_PREFERENCES);
    const inserted = await db.query<{
      id: string;
      display_name: string | null;
      avatar_url: string | null;
      phone: string | null;
      email: string | null;
      preferences: UserPreferences;
    }>(
      `INSERT INTO users (subject, display_name, phone, email, avatar_url, preferences)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (subject) DO UPDATE SET
         display_name = COALESCE(users.display_name, EXCLUDED.display_name),
         phone = COALESCE(EXCLUDED.phone, users.phone),
         email = COALESCE(EXCLUDED.email, users.email),
         avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
         updated_at = now()
       RETURNING id::text, display_name, avatar_url, phone, email, preferences`,
      [
        subject,
        input.displayName ?? null,
        input.phone ?? null,
        input.email ?? null,
        input.avatarUrl ?? null,
        prefs,
      ],
    );
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

export async function createSession(userId: string): Promise<{ token: string; expiresAt: number }> {
  return withDb(async (db) => {
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
  return withDb(async (db) => {
    const result = await db.query<{
      id: string;
      display_name: string | null;
      avatar_url: string | null;
      phone: string | null;
      email: string | null;
      preferences: UserPreferences;
      provider: AuthProvider | null;
    }>(
      `SELECT u.id::text, u.display_name, u.avatar_url, u.phone, u.email, u.preferences, i.provider
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
    return memGetSessionUser(token);
  }, () => memGetSessionUser(token));
}

export async function destroySession(token: string | undefined | null): Promise<void> {
  memDestroySession(token);
  if (!token) return;
  await withDb(async (db) => {
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
  return withDb(async (db) => {
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
      preferences: UserPreferences;
      provider: AuthProvider | null;
    }>(
      `UPDATE users SET
         display_name = COALESCE($2, display_name),
         avatar_url = COALESCE($3, avatar_url),
         preferences = COALESCE($4::jsonb, preferences),
         updated_at = now()
       WHERE id = $1
       RETURNING id::text, display_name, avatar_url, phone, email, preferences,
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

export async function issueOtp(provider: 'phone' | 'email', target: string): Promise<{ expiresAt: number }> {
  const memory = memIssueOtp(provider, target);
  await withDb(async (db) => {
    await db.query(
      `INSERT INTO auth_otp_challenges (provider, target, code_hash, expires_at)
       VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))`,
      [provider, target.trim().toLowerCase(), hashOtp(DEMO_OTP_CODE), memory.expiresAt],
    );
    return undefined;
  }, () => undefined);
  return memory;
}

export async function consumeOtp(provider: 'phone' | 'email', target: string, code: string): Promise<boolean> {
  const ok = await withDb(async (db) => {
    const result = await db.query<{ id: string }>(
      `SELECT id::text
       FROM auth_otp_challenges
       WHERE provider = $1 AND target = $2 AND consumed_at IS NULL AND expires_at > now()
         AND code_hash = $3
       ORDER BY created_at DESC
       LIMIT 1`,
      [provider, target.trim().toLowerCase(), hashOtp(code)],
    );
    const row = result.rows[0];
    if (!row) return false;
    await db.query(`UPDATE auth_otp_challenges SET consumed_at = now() WHERE id = $1`, [row.id]);
    return true;
  }, () => memConsumeOtp(provider, target, code));
  if (ok) return true;
  return memConsumeOtp(provider, target, code);
}

export async function listHistory(userId: string, limit = 30): Promise<SearchHistoryEntry[]> {
  return withDb(async (db) => {
    const result = await db.query<{
      id: string;
      query: string;
      mode: MapMode;
      created_at: Date;
    }>(
      `SELECT id::text, query, mode, created_at
       FROM search_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      query: row.query,
      mode: canonicalMode(row.mode),
      createdAt: row.created_at.toISOString(),
    }));
  }, () => memListHistory(userId, limit));
}

export async function addHistory(
  userId: string,
  query: string,
  mode: SearchHistoryEntry['mode'],
): Promise<SearchHistoryEntry | null> {
  const q = query.trim();
  if (!q) return null;
  const canon = canonicalMode(mode);
  return withDb(async (db) => {
    const last = await db.query<{ id: string; query: string; mode: MapMode; created_at: Date }>(
      `SELECT id::text, query, mode, created_at
       FROM search_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId],
    );
    const prev = last.rows[0];
    if (prev && prev.query === q && canonicalMode(prev.mode) === canon) {
      const updated = await db.query<{ id: string; query: string; mode: MapMode; created_at: Date }>(
        `UPDATE search_history SET created_at = now() WHERE id = $1
         RETURNING id::text, query, mode, created_at`,
        [prev.id],
      );
      const row = updated.rows[0];
      return {
        id: row.id,
        query: row.query,
        mode: canonicalMode(row.mode),
        createdAt: row.created_at.toISOString(),
      };
    }
    const inserted = await db.query<{ id: string; query: string; mode: MapMode; created_at: Date }>(
      `INSERT INTO search_history (user_id, query, mode)
       VALUES ($1, $2, $3)
       RETURNING id::text, query, mode, created_at`,
      [userId, q, canon],
    );
    const row = inserted.rows[0];
    return {
      id: row.id,
      query: row.query,
      mode: canonicalMode(row.mode),
      createdAt: row.created_at.toISOString(),
    };
  }, () => memAddHistory(userId, q, canon));
}

export async function clearHistory(userId: string): Promise<void> {
  memClearHistory(userId);
  await withDb(async (db) => {
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
  return withDb(async (db) => {
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
  return withDb(async (db) => {
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
  return withDb(async (db) => {
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
  return withDb(async (db) => {
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
  return withDb(async (db) => {
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
  return withDb(async (db) => {
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
  return withDb(async (db) => {
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
