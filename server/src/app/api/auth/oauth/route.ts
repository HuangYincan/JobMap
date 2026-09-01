import { NextResponse } from 'next/server';
import { RequestBodyTooLargeError, readJsonObjectBody } from '@/lib/request-body';
import { createSession, DbUnavailableError, upsertIdentity } from '@/lib/account-store';
import { demoLoginGate } from '@/lib/demo-login-gate';
import { writeSessionCookie } from '@/lib/http-session';
import type { OAuthProviderId } from '@/lib/oauth/oauth-config';

function noStoreJson(body: unknown, init?: { status?: number }) {
  const response = NextResponse.json(body, { ...init, headers: { 'Cache-Control': 'no-store' } });
  return response;
}

const OAUTH: Record<string, { subject: string; email: string; displayName: string; provider: OAuthProviderId }> = {
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

/** Demo fallback; disabled per provider as soon as its real OAuth env is set. */
export async function POST(request: Request) {
  let body: { provider?: string };
  try {
    body = await readJsonObjectBody<typeof body>(request);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return noStoreJson(
        { code: 'BODY_TOO_LARGE', message: 'request body too large' },
        { status: 400 },
      );
    }
    return noStoreJson({ code: 'BAD_REQUEST', message: 'invalid JSON' }, { status: 400 });
  }

  if (typeof body.provider !== 'string') {
    return noStoreJson({ code: 'BAD_REQUEST', message: 'provider must be a string' }, { status: 400 });
  }
  const spec = OAUTH[body.provider];
  if (!spec) {
    return noStoreJson({ code: 'BAD_REQUEST', message: 'unsupported provider' }, { status: 400 });
  }
  const gate = demoLoginGate(spec.provider);
  if (!gate.ok) {
    return noStoreJson(
      { code: gate.code, message: gate.message },
      { status: 403 },
    );
  }

  try {
    const user = await upsertIdentity(spec);
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
