// ============================================================
// Postgres 连接（可选）
//
// 没有 DATABASE_URL 时返回 null，调用方走内存实现。
// 不要打印连接串。
// ============================================================

import { Pool } from 'pg';

let pool: Pool | null | undefined;

/** Public read queries must fail closed instead of occupying a pool indefinitely. */
export const PUBLIC_READ_QUERY_TIMEOUT_MS = 3_000;

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool(): Pool | null {
  if (pool !== undefined) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    pool = null;
    return null;
  }
  pool = new Pool({ connectionString: url, max: 5 });
  return pool;
}

type QueryPool = {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

/**
 * Run a bounded public read. Real pg pools receive statement_timeout so the
 * server cancels a slow statement; injected pools retain the string/params
 * call shape and are covered by the client-side timeout race in tests.
 */
export async function queryPublicRead<T>(
  db: QueryPool,
  sql: string,
  params: unknown[] = [],
  timeoutMs = PUBLIC_READ_QUERY_TIMEOUT_MS,
): Promise<{ rows: T[] }> {
  const query: Promise<{ rows: T[] }> = db instanceof Pool
    ? (db as unknown as {
        query<R>(config: { text: string; values: unknown[]; statement_timeout: number }): Promise<{ rows: R[] }>;
      }).query<T>({ text: sql, values: params, statement_timeout: timeoutMs })
    : db.query<T>(sql, params);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`public read query timed out after ${timeoutMs}ms`);
      error.name = 'PublicReadTimeoutError';
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([query, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const READINESS_QUERY = `
  SELECT
    to_regclass('public.companies') IS NOT NULL AS has_companies,
    to_regclass('public.company_sites') IS NOT NULL AS has_company_sites,
    to_regclass('public.positions') IS NOT NULL AS has_positions
`;

/**
 * Check both database connectivity and the minimum schema required by Work
 * mode. The result intentionally contains no database details for callers to
 * expose in a health response.
 */
export async function checkDatabaseReadiness(db: QueryPool | null): Promise<boolean> {
  if (!db) return false;
  try {
    const result = await queryPublicRead<{
      has_companies: boolean;
      has_company_sites: boolean;
      has_positions: boolean;
    }>(db, READINESS_QUERY);
    const row = result.rows[0];
    return row?.has_companies === true
      && row.has_company_sites === true
      && row.has_positions === true;
  } catch {
    return false;
  }
}
