import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addGuestHistory,
  clearGuestHistory,
  GUEST_HISTORY_CAP,
  GUEST_HISTORY_KEY,
  listGuestHistory,
} from '../src/lib/guest-search-history.ts';

function installMemoryStorage() {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
      removeItem(key) {
        store.delete(key);
      },
    },
  };
  return store;
}

test('guest history uses the versioned localStorage key', () => {
  const store = installMemoryStorage();
  addGuestHistory('阿里巴巴', 'work');
  assert.ok(store.has(GUEST_HISTORY_KEY));
  assert.equal(store.has('search_history'), false);
});

test('guest history writes persistable queries and ignores domain', () => {
  installMemoryStorage();
  addGuestHistory('阿里巴巴', 'work');
  addGuestHistory('西湖', 'domain');
  const items = listGuestHistory();
  assert.equal(items.length, 1);
  assert.equal(items[0].query, '阿里巴巴');
  assert.equal(items[0].mode, 'work');
});

test('guest history dedupes query+mode, caps, and clears', () => {
  installMemoryStorage();
  addGuestHistory('前端', 'work');
  addGuestHistory('后端', 'work');
  addGuestHistory('前端', 'work');
  let items = listGuestHistory();
  assert.equal(items.length, 2);
  assert.equal(items[0].query, '前端');
  assert.equal(items[1].query, '后端');

  for (let i = 0; i < GUEST_HISTORY_CAP + 5; i += 1) {
    addGuestHistory(`q${i}`, 'work');
  }
  items = listGuestHistory();
  assert.equal(items.length, GUEST_HISTORY_CAP);

  clearGuestHistory();
  assert.equal(listGuestHistory().length, 0);
});
