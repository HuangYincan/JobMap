import { NextResponse } from 'next/server';
import { RequestBodyTooLargeError, readJsonBody } from '@/lib/request-body';
import {
  consumeOtp,
  createSession,
  DbUnavailableError,
  OtpTooManyAttemptsError,
  upsertIdentity,
} from '@/lib/account-store';
import { writeSessionCookie } from '@/lib/http-session';
import { isValidEmail, isValidPhone, normalizeContact } from '@/lib/contact-validation';

/**
 * 验证:15min 窗口错误尝试 ≥5 次 → 锁 15min(consumeOtp 内守卫,→ 429 TOO_MANY_ATTEMPTS);
 * 写路径 DB 故障 → 503,不静默降级。
 */
export async function POST(request: Request) {
  let body: { provider?: 'phone' | 'email'; target?: string; code?: string };
  try {
    body = await readJsonBody<typeof body>(request);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { code: 'BODY_TOO_LARGE', message: 'request body too large' },
        { status: 400 },
      );
    }
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'invalid JSON' }, { status: 400 });
  }

  const provider = body.provider === 'email' ? 'email' : 'phone';
  const inputTarget = (body.target || '').trim();
  const code = (body.code || '').trim();
  if (
    !inputTarget ||
    !code ||
    (provider === 'email' && !isValidEmail(inputTarget)) ||
    (provider === 'phone' && !isValidPhone(inputTarget)) ||
    !/^\d{6}$/.test(code)
  ) {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'invalid provider target or code' }, { status: 400 });
  }
  const target = normalizeContact(provider, inputTarget);

  try {
    if (!(await consumeOtp(provider, target, code))) {
      return NextResponse.json({ code: 'INVALID_CODE', message: 'invalid or expired code' }, { status: 401 });
    }

    const user = await upsertIdentity({
      provider,
      subject: target,
      phone: provider === 'phone' ? target : undefined,
      email: provider === 'email' ? target : undefined,
    });
    const session = await createSession(user.id);
    await writeSessionCookie(session.token, session.expiresAt);
    return NextResponse.json({ user });
  } catch (err) {
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
