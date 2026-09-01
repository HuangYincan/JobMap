import { NextResponse } from 'next/server';
import { readSessionUser } from '@/lib/http-session';
import { RequestBodyTooLargeError, isPlainObject, readJsonObjectBody } from '@/lib/request-body';
import { DbUnavailableError, addHistory, clearHistory, listHistory } from '@/lib/account-store';
import { parseKnownMode } from '@/lib/modes';
import { isPersistableMode } from '@/lib/persistable';
import { sanitizeEntityRef, type SearchHistoryEntityRef } from '@/lib/account';
import type { MapMode } from '@/lib/types';

/** Align persisted history with the public search API's keyword limit. */
const MAX_QUERY_LENGTH = 100;

function noStoreJson(body: unknown, init?: { status?: number }) {
  const response = NextResponse.json(body, { ...init, headers: { 'Cache-Control': 'no-store' } });
  return response;
}

export async function GET() {
  const user = await readSessionUser();
  if (!user) return noStoreJson({ items: [] });
  return noStoreJson({ items: await listHistory(user.id) });
}

export async function POST(request: Request) {
  const user = await readSessionUser();
  if (!user) {
    return noStoreJson({ code: 'UNAUTHORIZED', message: 'not signed in' }, { status: 401 });
  }
  let body: { query?: string; mode?: MapMode; entity?: unknown };
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
  if (!isPlainObject(body) || typeof body.query !== 'string') {
    return noStoreJson({ code: 'BAD_REQUEST', message: 'query must be a string' }, { status: 400 });
  }
  const query = body.query.trim();
  if (!query) {
    return noStoreJson({ code: 'BAD_REQUEST', message: 'query required' }, { status: 400 });
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return noStoreJson(
      { code: 'QUERY_TOO_LONG', message: `query must be at most ${MAX_QUERY_LENGTH} chars` },
      { status: 400 },
    );
  }
  const mode = parseKnownMode(body.mode);
  if (!mode) {
    return noStoreJson({ code: 'INVALID_MODE', message: 'unknown mode' }, { status: 400 });
  }
  if (!isPersistableMode(mode)) {
    return noStoreJson(
      { code: 'NOT_PERSISTABLE', message: 'only persistable modes can record search history' },
      { status: 400 },
    );
  }
  const entity: SearchHistoryEntityRef | undefined = sanitizeEntityRef(body.entity);
  try {
    const entry = await addHistory(user.id, query, mode, entity);
    return noStoreJson({ item: entry });
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
  const user = await readSessionUser();
  if (!user) {
    return noStoreJson({ code: 'UNAUTHORIZED', message: 'not signed in' }, { status: 401 });
  }
  try {
    await clearHistory(user.id);
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
