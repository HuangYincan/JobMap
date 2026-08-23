import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTtlCache,
  PUBLIC_CACHE_TTL_MS,
  PUBLIC_CACHE_MAX,
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

test('publicCacheKey encodes missing parts with explicit tag', () => {
  assert.equal(publicCacheKey(['work', undefined, 'q']), 's:4:worku:0:s:1:q');
});

test('publicCacheKey:组件值含 | 不碰撞(quality-scan #13)', () => {
  // 旧拼接 `a|b|c` 下两组输入同 key;长度前缀编码后必须不同
  assert.notEqual(publicCacheKey(['a|b', 'c']), publicCacheKey(['a', 'b|c']));
  // 同输入必须同 key(确定性)
  assert.equal(publicCacheKey(['a|b', 'c']), publicCacheKey(['a|b', 'c']));
  // undefined 与 null 分别编码(JSON 数组序列化会把两者同归为 null)
  assert.notEqual(publicCacheKey(['x', undefined]), publicCacheKey(['x', null]));
  // 类型标记:数字/布尔与同形字符串不碰撞
  assert.notEqual(publicCacheKey([1]), publicCacheKey(['1']));
  assert.notEqual(publicCacheKey([true]), publicCacheKey(['true']));
  // 值内换行/引号不破坏定界
  assert.notEqual(publicCacheKey(['a\nb', 'c']), publicCacheKey(['a', 'b\nc']));
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

test('public response cache is bounded against unique query flooding', () => {
  resetPublicCache();
  for (let i = 0; i < PUBLIC_CACHE_MAX + 1; i += 1) {
    writePublicCache(`unique:${i}`, { i }, PUBLIC_CACHE_TTL_MS);
  }
  assert.equal(publicCacheSize(), PUBLIC_CACHE_MAX);
  assert.equal(readPublicCache('unique:0'), undefined);
  assert.deepEqual(readPublicCache(`unique:${PUBLIC_CACHE_MAX}`), { i: PUBLIC_CACHE_MAX });
  resetPublicCache();
});

test('suggest cache is a separate 5-minute LRU', () => {
  resetSuggestCache();
  writeSuggestCache(suggestCacheKey('work', ' 阿里 '), { suggestions: [] });
  assert.deepEqual(readSuggestCache(suggestCacheKey('work', '阿里')), { suggestions: [] });
  assert.equal(suggestCacheSize(), 1);
  resetSuggestCache();
  assert.equal(suggestCacheSize(), 0);
});
