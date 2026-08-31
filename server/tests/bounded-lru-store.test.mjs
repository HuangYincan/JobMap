import test from 'node:test';
import assert from 'node:assert/strict';

import { BoundedLruStore } from '../src/lib/bounded-lru-store.ts';

test('BoundedLruStore rejects a non-positive ceiling', () => {
  assert.throws(() => new BoundedLruStore(0), /maxEntries must be a positive integer/);
});

test('BoundedLruStore keeps the newest entries and refreshes active reads', () => {
  const store = new BoundedLruStore(2);
  store.set('a', 'first');
  store.set('b', 'second');

  assert.equal(store.get('a'), 'first');
  store.set('c', 'third');

  assert.equal(store.size, 2);
  assert.equal(store.get('a'), 'first', 'a read refreshes it against eviction');
  assert.equal(store.get('b'), undefined, 'the inactive oldest entry is evicted');
  assert.equal(store.get('c'), 'third');

  store.delete('a');
  assert.equal(store.size, 1);
  store.clear();
  assert.equal(store.size, 0);
});
