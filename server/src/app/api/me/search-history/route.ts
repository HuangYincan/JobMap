import { NextResponse } from 'next/server';
import { readSessionUser } from '@/lib/http-session';
import { RequestBodyTooLargeError, readJsonBody } from '@/lib/request-body';
import { addHistory, clearHistory, listHistory } from '@/lib/account-store';
import { canonicalMode } from '@/lib/modes';
import { isPersistableMode } from '@/lib/persistable';
import { sanitizeEntityRef, type SearchHistoryEntityRef } from '@/lib/account';
import type { MapMode } from '@/lib/types';

/** Align persisted history with the public search API's keyword limit. */
const MAX_QUERY_LENGTH = 100;

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
  let body: { query?: string; mode?: MapMode; entity?: unknown };
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
  const query = (body.query || '').trim();
  if (!query) {
    return NextResponse.json({ code: 'BAD_REQUEST', message: 'query required' }, { status: 400 });
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { code: 'QUERY_TOO_LONG', message: `query must be at most ${MAX_QUERY_LENGTH} chars` },
      { status: 400 },
    );
  }
  const mode = canonicalMode(body.mode || 'work');
  if (!isPersistableMode(mode)) {
    return NextResponse.json(
      { code: 'NOT_PERSISTABLE', message: 'only persistable modes can record search history' },
      { status: 400 },
    );
  }
  const entity: SearchHistoryEntityRef | undefined = sanitizeEntityRef(body.entity);
  const entry = await addHistory(user.id, query, mode, entity);
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
