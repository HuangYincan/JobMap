/**
 * Process-local rate-limit state must have a memory ceiling. Unlike a plain
 * Map, this store bounds the number of keys an attacker can cause it to hold.
 * When the bound is reached, the oldest entry is sacrificed; the alternative
 * would be unbounded allocation during a key-rotation flood.
 */
export class BoundedRateStore<T> {
  private entries = new Map<string, { value: T; expiresAt: number }>();
  private maxEntries: number;

  constructor(maxEntries = 10_000) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error('maxEntries must be a positive integer');
    }
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.entries.size;
  }

  get capacity(): number {
    return this.maxEntries;
  }

  get(key: string, now = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh insertion order so actively attacked accounts are not the first
    // candidates for eviction when a flood fills unrelated buckets.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number, now = Date.now()): void {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error('ttlMs must be a positive finite number');
    }
    this.sweepExpired(now);
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: now + ttlMs });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  sweepExpired(now = Date.now()): number {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt > now) continue;
      this.entries.delete(key);
      removed += 1;
    }
    return removed;
  }
}
