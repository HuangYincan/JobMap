#!/usr/bin/env node
// Dry-run: which drop / imported sites still need a point.
// Does not call AMap. Live REST apply is a later step (AMAP_WEB_KEY).
import { bossAdapter } from '../src/lib/recruitment-adapters/boss.ts';
import { nowcoderAdapter } from '../src/lib/recruitment-adapters/nowcoder.ts';
import { officialCareerAdapter } from '../src/lib/recruitment-adapters/official-career.ts';
import { radarAdapter } from '../src/lib/recruitment-adapters/radar.ts';
import { seedRecruitmentAdapter } from '../src/lib/recruitment-adapters/seed.ts';
import { shixisengAdapter } from '../src/lib/recruitment-adapters/shixiseng.ts';
import { listImportedSitesNeedingGeocode, planSiteGeocode } from '../src/lib/site-geocode.ts';

const drops = await Promise.all([
  seedRecruitmentAdapter.list(),
  officialCareerAdapter().list(),
  bossAdapter().list(),
  nowcoderAdapter().list(),
  shixisengAdapter().list(),
  radarAdapter().list(),
]);
const allCompanies = drops.flat();
const plan = planSiteGeocode(allCompanies);
const imported = await listImportedSitesNeedingGeocode();

console.log(
  JSON.stringify(
    {
      companies: allCompanies.length,
      alreadyLocated: plan.alreadyLocated,
      needs: plan.needs.length,
      skippedNoAddress: plan.skippedNoAddress,
      samples: plan.needs.slice(0, 10),
      imported:
        imported == null
          ? { available: false, reason: 'no-database' }
          : { available: true, needs: imported.length, samples: imported.slice(0, 5) },
    },
    null,
    2,
  ),
);
