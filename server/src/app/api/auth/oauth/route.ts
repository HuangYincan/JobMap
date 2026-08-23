import { NextResponse } from 'next/server';
import { RequestBodyTooLargeError, readJsonBody } from '@/lib/request-body';
import { createSession, upsertIdentity } from '@/lib/account-store';
import { demoLoginGate } from '@/lib/demo-login-gate';
import { writeSessionCookie } from '@/lib/http-session';
import type { OAuthProviderId } from '@/lib/oauth/oauth-config';

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
    body = await readJsonBody<typeof body>(request);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { code: 'BODY_TOO_LARGE', message: 'request body too large' },
        { status: 400 },
      );
    }
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'invalid JSON' }, { status: 400 });
  }

  const spec = OAUTH[body.provider || ''];
  if (!spec) {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'unsupported provider' }, { status: 400 });
  }
  const gate = demoLoginGate(spec.provider);
  if (!gate.ok) {
    return NextResponse.json(
      { code: gate.code, message: gate.message },
      { status: 403 },
    );
  }

  const user = await upsertIdentity(spec);
  const session = await createSession(user.id);
  await writeSessionCookie(session.token, session.expiresAt);
  return NextResponse.json({ user });
}
