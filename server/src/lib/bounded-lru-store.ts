/**
 * Process-local durable-style state needs a hard ceiling without inventing an
 * artificial TTL. Refreshing insertion order on reads keeps active users from
 * being sacrificed during a flood of one-shot keys.
 */
export class BoundedLruStore<T> {
  private items = new Map<string, T>();
  private maxEntries: number;

  constructor(maxEntries = 1_000) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error('maxEntries must be a positive integer');
    }
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.items.size;
  }

  get capacity(): number {
    return this.maxEntries;
  }

  keys(): IterableIterator<string> {
    return this.items.keys();
  }

  values(): IterableIterator<T> {
    return this.items.values();
  }

  entries(): IterableIterator<[string, T]> {
    return this.items.entries();
  }

  *[Symbol.iterator](): IterableIterator<[string, T]> {
    yield* this.items;
  }

  has(key: string): boolean {
    return this.items.has(key);
  }

  get(key: string): T | undefined {
    const value = this.items.get(key);
    if (value === undefined) return undefined;
    this.items.delete(key);
    this.items.set(key, value);
    return value;
  }

  set(key: string, value: T): void {
    this.items.delete(key);
    while (this.items.size >= this.maxEntries) {
      const oldest = this.items.keys().next().value;
      if (oldest === undefined) break;
      this.items.delete(oldest);
    }
    this.items.set(key, value);
  }

  delete(key: string): void {
    this.items.delete(key);
  }

  clear(): void {
    this.items.clear();
  }
}
