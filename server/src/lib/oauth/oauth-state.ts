// ============================================================
// OAuth state:nonce 签发 + HMAC 校验 + next 清洗 + oauth_state cookie
//
// oauth_state cookie 格式(自定义):v1.<ts>.<state>.<nextBase64Url>.<mac>
//   - ts:签名时刻(秒)
//   - state:32-byte 随机 hex nonce(与三方回跳的 ?state= 一致)
//   - nextBase64Url:同源相对路径的 base64url 编码(签名时已清洗)
//   - mac:HMAC-SHA256("v1|ts|state|next") 前 32 hex
// 签名密钥复用 SESSION_SECRET;未设置 → 进程启动时随机(bootSecret),
// 不引入新 env。cookie 有效期 600s;httpOnly / sameSite=lax / secure 仅生产。
// ============================================================

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const OAUTH_STATE_COOKIE = 'oauth_state';
export const OAUTH_STATE_TTL_SECONDS = 600;
export const OAUTH_STATE_TTL_MS = OAUTH_STATE_TTL_SECONDS * 1000;
export const OAUTH_STATE_MAX_NEXT_LENGTH = 2048;

/** SESSION_SECRET 复用;未设置 → boot 随机(进程内一致)。 */
let bootSecret: string | null = null;
function oauthStateSecret(): string {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv) return fromEnv;
  bootSecret ??= randomBytes(32).toString('hex');
  return bootSecret;
}

/** 32-byte 随机 hex nonce(64 字符)。 */
export function randomOauthState(): string {
  return randomBytes(32).toString('hex');
}

/**
 * next 清洗:仅接受同源相对路径——单个 `/` 开头、非 `//`、非 `/\`、≤2048 字符。
 * 不合法 → 默认 `/`。
 */
export function sanitizeNext(next: string | null | undefined): string {
  const value = (next ?? '').trim();
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.startsWith('/\\') ||
    value.length > OAUTH_STATE_MAX_NEXT_LENGTH
  ) {
    return '/';
  }
  return value;
}

export interface OauthStateCookieOptions {
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
}

export function oauthStateCookieOptions(): OauthStateCookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: OAUTH_STATE_TTL_SECONDS,
  };
}

function macFor(ts: number, state: string, next: string): string {
  return createHmac('sha256', oauthStateSecret())
    .update(`v1|${ts}|${state}|${next}`)
    .digest('hex')
    .slice(0, 32);
}

/** 签发 oauth_state cookie 值。next 必须已清洗(sanitizeNext)。 */
export function signOauthState(input: { state: string; next: string; now?: number }): string {
  const now = input.now ?? Date.now();
  const ts = Math.floor(now / 1000);
  const nextB64 = Buffer.from(input.next, 'utf8').toString('base64url');
  return `v1.${ts}.${input.state}.${nextB64}.${macFor(ts, input.state, input.next)}`;
}

/**
 * 校验 oauth_state cookie 值:cookie 存在、格式正确、HMAC 有效、未过期(600s)、
 * state 与 query 一致 → { ok: true, next }(next 为签名时清洗过的相对路径)。
 * 任一失败 → { ok: false }。调用方负责在通过后立即清 cookie。
 */
export function verifyOauthState(
  raw: string | null | undefined,
  input: { state: string | null; now?: number },
): { ok: true; next: string } | { ok: false } {
  if (!raw) return { ok: false };
  const parts = raw.split('.');
  if (parts.length !== 5 || parts[0] !== 'v1') return { ok: false };
  const [, tsStr, state, nextB64, mac] = parts;
  if (!input.state || state !== input.state) return { ok: false };
  const ts = Number(tsStr);
  if (!Number.isInteger(ts) || ts <= 0) return { ok: false };
  const now = input.now ?? Date.now();
  if (now - ts * 1000 > OAUTH_STATE_TTL_MS) return { ok: false };
  const next = Buffer.from(nextB64, 'base64url').toString('utf8');
  // 存疑的 next(签名后不再信任)必须仍是合法相对路径,否则整票作废。
  if (sanitizeNext(next) !== next) return { ok: false };
  const expected = Buffer.from(macFor(ts, state, next), 'utf8');
  const actual = Buffer.from(mac, 'utf8');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { ok: false };
  return { ok: true, next };
}
