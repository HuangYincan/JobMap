// Public catalog: seed when there is no DB; imported work rows when Postgres has them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { INTERNSHIP_SEED } from '../src/lib/seed-data.ts';
import {
  loadServerCatalog,
  loadServerCatalogById,
  serverCatalog,
  serverCatalogById,
} from '../src/lib/server-catalog.ts';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function src(rel) {
  return readFileSync(join(srcRoot, rel), 'utf8');
}

test('sync catalog is still the seed (tests and dry helpers)', () => {
  const work = serverCatalog('work');
  assert.equal(work.length, INTERNSHIP_SEED.length);
  assert.ok(work.every((p) => p.kind === 'recruitment'));
  assert.ok(serverCatalogById('work', 'alibaba-xixi'));
  assert.equal(serverCatalogById('domain', 'hz-westlake')?.name, '西湖');
  assert.equal(serverCatalog('college').length, 0);
});

test('async catalog falls back to the same seed without DATABASE_URL', async () => {
  const work = await loadServerCatalog('work');
  assert.equal(work.length, INTERNSHIP_SEED.length);
  const ali = await loadServerCatalogById('work', 'alibaba-xixi');
  assert.equal(ali?.id, 'alibaba-xixi');
  const westlake = await loadServerCatalogById('domain', 'hz-westlake');
  assert.equal(westlake?.name, '西湖');
});

test('loadWorkCatalogFromDb joins companies + sites + open positions', () => {
  const store = src('lib/recruitment-store.ts');
  assert.match(store, /FROM companies ORDER BY slug/);
  assert.match(store, /FROM company_sites/);
  assert.match(store, /FROM positions WHERE status = 'open'/);
  assert.match(store, /companySites\.length === 1 \? company\.slug : `\$\{company\.slug\}:\$\{site\.id\}`/);
  assert.match(store, /return null/);
});

test('loadServerCatalog prefers imported work rows, then seed', () => {
  const catalog = src('lib/server-catalog.ts');
  assert.match(catalog, /loadWorkCatalogFromDb/);
  assert.match(catalog, /if \(imported && imported\.length > 0\) return imported/);
  assert.match(catalog, /return INTERNSHIP_SEED/);
});
