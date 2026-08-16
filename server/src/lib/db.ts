// ============================================================
// Postgres 连接（可选）
//
// 没有 DATABASE_URL 时返回 null，调用方走内存实现。
// 不要打印连接串。
// ============================================================

import { Pool } from 'pg';

let pool: Pool | null | undefined;

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
