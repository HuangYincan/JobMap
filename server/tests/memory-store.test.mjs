// memory-store 单测:内存模式(poolOverride → null)与 DB 模式(fake pool)双覆盖。
// 语义对齐 account-store:读失败回落内存(可恢复),写失败抛 DbUnavailableError。
import test from 'node:test';
import assert from 'node:assert/strict';
import { DbUnavailableError } from '../src/lib/account-store.ts';
import {
  __memoryStoreTest,
  addMemory,
  clearMemories,
  listMemories,
  MEMORY_CONTENT_MAX,
  MEMORY_LIST_MAX,
  MEMORY_STORAGE_MAX,
  MEMORY_USER_STORE_MAX,
  removeMemory,
  sanitizeMemoryContent,
  memoryUserStoreSize,
} from '../src/lib/memory-store.ts';

// ---- sanitizeMemoryContent 纯函数 ----

test('sanitizeMemoryContent: 非 string / 空白 / 超长截断 200', () => {
  assert.equal(sanitizeMemoryContent(undefined), '');
  assert.equal(sanitizeMemoryContent(null), '');
  assert.equal(sanitizeMemoryContent(42), '');
  assert.equal(sanitizeMemoryContent({}), '');
  assert.equal(sanitizeMemoryContent('   '), '');
  assert.equal(sanitizeMemoryContent(''), '');
  assert.equal(sanitizeMemoryContent('  我喜欢杭州  '), '我喜欢杭州');
  assert.equal(sanitizeMemoryContent('字'.repeat(250)).length, MEMORY_CONTENT_MAX);
  assert.equal(sanitizeMemoryContent('字'.repeat(200)).length, 200);
  assert.equal(sanitizeMemoryContent('短'), '短');
});

// ---- 内存模式(poolOverride → null) ----

test('memory(内存模式): add/list/remove/clear + userId 隔离', async () => {
  __memoryStoreTest.poolOverride = () => null;
  try {
    await clearMemories('mem-a');
    await clearMemories('mem-b');

    await addMemory('mem-a', '我常驻杭州');
    await addMemory('mem-a', '我在找前端岗位');
    await addMemory('mem-b', '我喜欢上海');

    const a = await listMemories('mem-a');
    assert.equal(a.length, 2);
    assert.equal(a[0].content, '我在找前端岗位', '后写的最新,created_at DESC 语义(内存模式 unshift)');
    assert.equal(a[1].content, '我常驻杭州');
    assert.ok(a[0].id.length > 0 && typeof a[0].createdAt === 'string');

    const b = await listMemories('mem-b');
    assert.equal(b.length, 1);
    assert.equal(b[0].content, '我喜欢上海');

    // removeMemory 只删自己的
    await removeMemory('mem-b', a[0].id);
    assert.equal((await listMemories('mem-a')).length, 2, '删别人的 id 不影响他人');
    await removeMemory('mem-a', a[0].id);
    assert.equal((await listMemories('mem-a')).length, 1);

    // clear 只清自己的
    await clearMemories('mem-a');
    assert.equal((await listMemories('mem-a')).length, 0);
    assert.equal((await listMemories('mem-b')).length, 1, 'clear 不影响其它用户');
  } finally {
    __memoryStoreTest.poolOverride = undefined;
  }
});

test('memory(内存模式): 空内容不写入', async () => {
  __memoryStoreTest.poolOverride = () => null;
  try {
    await clearMemories('mem-empty');
    await addMemory('mem-empty', '   ');
    await addMemory('mem-empty', '');
    assert.equal((await listMemories('mem-empty')).length, 0);
  } finally {
    __memoryStoreTest.poolOverride = undefined;
  }
});

// ---- DB 模式(fake pool) ----

