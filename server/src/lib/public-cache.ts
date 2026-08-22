// ============================================================
// 进程内短 TTL 缓存（Phase 2 读接口）
//
// 地图列表还在浏览器打高德；这些 Next API 给后续持久化 / 服务端
// 搜索用。账号 / 会话路由不要走这里。Redis 接上后只换 store。
// ============================================================

export interface CacheStore<T = unknown> {
  get(key: string): T | undefined;
  set(key: string, value: T, ttlMs: number): void;
  delete(key: string): void;
  clear(): void;
  size(): number;
}

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export function createTtlCache<T = unknown>(
  now: () => number = Date.now,
  opts: { max?: number } = {},
): CacheStore<T> {
  const bag = new Map<string, Entry<T>>();
  const max = opts.max && opts.max > 0 ? opts.max : Number.POSITIVE_INFINITY;

  function sweep(at: number) {
    for (const [key, entry] of bag) {
      if (entry.expiresAt <= at) bag.delete(key);
    }
  }

  function evictOldest() {
    while (bag.size > max) {
      const oldest = bag.keys().next().value;
      if (oldest === undefined) break;
      bag.delete(oldest);
    }
  }

  return {
    get(key) {
      const at = now();
      const hit = bag.get(key);
      if (!hit) return undefined;
      if (hit.expiresAt <= at) {
        bag.delete(key);
        return undefined;
      }
      bag.delete(key);
      bag.set(key, hit);
      return hit.value;
    },
    set(key, value, ttlMs) {
      const ttl = Math.max(0, ttlMs);
      bag.delete(key);
      bag.set(key, { value, expiresAt: now() + ttl });
      evictOldest();
      if (bag.size % 64 === 0) sweep(now());
    },
    delete(key) {
      bag.delete(key);
    },
    clear() {
      bag.clear();
    },
    size() {
      sweep(now());
      return bag.size;
    },
  };
}

const publicStore = createTtlCache();

export const PUBLIC_CACHE_TTL_MS = 30_000;
export const PUBLIC_CACHE_CONTROL = 'public, max-age=30, stale-while-revalidate=60';

export function publicCacheKey(parts: Array<string | number | boolean | null | undefined>): string {
  // quality-scan #13(2026-08-23):裸 `|` 拼接不转义,组件值(如 filters JSON)含 `|`
  // 时不同查询命中同一缓存。改为「类型标记 + 长度前缀 + 原值」逐段编码:每段按
  // 长度自定界,值内任意字符(含 `|` / 引号 / 换行)都不影响段边界;undefined 与
  // null、数字与同形字符串分别编码(JSON 数组序列化会把 undefined/null 同归为
  // `null`,存在残余碰撞)。
  let key = '';
  for (const part of parts) {
    let tag: string;
    let raw: string;
    if (part === null) {
      tag = 'n';
      raw = '';
    } else if (part === undefined) {
      tag = 'u';
      raw = '';
    } else if (typeof part === 'string') {
      tag = 's';
      raw = part;
    } else if (typeof part === 'number' && Number.isNaN(part)) {
      tag = 'x';
      raw = '';
    } else if (typeof part === 'number') {
      tag = 'd';
      raw = String(part);
    } else {
      tag = 'b';
      raw = String(part);
    }
    key += `${tag}:${raw.length}:${raw}`;
  }
  return key;
}

export function readPublicCache<T>(key: string): T | undefined {
  return publicStore.get(key) as T | undefined;
}

export function writePublicCache<T>(key: string, value: T, ttlMs = PUBLIC_CACHE_TTL_MS): void {
  publicStore.set(key, value, ttlMs);
}

/** 测试用：读公开缓存的当前条数（会先清过期）。 */
export function publicCacheSize(): number {
  return publicStore.size();
}

export function resetPublicCache(): void {
  publicStore.clear();
}

/** Browser suggest LRU (tech/10: max 100, 5 minutes). Not the public API store. */
export const SUGGEST_CACHE_TTL_MS = 5 * 60 * 1000;
export const SUGGEST_CACHE_MAX = 100;

const suggestStore = createTtlCache(Date.now, { max: SUGGEST_CACHE_MAX });

export function suggestCacheKey(mode: string, q: string): string {
  return publicCacheKey(['suggest', mode, q.trim().toLowerCase()]);
}

export function readSuggestCache<T>(key: string): T | undefined {
  return suggestStore.get(key) as T | undefined;
}

export function writeSuggestCache<T>(key: string, value: T, ttlMs = SUGGEST_CACHE_TTL_MS): void {
  suggestStore.set(key, value, ttlMs);
}

export function resetSuggestCache(): void {
  suggestStore.clear();
}

export function suggestCacheSize(): number {
  return suggestStore.size();
}
