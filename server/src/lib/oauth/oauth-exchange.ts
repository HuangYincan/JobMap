// ============================================================
// OAuth code→token→userinfo 交换(server-side fetch,零依赖手写客户端)
//
// 照 resend-client 先例:fetch 可注入(__oauthExchangeTest.fetchImpl 或
// 调用参数),单测零网络。失败统一抛 OauthExchangeError:
//   - HTTP 非 2xx
//   - JSON 含 error(非空)/ errcode(非 0)
//   - 必要字段缺失(token 缺 access_token / userinfo 缺 subject)
// 密钥只出现在请求参数里,绝不打印、绝不进错误消息。
// ============================================================

import type { OAuthProviderConfig, OAuthProviderId } from './oauth-config.ts';

/** code 交换 / userinfo 失败:flow 层包成 OauthProviderError(带 next)转 302。 */
export class OauthExchangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OauthExchangeError';
  }
}

export interface OAuthUserInfo {
  provider: OAuthProviderId;
  subject: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** 测试钩子(仅测试):注入假 fetch 覆盖 token/userinfo 两跳,生产零网络。 */
export const __oauthExchangeTest = {
  fetchImpl: undefined as FetchLike | undefined,
};

function resolveFetch(explicit?: FetchLike): FetchLike {
  if (explicit) return explicit;
  if (__oauthExchangeTest.fetchImpl) return __oauthExchangeTest.fetchImpl;
  return (url, init) => globalThis.fetch(url, init);
}

/** 请求 + JSON 解析 + HTTP 状态判定;2xx 也返回 body(错误码可能藏在 200 里)。 */
async function fetchJson(url: string, init: RequestInit, fetchImpl: FetchLike): Promise<unknown> {
  const res = await fetchImpl(url, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    throw new OauthExchangeError(`oauth request failed: HTTP ${res.status}`);
  }
  return body;
}

/** 判定 JSON 层错误:error 非空 / errcode 非 0 → 抛;否则返回普通对象。 */
function requireNoError(body: unknown, kind: string): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new OauthExchangeError(`${kind}: invalid response`);
  }
  const rec = body as Record<string, unknown>;
  if (rec.error !== undefined && rec.error !== null && rec.error !== '') {
    throw new OauthExchangeError(`${kind}: ${String(rec.error)}`);
  }
  if (rec.errcode !== undefined && Number(rec.errcode) !== 0) {
    throw new OauthExchangeError(`${kind}: errcode ${String(rec.errcode)}`);
  }
  return rec;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/**
 * code → access token → userinfo,映射为统一身份形状(供 upsertIdentity)。
 * redirectUri 必须与三方注册的回调一致。
 */
export async function exchangeCodeForUserinfo(
  cfg: OAuthProviderConfig,
  code: string,
  input: { redirectUri: string; fetchImpl?: FetchLike },
): Promise<OAuthUserInfo> {
  const fetchImpl = resolveFetch(input.fetchImpl);
  switch (cfg.id) {
    case 'github': {
      const tokenBody = await fetchJson(
        cfg.tokenEndpoint,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: cfg.clientId,
            client_secret: cfg.clientSecret,
            code,
            redirect_uri: input.redirectUri,
          }),
        },
        fetchImpl,
      );
      const token = requireNoError(tokenBody, 'github token');
      const accessToken = nonEmptyString(token.access_token);
      if (!accessToken) throw new OauthExchangeError('github token: missing access_token');
      const infoBody = await fetchJson(
        cfg.userinfoEndpoint,
        { headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'domain-map' } },
        fetchImpl,
      );
      const info = requireNoError(infoBody, 'github userinfo');
      if (info.id === undefined || info.id === null) {
        throw new OauthExchangeError('github userinfo: missing id');
      }
      return {
        provider: 'github',
        subject: String(info.id),
        email: nonEmptyString(info.email),
        displayName: nonEmptyString(info.name) ?? nonEmptyString(info.login),
        avatarUrl: nonEmptyString(info.avatar_url),
      };
    }
    case 'google': {
      const tokenBody = await fetchJson(
        cfg.tokenEndpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: cfg.clientId,
            client_secret: cfg.clientSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: input.redirectUri,
          }),
        },
        fetchImpl,
      );
      const token = requireNoError(tokenBody, 'google token');
      const accessToken = nonEmptyString(token.access_token);
      if (!accessToken) throw new OauthExchangeError('google token: missing access_token');
      const infoBody = await fetchJson(
        cfg.userinfoEndpoint,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        fetchImpl,
      );
      const info = requireNoError(infoBody, 'google userinfo');
      if (typeof info.sub !== 'string' || !info.sub) {
        throw new OauthExchangeError('google userinfo: missing sub');
      }
      return {
        provider: 'google',
        subject: info.sub,
        email: nonEmptyString(info.email),
        displayName: nonEmptyString(info.name),
        avatarUrl: nonEmptyString(info.picture),
      };
    }
    case 'wechat': {
      // 微信 token 交换是 GET(参数走 query),与 github/google 的 POST 不同。
      const tokenUrl = `${cfg.tokenEndpoint}?${new URLSearchParams({
        appid: cfg.clientId,
        secret: cfg.clientSecret,
        code,
        grant_type: 'authorization_code',
      })}`;
      const tokenBody = await fetchJson(tokenUrl, { method: 'GET' }, fetchImpl);
      const token = requireNoError(tokenBody, 'wechat token');
      const openid = nonEmptyString(token.openid);
      const accessToken = nonEmptyString(token.access_token);
      if (!openid || !accessToken) {
        throw new OauthExchangeError('wechat token: missing openid/access_token');
      }
      const infoUrl = `${cfg.userinfoEndpoint}?${new URLSearchParams({
        access_token: accessToken,
        openid,
        lang: 'zh_CN',
      })}`;
      const infoBody = await fetchJson(infoUrl, { method: 'GET' }, fetchImpl);
      const info = requireNoError(infoBody, 'wechat userinfo');
      return {
        provider: 'wechat',
        subject: openid,
        email: undefined, // 微信无邮箱,不报错
        displayName: nonEmptyString(info.nickname),
        avatarUrl: nonEmptyString(info.headimgurl),
      };
    }
  }
}
