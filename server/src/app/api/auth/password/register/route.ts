import { NextResponse } from 'next/server';
import { createSession, registerWithPassword, UsernameTakenError } from '@/lib/account-store';
import { readSessionToken, writeSessionCookie } from '@/lib/http-session';
import { isValidPassword, isValidUsername } from '@/lib/password';
import { clientIpBucketKey } from '@/lib/client-ip';
import { BoundedRateStore } from '@/lib/bounded-rate-store';
import { RequestBodyTooLargeError, readJsonBody } from '@/lib/request-body';

/** Registration performs scrypt and writes durable rows, so fail before parsing huge bodies. */
const MAX_BODY_CHARS = 4 * 1024;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;
const REGISTER_MAX_PER_KEY = 5;

const REGISTRATION_GUARD_CAPACITY = 10_000;
const REGISTRATION_GUARD_TTL_MS = REGISTER_WINDOW_MS * 2;
const registrationAttempts = new BoundedRateStore<number[]>(REGISTRATION_GUARD_CAPACITY);

class RegistrationRateLimitedError extends Error {
  constructor(readonly retryAfterMs: number) {
    super('too many registrations, try again later');
    this.name = 'RegistrationRateLimitedError';
  }
}

function checkRegistrationLimit(key: string): void {
  const now = Date.now();
  const attempts = (registrationAttempts.get(key) ?? []).filter((at) => at > now - REGISTER_WINDOW_MS);
  if (attempts.length >= REGISTER_MAX_PER_KEY) {
    throw new RegistrationRateLimitedError(attempts[0] + REGISTER_WINDOW_MS - now);
  }
}

function recordRegistration(key: string): void {
  const now = Date.now();
  const attempts = (registrationAttempts.get(key) ?? []).filter((at) => at > now - REGISTER_WINDOW_MS);
  attempts.push(now);
  registrationAttempts.set(key, attempts, REGISTRATION_GUARD_TTL_MS, now);
}

/**
 * 注册密码账号(username + password),成功后自动登录(写 dm_session cookie)。
 * 400:参数不合法(INVALID_USERNAME / PASSWORD_TOO_SHORT / PASSWORD_MISMATCH)
 * 409:用户名已存在(USERNAME_TAKEN)
 */
export async function POST(request: Request) {
  let body: { username?: string; password?: string; confirmPassword?: string };
  try {
    body = await readJsonBody<typeof body>(request, MAX_BODY_CHARS);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { ok: false, code: 'BODY_TOO_LARGE', message: 'request body too large' },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'invalid JSON' }, { status: 400 });
  }

  const username = (body.username ?? '').trim();
  const password = body.password ?? '';
  if (!isValidUsername(username)) {
    return NextResponse.json(
      { ok: false, code: 'INVALID_USERNAME', message: 'username must be 2-32 letters, digits, underscore or Chinese' },
      { status: 400 },
    );
  }
  if (!isValidPassword(password)) {
    return NextResponse.json(
      { ok: false, code: 'PASSWORD_TOO_SHORT', message: 'password must be at least 8 characters' },
      { status: 400 },
    );
  }
  if (body.confirmPassword !== undefined && body.confirmPassword !== password) {
    return NextResponse.json(
      { ok: false, code: 'PASSWORD_MISMATCH', message: 'passwords do not match' },
      { status: 400 },
    );
  }

  // Reserve an attempt before scrypt/durable writes. Counting only successes
  // would let duplicate-username probes bypass the guard and enumerate accounts.
  const bucketKey = clientIpBucketKey(request, await readSessionToken());
  try {
    checkRegistrationLimit(bucketKey);
  } catch (err) {
    if (err instanceof RegistrationRateLimitedError) {
      return NextResponse.json(
        { ok: false, code: 'RATE_LIMITED', message: err.message, retryAfterMs: err.retryAfterMs },
        { status: 429, headers: { 'Retry-After': Math.ceil(err.retryAfterMs / 1000).toString() } },
      );
    }
    throw err;
  }
  recordRegistration(bucketKey);

  let user;
  try {
    user = await registerWithPassword(username, password);
  } catch (err) {
    if (err instanceof UsernameTakenError) {
      return NextResponse.json(
        { ok: false, code: 'USERNAME_TAKEN', message: 'username already taken' },
        { status: 409 },
      );
    }
    throw err;
  }

  const session = await createSession(user.id);
  await writeSessionCookie(session.token, session.expiresAt);
  return NextResponse.json({ ok: true, user });
}
