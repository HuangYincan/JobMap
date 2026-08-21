import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  OauthBadRequestError,
  OauthNotConfiguredError,
  startOauthFlow,
} from '@/lib/oauth/oauth-flow';

/**
 * GET /api/auth/oauth/start?provider=<id>&next=<path>
 *
 * 成功 → 302 到 provider authorize URL + 写入 oauth_state cookie
 * (httpOnly / sameSite=lax / secure 仅生产 / maxAge 600s)。
 * provider 缺失/非法 → 400 BAD_REQUEST;未配置 → 503 OAUTH_NOT_CONFIGURED。
 * 行为逻辑在 lib/oauth/oauth-flow.startOauthFlow(单测直测)。
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const result = startOauthFlow({
      provider: url.searchParams.get('provider'),
      next: url.searchParams.get('next'),
      origin: url.origin,
    });
    const jar = await cookies();
    jar.set(result.cookie.name, result.cookie.value, result.cookie.options);
    return NextResponse.redirect(result.location, 302);
  } catch (err) {
    if (err instanceof OauthBadRequestError) {
      return NextResponse.json({ code: 'BAD_REQUEST', message: err.message }, { status: 400 });
    }
    if (err instanceof OauthNotConfiguredError) {
      return NextResponse.json({ code: 'OAUTH_NOT_CONFIGURED', message: err.message }, { status: 503 });
    }
    throw err;
  }
}
