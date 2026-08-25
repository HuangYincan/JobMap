#!/usr/bin/env node
// Dry-run: which drop / imported sites still need a point.
// Does not call AMap. Live REST apply is a later step (AMAP_WEB_KEY).
import { injectEnv } from './lib/load-env.mjs';
import { bossAdapter } from '../src/lib/recruitment-adapters/boss.ts';
import { nowcoderAdapter } from '../src/lib/recruitment-adapters/nowcoder.ts';
import { officialCareerAdapter } from '../src/lib/recruitment-adapters/official-career.ts';
import { qqdocOfficialAdapter } from '../src/lib/recruitment-adapters/qqdoc-official.ts';
import { radarAdapter } from '../src/lib/recruitment-adapters/radar.ts';
import { seedRecruitmentAdapter } from '../src/lib/recruitment-adapters/seed.ts';
import { shixisengAdapter } from '../src/lib/recruitment-adapters/shixiseng.ts';
import { formatGeocodeProviderReport, listImportedSitesNeedingGeocode, planSiteGeocode } from '../src/lib/site-geocode.ts';

// 2026-08-25 (fix/plan-env-load): PROVIDERS 行此前恒 missing — plan 脚本从不读
// server/.env.local (仅 apply 有内联 loadEnv)。注入后 dry-run 报告与 apply 一致。
injectEnv(['AMAP_WEB_KEY', 'JIAOYUNTONG_MAP_KEY', 'BAIDU_MAP_AK', 'TENCENT_MAP_KEY']);

const drops = await Promise.all([
  seedRecruitmentAdapter.list(),
  qqdocOfficialAdapter().list(),
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
console.log(formatGeocodeProviderReport());
