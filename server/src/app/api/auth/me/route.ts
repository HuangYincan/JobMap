import { NextResponse } from 'next/server';
import { clearSessionCookie, readSessionUser } from '@/lib/http-session';
import { updateUser } from '@/lib/account-store';
import type { Language } from '@/lib/i18n';
import { canonicalMode } from '@/lib/modes';
import type { MapMode } from '@/lib/types';

export async function GET() {
  const user = await readSessionUser();
  return NextResponse.json({ user });
}

export async function PATCH(request: Request) {
  const user = await readSessionUser();
  if (!user) {
    return NextResponse.json({ code: 'UNAUTHORIZED', message: 'not signed in' }, { status: 401 });
  }

  let body: {
    displayName?: string;
    avatarUrl?: string;
    preferences?: { language?: Language; defaultMode?: MapMode };
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'invalid JSON' }, { status: 400 });
  }

  const preferences = body.preferences
    ? {
        language: body.preferences.language,
        defaultMode: body.preferences.defaultMode
          ? canonicalMode(body.preferences.defaultMode)
          : undefined,
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
