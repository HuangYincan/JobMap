import { NextResponse } from 'next/server';
import { listOAuthProviders } from '@/lib/oauth/oauth-config';

/**
 * GET /api/auth/oauth/providers — 公开接口,无需登录。
 * 返回 provider 列表 + 是否已配置(configured 判定在 oauth-config),
 * 零敏感信息:绝不携带 client id / secret / 端点。
 */
export async function GET() {
  return NextResponse.json({ providers: listOAuthProviders() });
}
