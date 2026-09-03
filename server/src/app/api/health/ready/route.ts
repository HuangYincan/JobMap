import { NextResponse } from 'next/server';
import { checkDatabaseReadiness, getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * GET /api/health/ready — process + minimum Work-mode database readiness.
 *
 * Keep the response intentionally generic: deployment probes need a stable
 * status, not connection details or schema internals.
 */
export async function GET() {
  const ready = await checkDatabaseReadiness(getPool());
  return NextResponse.json(
    ready ? { ok: true } : { ok: false, code: 'DATABASE_UNAVAILABLE' },
    { status: ready ? 200 : 503, headers: NO_STORE },
  );
}
