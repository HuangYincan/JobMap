import { NextResponse } from 'next/server';
import {
  DbUnavailableError,
  issueOtp,
  OtpRateLimitedError,
  OtpTooManyAttemptsError,
} from '@/lib/account-store';
import {
  EmailAuthError,
  EmailConfigError,
  EmailRateLimitedError,
  EmailSendFailedError,
  sendVerificationEmail,
} from '@/lib/resend-client';
import {
  SmsAuthError,
  SmsConfigError,
  SmsDayLimitedError,
  SmsRateLimitedError,
  SmsSendFailedError,
  sendSmsVerifyCode,
} from '@/lib/aliyun-sms-client';

/**
 * email:经 Resend 真发(需 RESEND_API_KEY;未配置 → 503 EMAIL_NOT_CONFIGURED)。
 * phone:经阿里云短信认证服务真发(需 ALIYUN_* 四件套;未配置 → 503 SMS_NOT_CONFIGURED)。
 *
 * 限流:同 target 60s 冷却 + 24h 上限(issueOtp 内守卫);写路径 DB 故障 → 503,不静默降级。
 * 秘密纪律:绝不打印/返回验证码、key 或 Resend/阿里云原始错误。
 */
export async function POST(request: Request) {
  let body: { provider?: 'phone' | 'email'; target?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'invalid JSON' }, { status: 400 });
  }

  const provider = body.provider === 'email' ? 'email' : 'phone';
  const target = (body.target || '').trim();
  if (!target) {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'target required' }, { status: 400 });
  }
  if (provider === 'phone' && !/^\+?\d{6,15}$/.test(target.replace(/[\s-]/g, ''))) {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'invalid phone' }, { status: 400 });
  }
  if (provider === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'invalid email' }, { status: 400 });
  }

  try {
    if (provider === 'email') {
      // 先 issueOtp:守卫先行,配额(60s 冷却/24h 上限)不因发送失败被绕过。
      const { expiresAt, code } = await issueOtp(provider, target);
      const { messageId } = await sendVerificationEmail({ to: target, code, expiresAt });
      return NextResponse.json({ ok: true, provider, expiresAt, messageId });
    }
    // phone:先 issueOtp 守卫先行保配额,再经阿里云短信认证服务真发。
    const { expiresAt, code } = await issueOtp(provider, target);
    const { requestId } = await sendSmsVerifyCode({ phoneNumber: target, code });
    return NextResponse.json({ ok: true, provider, expiresAt, requestId });
  } catch (err) {
    if (err instanceof OtpRateLimitedError || err instanceof OtpTooManyAttemptsError) {
      return NextResponse.json(
        {
          code: err instanceof OtpTooManyAttemptsError ? 'TOO_MANY_ATTEMPTS' : 'RATE_LIMITED',
          message: err.message,
          retryAfterMs: err.retryAfterMs,
        },
        { status: 429 },
      );
    }
    if (err instanceof DbUnavailableError) {
      return NextResponse.json(
        { code: 'DB_UNAVAILABLE', message: 'database unavailable, try again later' },
        { status: 503 },
      );
    }
    if (err instanceof EmailConfigError) {
      return NextResponse.json(
        { code: 'EMAIL_NOT_CONFIGURED', message: '验证码服务暂不可用,请稍后再试' },
        { status: 503 },
      );
    }
    if (err instanceof EmailRateLimitedError) {
      return NextResponse.json(
        { code: 'EMAIL_RATE_LIMITED', message: '发送太频繁,请稍后再试' },
        { status: 429 },
      );
    }
    if (err instanceof EmailAuthError) {
      return NextResponse.json(
        { code: 'EMAIL_PROVIDER_ERROR', message: '验证码服务暂不可用,请稍后再试' },
        { status: 503 },
      );
    }
    if (err instanceof EmailSendFailedError) {
      return NextResponse.json(
        { code: 'EMAIL_SEND_FAILED', message: '验证码发送失败,请稍后再试' },
        { status: 500 },
      );
    }
    if (err instanceof SmsConfigError) {
      return NextResponse.json(
        { code: 'SMS_NOT_CONFIGURED', message: '验证码服务暂不可用,请稍后再试' },
        { status: 503 },
      );
    }
    if (err instanceof SmsRateLimitedError) {
      return NextResponse.json(
        { code: 'SMS_RATE_LIMITED', message: '发送太频繁,请稍后再试' },
        { status: 429 },
      );
    }
    if (err instanceof SmsDayLimitedError) {
      return NextResponse.json(
        { code: 'SMS_DAY_LIMITED', message: '今日发送次数已达上限,请稍后再试' },
        { status: 429 },
      );
    }
    if (err instanceof SmsAuthError) {
      return NextResponse.json(
        { code: 'SMS_PROVIDER_ERROR', message: '验证码服务暂不可用,请稍后再试' },
        { status: 503 },
      );
    }
    if (err instanceof SmsSendFailedError) {
      return NextResponse.json(
        { code: 'SMS_SEND_FAILED', message: '验证码发送失败,请稍后再试' },
        { status: 500 },
      );
    }
    throw err;
  }
}
