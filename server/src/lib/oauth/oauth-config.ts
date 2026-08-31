// ============================================================
// OAuth 2.0 provider 注册表(纯函数,零网络)
//
// env 读取 + configured 判定 + authorize URL 构造 + 三方端点表。
// configured = 该 provider 的 client id 与 secret 均非空(trim 后)。
// 本模块只负责「配置与 URL」;code→token→userinfo 见 oauth-exchange.ts,
// 完整流程编排见 oauth-flow.ts。
// 密钥绝不打印、绝不进日志、绝不进响应(listOAuthProviders 只出 id+configured)。
// ============================================================

export const OAUTH_PROVIDER_IDS = ['github', 'google', 'wechat'] as const;
export type OAuthProviderId = (typeof OAUTH_PROVIDER_IDS)[number];

export interface OAuthProviderConfig {
  id: OAuthProviderId;
  clientId: string;
  clientSecret: string;
  /** client id + secret 均已在 env(trim 后非空) */
  configured: boolean;
  tokenEndpoint: string;
  /** GitHub only: endpoint that supplies verified primary-email evidence. */
  emailEndpoint?: string;
  userinfoEndpoint: string;
}

const PROVIDER_ENV_KEYS: Record<OAuthProviderId, { clientId: string; clientSecret: string }> = {
  github: { clientId: 'GITHUB_OAUTH_CLIENT_ID', clientSecret: 'GITHUB_OAUTH_CLIENT_SECRET' },
  google: { clientId: 'GOOGLE_OAUTH_CLIENT_ID', clientSecret: 'GOOGLE_OAUTH_CLIENT_SECRET' },
  wechat: { clientId: 'WECHAT_OAUTH_APP_ID', clientSecret: 'WECHAT_OAUTH_SECRET' },
};

const TOKEN_ENDPOINTS: Record<OAuthProviderId, string> = {
  github: 'https://github.com/login/oauth/access_token',
  google: 'https://oauth2.googleapis.com/token',
  wechat: 'https://api.weixin.qq.com/sns/oauth2/access_token',
};

const USERINFO_ENDPOINTS: Record<OAuthProviderId, string> = {
  github: 'https://api.github.com/user',
  google: 'https://openidconnect.googleapis.com/v1/userinfo',
  wechat: 'https://api.weixin.qq.com/sns/userinfo',
};

const EMAIL_ENDPOINTS: Partial<Record<OAuthProviderId, string>> = {
  github: 'https://api.github.com/user/emails',
};

export function isOAuthProviderId(value: string | null | undefined): value is OAuthProviderId {
  return value !== null && value !== undefined && (OAUTH_PROVIDER_IDS as readonly string[]).includes(value);
}

/** 读取某 provider 的 env 凭据(trim 后;缺 → '')。绝不打印返回值。 */
export function readProviderEnv(
  id: OAuthProviderId,
  env: NodeJS.ProcessEnv = process.env,
): { clientId: string; clientSecret: string } {
  const keys = PROVIDER_ENV_KEYS[id];
  return {
    clientId: (env[keys.clientId] ?? '').trim(),
    clientSecret: (env[keys.clientSecret] ?? '').trim(),
  };
}

export function getOAuthProviderConfig(
  id: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): OAuthProviderConfig | null {
  if (!isOAuthProviderId(id)) return null;
  const { clientId, clientSecret } = readProviderEnv(id, env);
  return {
    id,
    clientId,
    clientSecret,
    configured: clientId !== '' && clientSecret !== '',
    tokenEndpoint: TOKEN_ENDPOINTS[id],
    userinfoEndpoint: USERINFO_ENDPOINTS[id],
    emailEndpoint: EMAIL_ENDPOINTS[id],
  };
}

/** 公开端点 GET /api/auth/oauth/providers:固定顺序 github/google/wechat,零敏感信息。 */
export function listOAuthProviders(
  env: NodeJS.ProcessEnv = process.env,
): Array<{ id: OAuthProviderId; configured: boolean }> {
  const out: Array<{ id: OAuthProviderId; configured: boolean }> = [];
  for (const id of OAUTH_PROVIDER_IDS) {
    const cfg = getOAuthProviderConfig(id, env);
    if (cfg) out.push({ id, configured: cfg.configured });
  }
  return out;
}

/** 各 provider 的 authorize URL(与三方注册的 redirect_uri 配套使用)。 */
export function buildAuthorizeUrl(
  id: OAuthProviderId,
  input: { clientId: string; redirectUri: string; state: string },
): string {
  switch (id) {
    case 'github':
      return `https://github.com/login/oauth/authorize?${new URLSearchParams({
        client_id: input.clientId,
        redirect_uri: input.redirectUri,
        state: input.state,
        scope: 'read:user user:email',
      })}`;
    case 'google':
      return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: input.clientId,
        redirect_uri: input.redirectUri,
        state: input.state,
        response_type: 'code',
        scope: 'openid email profile',
      })}`;
    case 'wechat':
      return `https://open.weixin.qq.com/connect/qrconnect?${new URLSearchParams({
        appid: input.clientId,
        redirect_uri: input.redirectUri,
        state: input.state,
        response_type: 'code',
        scope: 'snsapi_login',
        lang: 'zh_CN',
      })}#wechat_redirect`;
  }
}
