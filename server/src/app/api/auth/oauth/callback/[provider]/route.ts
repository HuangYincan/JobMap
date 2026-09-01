import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { writeSessionCookie } from '@/lib/http-session';
import {
  OauthBadRequestError,
  OauthProviderError,
  OauthStateInvalidError,
  absoluteRedirect,
  errorRedirectPath,
  runOauthCallback,
} from '@/lib/oauth/oauth-flow';
import { publicOriginFromRequest, PublicOriginConfigurationError } from '@/lib/oauth/request-origin';

/**
 * GET /api/auth/oauth/callback/<provider>?code=&state=
 *
 * 成功 → 建会话 + 写 session cookie → 302 到签名时的 next(不带参数)。
 * state 校验失败 → 302 /?auth_error=oauth_state_invalid(flow 内已清 cookie)。
 * code 交换 / userinfo 失败 → 302 <next>?auth_error=oauth_provider_error。
 * 行为逻辑在 lib/oauth/oauth-flow.runOauthCallback(单测直测,零网络)。
 * 全部 302 目标经 absoluteRedirect 绝对化:Next 16 的 NextResponse.redirect
 * 只接受绝对 URL,相对路径会在 validateURL 抛错 → 路由 500。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const url = new URL(request.url);
  let base: string;
  try {
    base = publicOriginFromRequest(request);
  } catch (err) {
    if (err instanceof PublicOriginConfigurationError) {
      return NextResponse.json(
        { code: 'OAUTH_ORIGIN_NOT_CONFIGURED', message: 'OAuth origin is not configured' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    throw err;
  }
  const { provider } = await params;
  try {
    const jar = await cookies();
    const result = await runOauthCallback({
      provider,
      code: url.searchParams.get('code'),
      state: url.searchParams.get('state'),
      cookieJar: jar,
      origin: base,
    });
    await writeSessionCookie(result.session.token, result.session.expiresAt);
    return NextResponse.redirect(absoluteRedirect(result.next, base), 302);
  } catch (err) {
    if (err instanceof OauthBadRequestError) {
      return NextResponse.json({ code: 'BAD_REQUEST', message: err.message }, { status: 400 });
    }
    if (err instanceof OauthStateInvalidError) {
      return NextResponse.redirect(absoluteRedirect(errorRedirectPath(err.next, 'oauth_state_invalid'), base), 302);
    }
    if (err instanceof OauthProviderError) {
      return NextResponse.redirect(absoluteRedirect(errorRedirectPath(err.next, 'oauth_provider_error'), base), 302);
    }
    // 兜底:未预期错误也不 500,按 provider_error 跳回首页。
    return NextResponse.redirect(absoluteRedirect('/?auth_error=oauth_provider_error', base), 302);
  }
}
