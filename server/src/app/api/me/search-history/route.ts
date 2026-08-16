import { NextResponse } from 'next/server';
import { readSessionUser } from '@/lib/http-session';
import { addHistory, clearHistory, listHistory } from '@/lib/account-store';
import { canonicalMode } from '@/lib/modes';
import type { MapMode } from '@/lib/types';

export async function GET() {
  const user = await readSessionUser();
  if (!user) return NextResponse.json({ items: [] });
  return NextResponse.json({ items: await listHistory(user.id) });
}

export async function POST(request: Request) {
  const user = await readSessionUser();
  if (!user) {
    return NextResponse.json({ code: 'UNAUTHORIZED', message: 'not signed in' }, { status: 401 });
  }
  let body: { query?: string; mode?: MapMode };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'invalid JSON' }, { status: 400 });
  }
  const query = (body.query || '').trim();
  if (!query) {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'query required' }, { status: 400 });
  }
  const entry = await addHistory(user.id, query, canonicalMode(body.mode || 'work'));
  return NextResponse.json({ item: entry });
}

export async function DELETE() {
  const user = await readSessionUser();
  if (!user) {
    return NextResponse.json({ code: 'UNAUTHORIZED', message: 'not signed in' }, { status: 401 });
  }
  await clearHistory(user.id);
  return NextResponse.json({ ok: true });
}
