import { getOAuthProviderConfig, type OAuthProviderId } from './oauth/oauth-config.ts';

export type DemoLoginGate =
  | { ok: true }
  | { ok: false; code: 'DEMO_LOGIN_DISABLED' | 'DEMO_LOGIN_DISABLED_IN_PRODUCTION'; message: string };

/**
 * Demo identities are a development convenience. A configured provider must use
 * the real OAuth flow, and production must never issue an anonymous demo session.
 */
export function demoLoginGate(
  provider: OAuthProviderId,
  env: NodeJS.ProcessEnv = process.env,
): DemoLoginGate {
  if (env.NODE_ENV === 'production') {
    return {
      ok: false,
      code: 'DEMO_LOGIN_DISABLED_IN_PRODUCTION',
      message: 'demo login is unavailable in production',
    };
  }
  if (getOAuthProviderConfig(provider, env)?.configured) {
    return {
      ok: false,
      code: 'DEMO_LOGIN_DISABLED',
      message: `use /api/auth/oauth/start?provider=${provider}`,
    };
  }
  return { ok: true };
}
