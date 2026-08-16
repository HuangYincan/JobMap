import { NextResponse } from 'next/server';
import { createSession, upsertIdentity } from '@/lib/account-store';
import { writeSessionCookie } from '@/lib/http-session';
import type { AuthProvider } from '@/lib/account';

const OAUTH: Record<string, { subject: string; email: string; displayName: string; provider: AuthProvider }> = {
  github: {
    provider: 'github',
    subject: 'github:demo',
    email: 'demo@users.noreply.github.com',
    displayName: 'GitHub Demo',
  },
  google: {
    provider: 'google',
    subject: 'google:demo',
    email: 'demo@gmail.com',
    displayName: 'Google Demo',
  },
  wechat: {
    provider: 'wechat',
    subject: 'wechat:demo',
    email: 'demo@wechat.local',
    displayName: 'WeChat Demo',
  },
};

/** Demo social login. Later: real OAuth code exchange per provider. */
export async function POST(request: Request) {
  let body: { provider?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'invalid JSON' }, { status: 400 });
  }

  const spec = OAUTH[body.provider || ''];
  if (!spec) {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'unsupported provider' }, { status: 400 });
  }

  const user = await upsertIdentity(spec);
  const session = await createSession(user.id);
  await writeSessionCookie(session.token, session.expiresAt);
  return NextResponse.json({ user });
}
