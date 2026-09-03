import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationDir = join(root, 'db', 'migrations');
const migration = readFileSync(join(migrationDir, '023_recruitment_source_record_fk.sql'), 'utf8');
const importer = readFileSync(join(root, 'server', 'src', 'lib', 'recruitment-import.ts'), 'utf8');

function migrationNumbers() {
  return readdirSync(migrationDir)
    .filter((name) => /^\d{3}_[^/]+\.sql$/.test(name))
    .map((name) => Number(name.slice(0, 3)))
    .sort((a, b) => a - b);
}

test('023 is the latest ordered migration and does not rewrite recruitment rows', () => {
  const numbers = migrationNumbers();
  assert.equal(numbers.at(-1), 23);
  assert.equal(numbers.filter((number) => number === 23).length, 1);
  assert.match(migration, /ENV_ONLY/);
  assert.match(migration, /company_sites_source_record_fkey/);
  assert.match(migration, /positions_source_record_fkey/);
  assert.match(migration, /FOREIGN KEY \(source_record_id, source_id\)/);
  assert.match(migration, /REFERENCES public\.source_records \(id, source_id\)/);
  assert.match(migration, /Read-only diagnostic SQL:/);
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+public\.(?:positions|company_sites|source_records)\b/i);
});

test('import apply writes source_record ids onto sites and positions', () => {
  assert.match(importer, /async function upsertSourceRecord\(/);
  assert.match(importer, /RETURNING id::text/);
  assert.match(importer, /const sourceRecordId = await upsertSourceRecord/);
  assert.match(importer, /siteRecordId = await upsertSourceRecord/);
  assert.match(importer, /source_record_id = EXCLUDED\.source_record_id/);
  assert.match(importer, /INSERT INTO company_sites \([^)]*source_record_id\)/);
});
