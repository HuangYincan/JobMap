import { NextResponse } from 'next/server';
import { readSessionUser } from '@/lib/http-session';
import {
  consumeOtp,
  DbUnavailableError,
  OtpTooManyAttemptsError,
  setPassword,
  verifyUserPassword,
} from '@/lib/account-store';
import { isValidPassword } from '@/lib/password';

/**
 * 设置/修改密码。
 *
 * 身份验证二选一(后端按当前状态判定,不猜前端):
 * - 已有密码:必填 oldPassword(401 WRONG_PASSWORD);亦可传 otp 替代(不再要求 oldPassword)
 * - 无密码:必填 otp;provider 必须为 email|phone,target 必须等于该用户已绑定凭证
 *   (401 NOT_BOUND),code 校验失败 401 INVALID_CODE
 * newPassword ≥8 位(400 PASSWORD_TOO_SHORT)。成功 200 { ok:true, user }(hasPassword:true)。
 * 错误处理参照 otp/verify:429 TOO_MANY_ATTEMPTS / 503 DB_UNAVAILABLE,不泄漏内部错误。
 */
export async function POST(request: Request) {
  const user = await readSessionUser();
  if (!user) {
    return NextResponse.json({ code: 'UNAUTHORIZED', message: 'not signed in' }, { status: 401 });
  }

  let body: { oldPassword?: unknown; otp?: unknown; newPassword?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'invalid JSON' }, { status: 400 });
  }

  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (!isValidPassword(newPassword)) {
    return NextResponse.json(
      { code: 'PASSWORD_TOO_SHORT', message: 'password must be at least 8 characters' },
      { status: 400 },
    );
  }

  try {
    if (body.otp !== undefined && body.otp !== null) {
      // OTP 身份验证(有密码用户亦可选):target 必须命中已绑定凭证
      const otp = parseOtp(body.otp);
      if (!otp) {
        return NextResponse.json(
          { code: 'BAD_REQUEST', message: 'otp must be { provider, target, code }' },
          { status: 400 },
        );
      }
      const bound = otp.provider === 'email' ? user.email : user.phone;
      if (!bound || bound.toLowerCase() !== otp.target.toLowerCase()) {
        return NextResponse.json(
          { code: 'NOT_BOUND', message: 'otp target does not match a bound credential' },
          { status: 401 },
        );
      }
      if (!(await consumeOtp(otp.provider, otp.target, otp.code))) {
        return NextResponse.json(
          { code: 'INVALID_CODE', message: 'invalid or expired code' },
          { status: 401 },
        );
      }
    } else if (user.hasPassword) {
      // 已有密码:必填 oldPassword
      const oldPassword = typeof body.oldPassword === 'string' ? body.oldPassword : '';
      if (!oldPassword) {
        return NextResponse.json(
          { code: 'BAD_REQUEST', message: 'oldPassword required' },
          { status: 400 },
        );
      }
      if (!(await verifyUserPassword(user.id, oldPassword))) {
        return NextResponse.json(
          { code: 'WRONG_PASSWORD', message: 'current password is incorrect' },
          { status: 401 },
        );
      }
    } else {
      // 无密码账号:OTP 是唯一身份验证途径
      return NextResponse.json(
        { code: 'BAD_REQUEST', message: 'otp required to set a password' },
        { status: 400 },
      );
    }

    const next = await setPassword(user.id, newPassword);
    return NextResponse.json({ ok: true, user: next });
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

function parseOtp(
  raw: unknown,
): { provider: 'email' | 'phone'; target: string; code: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.provider !== 'email' && o.provider !== 'phone') return null;
  if (typeof o.target !== 'string' || !o.target.trim()) return null;
  if (typeof o.code !== 'string' || !o.code.trim()) return null;
  return { provider: o.provider, target: o.target.trim(), code: o.code.trim() };
}
