import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyRecruitmentImport,
  dedupeSourceCompanies,
  planOfficialCareerImport,
  planRecruitmentImport,
  planSeedImport,
  validateSourceCompany,
} from '../src/lib/recruitment-import.ts';
import { bossAdapter } from '../src/lib/recruitment-adapters/boss.ts';
import { officialCareerAdapter, parseOfficialCareerPayload } from '../src/lib/recruitment-adapters/official-career.ts';
import { nowcoderAdapter } from '../src/lib/recruitment-adapters/nowcoder.ts';
import { shixisengAdapter } from '../src/lib/recruitment-adapters/shixiseng.ts';
import { mergeOfficialCareerIntoSeed, poiToSourceCompany } from '../src/lib/recruitment-source.ts';
import { WORK_SEED } from '../src/lib/seed-data.ts';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('mergeOfficialCareerIntoSeed keeps seed ids and unions new jobs', () => {
  const merged = mergeOfficialCareerIntoSeed(WORK_SEED, [
    {
      slug: 'alibaba-xixi',
      name: '阿里巴巴',
      industries: ['internet'],
      scale: 'bigtech',
      sites: [{ id: 'alibaba-xixi-site', name: '阿里巴巴' }],
      positions: [
        {
          externalId: 'alibaba-new-job',
          title: '新岗',
          siteId: 'alibaba-xixi-site',
          family: 'campus',
          status: 'open',
        },
      ],
    },
    {
      slug: 'brand-new-lab',
      name: '新实验室',
      industries: ['ai'],
      scale: 'startup',
      sites: [{ id: 'hq', name: '杭州', location: { lng: 120.1, lat: 30.2 } }],
      positions: [
        {
          externalId: 'lab-job',
          title: '科研',
          siteId: 'hq',
          family: 'intern',
          status: 'open',
        },
      ],
    },
  ]);
  const ali = merged.find((p) => p.id === 'alibaba-xixi');
  assert.ok(ali);
  assert.ok(ali.positions.some((p) => p.id === 'alibaba-new-job'));
  assert.ok(ali.positions.some((p) => p.id === 'alibaba-java'));
  const lab = merged.find((p) => p.id === 'brand-new-lab');
  assert.ok(lab);
  assert.equal(lab.source, 'api');
});

test('mergeOfficialCareerIntoSeed hides closed jobs on the read path', () => {
  const merged = mergeOfficialCareerIntoSeed(WORK_SEED, [
    {
      slug: 'alibaba-xixi',
      name: '阿里巴巴',
      industries: ['internet'],
      scale: 'bigtech',
      sites: [{ id: 'alibaba-xixi-site', name: '阿里巴巴' }],
      positions: [
        {
          externalId: 'alibaba-java',
          title: 'Java 后端开发工程师',
          siteId: 'alibaba-xixi-site',
          family: 'intern',
          status: 'closed',
        },
        {
          externalId: 'alibaba-paused-job',
          title: '暂停岗',
          siteId: 'alibaba-xixi-site',
          family: 'intern',
          status: 'paused',
        },
      ],
    },
    {
      slug: 'closed-only-lab',
      name: '已关实验室',
      industries: ['ai'],
      scale: 'startup',
      sites: [{ id: 'hq', name: '杭州', location: { lng: 120.1, lat: 30.2 } }],
      positions: [
        {
          externalId: 'closed-lab-job',
          title: '已关',
          siteId: 'hq',
          family: 'intern',
          status: 'closed',
        },
      ],
    },
  ]);
  const ali = merged.find((p) => p.id === 'alibaba-xixi');
  assert.ok(ali);
  assert.ok(!ali.positions.some((p) => p.id === 'alibaba-java'));
  assert.ok(!ali.positions.some((p) => p.id === 'alibaba-paused-job'));
  assert.ok(ali.positions.some((p) => p.id === 'alibaba-frontend'));
  assert.equal(merged.find((p) => p.id === 'closed-only-lab'), undefined);
});

