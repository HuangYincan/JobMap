#!/usr/bin/env node
// Plan the seed recruitment import. Pass --apply to upsert when DATABASE_URL is set.
import { applyRecruitmentImport, planSeedImport } from '../src/lib/recruitment-import.ts';

const apply = process.argv.includes('--apply');
const plan = await planSeedImport();
const sites = plan.companies.reduce((n, c) => n + c.sites.length, 0);
const positions = plan.companies.reduce((n, c) => n + c.positions.length, 0);
const result = apply ? await applyRecruitmentImport(plan) : null;
console.log(
  JSON.stringify(
    {
      companies: plan.companies.length,
      sites,
      positions,
      dropped: plan.dropped,
      issues: plan.issues,
      apply: result,
    },
    null,
    2,
  ),
);
if (plan.dropped > 0) process.exitCode = 1;
