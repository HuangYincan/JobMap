import { NextResponse } from 'next/server';
import { readSessionUser } from '@/lib/http-session';
import {
  bindEmail,
  consumeOtp,
  DbUnavailableError,
  EmailTakenError,
  OtpTooManyAttemptsError,
} from '@/lib/account-store';

/** 邮箱格式(与 otp/send 一致)。 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 绑定/更换邮箱(OTP 验证新邮箱),与 me/phone 对称。
 * 401 INVALID_CODE、409 EMAIL_TAKEN(lower(email) 唯一)、400 BAD_REQUEST、429/503。
 */
export async function POST(request: Request) {
  const user = await readSessionUser();
  if (!user) {
    return NextResponse.json({ code: 'UNAUTHORIZED', message: 'not signed in' }, { status: 401 });
  }

  let body: { email?: unknown; code?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'invalid JSON' }, { status: 400 });
  }

  const email = (typeof body.email === 'string' ? body.email : '').trim();
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'invalid email' }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'code required' }, { status: 400 });
  }

  try {
    if (!(await consumeOtp('email', email, code))) {
      return NextResponse.json({ code: 'INVALID_CODE', message: 'invalid or expired code' }, { status: 401 });
    }
    const next = await bindEmail(user.id, email);
    return NextResponse.json({ ok: true, user: next });
  } catch (err) {
    if (err instanceof EmailTakenError) {
      return NextResponse.json(
        { code: 'EMAIL_TAKEN', message: 'email already bound to another account' },
        { status: 409 },
      );
    }
    if (err instanceof OtpTooManyAttemptsError) {
      return NextResponse.json(
        { code: 'TOO_MANY_ATTEMPTS', message: err.message, retryAfterMs: err.retryAfterMs },
        { status: 429 },
      );
    }
    if (err instanceof DbUnavailableError) {
      return NextResponse.json(
        { code: 'DB_UNAVAILABLE', message: 'database unavailable, try again later' },
        { status: 503 },
      );
    }
    throw err;
  }
}
