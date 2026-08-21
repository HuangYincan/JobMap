import { NextResponse } from 'next/server';
import { createSession, upsertIdentity } from '@/lib/account-store';
import { writeSessionCookie } from '@/lib/http-session';

/** Demo fallback,仅未配置真实 OAuth 时使用(真实流程见 /api/auth/oauth/start?provider=github)。逻辑保持原样。 */
export async function POST() {
  const user = await upsertIdentity({
    provider: 'github',
    subject: 'github:demo',
    email: 'demo@users.noreply.github.com',
    displayName: 'GitHub Demo',
  });
  const session = await createSession(user.id);
  await writeSessionCookie(session.token, session.expiresAt);
  return NextResponse.json({ user });
}
