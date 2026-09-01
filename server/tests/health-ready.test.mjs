import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkDatabaseReadiness, READINESS_QUERY } from '../src/lib/db.ts';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function poolWith(rows) {
  return {
    async query(sql) {
      assert.equal(sql, READINESS_QUERY);
      return { rows };
    },
  };
}

test('database readiness requires the minimum Work-mode tables', async () => {
  assert.equal(await checkDatabaseReadiness(poolWith([
    { has_companies: true, has_company_sites: true, has_positions: true },
  ])), true);
  assert.equal(await checkDatabaseReadiness(poolWith([
    { has_companies: true, has_company_sites: false, has_positions: true },
  ])), false);
  assert.equal(await checkDatabaseReadiness(null), false);
});

test('database readiness fails closed on query errors', async () => {
  const pool = { async query() { throw new Error('database unavailable'); } };
  assert.equal(await checkDatabaseReadiness(pool), false);
});

test('readiness route is uncached and returns only generic health status', () => {
  const route = readFileSync(join(srcRoot, 'app/api/health/ready/route.ts'), 'utf8');
  assert.match(route, /checkDatabaseReadiness\(getPool\(\)\)/);
  assert.match(route, /'Cache-Control': 'no-store'/);
  assert.match(route, /status: ready \? 200 : 503/);
  assert.doesNotMatch(route, /DATABASE_URL|POSTGRES_PASSWORD|connectionString/);
});
