import { NextResponse } from 'next/server';
import { RequestBodyTooLargeError, readJsonBody } from '@/lib/request-body';
import { clearSessionCookie, readSessionUser } from '@/lib/http-session';
import { updateUser } from '@/lib/account-store';
import type { Language } from '@/lib/i18n';
import { canonicalMode } from '@/lib/modes';
import type { MapMode } from '@/lib/types';

export async function GET() {
  const user = await readSessionUser();
  return NextResponse.json({ user });
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
  const user = await readSessionUser();
  if (!user) {
    return NextResponse.json({ code: 'UNAUTHORIZED', message: 'not signed in' }, { status: 401 });
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

  // #18：displayName 长度上限 + avatarUrl 协议白名单（http/https）与长度上限，
  // 非法 → 400（校验先于 updateUser，不入库不回显）。avatarUrl='' 保留清头像语义。
  if (body.displayName !== undefined) {
    if (typeof body.displayName !== 'string') {
      return NextResponse.json(
        { code: 'INVALID_DISPLAY_NAME', message: `displayName must be a string of at most ${MAX_DISPLAY_NAME_LENGTH} chars` },
        { status: 400 }
      );
    }
    if (body.displayName.length > MAX_DISPLAY_NAME_LENGTH) {
      return NextResponse.json(
        { code: 'DISPLAY_NAME_TOO_LONG', message: `displayName must be at most ${MAX_DISPLAY_NAME_LENGTH} chars` },
        { status: 400 }
      );
    }
  }
  if (body.avatarUrl !== undefined) {
    if (typeof body.avatarUrl !== 'string' || body.avatarUrl.length > MAX_AVATAR_URL_LENGTH) {
      return NextResponse.json(
        { code: 'INVALID_AVATAR_URL', message: `avatarUrl must be a string of at most ${MAX_AVATAR_URL_LENGTH} chars` },
        { status: 400 }
      );
    }
    if (body.avatarUrl !== '' && !isHttpUrl(body.avatarUrl)) {
      return NextResponse.json(
        { code: 'INVALID_AVATAR_URL', message: 'avatarUrl must be an http(s) URL' },
        { status: 400 }
      );
    }
  }

  const preferences = body.preferences
    ? {
        language: body.preferences.language,
        defaultMode: body.preferences.defaultMode
          ? canonicalMode(body.preferences.defaultMode)
          : undefined,
        notifications: body.preferences.notifications,
        career: body.preferences.career,
      }
    : undefined;

  const next = await updateUser(user.id, {
    displayName: body.displayName,
    avatarUrl: body.avatarUrl,
    preferences,
  });
  return NextResponse.json({ user: next });
}

export async function DELETE() {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
