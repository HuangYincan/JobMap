// ============================================================
// OAuth 流程编排(start 重定向 + callback 全链路)
//
// 为什么 flow 在 lib:route.ts 使用 next/server + `@/` 别名,node:test 无法
// import(仓库既有契约),行为逻辑全部下沉到这里,cookie jar 注入式,
// 单测用假 jar 确定性覆盖「302 目标 / cookie 写入与清理 / 不调用三方」。
// route 层只是薄壳:调 flow → jar.set/writeSessionCookie → NextResponse。
// ============================================================

import type { AccountUser } from '../account.ts';
import { createSession, upsertIdentity } from '../account-store.ts';
import {
  buildAuthorizeUrl,
  getOAuthProviderConfig,
  isOAuthProviderId,
} from './oauth-config.ts';
import { OauthExchangeError, exchangeCodeForUserinfo, type FetchLike, type OAuthUserInfo } from './oauth-exchange.ts';
import {
  OAUTH_STATE_COOKIE,
  oauthStateCookieOptions,
  randomOauthState,
  sanitizeNext,
  signOauthState,
  verifyOauthState,
  type OauthStateCookieOptions,
} from './oauth-state.ts';

/** cookie 读写接口:route 传 next/headers 的 jar,测试传假 jar。 */
export interface OauthCookieJar {
  get(name: string): { name: string; value: string } | undefined;
  set(name: string, value: string, options: OauthStateCookieOptions): void;
  delete(name: string): void;
}

/** provider 缺失/非法 → 400 BAD_REQUEST。 */
export class OauthBadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OauthBadRequestError';
  }
}

/** provider 未配置 → 503 OAUTH_NOT_CONFIGURED。 */
export class OauthNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OauthNotConfiguredError';
  }
}

/** state 校验失败 → 302 <next>?auth_error=oauth_state_invalid(next 恒为 '/')。 */
export class OauthStateInvalidError extends Error {
  readonly next = '/';
  constructor(message = 'oauth state invalid') {
    super(message);
    this.name = 'OauthStateInvalidError';
  }
}

/** 三方交换/账号挂接失败 → 302 <next>?auth_error=oauth_provider_error。 */
export class OauthProviderError extends Error {
  readonly next: string;
  constructor(next: string, message: string) {
    super(message);
    this.name = 'OauthProviderError';
    this.next = next;
  }
}

/** next + auth_error 拼成跳转路径(兼容 next 自带 query)。 */
export function errorRedirectPath(next: string, code: string): string {
  const url = new URL(next, 'http://local.invalid');
  url.searchParams.set('auth_error', code);
  return url.pathname + (url.search || '');
}

// ---- start:构造 authorize 302 + oauth_state cookie ----

export interface OauthStartResult {
  /** 302 目标(provider authorize URL) */
  location: string;
  /** 写入 oauth_state cookie 所需的全部信息(含 httpOnly 等选项) */
  cookie: { name: string; value: string; options: OauthStateCookieOptions };
  /** 清洗后的 next(供测试断言) */
  next: string;
}

export function startOauthFlow(input: {
  provider: string | null;
  next: string | null;
  origin: string;
  now?: number;
  env?: NodeJS.ProcessEnv;
}): OauthStartResult {
  if (!isOAuthProviderId(input.provider)) {
    throw new OauthBadRequestError('unsupported provider');
  }
  const cfg = getOAuthProviderConfig(input.provider, input.env);
  if (!cfg || !cfg.configured) {
    throw new OauthNotConfiguredError(`oauth provider ${input.provider} not configured`);
  }
  const safeNext = sanitizeNext(input.next);
  const state = randomOauthState();
  const redirectUri = `${input.origin}/api/auth/oauth/callback/${cfg.id}`;
  const location = buildAuthorizeUrl(cfg.id, {
    clientId: cfg.clientId,
    redirectUri,
    state,
  });
  return {
    location,
    next: safeNext,
    cookie: {
      name: OAUTH_STATE_COOKIE,
      value: signOauthState({ state, next: safeNext, now: input.now }),
      options: oauthStateCookieOptions(),
    },
  };
}

// ---- callback:state 校验 → 交换 → 挂接 → 建会话 ----

export interface OauthCallbackSuccess {
  next: string;
  user: AccountUser;
  session: { token: string; expiresAt: number };
}

export async function runOauthCallback(input: {
  provider: string;
  code: string | null;
  state: string | null;
  cookieJar: OauthCookieJar;
  origin: string;
  now?: number;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
}): Promise<OauthCallbackSuccess> {
  if (!isOAuthProviderId(input.provider)) {
    throw new OauthBadRequestError('unsupported provider');
  }
  const cfg = getOAuthProviderConfig(input.provider, input.env);
  if (!cfg || !cfg.configured) {
    // 防御:start 已拦 503,这里兜底按 provider_error 跳回,不 500。
    throw new OauthProviderError('/', `oauth provider ${input.provider} not configured`);
  }

  // state 校验(cookie 存在 + HMAC + 未过期 + 与 query 一致);失败立即清 cookie,
  // 并且不向三方发任何请求。
  const raw = input.cookieJar.get(OAUTH_STATE_COOKIE)?.value;
  const verified = verifyOauthState(raw, { state: input.state, now: input.now });
  if (!verified.ok) {
    input.cookieJar.delete(OAUTH_STATE_COOKIE);
    throw new OauthStateInvalidError();
  }
  input.cookieJar.delete(OAUTH_STATE_COOKIE);

  const redirectUri = `${input.origin}/api/auth/oauth/callback/${cfg.id}`;
  let info: OAuthUserInfo;
  try {
    info = await exchangeCodeForUserinfo(cfg, input.code ?? '', {
      redirectUri,
      fetchImpl: input.fetchImpl,
    });
  } catch (err) {
    if (err instanceof OauthExchangeError) {
      throw new OauthProviderError(verified.next, err.message);
    }
    throw err;
  }

  const user = await upsertIdentity({
    provider: info.provider,
    subject: info.subject,
    email: info.email,
    displayName: info.displayName,
    avatarUrl: info.avatarUrl,
  });
  const session = await createSession(user.id);
  return { next: verified.next, user, session };
}
