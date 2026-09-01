// ============================================================
// 用户个性化记忆仓储(tech/30-agent-memory.md)
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
import { BoundedLruStore } from './bounded-lru-store.ts';
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
/** 每个用户的持久化总量上限;写入后保留最新一条并淘汰最旧。 */
export const MEMORY_STORAGE_MAX = MEMORY_LIST_MAX;
/** 进程内回退存储的用户键上限;键洪泛时淘汰最早未活跃用户。 */
export const MEMORY_USER_STORE_MAX = 1_000;

/** 工具层与存储层共用的敏感内容拒绝原因;不回显用户输入。 */
export const MEMORY_SENSITIVE_CONTENT_MESSAGE =
  '出于安全原因,不能保存密码、密钥、令牌、验证码、私钥、JWT、精确住址或联系方式';

/**
 * 记忆写入的高置信敏感内容规则。
 *
 * 关键词本身不构成拒绝条件:只有显式的「字段 + 是/为/分隔符 + 值」才命中,
 * 以免把“我喜欢研究密码学”“我想学习 API”之类普通偏好误判为秘密。
 * 电话、邮箱和带街道/门牌号的地址是高置信直接识别,因为它们本身就是可用的
 * 联系方式/精确位置。规则只用于阻止写入,不会把原文记录到日志或错误中。
 */
const PASSWORD_DISCLOSURE_RE = /(?:密码|口令|password|passwd|pwd)\s*(?:是|为|[:：=])\s*\S+/iu;
const CREDENTIAL_DISCLOSURE_RE =
  /(?:api[\s_-]*key|api[\s_-]*secret|access[\s_-]*token|refresh[\s_-]*token|client[\s_-]*secret|密钥|秘钥|令牌|token|secret)\s*(?:是|为|[:：=])\s*\S+/iu;
const OTP_DISCLOSURE_RE =
  /(?:验证码|一次性密码|动态密码)\s*(?:(?:是|为)\s*)?[:：=]?\s*\d{4,8}(?!\d)|\botp\b\s*(?:code\s*)?(?:is|[:=])\s*[A-Za-z0-9-]{4,}/iu;
const PRIVATE_KEY_DISCLOSURE_RE = /(?:私钥|private\s+key)\s*(?:是|为|[:：=])\s*\S+/iu;
const PRIVATE_KEY_PEM_RE = /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/iu;
const JWT_RE = /(?:^|[^A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:$|[^A-Za-z0-9_-])/u;
const KNOWN_TOKEN_RE = /(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{12,}|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{12,}|Bearer\s+[A-Za-z0-9._~+/=-]{12,})/iu;
const PHONE_RE = /(?:^|[^0-9])(?:\+?86[ -]?)?1[3-9][0-9]{9}(?![0-9])/u;
const EMAIL_RE = /(?:^|[^A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:$|[^A-Za-z0-9._%+-])/u;
const CONTACT_DISCLOSURE_RE =
  /(?:手机号|手机号码|电话号码|联系电话|联系方式|微信号|wechat\s*id)\s*(?:是|为|[:：=])\s*[A-Za-z0-9_+.-]{4,}/iu;
const PRECISE_ADDRESS_RE =
  /(?:家庭住址|住宅地址|家庭地址|详细地址|具体住址|居住地址|住址|我家地址|家住|住在|home\s+address|residential\s+address)[^。\n]{0,120}?(?:[0-9]+\s*(?:号|弄|栋|幢|单元|室)(?!线)|(?:路|街|巷)[^。\n]{0,24}?[0-9]+\s*号?|[0-9]+\s+[^,。\n]{1,40}\s+(?:street|st\b|road|rd\b|avenue|ave\b))/iu;

/** 判断一条记忆是否包含高置信凭据、联系方式或精确住宅地址。 */
export function isSensitiveMemoryContent(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const content = raw.trim().normalize('NFKC').replace(/[​-‍﻿]/g, '');
  if (!content) return false;
  return [
    PASSWORD_DISCLOSURE_RE,
    CREDENTIAL_DISCLOSURE_RE,
    OTP_DISCLOSURE_RE,
    PRIVATE_KEY_DISCLOSURE_RE,
    PRIVATE_KEY_PEM_RE,
    JWT_RE,
    KNOWN_TOKEN_RE,
    PHONE_RE,
    EMAIL_RE,
    CONTACT_DISCLOSURE_RE,
    PRECISE_ADDRESS_RE,
  ].some((pattern) => pattern.test(content));
}

/** 纯函数:记忆内容清洗——非 string/trim 后空串 → '',超长截断 200 字。 */
export function sanitizeMemoryContent(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const t = raw.trim();
  if (!t) return '';
  return t.length > MEMORY_CONTENT_MAX ? t.slice(0, MEMORY_CONTENT_MAX) : t;
}

// ---- 内存模式存储(无 DATABASE_URL 时) ----
const memMemories = new BoundedLruStore<UserMemory[]>(MEMORY_USER_STORE_MAX);

function memList(userId: string): UserMemory[] {
  return [...(memMemories.get(userId) ?? [])].filter((item) => !isSensitiveMemoryContent(item.content));
}

function memPut(userId: string, items: UserMemory[]): void {
  if (items.length === 0) {
    memMemories.delete(userId);
    return;
  }
  memMemories.set(userId, items);
}

function memAdd(userId: string, content: string): void {
  const items = memMemories.get(userId) ?? [];
  items.unshift({ id: randomUUID(), content, createdAt: new Date().toISOString() });
  memPut(userId, items.slice(0, MEMORY_STORAGE_MAX));
}

function memRemove(userId: string, id: string): void {
  const items = memMemories.get(userId) ?? [];
  memPut(userId, items.filter((m) => m.id !== id));
}

function memClear(userId: string): void {
  memMemories.delete(userId);
}

/** Observability/test seam for the process-local fallback's key ceiling. */
export function memoryUserStoreSize(): number {
  return memMemories.size;
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
      return result.rows
        .map((r) => ({ id: r.id, content: r.content, createdAt: r.created_at.toISOString() }))
        .filter((item) => !isSensitiveMemoryContent(item.content));
    },
    () => memList(userId),
  );
}

/** 新增一条记忆(入参经 sanitizeMemoryContent:trim + 截断 200 字;空/敏感内容 → 不写)。 */
export async function addMemory(userId: string, content: string): Promise<void> {
  // Check before the 200-character cap so a secret appended after harmless text
  // cannot be hidden by truncation.
  if (isSensitiveMemoryContent(content)) return;
  const clean = sanitizeMemoryContent(content);
  // 第二道边界必须位于 DB/内存写入之前:即使调用方绕过 builtin 工具,
  // 高置信秘密也不会进入存储,也不会因 DB 故障触发任何查询。
  if (!clean) return;
  await withDbWrite(
    async (db) => {
      await db.query(
        `INSERT INTO user_memories (user_id, content)
         VALUES ($1, $2)
         ON CONFLICT (user_id, content) DO NOTHING`,
        [userId, clean],
      );
      await db.query(
        `DELETE FROM user_memories
         WHERE user_id = $1
           AND id NOT IN (
             SELECT id FROM user_memories
             WHERE user_id = $1
             ORDER BY created_at DESC, id DESC
             LIMIT $2
           )`,
        [userId, MEMORY_STORAGE_MAX],
      );
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
