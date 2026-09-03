import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sql = readFileSync(
  join(repoRoot, 'db', 'scripts', 'repair-020-position-site-company.sql'),
  'utf8',
);
const sh = readFileSync(
  join(repoRoot, 'db', 'scripts', 'repair-020-position-site-company.sh'),
  'utf8',
);

test('020 repair retargets site_id only and stays out of the migration ledger', () => {
  assert.match(sql, /ENV_ONLY/);
  assert.match(sql, /never merges companies/i);
  assert.match(sql, /UPDATE public\.positions/);
  assert.match(sql, /SET site_id = r\.new_site_id/);
  assert.doesNotMatch(sql, /\bUPDATE\s+public\.companies\b/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\s+public\.(?:positions|company_sites|companies)\b/i);
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\s+public\.(?:positions|company_sites|companies)\b/i);
  assert.match(sql, /NOT EXISTS \(/);
  assert.match(sql, /cross-company position\/site row\(s\) remain/);
  assert.match(sh, /ON_ERROR_STOP=1/);
  assert.match(sh, /repair-020-position-site-company\.sql/);
});
