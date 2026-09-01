import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationDir = join(repoRoot, 'db', 'migrations');
const baseline = readFileSync(join(migrationDir, '006_recruitment_sites.sql'), 'utf8');
const migration = readFileSync(
  join(migrationDir, '020_position_site_company_fk.sql'),
  'utf8',
);

test('020 has no skipped predecessor and 022 follows current migrations', () => {
  const migrationNumbers = readdirSync(migrationDir)
    .filter((name) => /^\d{3}_[^/]+\.sql$/.test(name))
    .map((name) => Number(name.slice(0, 3)))
    .sort((a, b) => a - b);
  const priorNumbers = migrationNumbers.filter((number) => number < 20);

  assert.equal(priorNumbers.at(-1), 19);
  assert.equal(migrationNumbers.filter((number) => number === 20).length, 1);
  assert.equal(migrationNumbers.filter((number) => number === 21).length, 1);
  assert.equal(migrationNumbers.filter((number) => number === 22).length, 1);
  assert.equal(migrationNumbers.at(-1), 22);
});

test('006 has independent company and site foreign keys', () => {
  // Reconfirm the finding: each column independently references a valid row,
  // so the old schema does not assert that both rows belong to the same company.
  assert.match(
    baseline,
    /company_id bigint NOT NULL REFERENCES companies\(id\) ON DELETE CASCADE/,
  );
  assert.match(
    baseline,
    /site_id bigint NOT NULL REFERENCES company_sites\(id\) ON DELETE RESTRICT/,
  );
  assert.doesNotMatch(
    baseline,
    /FOREIGN KEY\s*\(\s*site_id\s*,\s*company_id\s*\)/,
  );
});

test('020 preflight reports and blocks legacy cross-company rows', () => {
  const preflightAt = migration.indexOf('SELECT count(*)');
  const uniqueKeyAt = migration.indexOf(
    'CREATE UNIQUE INDEX IF NOT EXISTS company_sites_id_company_id_uidx',
  );
  const compositeFkAt = migration.indexOf(
    'ADD CONSTRAINT positions_site_company_fkey',
  );

  assert.ok(preflightAt >= 0, 'preflight count must exist');
  assert.ok(uniqueKeyAt > preflightAt, 'preflight must run before DDL');
  assert.ok(compositeFkAt > uniqueKeyAt, 'FK must follow the unique key');
  assert.match(
    migration,
    /FROM public\.positions AS p\s+JOIN public\.company_sites AS s ON s\.id = p\.site_id\s+WHERE p\.company_id IS DISTINCT FROM s\.company_id/s,
  );
  assert.match(migration, /RAISE EXCEPTION USING/);
  assert.match(migration, /Read-only diagnostic SQL:/);
  assert.match(migration, /ORDER BY p\.id/);
  assert.doesNotMatch(
    migration,
    /\b(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+public\.positions\b/i,
  );
});

test('020 adds an idempotent ownership-matching FK and preserves delete actions', () => {
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS company_sites_id_company_id_uidx\s+ON public\.company_sites \(id, company_id\);/s,
  );
  assert.match(migration, /pg_constraint/);
  assert.match(migration, /conname = 'positions_site_company_fkey'/);
  assert.match(
    migration,
    /FOREIGN KEY \(site_id, company_id\)\s+REFERENCES public\.company_sites \(id, company_id\)\s+ON DELETE RESTRICT/s,
  );
  assert.doesNotMatch(migration, /DROP\s+CONSTRAINT/i);
  assert.match(baseline, /company_id bigint NOT NULL REFERENCES companies\(id\) ON DELETE CASCADE/);
  assert.match(baseline, /site_id bigint NOT NULL REFERENCES company_sites\(id\) ON DELETE RESTRICT/);
});
