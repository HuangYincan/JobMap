import { NextResponse } from 'next/server';
import { RequestBodyTooLargeError, isPlainObject, readJsonObjectBody } from '@/lib/request-body';
import { clearSessionCookie, readSessionUser } from '@/lib/http-session';
import { DbUnavailableError, updateUser } from '@/lib/account-store';
import type { Language } from '@/lib/i18n';
import { canonicalMode, parseKnownMode } from '@/lib/modes';
import type { MapMode } from '@/lib/types';

function noStoreJson(body: unknown, init?: { status?: number }) {
  const response = NextResponse.json(body, { ...init, headers: { 'Cache-Control': 'no-store' } });
  return response;
}

export async function GET() {
  try {
    const user = await readSessionUser();
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

// ---- 输入上限（quality-scan #18，2026-08-23）----
/** displayName 长度上限（GitHub 用户名上限 39/本地默认名远短于此，50 覆盖现有来源）。 */
const MAX_DISPLAY_NAME_LENGTH = 50;
/** avatarUrl 长度上限（正常 URL 远短于此；防超长串进 storage/回显）。 */
const MAX_AVATAR_URL_LENGTH = 2048;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function PATCH(request: Request) {
  let user;
  try {
    user = await readSessionUser();
  } catch (err) {
    if (err instanceof DbUnavailableError) {
      return noStoreJson(
        { code: 'DB_UNAVAILABLE', message: 'database unavailable, try again later' },
        { status: 503 },
      );
    }
    throw err;
  }
  if (!user) {
    return noStoreJson({ code: 'UNAUTHORIZED', message: 'not signed in' }, { status: 401 });
  }

  let body: {
    displayName?: string;
    avatarUrl?: string;
    preferences?: Partial<import('@/lib/account').UserPreferences> & {
      language?: Language;
      defaultMode?: MapMode;
    };
  };
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

  // #18：displayName 长度上限 + avatarUrl 协议白名单（http/https）与长度上限，
  // 非法 → 400（校验先于 updateUser，不入库不回显）。avatarUrl='' 保留清头像语义。
  if (body.displayName !== undefined) {
    if (typeof body.displayName !== 'string') {
      return noStoreJson(
        { code: 'INVALID_DISPLAY_NAME', message: `displayName must be a string of at most ${MAX_DISPLAY_NAME_LENGTH} chars` },
        { status: 400 }
      );
    }
    if (body.displayName.length > MAX_DISPLAY_NAME_LENGTH) {
      return noStoreJson(
        { code: 'DISPLAY_NAME_TOO_LONG', message: `displayName must be at most ${MAX_DISPLAY_NAME_LENGTH} chars` },
        { status: 400 }
      );
    }
  }
  if (body.avatarUrl !== undefined) {
    if (typeof body.avatarUrl !== 'string' || body.avatarUrl.length > MAX_AVATAR_URL_LENGTH) {
      return noStoreJson(
        { code: 'INVALID_AVATAR_URL', message: `avatarUrl must be a string of at most ${MAX_AVATAR_URL_LENGTH} chars` },
        { status: 400 }
      );
    }
    if (body.avatarUrl !== '' && !isHttpUrl(body.avatarUrl)) {
      return noStoreJson(
        { code: 'INVALID_AVATAR_URL', message: 'avatarUrl must be an http(s) URL' },
        { status: 400 }
      );
    }
  }

  if (body.preferences !== undefined && !isPlainObject(body.preferences)) {
    return noStoreJson({ code: 'BAD_REQUEST', message: 'preferences must be an object' }, { status: 400 });
  }
  if (body.preferences?.language !== undefined && body.preferences.language !== 'zh' && body.preferences.language !== 'en') {
    return noStoreJson({ code: 'BAD_REQUEST', message: 'language must be zh or en' }, { status: 400 });
  }
  if (body.preferences?.defaultMode !== undefined && parseKnownMode(body.preferences.defaultMode) === null) {
    return noStoreJson({ code: 'INVALID_MODE', message: 'unknown default mode' }, { status: 400 });
  }

  const preferences = body.preferences
    ? {
        language: body.preferences.language,
        defaultMode: body.preferences.defaultMode
          ? canonicalMode(body.preferences.defaultMode)
          : undefined,
        notifications: body.preferences.notifications,
        career: body.preferences.career,
        ...(Object.hasOwn(body.preferences, "applicationPipeline")
          ? { applicationPipeline: body.preferences.applicationPipeline }
          : {}),
      }
    : undefined;

  try {
    const next = await updateUser(user.id, {
      displayName: body.displayName,
      avatarUrl: body.avatarUrl,
      preferences,
    });
    return noStoreJson({ user: next });
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

export async function DELETE() {
  try {
    await clearSessionCookie();
    return noStoreJson({ ok: true });
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
