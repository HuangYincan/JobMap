// 客户端 IP / 限流桶键共享解析。
//
// Request headers are attacker-controlled. A non-empty TRUSTED_PROXY_IPS is
// only a configuration allowlist; it cannot prove which peer opened this
// request. Forwarded headers are therefore ignored unless the caller supplies
// a separately verified peer address from the hosting/runtime seam. Next.js
// Request does not expose that peer, so the three public routes deliberately
// use the session-fingerprint fallback today.

import { createHash } from 'node:crypto';

/** 可信反代出站地址白名单(逗号分隔;不等于已验证 peer)。 */
export const TRUSTED_PROXY_IPS: string[] = (process.env.TRUSTED_PROXY_IPS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Only a runtime-provided peer address can activate forwarded-header trust. */
export function isTrustedProxyPeer(peerAddress: string | null | undefined): boolean {
  const peer = peerAddress?.trim();
  return Boolean(peer && TRUSTED_PROXY_IPS.includes(peer));
}

/**
 * Read forwarded client headers only after the caller has supplied a verified
 * peer address. Never derive that peer address from another request header.
 */
export function resolveClientIp(
  request: Request,
  verifiedPeerAddress: string | null = null,
): string | null {
  if (!isTrustedProxyPeer(verifiedPeerAddress)) return null;
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
 * 匿名(无 cookie)→固定桶 `anon:public`。
 */
export function sessionFingerprintKey(token: string | null): string {
  if (!token) return 'anon:public';
  return `session:${createHash('sha256').update(token).digest('hex')}`;
}

/**
 * per-IP 维度桶键。Without a verified peer seam, forwarded headers never
 * influence this value, even when TRUSTED_PROXY_IPS is configured.
 */
export function clientIpBucketKey(
  request: Request,
  token: string | null,
  verifiedPeerAddress: string | null = null,
): string {
  const ip = resolveClientIp(request, verifiedPeerAddress);
  if (ip !== null) return `ip:${ip}`;
  return sessionFingerprintKey(token);
}
