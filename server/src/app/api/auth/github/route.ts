import { NextResponse } from 'next/server';
import { createSession, upsertIdentity } from '@/lib/account-store';
import { demoLoginGate } from '@/lib/demo-login-gate';
import { writeSessionCookie } from '@/lib/http-session';

/**
 * Demo fallback for local development. Once real GitHub OAuth credentials are
 * present, this endpoint must not mint a demo session.
 */
export async function POST() {
  const gate = demoLoginGate('github');
  if (!gate.ok) {
    return NextResponse.json(
      { code: gate.code, message: gate.message },
      { status: 403 },
    );
  }

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
