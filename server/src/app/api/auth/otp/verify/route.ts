import { NextResponse } from 'next/server';
import { consumeOtp, createSession, upsertIdentity } from '@/lib/session-store';
import { writeSessionCookie } from '@/lib/http-session';

export async function POST(request: Request) {
  let body: { provider?: 'phone' | 'email'; target?: string; code?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'invalid JSON' }, { status: 400 });
  }

  const provider = body.provider === 'email' ? 'email' : 'phone';
  const target = (body.target || '').trim();
  const code = (body.code || '').trim();
  if (!target || !code) {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'target and code required' }, { status: 400 });
  }
  if (!consumeOtp(provider, target, code)) {
    return NextResponse.json({ code: 'INVALID_CODE', message: 'invalid or expired code' }, { status: 401 });
  }

  const user = upsertIdentity({
    provider,
    subject: target,
    phone: provider === 'phone' ? target : undefined,
    email: provider === 'email' ? target : undefined,
  });
  const session = createSession(user.id);
  await writeSessionCookie(session.token, session.expiresAt);
  return NextResponse.json({ user });
}
