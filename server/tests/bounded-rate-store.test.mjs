import test from 'node:test';
import assert from 'node:assert/strict';

import { BoundedRateStore } from '../src/lib/bounded-rate-store.ts';

test('BoundedRateStore expires entries and sweeps stale buckets', () => {
  const store = new BoundedRateStore(4);
  store.set('a', { hits: 1 }, 1_000, 1_000);
  assert.deepEqual(store.get('a', 1_200), { hits: 1 });
  assert.equal(store.get('a', 2_001), undefined);
  assert.equal(store.size, 0);

  store.set('old', 1, 1_000, 1_000);
  store.set('live', 2, 10_000, 1_000);
  assert.equal(store.sweepExpired(2_000), 1);
  assert.equal(store.size, 1);
});

test('BoundedRateStore keeps a hard ceiling and evicts the least recently used key', () => {
  const store = new BoundedRateStore(2);
  const now = 5_000;
  store.set('a', 'a', 60_000, now);
  store.set('b', 'b', 60_000, now);
  assert.equal(store.get('a', now), 'a');
  store.set('c', 'c', 60_000, now + 1);

  assert.equal(store.size, 2);
  assert.equal(store.capacity, 2);
  assert.equal(store.get('b', now + 2), undefined, 'least recently used bucket is evicted');
  assert.equal(store.get('a', now + 2), 'a');
  assert.equal(store.get('c', now + 2), 'c');
});

test('BoundedRateStore rejects unsafe bounds and TTLs', () => {
  assert.throws(() => new BoundedRateStore(0), /maxEntries/);
  const store = new BoundedRateStore(1);
  assert.throws(() => store.set('x', 1, 0), /ttlMs/);
});
