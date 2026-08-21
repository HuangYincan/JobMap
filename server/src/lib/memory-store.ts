// ============================================================
// 用户个性化记忆仓储(tech/26-agent-memory.md)
//
// 与 account-store 同构:有 DATABASE_URL 且 018 已应用 → 上云。
// 否则回落到进程内内存实现,单测不依赖库。
//
// 读路径:DB 查询失败允许回落内存(降级合理,读不到不至于崩)。
// 写路径:DB 故障直接抛 DbUnavailableError(工具/route 层转可恢复错误),
//         绝不静默回落内存——否则数据在内存与 DB 间分裂,保存看似成功实则丢失。
// ============================================================

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { DbUnavailableError } from './account-store.ts';
import { getPool } from './db.ts';

export interface UserMemory {
  id: string;
  content: string;
  createdAt: string;
}

/** 单条记忆内容上限(与工具 schema / 注入预算一致)。 */
export const MEMORY_CONTENT_MAX = 200;
/** listMemories 返回上限。 */
export const MEMORY_LIST_MAX = 50;

/** 纯函数:记忆内容清洗——非 string/trim 后空串 → '',超长截断 200 字。 */
export function sanitizeMemoryContent(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const t = raw.trim();
  if (!t) return '';
  return t.length > MEMORY_CONTENT_MAX ? t.slice(0, MEMORY_CONTENT_MAX) : t;
}

// ---- 内存模式存储(无 DATABASE_URL 时) ----
const memMemories = new Map<string, UserMemory[]>();

function memList(userId: string): UserMemory[] {
  return [...(memMemories.get(userId) ?? [])];
}

function memAdd(userId: string, content: string): void {
  const items = memMemories.get(userId) ?? [];
  items.unshift({ id: randomUUID(), content, createdAt: new Date().toISOString() });
  memMemories.set(userId, items);
}

function memRemove(userId: string, id: string): void {
  const items = memMemories.get(userId) ?? [];
  memMemories.set(userId, items.filter((m) => m.id !== id));
}

function memClear(userId: string): void {
  memMemories.set(userId, []);
}

// ---- DB 连接与故障策略 ----

/**
 * 测试钩子(仅测试使用,生产调用方不碰):
 * - poolOverride:注入 fake 池(可让 query 抛错模拟 DB 故障)或 null(强制内存模式),
 *   绕过 getPool 的进程级缓存,让「写路径抛 / 读路径降级」可被确定性单测覆盖。
 */
export const __memoryStoreTest = {
  poolOverride: undefined as (() => Pool | null) | undefined,
};

function getPoolForCall(): Pool | null {
  return __memoryStoreTest.poolOverride ? __memoryStoreTest.poolOverride() : getPool();
}

/** 读路径:DB 故障回落内存(降级合理,读不到不至于崩)。 */
async function withDbRead<T>(fn: (pool: Pool) => Promise<T>, fallback: () => T | Promise<T>): Promise<T> {
  const db = getPoolForCall();
  if (!db) return fallback();
  try {
    return await fn(db);
  } catch (err) {
    console.warn('[memory-store] postgres unavailable, using memory:', (err as Error).message);
    return fallback();
  }
}

/** 写路径:DB 故障直接抛 DbUnavailableError,绝不静默回落内存造成数据分裂。 */
async function withDbWrite<T>(fn: (pool: Pool) => Promise<T>, memory: () => T | Promise<T>): Promise<T> {
  const db = getPoolForCall();
  if (!db) return memory(); // 未配置 DB:内存模式本身就是存储,写内存。
  try {
    return await fn(db);
  } catch (err) {
    throw new DbUnavailableError(err);
  }
}

/** 按 created_at DESC 列出某用户的记忆,上限 MEMORY_LIST_MAX(50)。 */
export async function listMemories(userId: string): Promise<UserMemory[]> {
  return withDbRead(
    async (db) => {
      const result = await db.query<{ id: string; content: string; created_at: Date }>(
        `SELECT id::text, content, created_at
         FROM user_memories
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, MEMORY_LIST_MAX],
      );
      return result.rows.map((r) => ({ id: r.id, content: r.content, createdAt: r.created_at.toISOString() }));
    },
    () => memList(userId),
  );
}

/** 新增一条记忆(入参经 sanitizeMemoryContent:trim + 截断 200 字;空 → 不写)。 */
export async function addMemory(userId: string, content: string): Promise<void> {
  const clean = sanitizeMemoryContent(content);
  if (!clean) return;
  await withDbWrite(
    async (db) => {
      await db.query(`INSERT INTO user_memories (user_id, content) VALUES ($1, $2)`, [userId, clean]);
      return undefined;
    },
    () => memAdd(userId, clean),
  );
}

/** 删除自己的某条记忆(user_id 条件,删不到别人的行)。 */
export async function removeMemory(userId: string, id: string): Promise<void> {
  await withDbWrite(
    async (db) => {
      await db.query(`DELETE FROM user_memories WHERE user_id = $1 AND id = $2`, [userId, id]);
      return undefined;
    },
    () => memRemove(userId, id),
  );
}

/** 清空某用户的全部记忆。 */
export async function clearMemories(userId: string): Promise<void> {
  await withDbWrite(
    async (db) => {
      await db.query(`DELETE FROM user_memories WHERE user_id = $1`, [userId]);
      return undefined;
    },
    () => memClear(userId),
  );
}
