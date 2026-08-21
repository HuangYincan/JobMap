// ============================================================
// 阿里云短信认证服务客户端(手机 OTP 验证码发送)
//
// 手写阿里云 RPC 签名(HMAC-SHA1 + RFC3986 percent-encode),
// 零 SDK 依赖(与 resend-client.ts 同款模式)。
// 重试策略(用户拍板):网络错误(fetch 抛异常)→ 等 retryDelayMs
// (默认 500ms)→ 重试 1 次;HTTP 非 200 / 业务错误不重试。最多 2 次请求。
// 密钥纪律:ALIYUN_ACCESS_KEY_SECRET 只参与 HMAC 计算,绝不打印、
// 绝不进日志(query 中仅 AccessKeyId,签名本身不含 secret 明文);
// 验证码绝不打印。成功只记 requestId。
// ============================================================

import { createHmac, randomUUID } from 'node:crypto';

/** 阿里云短信配置(server/.env.local,服务端秘密)。trim 后任一缺失 → undefined。 */
export function aliyunSmsConfig(): {
  accessKeyId: string;
  accessKeySecret: string;
  signName: string;
  templateCode: string;
} | undefined {
  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID?.trim();
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET?.trim();
  const signName = process.env.ALIYUN_SMS_SIGN_NAME?.trim();
  const templateCode = process.env.ALIYUN_SMS_TEMPLATE_CODE?.trim();
  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) return undefined;
  return { accessKeyId, accessKeySecret, signName, templateCode };
}

// ---- 错误类型(route 层映射 HTTP 状态,仓库 instanceof 映射惯例) ----

/** 缺 ALIYUN_* 配置:route 层转 503 SMS_NOT_CONFIGURED。 */
export class SmsConfigError extends Error {
  constructor(message = 'aliyun sms not configured') {
    super(message);
    this.name = 'SmsConfigError';
  }
}

/** 阿里云 FREQUENCY_FAIL(发送频控):route 层转 429 SMS_RATE_LIMITED。 */
export class SmsRateLimitedError extends Error {
  constructor(message = 'aliyun sms frequency limited') {
    super(message);
    this.name = 'SmsRateLimitedError';
  }
}

/** 阿里云 BUSINESS_LIMIT_CONTROL(号码天级流控):route 层转 429 SMS_DAY_LIMITED。 */
export class SmsDayLimitedError extends Error {
  constructor(message = 'aliyun sms day limited') {
    super(message);
    this.name = 'SmsDayLimitedError';
  }
}

/** AccessKey 无效 / 签名不匹配 / Forbidden:route 层转 503 SMS_PROVIDER_ERROR。 */
export class SmsAuthError extends Error {
  constructor(message = 'aliyun sms auth failed') {
    super(message);
    this.name = 'SmsAuthError';
  }
}

/** 其余业务错误 / 网络 / HTTP 异常:route 层转 500 SMS_SEND_FAILED。 */
export class SmsSendFailedError extends Error {
  constructor(message = 'aliyun sms send failed') {
    super(message);
    this.name = 'SmsSendFailedError';
  }
}

