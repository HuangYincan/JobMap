#!/usr/bin/env node
// Dry-run the seed recruitment import. Does not write Postgres.
import { planSeedImport } from '../src/lib/recruitment-import.ts';

const plan = await planSeedImport();
const sites = plan.companies.reduce((n, c) => n + c.sites.length, 0);
const positions = plan.companies.reduce((n, c) => n + c.positions.length, 0);
console.log(
  JSON.stringify(
    {
      companies: plan.companies.length,
      sites,
      positions,
      dropped: plan.dropped,
      issues: plan.issues,
    },
    null,
    2,
  ),
);
if (plan.dropped > 0) process.exitCode = 1;
