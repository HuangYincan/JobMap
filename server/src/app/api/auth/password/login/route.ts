import { NextResponse } from 'next/server';
import { RequestBodyTooLargeError, readJsonObjectBody } from '@/lib/request-body';
import { createSession, DbUnavailableError, loginWithPassword } from '@/lib/account-store';
import { writeSessionCookie, readSessionToken } from '@/lib/http-session';
import { clientIpBucketKey } from '@/lib/client-ip';
import { BoundedRateStore } from '@/lib/bounded-rate-store';

function noStoreJson(body: unknown, init?: { status?: number; headers?: HeadersInit }) {
  const response = NextResponse.json(body, {
    ...init,
    headers: { 'Cache-Control': 'no-store', ...(init?.headers ?? {}) },
  });
  return response;
}

/**
 * 密码登录(username + password)。成功写 dm_session cookie。
 * 401:账号或密码错误(INVALID_CREDENTIALS,不泄露账号是否存在)。
 * 429:防爆破滑动窗口(scan #3,与 OTP 守卫同构)——15min 窗口内失败 ≥5 次
 * (每账号)或 ≥20 次(每 IP)→ 锁 15min;本守卫先于 loginWithPassword,
 * 锁定期内不再执行 scrypt,撞库只可能发生在窗口内。
 */
export async function POST(request: Request) {
  let body: { username?: string; password?: string };
  try {
    body = await readJsonObjectBody<typeof body>(request);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return noStoreJson(
        { ok: false, code: 'BODY_TOO_LARGE', message: 'request body too large' },
        { status: 400 },
      );
    }
    return noStoreJson({ ok: false, code: 'BAD_REQUEST', message: 'invalid JSON' }, { status: 400 });
  }

  if (typeof body.username !== 'string' || typeof body.password !== 'string') {
    return noStoreJson(
      { ok: false, code: 'BAD_REQUEST', message: 'username and password required' },
      { status: 400 },
    );
  }
  const username = body.username.trim();
  const password = body.password;
  if (!username || !password) {
    return noStoreJson(
      { ok: false, code: 'BAD_REQUEST', message: 'username and password required' },
      { status: 400 },
    );
  }

  // per-IP 维度与 agent-chat 同语义(scan r2 #1):可信反代后取转发头 IP;未配置
  // TRUSTED_PROXY_IPS 时忽略转发头,登录用户按会话指纹、匿名归固定桶——
  // 伪造/轮换 XFF 不再换桶。per-账号 守卫保持 account-keyed 不变。
  const ipKey = loginGuardKey('ip', clientIpBucketKey(request, await readSessionToken()));
  const accountKey = loginGuardKey('account', username);
  try {
    checkLoginRateLimit(ipKey);
    checkLoginRateLimit(accountKey);
  } catch (err) {
    if (err instanceof LoginRateLimitedError) {
      return rateLimited(err);
    }
    throw err;
  }

  try {
    const user = await loginWithPassword(username, password);
    if (!user) {
      // 失败计数(5 次内仍是普通 401;触发锁定 → 429,与 OTP consumeOtp 同语义)。
      try {
        recordLoginFailure(ipKey, LOGIN_IP_MAX_FAILURES);
        recordLoginFailure(accountKey, LOGIN_MAX_FAILURES);
      } catch (err) {
        if (err instanceof LoginRateLimitedError) {
          return rateLimited(err);
        }
        throw err;
      }
      return noStoreJson(
        { ok: false, code: 'INVALID_CREDENTIALS', message: 'invalid username or password' },
        { status: 401 },
      );
    }

    clearLoginFailures(ipKey);
    clearLoginFailures(accountKey);
    const session = await createSession(user.id);
    await writeSessionCookie(session.token, session.expiresAt);
    return noStoreJson({ ok: true, user });
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return noStoreJson(
        { ok: false, code: 'DB_UNAVAILABLE', message: 'database unavailable, try again later' },
        { status: 503 },
      );
    }
    throw err;
  }
}

// ---- 防爆破滑动窗口(scan #3;与 account-store 的 otpGuard 同构:进程内、
// 单实例演示假设;窗口/锁数值与 OTP 15min/5 次一致,IP 维度放宽到 20) ----

const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
/** per-IP 失败上限:NAT 共享出口下多名用户误输密码不致整网锁定,故放宽。 */
const LOGIN_IP_MAX_FAILURES = 20;

class LoginRateLimitedError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number, message: string) {
    super(message);
    this.name = 'LoginRateLimitedError';
    this.retryAfterMs = retryAfterMs;
  }
}

interface LoginGuard {
  failures: number[]; // 15min 窗口内的失败时间戳
  lockedUntil: number; // 0 = 未锁
}

const LOGIN_GUARD_CAPACITY = 10_000;
const LOGIN_GUARD_TTL_MS = Math.max(LOGIN_ATTEMPT_WINDOW_MS, LOGIN_LOCK_MS) * 2;
const loginGuards = new BoundedRateStore<LoginGuard>(LOGIN_GUARD_CAPACITY);

function loginGuardKey(kind: 'ip' | 'account', value: string): string {
  return `${kind}:${value.trim().toLowerCase().slice(0, 128)}`;
}

function checkLoginRateLimit(key: string): void {
  const guard = loginGuards.get(key);
  if (!guard) return;
  const now = Date.now();
  guard.failures = guard.failures.filter((t) => t > now - LOGIN_ATTEMPT_WINDOW_MS);
  if (guard.lockedUntil <= now) guard.lockedUntil = 0;
  if (guard.lockedUntil > now) {
    throw new LoginRateLimitedError(guard.lockedUntil - now, 'too many failed attempts, try again later');
  }
}

function recordLoginFailure(key: string, maxFailures: number): void {
  let guard = loginGuards.get(key);
  if (!guard) {
    guard = { failures: [], lockedUntil: 0 };
    loginGuards.set(key, guard, LOGIN_GUARD_TTL_MS);
  }
  const now = Date.now();
  guard.failures = guard.failures.filter((t) => t > now - LOGIN_ATTEMPT_WINDOW_MS);
  guard.failures.push(now);
  if (guard.failures.length >= maxFailures) {
    guard.lockedUntil = now + LOGIN_LOCK_MS;
    guard.failures = [];
    throw new LoginRateLimitedError(LOGIN_LOCK_MS, 'too many failed attempts, locked');
  }
}

function clearLoginFailures(key: string): void {
  loginGuards.delete(key);
}

function rateLimited(err: LoginRateLimitedError): NextResponse {
  return noStoreJson(
    { ok: false, code: 'TOO_MANY_ATTEMPTS', message: err.message, retryAfterMs: err.retryAfterMs },
    { status: 429 },
  );
}