export interface SendSmsVerifyCodeOptions {
  /** Fetch 实现(默认全局 fetch;测试注入)。 */
  fetchImpl?: typeof fetch;
  /** 当前时间(默认 new Date();测试注入固定时刻保证签名确定性)。 */
  now?: () => Date;
  /** 签名随机串(默认 randomUUID;测试注入固定值保证签名确定性)。 */
  signatureNonce?: string;
  /** 网络错误重试前的等待毫秒数(默认 500;测试传 0)。 */
  retryDelayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 网络错误的安全描述(不携带 key/验证码等敏感字段)。 */
function describeNetworkError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/** RFC3986 严格百分号编码(encodeURIComponent 不转义 !'()*,这里补齐)。 */
function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/** 鉴权类错误码前缀/包含标记(阿里云返回这些时按 key 失效处理)。 */
const AUTH_CODE_MARKERS = ['InvalidAccessKeyId', 'SignatureDoesNotMatch', 'AuthFailure', 'Forbidden'];

/** body.Code → 业务错误;未知一律 SmsSendFailedError;鉴权类额外 console.warn。 */
function mapBizError(code: string): SmsConfigError | SmsRateLimitedError | SmsDayLimitedError | SmsAuthError | SmsSendFailedError {
  if (code === 'FREQUENCY_FAIL') return new SmsRateLimitedError();
  if (code === 'BUSINESS_LIMIT_CONTROL') return new SmsDayLimitedError();
  if (AUTH_CODE_MARKERS.some((marker) => code.startsWith(marker) || code.includes(marker))) {
    console.warn('aliyun sms auth failed, check/rotate ALIYUN_ACCESS_KEY_ID/SECRET');
    return new SmsAuthError();
  }
  return new SmsSendFailedError();
}

/** requestId 取自 body.RequestId ?? body.Model?.RequestId ?? ''(绝不回退打印其他字段)。 */
function requestIdFromBody(body: Record<string, unknown>): string {
  if (typeof body.RequestId === 'string') return body.RequestId;
  const model = body.Model;
  if (model && typeof model === 'object' && typeof (model as { RequestId?: unknown }).RequestId === 'string') {
    return (model as { RequestId: string }).RequestId;
  }
  return '';
}

/**
 * 构造签名 URL(阿里云 RPC 签名,GET 直传值模式):
 * 1. 参数表(含业务参数与签名公共参数)
 * 2. key 按字典序升序,拼 percentEncode(key)=percentEncode(value) 以 & 连接
 * 3. StringToSign = 'GET&%2F&' + percentEncode(canonicalizedQuery)
 * 4. Signature = base64(HMAC-SHA1(secret + '&', StringToSign))
 * 5. 最终 URL = 端点 + canonicalizedQuery + '&Signature=' + percentEncode(Signature)
 */
function buildSignedUrl(
  cfg: { accessKeyId: string; accessKeySecret: string; signName: string; templateCode: string },
  input: { phoneNumber: string; code: string },
  now: Date,
  signatureNonce: string,
): string {
  const params: Record<string, string> = {
    AccessKeyId: cfg.accessKeyId,
    Action: 'SendSmsVerifyCode',
    Format: 'JSON',
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: signatureNonce,
    Timestamp: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25',
    PhoneNumber: input.phoneNumber,
    SignName: cfg.signName,
    TemplateCode: cfg.templateCode,
    // 直接传值模式:验证码由服务端生成,模板参数 {"code": "123456"}。
    TemplateParam: JSON.stringify({ code: input.code }),
  };
  const canonicalizedQuery = Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&');
  const stringToSign = `GET&%2F&${percentEncode(canonicalizedQuery)}`;
  const signature = createHmac('sha1', `${cfg.accessKeySecret}&`).update(stringToSign).digest('base64');
  return `https://dypnsapi.aliyuncs.com/?${canonicalizedQuery}&Signature=${percentEncode(signature)}`;
}

/**
 * 发送短信验证码(阿里云短信认证服务 SendSmsVerifyCode,dypnsapi 2017-05-25)。
 * - 缺配置 → 直接抛 SmsConfigError(不调 fetch)
 * - 网络错误 → 等 retryDelayMs → 重试 1 次;HTTP 非 200 / 业务错误不重试
 * - Code=OK → console.log 记 requestId,返回 { requestId }
 * - 业务错误码 → 按映射抛错(FREQUENCY_FAIL / BUSINESS_LIMIT_CONTROL / 鉴权类 / 其他)
 * - HTTP 非 200 且 body 无 Code → SmsSendFailedError
 */
export async function sendSmsVerifyCode(
  input: { phoneNumber: string; code: string },
  options: SendSmsVerifyCodeOptions = {},
): Promise<{ requestId: string }> {
  const cfg = aliyunSmsConfig();
  if (!cfg) throw new SmsConfigError();

  const fetchImpl = options.fetchImpl ?? fetch;
  const retryDelayMs = options.retryDelayMs ?? 500;
  const now = options.now ?? (() => new Date());
  const signatureNonce = options.signatureNonce ?? randomUUID();

  const url = buildSignedUrl(cfg, input, now(), signatureNonce);

  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (err) {
    // 网络错误 → 重试 1 次
    await sleep(retryDelayMs);
    try {
      res = await fetchImpl(url);
    } catch (err2) {
      console.log('aliyun sms network error after retry:', describeNetworkError(err2));
      throw new SmsSendFailedError();
    }
  }

  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    console.log(`aliyun sms invalid response body, status=${res.status}`);
    throw new SmsSendFailedError();
  }

  const code = typeof body.Code === 'string' ? body.Code : undefined;
  if (code === 'OK') {
    const requestId = requestIdFromBody(body);
    console.log(`aliyun sms sent, requestId=${requestId}`);
    return { requestId };
  }
  if (code) {
    console.log(`aliyun sms business error, code=${code}`);
    throw mapBizError(code);
  }
  console.log(`aliyun sms send failed, status=${res.status}`);
  throw new SmsSendFailedError();
}
