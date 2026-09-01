import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorkSuggestionsFromDb, searchWorkSitesForPlace, countWorkTagMatchesBatchFromDb } from '../src/lib/recruitment-store.ts';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function rowsFor(sql) {
  if (sql.includes("'company'::text")) return [{
    kind: 'company', slug: 'acme', company_name: 'Acme', industries: [], summary: null,
    logo_emoji: null, site_id: '1', site_count: '1', lng: 120.1, lat: 30.2,
  }];
  if (sql.includes("'job'::text")) return [];
  return [{ count_0: '2', count_1: '3', count_2: '4' }];
}

test('work suggestions escape LIKE metacharacters and emit ESCAPE clauses', async () => {
  const calls = [];
  const pool = { async query(sql, params) { calls.push({ sql, params }); return { rows: rowsFor(sql) }; } };
  await loadWorkSuggestionsFromDb(String.raw`100%_\\now`, 10, pool);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ sql }) => /ILIKE \$\d+ ESCAPE E'\\\\'/.test(sql)));
  assert.ok(calls.some(({ params }) => params.some((value) => typeof value === 'string' && value.startsWith('100\\%\\_') && value.endsWith('now%'))));
});

test('work site search escapes term and city patterns with bound parameters', async () => {
  const calls = [];
  const pool = { async query(sql, params) {
    calls.push({ sql, params });
    return { rows: [{ slug: 'acme', company_name: 'Acme', site_id: '1', site_name: 'HQ', address: null, city: '杭州', lng: 120.1, lat: 30.2 }] };
  } };
  await searchWorkSitesForPlace(['a_b%\\c'], '杭_%', 8, pool);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /ILIKE \$1 ESCAPE E'\\\\'/);
  assert.match(calls[0].sql, /ILIKE \$2 ESCAPE E'\\\\'/);
  assert.ok(calls[0].params.includes('%a\\_b\\%\\\\c%'));
  assert.ok(calls[0].params.includes('%杭\\_\\%%'));
});

test('tag counts batch into one aggregate query and keep output order', async () => {
  const calls = [];
  const pool = { async query(sql, params) {
    calls.push({ sql, params });
    return { rows: [{ count_0: '7', count_1: '8', count_2: '9' }] };
  } };
  const counts = await countWorkTagMatchesBatchFromDb([
    { key: 'scale', value: 'bigtech' },
    { key: 'education', value: '硕士' },
    { key: 'roleFamily', value: 'tech' },
  ], pool);
  assert.deepEqual(counts, [7, 8, 9]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FILTER \(WHERE c\.scale = \$1\)/);
  assert.match(calls[0].sql, /FILTER \(WHERE p\.education = \$2\)/);
  assert.match(calls[0].sql, /FILTER \(WHERE concat_ws/);
  assert.deepEqual(calls[0].params.slice(0, 2), ['bigtech', '硕士']);
});

test('unsupported persisted-free tags return zero without a database query', async () => {
  let calls = 0;
  const pool = { async query() { calls += 1; return { rows: [] }; } };
  const counts = await countWorkTagMatchesBatchFromDb([
    { key: 'providesHousing', value: 'true' },
    { key: 'providesShuttle', value: 'true' },
  ], pool);
  assert.deepEqual(counts, [0, 0]);
  assert.equal(calls, 0);
});

test('suggest route uses one batched tag-count query rather than per-tag Promise.all', () => {
  const route = readFileSync(join(srcRoot, 'app/api/suggest/route.ts'), 'utf8');
  assert.match(route, /countWorkTagMatchesBatchFromDb/);
  assert.doesNotMatch(route, /Promise\.all\(tags\.map/);
});
