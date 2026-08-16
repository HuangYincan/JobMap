import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dedupeSourceCompanies,
  planRecruitmentImport,
  planSeedImport,
  validateSourceCompany,
} from '../src/lib/recruitment-import.ts';
import { poiToSourceCompany } from '../src/lib/recruitment-source.ts';
import { WORK_SEED } from '../src/lib/seed-data.ts';

function sample() {
  return poiToSourceCompany(WORK_SEED[0]);
}

test('validateSourceCompany accepts the first work seed company', () => {
  assert.deepEqual(validateSourceCompany(sample()), []);
});

test('validateSourceCompany flags a position that points at a missing site', () => {
  const company = sample();
  company.positions[0].siteId = 'no-such-site';
  const issues = validateSourceCompany(company);
  assert.ok(issues.some((row) => row.field === 'positions.siteId'));
});

test('dedupeSourceCompanies merges sites and unique positions on the same slug', () => {
  const a = sample();
  const b = sample();
  b.sites = [{ id: `${a.sites[0].id}-east`, name: '东区', location: { lng: 120.2, lat: 30.2 } }];
  b.positions = [
    {
      ...a.positions[0],
      externalId: `${a.positions[0].externalId}-east`,
      siteId: b.sites[0].id,
    },
  ];
  const [merged] = dedupeSourceCompanies([a, b]);
  assert.equal(merged.sites.length, 2);
  assert.ok(merged.positions.some((p) => p.externalId === b.positions[0].externalId));
});

test('planRecruitmentImport drops invalid companies and keeps the rest', () => {
  const good = sample();
  const bad = { ...sample(), slug: 'broken', name: '', sites: [], positions: [] };
  const plan = planRecruitmentImport([good, bad]);
  assert.equal(plan.companies.length, 1);
  assert.equal(plan.dropped, 1);
  assert.ok(plan.issues.length > 0);
});

test('planSeedImport accepts every current WORK_SEED company', async () => {
  const plan = await planSeedImport();
  assert.equal(plan.dropped, 0);
  assert.equal(plan.issues.length, 0);
  assert.ok(plan.companies.length >= 50);
  assert.ok(plan.companies.every((c) => c.sites.length >= 1));
  assert.ok(plan.companies.every((c) => c.positions.every((p) => c.sites.some((s) => s.id === p.siteId))));
});
