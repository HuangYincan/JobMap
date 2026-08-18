import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyRecruitmentImport,
  dedupeSourceCompanies,
  planOfficialCareerImport,
  planRecruitmentImport,
  planSeedImport,
  positionTaxonomy,
  siteCityOf,
  validateSourceCompany,
} from '../src/lib/recruitment-import.ts';
import { bossAdapter } from '../src/lib/recruitment-adapters/boss.ts';
import { officialCareerAdapter, parseOfficialCareerPayload } from '../src/lib/recruitment-adapters/official-career.ts';
import { nowcoderAdapter } from '../src/lib/recruitment-adapters/nowcoder.ts';
import { radarAdapter } from '../src/lib/recruitment-adapters/radar.ts';
import { shixisengAdapter } from '../src/lib/recruitment-adapters/shixiseng.ts';
import { mergeCompaniesIntoPois, poiToSourceCompany } from '../src/lib/recruitment-source.ts';
import { WORK_SEED } from '../src/lib/seed-data.ts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function sample() {
  return poiToSourceCompany(WORK_SEED[0]);
}

test('validateSourceCompany accepts the first work seed company', () => {
  assert.deepEqual(validateSourceCompany(sample()), []);
});

test('validateSourceCompany accepts an address-only site (pending geocode)', () => {
  const company = sample();
  company.sites = [{ id: 'demo-site', name: company.name, location: { address: '杭州' } }];
  company.positions = [{ ...company.positions[0], siteId: 'demo-site' }];
  assert.deepEqual(validateSourceCompany(company), []);
});

test('validateSourceCompany flags a non-ISO deadline before the DB apply', () => {
  const company = sample();
  company.positions[0].deadline = '招满即止';
  const issues = validateSourceCompany(company);
  assert.ok(issues.some((row) => row.field === 'positions.deadline'));
  company.positions[0].deadline = '2026-10-15';
  assert.deepEqual(validateSourceCompany(company), []);
  // Delimiter-optional formats align with the crawler's parse_deadline.
  company.positions[0].deadline = '2026 10 15';
  assert.deepEqual(validateSourceCompany(company), []);
});

test('applyRecruitmentImport only counts authentic positions (no re-opening example jobs)', async () => {
  const plan = await planSeedImport();
  const result = await applyRecruitmentImport(plan);
  assert.equal(result.wrote, false);
  assert.equal(result.reason, 'no-database');
  assert.ok(result.positions > 0);
  // Plan contains 241 positions; apply must count only radar-*/portal-*.
  const planPositions = plan.companies.reduce((n, c) => n + c.positions.length, 0);
  assert.ok(planPositions > result.positions, 'example jobs are filtered out at apply time');
});

test('radar adapter reads the mapped drop directory', async () => {
  const companies = await radarAdapter().list();
  assert.ok(companies.length >= 90, `expected >= 90 radar companies, got ${companies.length}`);
  const netease = companies.find((c) => c.slug === 'netease-hangzhou');
  assert.ok(netease);
  assert.ok(netease.positions.some((p) => p.externalId.startsWith('radar-')));
});

test('manycore drop keeps a closed aggregate tombstone and 4 split positions with real JDs', async () => {
  const companies = await radarAdapter().list();
  const manycore = companies.find((c) => c.slug === 'manycore-hangzhou');
  assert.ok(manycore, 'manycore-hangzhou drop is present');

  const tombstone = manycore.positions.find((p) => p.externalId === 'radar-735415a42603');
  assert.ok(tombstone);
  assert.equal(tombstone.status, 'closed', 'aggregate tombstone is closed so alive filters hide it');
  assert.equal(tombstone.aggregate, true);

  const split = manycore.positions.filter((p) => p.externalId.startsWith('radar-735415a42603-'));
  assert.equal(split.length, 4, 'aggregate row split into 4 real jobs');
  assert.equal(new Set(split.map((p) => p.externalId)).size, 4, 'split externalIds are unique');
  assert.ok(split.every((p) => p.status === 'open'));
  assert.ok(split.every((p) => p.family === 'campus'));
  assert.ok(split.every((p) => p.applySource === 'official'));
  assert.ok(split.every((p) => p.siteId === 'manycore-hangzhou-site-hangzhou'));
  assert.ok(split.every((p) => p.description?.length > 0), 'every split job carries a real JD');
});

