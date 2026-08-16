import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTtlCache,
  publicCacheKey,
  publicCacheSize,
  readPublicCache,
  resetPublicCache,
  writePublicCache,
  readSuggestCache,
  resetSuggestCache,
  suggestCacheKey,
  suggestCacheSize,
  writeSuggestCache,
} from '../src/lib/public-cache.ts';

test('createTtlCache expires entries after ttl', () => {
  let now = 1_000;
  const cache = createTtlCache(() => now);
  cache.set('a', 1, 50);
  assert.equal(cache.get('a'), 1);
  now = 1_049;
  assert.equal(cache.get('a'), 1);
  now = 1_050;
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.size(), 0);
});

test('publicCacheKey joins missing parts as empty slots', () => {
  assert.equal(publicCacheKey(['work', undefined, 'q']), 'work||q');
});

test('read/writePublicCache share one store', () => {
  resetPublicCache();
  writePublicCache('modes|false', { modes: [] }, 60_000);
  assert.deepEqual(readPublicCache('modes|false'), { modes: [] });
  assert.equal(publicCacheSize(), 1);
  resetPublicCache();
  assert.equal(publicCacheSize(), 0);
});

test('createTtlCache evicts the oldest key when max is reached', () => {
  const cache = createTtlCache(() => 1_000, { max: 2 });
  cache.set('a', 1, 60_000);
  cache.set('b', 2, 60_000);
  cache.set('c', 3, 60_000);
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('b'), 2);
  assert.equal(cache.get('c'), 3);
});

test('suggest cache is a separate 5-minute LRU', () => {
  resetSuggestCache();
  writeSuggestCache(suggestCacheKey('work', ' 阿里 '), { suggestions: [] });
  assert.deepEqual(readSuggestCache(suggestCacheKey('work', '阿里')), { suggestions: [] });
  assert.equal(suggestCacheSize(), 1);
  resetSuggestCache();
  assert.equal(suggestCacheSize(), 0);
});
