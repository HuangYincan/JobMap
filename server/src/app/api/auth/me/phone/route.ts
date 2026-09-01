import { NextResponse } from 'next/server';
import { RequestBodyTooLargeError, readJsonObjectBody } from '@/lib/request-body';
import { readSessionUser } from '@/lib/http-session';
import {
  bindPhone,
  consumeOtp,
  DbUnavailableError,
  OtpTooManyAttemptsError,
  PhoneTakenError,
} from '@/lib/account-store';
import { isValidPhone, normalizePhone } from '@/lib/contact-validation';

function noStoreJson(body: unknown, init?: { status?: number }) {
  const response = NextResponse.json(body, { ...init, headers: { 'Cache-Control': 'no-store' } });
  return response;
}

/**
 * 绑定/更换手机(OTP 验证新手机)。成功 200 { ok:true, user }(user.phone 已更新)。
 * 401 INVALID_CODE(验证码错/过期)、409 PHONE_TAKEN(已被他人绑定)、
 * 400 BAD_REQUEST(格式/缺 code)、429/503 照 otp/verify 模式。
 */
export async function POST(request: Request) {
  const user = await readSessionUser();
  if (!user) {
    return noStoreJson({ code: 'UNAUTHORIZED', message: 'not signed in' }, { status: 401 });
  }

  let body: { phone?: unknown; code?: unknown };
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

  const inputPhone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const phone = isValidPhone(inputPhone) ? normalizePhone(inputPhone) : inputPhone;
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!isValidPhone(phone)) {
    return noStoreJson({ code: 'BAD_REQUEST', message: 'invalid phone' }, { status: 400 });
  }
  if (!code) {
    return noStoreJson({ code: 'BAD_REQUEST', message: 'code required' }, { status: 400 });
  }

  try {
    if (!(await consumeOtp('phone', phone, code))) {
      return noStoreJson({ code: 'INVALID_CODE', message: 'invalid or expired code' }, { status: 401 });
    }
    const next = await bindPhone(user.id, phone);
    return noStoreJson({ ok: true, user: next });
  } catch (err) {
    if (err instanceof PhoneTakenError) {
      return noStoreJson(
        { code: 'PHONE_TAKEN', message: 'phone already bound to another account' },
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
