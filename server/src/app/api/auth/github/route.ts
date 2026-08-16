import { NextResponse } from 'next/server';
import { createSession, upsertIdentity } from '@/lib/account-store';
import { writeSessionCookie } from '@/lib/http-session';

/** Demo GitHub login. Later: OAuth code exchange. */
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
