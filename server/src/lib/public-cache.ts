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

export function createTtlCache<T = unknown>(now: () => number = Date.now): CacheStore<T> {
  const bag = new Map<string, Entry<T>>();

  function sweep(at: number) {
    for (const [key, entry] of bag) {
      if (entry.expiresAt <= at) bag.delete(key);
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
      return hit.value;
    },
    set(key, value, ttlMs) {
      const ttl = Math.max(0, ttlMs);
      bag.set(key, { value, expiresAt: now() + ttl });
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
  return parts.map((part) => (part == null ? '' : String(part))).join('|');
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
