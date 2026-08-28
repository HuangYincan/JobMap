import { createHash, randomBytes } from 'node:crypto';

export const NAVIGATION_SESSION_COOKIE = 'dm_navigation_session';
export const NAVIGATION_SESSION_COOKIE_PATH = '/api/navigation/routes';
export const NAVIGATION_SESSION_COOKIE_MAX_AGE_SECONDS = 4 * 60 * 60;
export const NAVIGATION_SESSION_TOKEN_PATTERN = /^nav_[a-f0-9]{64}$/;

export function createNavigationSessionToken(): string {
  return `nav_${randomBytes(32).toString('hex')}`;
}

export function isNavigationSessionToken(value: unknown): value is string {
  return typeof value === 'string' && NAVIGATION_SESSION_TOKEN_PATTERN.test(value);
}

export function fingerprintNavigationSession(token: string): string {
  if (!isNavigationSessionToken(token)) {
    throw new TypeError('invalid navigation session token');
  }
  return createHash('sha256')
    .update('domain-map:navigation-session:')
    .update(token)
    .digest('hex');
}

export function readNavigationSessionToken(request: Request): string | null {
  const raw = request.headers.get('cookie');
  if (!raw) return null;
  const values = raw
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${NAVIGATION_SESSION_COOKIE}=`))
    .map((part) => part.slice(NAVIGATION_SESSION_COOKIE.length + 1));
  if (values.length !== 1 || !isNavigationSessionToken(values[0])) return null;
  return values[0];
}

export function serializeNavigationSessionCookie(
  token: string,
  secure = process.env.NODE_ENV === 'production',
): string {
  if (!isNavigationSessionToken(token)) {
    throw new TypeError('invalid navigation session token');
  }
  return [
    `${NAVIGATION_SESSION_COOKIE}=${token}`,
    `Path=${NAVIGATION_SESSION_COOKIE_PATH}`,
    `Max-Age=${NAVIGATION_SESSION_COOKIE_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}
