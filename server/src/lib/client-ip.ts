// 客户端 IP / 限流桶键共享解析(quality-scan r2 #1,2026-08-23)。
//
// 三路由(agent/chat、auth/otp/send、auth/password/login)统一代理信任语义:
// x-forwarded-for 由网络代理注入;客户端直连 Next 时可任意伪造并轮换该头,仅凭
// 首段取 IP 会让 per-IP 限流桶被绕过(LLM 费用 / OTP 短信 / 登录爆破三处滥用面)。
// 因此仅当部署在可信反代之后(配置 TRUSTED_PROXY_IPS,逗号分隔的代理出站地址)
// 才信任转发头;未配置时完全忽略转发头,桶键改用会话指纹(登录用户按会话 cookie
// 哈希;匿名无 cookie 归入固定桶)——伪造 XFF 不再换桶。
//
// 本模块保持零 Next.js 依赖(node:crypto + 标准 Request),node:test 可直接 import;
// 会话 cookie 的读取(Next 请求上下文,见 lib/http-session readSessionToken)由
// 调用方完成并注入,本模块只做纯函数解析。

import { createHash } from 'node:crypto';

/** 可信反代出站地址白名单(逗号分隔;空 = 未配置,不信任任何转发头)。 */
export const TRUSTED_PROXY_IPS: string[] = (process.env.TRUSTED_PROXY_IPS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * 可信反代之后 → 转发头首段(代理注入,客户端不可控):x-forwarded-for 首段 →
 * x-real-ip → 'unknown'。未配置 TRUSTED_PROXY_IPS → 一律 null(调用方必须改用
 * 会话指纹桶键,不得回退直取请求头——XFF 可伪造,直取等于可换桶)。
 */
export function resolveClientIp(request: Request): string | null {
  if (TRUSTED_PROXY_IPS.length === 0) return null;
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0].trim();
    if (first) return first;
  }
  const real = request.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}

/**
 * 会话指纹桶键:登录用户(有会话 cookie)→ `session:<sha256(token)>`;
 * 匿名(无 cookie)→ 固定桶 `anon:public`。未配置可信代理时,桶键唯一来源。
 */
export function sessionFingerprintKey(token: string | null): string {
  if (!token) return 'anon:public';
  return `session:${createHash('sha256').update(token).digest('hex')}`;
}

/**
 * per-IP 维度桶键(三路由统一):可信反代之后 → `ip:<IP>`;否则 → 会话指纹。
 * token 由调用方从会话 cookie 读取(读 cookie 属 Next 请求上下文,调用方注入,
 * 本模块保持可单测)。
 */
export function clientIpBucketKey(request: Request, token: string | null): string {
  const ip = resolveClientIp(request);
  if (ip !== null) return `ip:${ip}`;
  return sessionFingerprintKey(token);
}
