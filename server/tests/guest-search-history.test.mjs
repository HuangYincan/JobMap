import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addGuestHistory,
  clearGuestHistory,
  GUEST_HISTORY_CAP,
  GUEST_HISTORY_KEY,
  listGuestHistory,
  mergeGuestHistoryIntoAccount,
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

test('guest history persists entity refs and keeps plain rows plain', () => {
  installMemoryStorage();
  addGuestHistory('字节跳动', 'work', {
    kind: 'company',
    id: 'bytedance-hz',
    name: '字节跳动',
    lng: 120.1,
    lat: 30.2,
    address: '余杭区',
  });
  addGuestHistory('纯关键词', 'work');
  const items = listGuestHistory();
  assert.equal(items.length, 2);
  // 后加的在最前
  const entityRow = items.find((i) => i.query === '字节跳动');
  const plainRow = items.find((i) => i.query === '纯关键词');
  assert.deepEqual(entityRow.entity, {
    kind: 'company',
    id: 'bytedance-hz',
    name: '字节跳动',
    lng: 120.1,
    lat: 30.2,
    address: '余杭区',
  });
  assert.equal(plainRow.entity, undefined);
  assert.equal('entity' in plainRow, false);
});

test('guest history tolerates legacy rows without entity and strips corrupt entity', () => {
  const store = installMemoryStorage();
  store.set(
    GUEST_HISTORY_KEY,
    JSON.stringify([
      { id: 'legacy-1', query: '旧记录', mode: 'work', createdAt: '2026-08-01T00:00:00Z' },
      { id: 'broken-1', query: '损坏', mode: 'work', createdAt: '2026-08-02T00:00:00Z', entity: { nope: true } },
      { id: 'good-1', query: '完好', mode: 'work', createdAt: '2026-08-03T00:00:00Z', entity: { kind: 'company', id: 'c1', name: '完好' } },
    ]),
  );
  const items = listGuestHistory();
  assert.equal(items.length, 3);
  const good = items.find((i) => i.id === 'good-1');
  assert.deepEqual(good.entity, { kind: 'company', id: 'c1', name: '完好' });
  // 旧数据无 entity 字段 → 原样保留（纯搜索回放），不新增空 entity 键
  const legacy = items.find((i) => i.id === 'legacy-1');
  assert.equal(legacy.entity, undefined);
  assert.equal('entity' in legacy, false);
  // 结构损坏的 entity 被剥离
  const broken = items.find((i) => i.id === 'broken-1');
  assert.equal(broken.entity, undefined);
  assert.equal('entity' in broken, false);
});

test('guest merge upload carries entity refs for entity rows', async () => {
  installMemoryStorage();
  addGuestHistory('字节跳动', 'work', { kind: 'company', id: 'bytedance-hz', name: '字节跳动' });
  addGuestHistory('纯关键词', 'work');

  const calls = [];
  await mergeGuestHistoryIntoAccount({
    fetchImpl: async (url, init) => {
      calls.push(JSON.parse(String(init.body)));
      return { ok: true };
    },
    cloud: [],
  });
  const byEntity = calls.find((c) => c.query === '字节跳动');
  const plain = calls.find((c) => c.query === '纯关键词');
  assert.deepEqual(byEntity.entity, { kind: 'company', id: 'bytedance-hz', name: '字节跳动' });
  assert.equal('entity' in plain, false);
});

test('mergeGuestHistoryIntoAccount uploads only rows absent from cloud', async () => {
  installMemoryStorage();
  addGuestHistory('前端', 'work');
  addGuestHistory('后端', 'work');
  addGuestHistory('西湖', 'domain'); // non-persistable — never uploaded

  const calls = [];
  const uploaded = await mergeGuestHistoryIntoAccount({
    fetchImpl: async (url, init) => {
      calls.push(JSON.parse(String(init.body)));
      return { ok: true };
    },
    cloud: [{ id: 'x', query: '前端', mode: 'work', createdAt: '2026-08-17' }],
  });
  assert.deepEqual(uploaded.map((i) => i.query), ['后端']);
  assert.deepEqual(calls.map((c) => c.query), ['后端']);
  // Local mirror is kept — sign-out still restores it.
  assert.equal(listGuestHistory().length, 2);
});

test('mergeGuestHistoryIntoAccount keeps failed rows local and survives offline', async () => {
  installMemoryStorage();
  addGuestHistory('算法', 'work');

  const uploaded = await mergeGuestHistoryIntoAccount({
    fetchImpl: async () => {
      throw new Error('offline');
    },
    loadCloud: async () => [],
  });
  assert.deepEqual(uploaded, []);
  assert.equal(listGuestHistory().length, 1); // row survives for a later merge
});
