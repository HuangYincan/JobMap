#!/usr/bin/env node
// Dry-run: which seed / imported sites still need a point.
// Does not call AMap. Live REST apply is a later step (AMAP_WEB_KEY).
import { seedRecruitmentAdapter } from '../src/lib/recruitment-adapters/seed.ts';
import { listImportedSitesNeedingGeocode, planSiteGeocode } from '../src/lib/site-geocode.ts';

const companies = await seedRecruitmentAdapter.list();
const seedPlan = planSiteGeocode(companies);
const imported = await listImportedSitesNeedingGeocode();

console.log(
  JSON.stringify(
    {
      seed: {
        alreadyLocated: seedPlan.alreadyLocated,
        needs: seedPlan.needs.length,
        skippedNoAddress: seedPlan.skippedNoAddress,
        samples: seedPlan.needs.slice(0, 5),
      },
      imported:
        imported == null
          ? { available: false, reason: 'no-database' }
          : { available: true, needs: imported.length, samples: imported.slice(0, 5) },
    },
    null,
    2,
  ),
);
