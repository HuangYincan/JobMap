import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { writeSessionCookie } from '@/lib/http-session';
import {
  OauthBadRequestError,
  OauthProviderError,
  OauthStateInvalidError,
  errorRedirectPath,
  runOauthCallback,
} from '@/lib/oauth/oauth-flow';

/**
 * GET /api/auth/oauth/callback/<provider>?code=&state=
 *
 * 成功 → 建会话 + 写 session cookie → 302 到签名时的 next(不带参数)。
 * state 校验失败 → 302 /?auth_error=oauth_state_invalid(flow 内已清 cookie)。
 * code 交换 / userinfo 失败 → 302 <next>?auth_error=oauth_provider_error。
 * 行为逻辑在 lib/oauth/oauth-flow.runOauthCallback(单测直测,零网络)。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const url = new URL(request.url);
  const { provider } = await params;
  try {
    const jar = await cookies();
    const result = await runOauthCallback({
      provider,
      code: url.searchParams.get('code'),
      state: url.searchParams.get('state'),
      cookieJar: jar,
      origin: url.origin,
    });
    await writeSessionCookie(result.session.token, result.session.expiresAt);
    return NextResponse.redirect(result.next, 302);
  } catch (err) {
    if (err instanceof OauthBadRequestError) {
      return NextResponse.json({ code: 'BAD_REQUEST', message: err.message }, { status: 400 });
    }
    if (err instanceof OauthStateInvalidError) {
      return NextResponse.redirect(errorRedirectPath(err.next, 'oauth_state_invalid'), 302);
    }
    if (err instanceof OauthProviderError) {
      return NextResponse.redirect(errorRedirectPath(err.next, 'oauth_provider_error'), 302);
    }
    // 兜底:未预期错误也不 500,按 provider_error 跳回首页。
    return NextResponse.redirect('/?auth_error=oauth_provider_error', 302);
  }
}
