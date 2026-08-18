import { NextResponse } from 'next/server';
import { createSession, loginWithPassword } from '@/lib/account-store';
import { writeSessionCookie } from '@/lib/http-session';

/**
 * 密码登录(username + password)。成功写 dm_session cookie。
 * 401:账号或密码错误(INVALID_CREDENTIALS,不泄露账号是否存在)。
 */
export async function POST(request: Request) {
  let body: { username?: string; password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'invalid JSON' }, { status: 400 });
  }

  const username = (body.username ?? '').trim();
  const password = body.password ?? '';
  if (!username || !password) {
    return NextResponse.json(
      { ok: false, code: 'BAD_REQUEST', message: 'username and password required' },
      { status: 400 },
    );
  }

  const user = await loginWithPassword(username, password);
  if (!user) {
    return NextResponse.json(
      { ok: false, code: 'INVALID_CREDENTIALS', message: 'invalid username or password' },
      { status: 401 },
    );
  }

  const session = await createSession(user.id);
  await writeSessionCookie(session.token, session.expiresAt);
  return NextResponse.json({ ok: true, user });
}
