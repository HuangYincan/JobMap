import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationDir = join(root, 'db', 'migrations');
const baseline = readFileSync(join(migrationDir, '013_hangzhou_pois.sql'), 'utf8');
const migration = readFileSync(join(migrationDir, '022_hz_pois_photos_shape.sql'), 'utf8');
const store = readFileSync(join(root, 'server', 'src', 'lib', 'hz-poi-store.ts'), 'utf8');

function migrationNumbers() {
  return readdirSync(migrationDir)
    .filter((name) => /^\d{3}_[^/]+\.sql$/.test(name))
    .map((name) => Number(name.slice(0, 3)))
    .sort((a, b) => a - b);
}

test('022 is the next ordered migration and leaves 013 photos default unchanged', () => {
  const numbers = migrationNumbers();
  assert.equal(numbers.at(-1), 22);
  assert.equal(numbers.filter((number) => number === 22).length, 1);
  assert.match(baseline, /photos\s+jsonb NOT NULL DEFAULT '\[\]'/);
});

test('022 preflights historical dirty photos and fails closed without repair SQL', () => {
  const preflightAt = migration.indexOf('SELECT count(*)');
  const ddlAt = migration.indexOf('ADD CONSTRAINT hz_pois_photos_array_check');

  assert.ok(preflightAt >= 0, 'historical photos preflight count must exist');
  assert.ok(ddlAt > preflightAt, 'preflight must run before shape constraint DDL');
  assert.match(migration, /jsonb_typeof\(photos\)\s*<>\s*'array'/);
  assert.match(migration, /CHECK \(jsonb_typeof\(photos\) = 'array'\)/);
  assert.match(migration, /Read-only diagnostic SQL:/);
  assert.match(migration, /ENV_ONLY/);
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+public\.hz_pois\b/i);
});

test('public jsonb_array_length paths normalize non-array legacy values to []', () => {
  assert.match(
    store,
    /jsonb_array_length\(CASE WHEN jsonb_typeof\(\$\{column\}\) = 'array' THEN \$\{column\} ELSE '\[\]'::jsonb END\)/,
  );
  const guardedCalls = store.match(/photosArrayLengthSql\('p\.photos'\)/g) ?? [];
  assert.ok(guardedCalls.length >= 3, 'list, order, and suggest paths must all be guarded');
  assert.doesNotMatch(store, /jsonb_array_length\(p\.photos\)/);
});
