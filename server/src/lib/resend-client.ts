// ============================================================
// Resend 邮件客户端(邮箱 OTP 验证码发送)
//
// 重试策略(用户拍板):网络错误或 HTTP 429 → 等 retryDelayMs(默认 500ms)
// → 重试 1 次;其余状态码不重试。最多 2 次请求。
// 密钥纪律:key 只在 process.env 引用,绝不打印、绝不入库;
// 验证码绝不打印。成功只记 messageId。
// ============================================================

import {
  EMAIL_FROM,
  EMAIL_SUBJECT,
  buildVerificationEmailHtml,
  buildVerificationEmailText,
} from './verification-email.ts';

/** RESEND_API_KEY(server/.env.local,服务端秘密)。trim 后非空即视为已配置。 */
export function resendApiKey(): string | undefined {
  const key = process.env.RESEND_API_KEY?.trim();
  return key || undefined;
}

// ---- 错误类型(route 层映射 HTTP 状态,仓库 instanceof 映射惯例) ----

/** 缺 RESEND_API_KEY:route 层转 503 EMAIL_NOT_CONFIGURED。 */
export class EmailConfigError extends Error {
  constructor(message = 'resend not configured') {
    super(message);
    this.name = 'EmailConfigError';
  }
}

/** Resend 429(重试后仍限流):route 层转 429 EMAIL_RATE_LIMITED。 */
export class EmailRateLimitedError extends Error {
  constructor(message = 'resend rate limited') {
    super(message);
    this.name = 'EmailRateLimitedError';
  }
}

/** Resend 401/403(key 失效/过期):route 层转 503 EMAIL_PROVIDER_ERROR。 */
export class EmailAuthError extends Error {
  constructor(message = 'resend auth failed') {
    super(message);
    this.name = 'EmailAuthError';
  }
}

/** 422 / 网络错误 / 其他失败:route 层转 500 EMAIL_SEND_FAILED。 */
export class EmailSendFailedError extends Error {
  constructor(message = 'resend send failed') {
    super(message);
    this.name = 'EmailSendFailedError';
  }
}

export interface SendVerificationEmailOptions {
  /** Fetch 实现(默认全局 fetch;测试注入)。 */
  fetchImpl?: typeof fetch;
  /** 网络错误/429 重试前的等待毫秒数(默认 500)。 */
  retryDelayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 网络错误的安全描述(不携带 key/验证码等敏感字段)。 */
function describeNetworkError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

async function parseMessageId(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { id?: unknown };
    return typeof body.id === 'string' ? body.id : '';
  } catch {
    return '';
  }
}

/**
 * 发送验证码邮件。
 * - 缺 key → 直接抛 EmailConfigError(不调 fetch)
 * - 网络错误或 429 → 等 retryDelayMs → 重试 1 次;其余状态码不重试
 * - 成功 → console.log 记 messageId,返回 { messageId }
 * - 401/403 → console.warn 提示轮换 key → EmailAuthError
 * - 429(重试后仍限流)→ EmailRateLimitedError
 * - 422 → EmailSendFailedError
 * - 网络/其他 → EmailSendFailedError
 */
export async function sendVerificationEmail(
  input: { to: string; code: string; expiresAt: number },
  options: SendVerificationEmailOptions = {},
): Promise<{ messageId: string }> {
  const key = resendApiKey();
  if (!key) throw new EmailConfigError();

  const fetchImpl = options.fetchImpl ?? fetch;
  const retryDelayMs = options.retryDelayMs ?? 500;

  const attempt = async (): Promise<Response> => {
    return fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: input.to,
        subject: EMAIL_SUBJECT,
        html: buildVerificationEmailHtml(input.code, input.expiresAt),
        text: buildVerificationEmailText(input.code, input.expiresAt),
      }),
    });
  };

  let res: Response;
  try {
    res = await attempt();
  } catch (err) {
    // 网络错误 → 重试 1 次
    await sleep(retryDelayMs);
    try {
      res = await attempt();
    } catch (err2) {
      console.log('resend network error after retry:', describeNetworkError(err2));
      throw new EmailSendFailedError();
    }
  }

  if (res.status === 429) {
    // 限流 → 重试 1 次
    await sleep(retryDelayMs);
    try {
      res = await attempt();
    } catch (err) {
      console.log('resend rate limited, status=429 (retry network error):', describeNetworkError(err));
      throw new EmailRateLimitedError();
    }
  }

  if (res.status === 200) {
    const messageId = await parseMessageId(res);
    console.log(`resend email sent, messageId=${messageId}`);
    return { messageId };
  }
  if (res.status === 429) {
    // 重试后仍 429 → 限流
    console.log('resend rate limited, status=429');
    throw new EmailRateLimitedError();
  }
  if (res.status === 401 || res.status === 403) {
    console.warn('resend key invalid/expired, rotate RESEND_API_KEY');
    throw new EmailAuthError();
  }
  if (res.status === 422) {
    console.log('resend rejected request payload, status=422');
    throw new EmailSendFailedError();
  }
  console.log(`resend send failed, status=${res.status}`);
  throw new EmailSendFailedError();
}
