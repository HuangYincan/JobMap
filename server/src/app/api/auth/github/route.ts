import { NextResponse } from 'next/server';
import { createSession, DbUnavailableError, upsertIdentity } from '@/lib/account-store';
import { demoLoginGate } from '@/lib/demo-login-gate';
import { writeSessionCookie } from '@/lib/http-session';

function noStoreJson(body: unknown, init?: { status?: number }) {
  const response = NextResponse.json(body, { ...init, headers: { 'Cache-Control': 'no-store' } });
  return response;
}

/**
 * Demo fallback for local development. Once real GitHub OAuth credentials are
 * present, this endpoint must not mint a demo session.
 */
export async function POST() {
  const gate = demoLoginGate('github');
  if (!gate.ok) {
    return noStoreJson(
      { code: gate.code, message: gate.message },
      { status: 403 },
    );
  }

  try {
    const user = await upsertIdentity({
      provider: 'github',
      subject: 'github:demo',
      email: 'demo@users.noreply.github.com',
      displayName: 'GitHub Demo',
    });
    const session = await createSession(user.id);
    await writeSessionCookie(session.token, session.expiresAt);
    return noStoreJson({ user });
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return noStoreJson(
        { code: 'DB_UNAVAILABLE', message: 'database unavailable, try again later' },
        { status: 503 },
      );
    }
    throw err;
  }
}