test('positionTaxonomy keeps family and carries the aggregate flag for the DB upsert', () => {
  const plain = {
    externalId: 'x-1',
    title: '普通岗',
    siteId: 's',
    family: 'campus',
    status: 'open',
  };
  assert.deepEqual(positionTaxonomy(plain), { family: 'campus' });
  // Drop taxonomy fields (e.g. campusSeason) survive; aggregate is added.
  const withTaxonomy = {
    ...plain,
    taxonomy: { family: 'campus', campusSeason: 'autumn' },
    aggregate: true,
  };
  assert.deepEqual(positionTaxonomy(withTaxonomy), {
    family: 'campus',
    campusSeason: 'autumn',
    aggregate: true,
  });
  // A false / missing aggregate never leaks into the jsonb payload.
  const without = { ...plain, aggregate: false };
  assert.deepEqual(positionTaxonomy(without), { family: 'campus' });
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

test('mergeCompaniesIntoPois keeps seed ids, unions new jobs, and does not duplicate new-site positions', () => {
  const merged = mergeCompaniesIntoPois(WORK_SEED, [
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
  // The new site pin already carries its open positions — the loop must not append twice.
  assert.equal(lab.positions.filter((p) => p.id === 'lab-job').length, 1);
});

test('mergeCompaniesIntoPois hides closed jobs on the read path', () => {
  const merged = mergeCompaniesIntoPois(WORK_SEED, [
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
  assert.equal(lab.positions[0].siteId, 'zhejiang-lab-site');

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

  const bili = plan.companies.find((c) => c.slug === 'bilibili-hangzhou');
  assert.ok(bili?.positions.some((p) => p.externalId === 'bilibili-campus-frontend-2026'));
  assert.ok(bili?.positions.some((p) => p.externalId === 'bili-community'));

  const megvii = plan.companies.find((c) => c.slug === 'megvii-hangzhou');
  assert.ok(megvii?.positions.some((p) => p.externalId === 'megvii-campus-frontend-2026'));
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

test('siteCityOf prefers site.city then parses known cities from the address', () => {
  assert.equal(siteCityOf({ id: 'x', name: 'x', city: '北京' }), '北京');
  assert.equal(siteCityOf({ id: 'x', name: 'x', location: { address: '北京市' } }), '北京');
  assert.equal(siteCityOf({ id: 'x', name: 'x', location: { address: '北京市海淀区中关村' } }), '北京');
  assert.equal(siteCityOf({ id: 'x', name: 'x', location: { address: '杭州市西湖区文一西路969号' } }), '杭州');
  // 杭州区名开头视为杭州站点；多城市文本 / 无法识别地址保持 null。
  assert.equal(siteCityOf({ id: 'x', name: 'x', location: { address: '西湖区龙井路1号' } }), '杭州');
  assert.equal(siteCityOf({ id: 'x', name: 'x', location: { address: '北京/上海' } }), null);
  assert.equal(siteCityOf({ id: 'x', name: 'x', location: { address: '海淀区中关村' } }), null);
  assert.equal(siteCityOf({ id: 'x', name: 'x' }), null);
  assert.equal(siteCityOf({ id: 'x', name: 'x', location: {} }), null);
});

test('validateSourceCompany accepts tier 0-21 and rejects others', () => {
  const good = sample();
  good.tier = 0; // 0=一直可见(国际化名企)
  assert.deepEqual(validateSourceCompany(good), []);
  const good21 = sample();
  good21.tier = 21; // 21=永不显示
  assert.deepEqual(validateSourceCompany(good21), []);
  const bad = sample();
  bad.tier = 22; // 超出 0..21
  assert.ok(validateSourceCompany(bad).some((row) => row.field === 'tier'));
  const badNeg = sample();
  badNeg.tier = -1;
  assert.ok(validateSourceCompany(badNeg).some((row) => row.field === 'tier'));
  const badFloat = sample();
  badFloat.tier = 4.5;
  assert.ok(validateSourceCompany(badFloat).some((row) => row.field === 'tier'));
});

test('import maps tier / category / site city / province / city_code onto the DB upsert', () => {
  const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const store = readFileSync(join(srcRoot, 'lib/recruitment-import.ts'), 'utf8');
  assert.match(store, /INSERT INTO companies \([^)]*\btier\b/);
  assert.match(store, /INSERT INTO companies \([^)]*\bcategory\b/);
  assert.match(store, /tier = EXCLUDED\.tier/);
  assert.match(store, /category = EXCLUDED\.category/);
  assert.match(store, /INSERT INTO company_sites \([^)]*\bcity\b/);
  assert.match(store, /province = \$5, city_code = \$6/);
  assert.match(store, /siteCityOf\(site\)/);
  assert.match(store, /company\.tier \?\? TIER_DEFAULT/);
  assert.match(store, /company\.category \?\? 'other'/);
});

test('site upsert never nulls existing geocoded coords when the drop lacks them', () => {
  // 2026-08-19 事故回归契约:import:apply 曾把 lng/lat 覆盖成 NULL,
  // 地图 79 pins → 2。UPDATE 必须 COALESCE 保既有坐标。
  const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const store = readFileSync(join(srcRoot, 'lib/recruitment-import.ts'), 'utf8');
  assert.match(store, /lng = COALESCE\(\$7, lng\), lat = COALESCE\(\$8, lat\)/);
});