/** 极简 fake 池:按 SQL 分支维护行集,可注入读写故障;记录调用。 */
function fakeDb({ failRead = false, failWrite = false } = {}) {
  const rows = new Map();
  const calls = [];
  let nextId = 1;
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('SELECT') && failRead) throw new Error('read down');
      if (!sql.includes('SELECT') && failWrite) throw new Error('write down');
      if (sql.includes('SELECT') && sql.includes('user_memories')) {
        const items = rows.get(params[0]) ?? [];
        return { rows: items.map((m) => ({ id: String(m.id), content: m.content, created_at: new Date(m.createdAt) })), rowCount: items.length };
      }
      if (sql.includes('INSERT INTO user_memories')) {
        const arr = rows.get(params[0]) ?? [];
        arr.unshift({ id: nextId++, content: params[1], createdAt: '2026-08-22T00:00:00.000Z' });
        rows.set(params[0], arr);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('DELETE FROM user_memories')) {
        const arr = rows.get(params[0]) ?? [];
        if (sql.includes('id NOT IN')) {
          rows.set(params[0], arr.slice(0, params[1]));
        } else if (params.length > 1) {
          rows.set(params[0], arr.filter((m) => String(m.id) !== String(params[1])));
        } else {
          rows.set(params[0], []);
        }
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

test('memory(DB 模式): SQL 契约 — SELECT 按 user_id + LIMIT 50,INSERT 经 sanitize,删除带 user_id', async () => {
  const db = fakeDb();
  __memoryStoreTest.poolOverride = () => db;
  try {
    await clearMemories('db-1');
    await addMemory('db-1', '  我常驻杭州  ');
    await addMemory('db-1', '字'.repeat(250)); // 超长 → 截断 200
    const items = await listMemories('db-1');

    const listCall = db.calls.find((c) => c.sql.includes('SELECT'));
    assert.ok(listCall, '必须执行过 SELECT');
    assert.ok(listCall.sql.includes('FROM user_memories'), '查询 user_memories');
    assert.ok(listCall.sql.includes('WHERE user_id = $1'), '按 user_id 过滤');
    assert.ok(listCall.sql.includes('ORDER BY created_at DESC'), 'created_at DESC');
    assert.ok(listCall.sql.includes('LIMIT $2'), 'LIMIT 参数化');
    assert.equal(listCall.params[1], MEMORY_LIST_MAX, '上限 50');

    const inserts = db.calls.filter((c) => c.sql.includes('INSERT INTO user_memories'));
    assert.equal(inserts.length, 2);
    for (const insert of inserts) {
      assert.match(insert.sql, /ON CONFLICT \(user_id, content\) DO NOTHING/);
    }
    assert.equal(inserts[0].params[0], 'db-1');
    assert.equal(inserts[0].params[1], '我常驻杭州', 'trim 后入库');
    assert.equal(inserts[1].params[1].length, MEMORY_CONTENT_MAX, '超长截断 200 后入库');

    assert.equal(items.length, 2);
    assert.equal(items[0].content.length, MEMORY_CONTENT_MAX);
    assert.equal(items[0].createdAt, '2026-08-22T00:00:00.000Z');

    // removeMemory 带 user_id 条件
    await removeMemory('db-1', items[1].id);
    const del = db.calls.find((c) => c.sql.includes('DELETE FROM user_memories') && c.sql.includes('id = $2'));
    assert.ok(del.sql.includes('user_id = $1 AND id = $2'), '仅删自己的行');
    assert.equal((await listMemories('db-1')).length, 1);

    // clearMemories 按 user_id 清空
    await clearMemories('db-1');
    const delAll = db.calls.find((c) => c.sql.includes('DELETE FROM user_memories') && c.params.length === 1);
    assert.ok(delAll.sql.includes('user_id = $1'));
    assert.equal((await listMemories('db-1')).length, 0);
  } finally {
    __memoryStoreTest.poolOverride = undefined;
  }
});

test('memory: per-user storage is capped to the newest 50 facts', async () => {
  __memoryStoreTest.poolOverride = () => null;
  try {
    await clearMemories('mem-cap');
    for (let i = 0; i < MEMORY_STORAGE_MAX + 5; i += 1) {
      await addMemory('mem-cap', `fact-${String(i).padStart(2, '0')}`);
    }
    const items = await listMemories('mem-cap');
    assert.equal(items.length, MEMORY_STORAGE_MAX);
    assert.equal(items[0].content, `fact-${String(MEMORY_STORAGE_MAX + 4).padStart(2, '0')}`);
    assert.equal(items.at(-1)?.content, 'fact-05');
  } finally {
    __memoryStoreTest.poolOverride = undefined;
  }
});

test('memory(DB 模式): INSERT 后按 user_id 淘汰最旧行', async () => {
  const db = fakeDb();
  __memoryStoreTest.poolOverride = () => db;
  try {
    await addMemory('db-cap', '事实');
    const prune = db.calls.find((c) => c.sql.includes('DELETE FROM user_memories') && c.sql.includes('id NOT IN'));
    assert.ok(prune, 'INSERT 后必须执行总量裁剪');
    assert.match(prune.sql, /WHERE user_id = \$1/);
    assert.match(prune.sql, /ORDER BY created_at DESC, id DESC/);
    assert.match(prune.sql, /LIMIT \$2/);
    assert.deepEqual(prune.params, ['db-cap', MEMORY_STORAGE_MAX]);
  } finally {
    __memoryStoreTest.poolOverride = undefined;
  }
});

test('memory(DB 模式): userId 隔离', async () => {
  const db = fakeDb();
  __memoryStoreTest.poolOverride = () => db;
  try {
    await addMemory('db-a', '杭州');
    await addMemory('db-b', '上海');
    assert.equal((await listMemories('db-a')).length, 1);
    assert.equal((await listMemories('db-b')).length, 1);
    await clearMemories('db-a');
    assert.equal((await listMemories('db-a')).length, 0);
    assert.equal((await listMemories('db-b')).length, 1, 'DB 模式 clear 不越界');
  } finally {
    __memoryStoreTest.poolOverride = undefined;
  }
});

test('memory(DB 模式): 读失败回落(可恢复,返回空/内存),写失败抛 DbUnavailableError', async () => {
  const down = fakeDb({ failRead: true, failWrite: true });
  __memoryStoreTest.poolOverride = () => down;
  try {
    // 读失败 → 回落,不抛
    assert.deepEqual(await listMemories('db-down'), []);
    // 写失败 → DbUnavailableError(绝不静默回落内存)
    await assert.rejects(addMemory('db-down', '内容'), DbUnavailableError);
    await assert.rejects(removeMemory('db-down', '1'), DbUnavailableError);
    await assert.rejects(clearMemories('db-down'), DbUnavailableError);
    // 故障期间内存不残留(写从未成功)
    assert.equal((await listMemories('db-down')).length, 0);
  } finally {
    __memoryStoreTest.poolOverride = undefined;
  }
});

test('memory(内存模式): fallback user keys are capped to a bounded LRU', async () => {
  __memoryStoreTest.poolOverride = () => null;
  try {
    const firstUser = 'memory-user-000';
    await clearMemories(firstUser);
    for (let i = 0; i < MEMORY_USER_STORE_MAX + 1; i += 1) {
      const userId = `memory-user-${String(i).padStart(3, '0')}`;
      await addMemory(userId, `preference-${i}`);
    }

    assert.equal(memoryUserStoreSize(), MEMORY_USER_STORE_MAX);
    assert.deepEqual(await listMemories(firstUser), [], 'inactive oldest user is evicted');
    assert.deepEqual(
      (await listMemories(`memory-user-${String(MEMORY_USER_STORE_MAX).padStart(3, '0')}`))
        .map((item) => item.content),
      [`preference-${MEMORY_USER_STORE_MAX}`],
    );
  } finally {
    __memoryStoreTest.poolOverride = undefined;
  }
});
