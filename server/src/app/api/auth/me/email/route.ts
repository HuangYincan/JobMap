import { NextResponse } from 'next/server';
import { RequestBodyTooLargeError, readJsonObjectBody } from '@/lib/request-body';
import { readSessionUser } from '@/lib/http-session';
import {
  bindEmail,
  consumeOtp,
  DbUnavailableError,
  EmailTakenError,
  OtpTooManyAttemptsError,
} from '@/lib/account-store';
import { isValidEmail, normalizeEmail } from '@/lib/contact-validation';

function noStoreJson(body: unknown, init?: { status?: number }) {
  const response = NextResponse.json(body, { ...init, headers: { 'Cache-Control': 'no-store' } });
  return response;
}

/**
 * 绑定/更换邮箱(OTP 验证新邮箱),与 me/phone 对称。
 * 401 INVALID_CODE、409 EMAIL_TAKEN(lower(email) 唯一)、400 BAD_REQUEST、429/503。
 */
export async function POST(request: Request) {
  let user;
  try {
    user = await readSessionUser();
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return noStoreJson(
        { code: 'DB_UNAVAILABLE', message: 'database unavailable, try again later' },
        { status: 503 },
      );
    }
    throw err;
  }
  if (!user) {
    return noStoreJson({ code: 'UNAUTHORIZED', message: 'not signed in' }, { status: 401 });
  }

  let body: { email?: unknown; code?: unknown };
  try {
    body = await readJsonObjectBody<typeof body>(request);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return noStoreJson(
        { code: 'BODY_TOO_LARGE', message: 'request body too large' },
        { status: 400 },
      );
    }
    return noStoreJson({ code: 'BAD_REQUEST', message: 'invalid JSON' }, { status: 400 });
  }

  const inputEmail = typeof body.email === 'string' ? body.email.trim() : '';
  const email = isValidEmail(inputEmail) ? normalizeEmail(inputEmail) : inputEmail;
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!isValidEmail(email)) {
    return noStoreJson({ code: 'BAD_REQUEST', message: 'invalid email' }, { status: 400 });
  }
  if (!code) {
    return noStoreJson({ code: 'BAD_REQUEST', message: 'code required' }, { status: 400 });
  }

  try {
    if (!(await consumeOtp('email', email, code))) {
      return noStoreJson({ code: 'INVALID_CODE', message: 'invalid or expired code' }, { status: 401 });
    }
    const next = await bindEmail(user.id, email);
    return noStoreJson({ ok: true, user: next });
  } catch (err) {
    if (err instanceof EmailTakenError) {
      return noStoreJson(
        { code: 'EMAIL_TAKEN', message: 'email already bound to another account' },
        { status: 409 },
      );
    }
    if (err instanceof OtpTooManyAttemptsError) {
      return noStoreJson(
        { code: 'TOO_MANY_ATTEMPTS', message: err.message, retryAfterMs: err.retryAfterMs },
        { status: 429 },
      );
    }
    if (err instanceof DbUnavailableError) {
      return noStoreJson(
        { code: 'DB_UNAVAILABLE', message: 'database unavailable, try again later' },
        { status: 503 },
      );
    }
    throw err;
  }
}
