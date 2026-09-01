import { NextResponse } from 'next/server';

function noStoreJson(body: unknown, init?: { status?: number; headers?: HeadersInit }) {
  const response = NextResponse.json(body, {
    ...init,
    headers: { 'Cache-Control': 'no-store', ...(init?.headers ?? {}) },
  });
  return response;
}
import { RequestBodyTooLargeError, readJsonObjectBody } from '@/lib/request-body';
import { readSessionToken } from '@/lib/http-session';
import { clientIpBucketKey } from '@/lib/client-ip';
import {
  checkOtpSendLimits,
  DbUnavailableError,
  issueOtp,
  OtpRateLimitedError,
  OtpTooManyAttemptsError,
} from '@/lib/account-store';
import { isValidEmail, isValidPhone, normalizeContact } from '@/lib/contact-validation';
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
 * 限流:同 target 60s 冷却 + 24h 上限(issueOtp 内守卫);发送前再经
 * checkOtpSendLimits 做 per-IP(默认 20/24h)与 per-账号(默认 10/24h)校验,
 * 防轮换 target 绕过限额持续耗配额(scan #2);写路径 DB 故障 → 503,不静默降级。
 * 秘密纪律:绝不打印/返回验证码、key 或 Resend/阿里云原始错误。
 */
export async function POST(request: Request) {
  let body: { provider?: 'phone' | 'email'; target?: string };
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

  if (body.provider !== 'email' && body.provider !== 'phone') {
    return noStoreJson({ code: 'BAD_REQUEST', message: 'invalid provider' }, { status: 400 });
  }
  if (typeof body.target !== 'string') {
    return noStoreJson({ code: 'BAD_REQUEST', message: 'target required' }, { status: 400 });
  }
  const provider = body.provider;
  const inputTarget = body.target.trim();
  const target = (provider === 'phone' && isValidPhone(inputTarget)) ||
      (provider === 'email' && isValidEmail(inputTarget))
    ? normalizeContact(provider, inputTarget)
    : inputTarget;
  if (!target) {
    return noStoreJson({ code: 'BAD_REQUEST', message: 'target required' }, { status: 400 });
  }
  if (provider === 'phone' && !isValidPhone(target)) {
    return noStoreJson({ code: 'BAD_REQUEST', message: 'invalid phone' }, { status: 400 });
  }
  if (provider === 'email' && !isValidEmail(target)) {
    return noStoreJson({ code: 'BAD_REQUEST', message: 'invalid email' }, { status: 400 });
  }

  try {
    // per-IP / per-账号 24h 发送桶先于 issueOtp(与 per-target 守卫同构:计数先于发送)。
    // per-IP 维度与 agent-chat 同语义(scan r2 #1):可信反代后取转发头 IP;未配置
    // TRUSTED_PROXY_IPS 时忽略转发头,登录用户按会话指纹、匿名归固定桶——
    // 伪造/轮换 XFF 不再换桶。per-target / per-账号 守卫保持 account-keyed 不变。
    await checkOtpSendLimits(await clientIpBucketKey(request, await readSessionToken()), provider, target);
    if (provider === 'email') {
      // 先 issueOtp:守卫先行,配额(60s 冷却/24h 上限)不因发送失败被绕过。
      const { expiresAt, code } = await issueOtp(provider, target);
      const { messageId } = await sendVerificationEmail({ to: target, code, expiresAt });
      return noStoreJson({ ok: true, provider, expiresAt, messageId });
    }
    // phone:先 issueOtp 守卫先行保配额,再经阿里云短信认证服务真发。
    const { expiresAt, code } = await issueOtp(provider, target);
    const { requestId } = await sendSmsVerifyCode({ phoneNumber: target, code });
    return noStoreJson({ ok: true, provider, expiresAt, requestId });
  } catch (err) {
    if (err instanceof OtpRateLimitedError || err instanceof OtpTooManyAttemptsError) {
      return noStoreJson(
        {
          code: err instanceof OtpTooManyAttemptsError ? 'TOO_MANY_ATTEMPTS' : 'RATE_LIMITED',
          message: err.message,
          retryAfterMs: err.retryAfterMs,
        },
        { status: 429 },
      );
    }
    if (err instanceof DbUnavailableError) {
      return noStoreJson(
        { code: 'DB_UNAVAILABLE', message: 'database unavailable, try again later' },
        { status: 503 },
      );
    }
    if (err instanceof EmailConfigError) {
      return noStoreJson(
        { code: 'EMAIL_NOT_CONFIGURED', message: '验证码服务暂不可用,请稍后再试' },
        { status: 503 },
      );
    }
    if (err instanceof EmailRateLimitedError) {
      return noStoreJson(
        { code: 'EMAIL_RATE_LIMITED', message: '发送太频繁,请稍后再试' },
        { status: 429 },
      );
    }
    if (err instanceof EmailAuthError) {
      return noStoreJson(
        { code: 'EMAIL_PROVIDER_ERROR', message: '验证码服务暂不可用,请稍后再试' },
        { status: 503 },
      );
    }
    if (err instanceof EmailSendFailedError) {
      return noStoreJson(
        { code: 'EMAIL_SEND_FAILED', message: '验证码发送失败,请稍后再试' },
        { status: 500 },
      );
    }
    if (err instanceof SmsConfigError) {
      return noStoreJson(
        { code: 'SMS_NOT_CONFIGURED', message: '验证码服务暂不可用,请稍后再试' },
        { status: 503 },
      );
    }
    if (err instanceof SmsRateLimitedError) {
      return noStoreJson(
        { code: 'SMS_RATE_LIMITED', message: '发送太频繁,请稍后再试' },
        { status: 429 },
      );
    }
    if (err instanceof SmsDayLimitedError) {
      return noStoreJson(
        { code: 'SMS_DAY_LIMITED', message: '今日发送次数已达上限,请稍后再试' },
        { status: 429 },
      );
    }
    if (err instanceof SmsAuthError) {
      return noStoreJson(
        { code: 'SMS_PROVIDER_ERROR', message: '验证码服务暂不可用,请稍后再试' },
        { status: 503 },
      );
    }
    if (err instanceof SmsSendFailedError) {
      return noStoreJson(
        { code: 'SMS_SEND_FAILED', message: '验证码发送失败,请稍后再试' },
        { status: 500 },
      );
    }
    throw err;
  }
}
