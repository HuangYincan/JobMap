import { NextResponse } from 'next/server';
import { createSession, registerWithPassword, UsernameTakenError } from '@/lib/account-store';
import { writeSessionCookie } from '@/lib/http-session';
import { isValidPassword, isValidUsername } from '@/lib/password';

/**
 * 注册密码账号(username + password),成功后自动登录(写 dm_session cookie)。
 * 400:参数不合法(INVALID_USERNAME / PASSWORD_TOO_SHORT / PASSWORD_MISMATCH)
 * 409:用户名已存在(USERNAME_TAKEN)
 */
export async function POST(request: Request) {
  let body: { username?: string; password?: string; confirmPassword?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', message: 'invalid JSON' }, { status: 400 });
  }

  const username = (body.username ?? '').trim();
  const password = body.password ?? '';
  if (!isValidUsername(username)) {
    return NextResponse.json(
      { ok: false, code: 'INVALID_USERNAME', message: 'username must be 2-32 letters, digits, underscore or Chinese' },
      { status: 400 },
    );
  }
  if (!isValidPassword(password)) {
    return NextResponse.json(
      { ok: false, code: 'PASSWORD_TOO_SHORT', message: 'password must be at least 8 characters' },
      { status: 400 },
    );
  }
  if (body.confirmPassword !== undefined && body.confirmPassword !== password) {
    return NextResponse.json(
      { ok: false, code: 'PASSWORD_MISMATCH', message: 'passwords do not match' },
      { status: 400 },
    );
  }

  let user;
  try {
    user = await registerWithPassword(username, password);
  } catch (err) {
    if (err instanceof UsernameTakenError) {
      return NextResponse.json(
        { ok: false, code: 'USERNAME_TAKEN', message: 'username already taken' },
        { status: 409 },
      );
    }
    throw err;
  }

  const session = await createSession(user.id);
  await writeSessionCookie(session.token, session.expiresAt);
  return NextResponse.json({ ok: true, user });
}
