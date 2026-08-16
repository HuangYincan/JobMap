import { cookies } from 'next/headers';
import { SESSION_COOKIE, type AccountUser } from './account.ts';
import { destroySession, getSessionUser } from './session-store.ts';

export async function readSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

export async function readSessionUser(): Promise<AccountUser | null> {
  return getSessionUser(await readSessionToken());
}

export async function writeSessionCookie(token: string, expiresAt: number): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(expiresAt),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const token = await readSessionToken();
  destroySession(token);
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
