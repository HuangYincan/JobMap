import { NextResponse } from 'next/server';
import {
  consumeOtp,
  createSession,
  DbUnavailableError,
  OtpTooManyAttemptsError,
  upsertIdentity,
} from '@/lib/account-store';
import { writeSessionCookie } from '@/lib/http-session';

/**
 * 验证:15min 窗口错误尝试 ≥5 次 → 锁 15min(consumeOtp 内守卫,→ 429 TOO_MANY_ATTEMPTS);
 * 写路径 DB 故障 → 503,不静默降级。
 */
export async function POST(request: Request) {
  let body: { provider?: 'phone' | 'email'; target?: string; code?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'invalid JSON' }, { status: 400 });
  }

  const provider = body.provider === 'email' ? 'email' : 'phone';
  const target = (body.target || '').trim();
  const code = (body.code || '').trim();
  if (!target || !code) {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'target and code required' }, { status: 400 });
  }

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