test('planSeedImport merges official-career drops onto seed slugs', async () => {
  const plan = await planSeedImport();
  const alibaba = plan.companies.find((c) => c.slug === 'alibaba-xixi');
  assert.ok(alibaba);
  assert.ok(alibaba.positions.some((p) => p.externalId === 'alibaba-campus-frontend-2026'));
  assert.ok(alibaba.positions.some((p) => p.externalId === 'alibaba-java'));

  const lab = plan.companies.find((c) => c.slug === 'zhejiang-lab');
  assert.ok(lab);
  assert.equal(lab.positions[0].siteId, 'hq');

  const bytedance = plan.companies.find((c) => c.slug === 'bytedance-hangzhou');
  assert.ok(bytedance);
  assert.ok(bytedance.positions.some((p) => p.externalId === 'bytedance-campus-frontend-2026'));
  assert.ok(bytedance.positions.some((p) => p.externalId === 'bytedance-algo'));

  const tencent = plan.companies.find((c) => c.slug === 'tencent-hangzhou');
  assert.ok(tencent);
  assert.ok(tencent.positions.some((p) => p.externalId === 'tencent-campus-frontend-2026'));
  assert.ok(tencent.positions.some((p) => p.externalId === 'tencent-backend'));
  assert.equal(tencent.sites.filter((s) => s.id === 'tencent-hangzhou-site').length, 1);

  const netease = plan.companies.find((c) => c.slug === 'netease-hangzhou');
  assert.ok(netease);
  assert.ok(netease.positions.some((p) => p.externalId === 'netease-campus-frontend-2026'));

  const huawei = plan.companies.find((c) => c.slug === 'huawei-hangzhou');
  assert.ok(huawei);
  assert.ok(huawei.positions.some((p) => p.externalId === 'huawei-campus-frontend-2026'));

  const ant = plan.companies.find((c) => c.slug === 'antgroup-hangzhou');
  assert.ok(ant);
  assert.ok(ant.positions.some((p) => p.externalId === 'antgroup-campus-frontend-2026'));

  const xiaomi = plan.companies.find((c) => c.slug === 'xiaomi-hangzhou');
  assert.ok(xiaomi);
  assert.ok(xiaomi.positions.some((p) => p.externalId === 'xiaomi-campus-frontend-2026'));
  assert.ok(xiaomi.positions.some((p) => p.externalId === 'mi-android'));
  assert.equal(xiaomi.sites.filter((s) => s.id === 'xiaomi-hangzhou-site').length, 1);

  const didi = plan.companies.find((c) => c.slug === 'didi-hangzhou');
  assert.ok(didi?.positions.some((p) => p.externalId === 'didi-campus-frontend-2026'));

  const deepseek = plan.companies.find((c) => c.slug === 'deepseek');
  assert.ok(deepseek?.positions.some((p) => p.externalId === 'deepseek-campus-frontend-2026'));
});

test('applyRecruitmentImport is a no-op without DATABASE_URL', async () => {
  delete process.env.DATABASE_URL;
  const plan = await planSeedImport();
  const result = await applyRecruitmentImport(plan);
  assert.equal(result.wrote, false);
  assert.equal(result.reason, 'no-database');
  assert.equal(result.companies, plan.companies.length);
});

test('official-career adapter reads JSON drops and skips a missing dir', async () => {
  const parsed = parseOfficialCareerPayload({ slug: 'x', name: 'X', sites: [], positions: [] });
  assert.equal(parsed[0].slug, 'x');
  assert.deepEqual(parseOfficialCareerPayload({ nope: true }), []);

  const empty = await officialCareerAdapter('/tmp/domain-map-no-such-official-career').list();
  assert.deepEqual(empty, []);

  const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'official-career');
  const plan = await planOfficialCareerImport(dir);
  assert.equal(plan.dropped, 0);
  assert.ok(plan.companies.some((c) => c.slug === 'fixture-hz'));
  assert.equal(plan.companies.find((c) => c.slug === 'fixture-hz')?.positions[0].siteId, 'hq');
});

test('boss / nowcoder / shixiseng adapters read file drops and skip missing dirs', async () => {
  assert.deepEqual(await nowcoderAdapter('/tmp/domain-map-no-such-nowcoder').list(), []);
  assert.deepEqual(await shixisengAdapter('/tmp/domain-map-no-such-shixiseng').list(), []);
  assert.deepEqual(await bossAdapter('/tmp/domain-map-no-such-boss').list(), []);

  const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'boss');
  const rows = await bossAdapter(dir).list();
  assert.equal(rows[0]?.slug, 'fixture-boss');
  assert.equal(rows[0]?.positions[0]?.applySource, 'boss');
});
