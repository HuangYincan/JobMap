import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyRecruitmentImport,
  dedupeSourceCompanies,
  hasValidUrlScheme,
  planOfficialCareerImport,
  planRecruitmentImport,
  planSeedImport,
  positionTaxonomy,
  siteCityOf,
  suppressRadarForPortalCompanies,
  validateSourceCompany,
} from '../src/lib/recruitment-import.ts';
import { bossAdapter } from '../src/lib/recruitment-adapters/boss.ts';
import { officialCareerAdapter, parseOfficialCareerPayload } from '../src/lib/recruitment-adapters/official-career.ts';
import { nowcoderAdapter } from '../src/lib/recruitment-adapters/nowcoder.ts';
import { radarAdapter } from '../src/lib/recruitment-adapters/radar.ts';
import { shixisengAdapter } from '../src/lib/recruitment-adapters/shixiseng.ts';
import { mergeCompaniesIntoPois, poiToSourceCompany } from '../src/lib/recruitment-source.ts';
import { authenticPositionSql, isAuthenticPositionRecord } from '../src/lib/freshness.ts';
import { embodiedJobsAdapter } from '../src/lib/recruitment-adapters/embodied-jobs.ts';
import { WORK_SEED } from './fixtures/seed-data.ts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function sample() {
  return poiToSourceCompany(WORK_SEED[0]);
}

test('validateSourceCompany accepts the first work seed company', () => {
  assert.deepEqual(validateSourceCompany(sample()), []);
});

test('hasValidUrlScheme rejects non-http schemes and repeated schemes (scan #4 regression)', () => {
  // 2026-08-20 全库扫描: radar 2 个 drop 的 careerUrl/applyUrl 为
  // https://https://… 双协议前缀 → JD 面板「投递」链接不可用。校验器防复发。
  assert.equal(hasValidUrlScheme('https://zhaopin.aircas.ac.cn/'), true);
  assert.equal(hasValidUrlScheme('http://bdochina.zhiye.com/intern/jobs'), true);
  assert.equal(hasValidUrlScheme('https://https://zhaopin.aircas.ac.cn/'), false);
  assert.equal(hasValidUrlScheme('http://http://example.com/'), false);
  assert.equal(hasValidUrlScheme('https://http://example.com/'), false);
  assert.equal(hasValidUrlScheme('https://www.zhipin.com/zt/schneider/ai_star_shixisheng.html/./ai_star_shixisheng.html'), false);
  assert.equal(hasValidUrlScheme('https://www.zhipin.com/zt/schneider/ai_star_shixisheng.html/other.html'), false);
  assert.equal(hasValidUrlScheme('https://www.zhipin.com/zt/schneider/ai_star_shixisheng.html#/apply'), true);
  assert.equal(hasValidUrlScheme('zhaopin.aircas.ac.cn'), false);
  assert.equal(hasValidUrlScheme('//cdn.example.com/logo.png'), false);
  // 可选字段缺省 (undefined / null / 空串) 合法 — 不因缺 URL 拒收公司。
  assert.equal(hasValidUrlScheme(undefined), true);
  assert.equal(hasValidUrlScheme(null), true);
  assert.equal(hasValidUrlScheme(''), true);
});

test('validateSourceCompany flags double-scheme and non-http URL fields', () => {
  const company = sample();
  company.careerUrl = 'https://https://zhaopin.aircas.ac.cn/';
  company.logoUrl = '//cdn.example.com/logo.png';
  company.sites[0].careerUrl = 'http://http://example.com/';
  company.positions[0].applyUrl = 'https://https://bdochina.zhiye.com/intern/jobs';
  const issues = validateSourceCompany(company);
  assert.ok(issues.some((row) => row.field === 'careerUrl'), 'company careerUrl flagged');
  assert.ok(issues.some((row) => row.field === 'logoUrl'), 'company logoUrl flagged');
  assert.ok(issues.some((row) => row.field === 'sites.careerUrl'), 'site careerUrl flagged');
  assert.ok(issues.some((row) => row.field === 'positions.applyUrl'), 'position applyUrl flagged');

  // 修正后的合法值不再产生问题。
  company.careerUrl = 'https://zhaopin.aircas.ac.cn/';
  company.logoUrl = 'https://cdn.example.com/logo.png';
  company.sites[0].careerUrl = 'https://example.com/';
  company.positions[0].applyUrl = 'https://bdochina.zhiye.com/intern/jobs';
  assert.deepEqual(validateSourceCompany(company), []);
});

test('validateSourceCompany rejects source codes that would violate sources.code', () => {
  const company = sample();
  for (const bad of ['', 'BAD', 'bad_source', 'has space', '1bad']) {
    company.source = bad;
    assert.ok(
      validateSourceCompany(company).some((row) => row.field === 'source'),
      `${bad} should be rejected`,
    );
  }
  company.source = 'xiaozhao-radar';
  assert.deepEqual(validateSourceCompany(company), []);
  company.source = undefined;
  assert.deepEqual(validateSourceCompany(company), []);
});

test('radar drops with the scan #4 double-prefix fix stay clean (2 files, 4 URLs)', () => {
  // 数据级回归: 修正过的 2 个 drop 不再含 https://https:// (careerUrl/applyUrl 各 2 处)。
  const radarDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'recruitment', 'radar');
  for (const name of ['中国科学院空天信息创新研究院.json', 'bdo立信.json']) {
    const raw = readFileSync(join(radarDir, name), 'utf8');
    assert.doesNotMatch(raw, /https:\/\/https:\/\//, `${name} has no repeated scheme`);
    assert.match(raw, /"careerUrl": "https:\/\//, `${name} careerUrl is a single-scheme URL`);
    assert.match(raw, /"applyUrl": "https:\/\//, `${name} applyUrl is a single-scheme URL`);
  }
});

test('施耐德 drops use canonical apply URL and reject extracted path fragments', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'recruitment', 'qqdoc-jobs');
  for (const name of ['qqj-施耐德电气.json', 'qqj-施耐德电气AI星火实习生计划.json']) {
    const raw = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    const applyUrl = raw.positions[0].applyUrl;
    assert.equal(applyUrl, 'https://www.zhipin.com/zt/schneider/ai_star_shixisheng.html');
    assert.equal(hasValidUrlScheme(applyUrl), true);
    assert.doesNotMatch(applyUrl, /\/\.\//);
  }
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

test('authenticity uses registered source provenance for embodied jobs', () => {
  assert.equal(isAuthenticPositionRecord({ externalId: 'embj-迦智科技-1', source: 'embodied-jobs' }), true);
  assert.equal(isAuthenticPositionRecord({ externalId: 'embj-迦智科技-1', source: 'official-career' }), false);
  assert.equal(isAuthenticPositionRecord({ externalId: 'portal-deepseek', source: 'official-career' }), true);
  assert.equal(isAuthenticPositionRecord({ externalId: 'embj-迦智科技-1' }), false);
});

test('public-read authenticity SQL follows the source registry and rejects none-policy rows', () => {
  const sql = authenticPositionSql('src', 'pos');
  assert.match(sql, /src\.code IN/);
  assert.match(sql, /'embodied-jobs'/);
  assert.match(sql, /src\.code = 'official-career'.*pos\.external_id LIKE 'portal-%'/);
  assert.doesNotMatch(sql, /qqdoc-official/);
  assert.doesNotMatch(sql, /seed/);
});

test('embodied-jobs plan records survive authenticity filtering as a whole source', async () => {
  const companies = await embodiedJobsAdapter().list();
  assert.ok(companies.length > 0);
  const plan = planRecruitmentImport(companies);
  assert.equal(plan.dropped, 0);
  assert.ok(plan.companies.every((company) => company.source === 'embodied-jobs'));
  const positions = plan.companies.flatMap((company) => company.positions);
  assert.ok(positions.length > 0);
  assert.ok(positions.every((position) => position.source === 'embodied-jobs'));
  const authentic = plan.companies.flatMap((company) =>
    company.positions.filter((position) =>
      isAuthenticPositionRecord({ externalId: position.externalId, source: position.source }),
    ),
  );
  assert.equal(authentic.length, positions.length);
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

test('dedupeSourceCompanies preserves site and position source per record', () => {
  const official = sample();
  official.slug = 'deepseek';
  official.source = 'official-career';
  official.sites = [{ ...official.sites[0], id: 'deepseek-official-site' }];
  official.positions = [{ ...official.positions[0], externalId: 'portal-deepseek', siteId: 'deepseek-official-site' }];

  const radar = sample();
  radar.slug = 'deepseek';
  radar.source = 'xiaozhao-radar';
  radar.sites = [{ ...radar.sites[0], id: 'deepseek-radar-site' }];
  radar.positions = [{ ...radar.positions[0], externalId: 'radar-deepseek', siteId: 'deepseek-radar-site' }];

  const [merged] = dedupeSourceCompanies([official, radar]);
  assert.equal(merged.source, 'official-career');
  assert.equal(merged.sites.find((site) => site.id === 'deepseek-official-site')?.source, 'official-career');
  assert.equal(merged.sites.find((site) => site.id === 'deepseek-radar-site')?.source, 'xiaozhao-radar');
  assert.equal(merged.positions.find((position) => position.externalId === 'portal-deepseek')?.source, 'official-career');
  assert.equal(merged.positions.find((position) => position.externalId === 'radar-deepseek')?.source, 'xiaozhao-radar');
});

test('dedupeSourceCompanies merges logoUrl/logoEmoji (seed logo fills a logo-less drop)', () => {
  // 2026-08-19 Bug2: mergeCompany 曾只合并 sites+positions, seed 的
  // logoUrl/logoEmoji 被丢弃 → 写库全空 → DB 读路径全 🏢。
  // 真实 drops 先行、seed 垫底: drop 无 logo 时 seed 补上。
  const drop = sample();
  drop.logoUrl = undefined;
  drop.logoEmoji = undefined;
  const seed = sample(); // WORK_SEED[0] 自带 logoUrl + logoEmoji
  assert.ok(seed.logoUrl && seed.logoEmoji, 'seed fixture carries logo fields');
  const [merged] = dedupeSourceCompanies([drop, seed]);
  assert.equal(merged.logoUrl, seed.logoUrl, 'seed logoUrl survives the merge');
  assert.equal(merged.logoEmoji, seed.logoEmoji, 'seed logoEmoji survives the merge');
});

test('dedupeSourceCompanies never overwrites a drop-provided logo (non-empty wins)', () => {
  const drop = sample();
  drop.logoUrl = 'https://cdn.example.com/drop.png';
  drop.logoEmoji = '🚀';
  const seed = sample();
  const [merged] = dedupeSourceCompanies([drop, seed]);
  assert.equal(merged.logoUrl, 'https://cdn.example.com/drop.png');
  assert.equal(merged.logoEmoji, '🚀');
});

test('company upsert never nulls existing logo columns and qualifies EXCLUDED refs (no PG 42702)', () => {
  // 2026-08-19 Bug2 根因链第 2 环: 写库 logoUrl ?? null 曾把既有 logo 覆盖成 NULL。
  // COALESCE 与坐标列同款策略: 缺数据不销毁好数据。
  // 2026-08-20: DO UPDATE SET 的 RHS 对「目标表 + EXCLUDED」通用解析, 未限定的
  // logo_url / logo_emoji 两边都有 → `column reference "logo_url" is ambiguous`
  // (PG 42702, import:seed:apply 必败)。回退参数必须表限定为 companies.*。
  const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const store = readFileSync(join(srcRoot, 'lib/recruitment-import.ts'), 'utf8');
  assert.match(store, /logo_url = COALESCE\(EXCLUDED\.logo_url, companies\.logo_url\)/);
  assert.match(store, /logo_emoji = COALESCE\(EXCLUDED\.logo_emoji, companies\.logo_emoji\)/);
  // RHS 不得残留未限定列引用 (PG 42702 歧义回归断言)。
  assert.doesNotMatch(store, /COALESCE\(EXCLUDED\.logo_url, logo_url\)/);
  assert.doesNotMatch(store, /COALESCE\(EXCLUDED\.logo_emoji, logo_emoji\)/);
});

test('planRecruitmentImport drops invalid companies and keeps the rest', () => {
  const good = sample();
  const bad = { ...sample(), slug: 'broken', name: '', sites: [], positions: [] };
  const plan = planRecruitmentImport([good, bad]);
  assert.equal(plan.companies.length, 1);
  assert.equal(plan.dropped, 1);
  assert.ok(plan.issues.length > 0);
});

test('planSeedImport accepts every real drop with valid sites (strict DB-only import)', async () => {
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

test('planSeedImport merges real drops onto catalog slugs (no seed scaffold)', async () => {
  const plan = await planSeedImport();
  // 官方 career drop 携带 seed 风格 slug(alibaba-xixi 等), 是真实数据而非 seed 示例。
  const alibaba = plan.companies.find((c) => c.slug === 'alibaba-xixi');
  assert.ok(alibaba);
  assert.ok(alibaba.positions.some((p) => p.externalId === 'alibaba-campus-frontend-2026'));

  const lab = plan.companies.find((c) => c.slug === 'zhejiang-lab');
  assert.ok(lab);
  assert.equal(lab.positions[0].siteId, 'zhejiang-lab-site');

  const bytedance = plan.companies.find((c) => c.slug === 'bytedance-hangzhou');
  assert.ok(bytedance);
  assert.ok(bytedance.positions.some((p) => p.externalId === 'bytedance-campus-frontend-2026'));

  const tencent = plan.companies.find((c) => c.slug === 'tencent-hangzhou');
  assert.ok(tencent);
  assert.ok(tencent.positions.some((p) => p.externalId === 'tencent-campus-frontend-2026'));
  assert.equal(tencent.sites.filter((s) => s.id === 'tencent-hangzhou-site').length, 1);

  const netease = plan.companies.find((c) => c.slug === 'netease-hangzhou');
  assert.ok(netease);
  assert.ok(netease.positions.some((p) => p.externalId === 'netease-campus-frontend-2026'));

  const xiaomi = plan.companies.find((c) => c.slug === 'xiaomi-hangzhou');
  assert.ok(xiaomi);
  assert.ok(xiaomi.positions.some((p) => p.externalId === 'xiaomi-campus-frontend-2026'));

  const deepseek = plan.companies.find((c) => c.slug === 'deepseek');
  assert.ok(deepseek?.positions.some((p) => p.externalId === 'deepseek-campus-frontend-2026'));

  // 2026-08-26: seed 示例岗位已移除(alibaba-java / tencent-backend 等不再出现),
  // 只保留真实 drop 岗位(官方 career / portal-* / radar-*)。
  assert.equal(alibaba.positions.some((p) => p.externalId === 'alibaba-java'), false);
  assert.equal(tencent.positions.some((p) => p.externalId === 'tencent-backend'), false);
  assert.ok(xiaomi.positions.some((p) => p.externalId.startsWith('portal-feishu-')));
});

test('applyRecruitmentImport is a no-op without DATABASE_URL', async () => {
  delete process.env.DATABASE_URL;
  const plan = await planSeedImport();
  const result = await applyRecruitmentImport(plan);
  assert.equal(result.wrote, false);
  assert.equal(result.reason, 'no-database');
  assert.equal(result.companies, plan.companies.length);
});

function fakeImportPlan() {
  return {
    companies: [
      {
        slug: 'fake-hz',
        name: 'Fake',
        source: 'xiaozhao-radar',
        industries: ['internet'],
        scale: 'startup',
        sites: [{ id: 'fake-site', name: 'Fake HQ', location: { lng: 120.1, lat: 30.2 } }],
        positions: [
          {
            externalId: 'radar-fake-1',
            title: 'Fake role',
            siteId: 'fake-site',
            family: 'campus',
            status: 'open',
            deadline: '2026-12-31',
            applySource: 'official',
            applyUrl: 'https://apply.example/1',
            retrievedAt: '2026-08-20T10:30:00Z',
            expiresAt: '2026-12-31T23:59:59Z',
            salary: { min: 100, max: 200 },
          },
          {
            externalId: 'seed-fake',
            title: 'Example',
            siteId: 'fake-site',
            family: 'campus',
            status: 'open',
          },
        ],
      },
    ],
    issues: [],
    dropped: 0,
  };
}

function fakeApplyPool(opts = {}) {
  const calls = [];
  let released = false;
  const client = {
    release() {
      released = true;
    },
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('INSERT INTO plugin_manifests')) return { rows: [{ id: 'plugin-fake' }] };
      if (sql.includes('INSERT INTO sources')) {
        return { rows: [{ id: opts.sourceIds?.[params[0]] ?? 'source-fake' }] };
      }
      if (sql.includes('INSERT INTO import_runs')) return { rows: [{ id: 'run-fake' }] };
      if (sql.includes('UPDATE import_runs')) return { rows: [] };
      if (sql.includes('INSERT INTO companies')) {
        if (opts.failAt === 'company') throw new Error('company upsert failed');
        return { rows: [{ id: 'company-fake' }] };
      }
      if (sql.includes('SELECT id::text FROM company_sites WHERE company_id = $1 AND site_key = $2')) {
        return { rows: opts.existingSite ? [{ id: 'site-fake' }] : [] };
      }
      if (sql.includes('site_key IS NULL')) return { rows: [] };
      if (sql.includes('INSERT INTO company_sites')) return { rows: [{ id: 'site-fake' }] };
      if (sql.includes('INSERT INTO positions') && opts.failAt === 'position') {
        throw new Error('position upsert failed');
      }
      return { rows: [] };
    },
  };
  return {
    pool: { connect: async () => client },
    calls,
    get released() {
      return released;
    },
  };
}

test('applyRecruitmentImport runs a transactional upsert with an injected pool', async () => {
  const fake = fakeApplyPool();
  const result = await applyRecruitmentImport(fakeImportPlan(), fake.pool);
  assert.equal(result.wrote, true);
  assert.equal(result.companies, 1);
  assert.equal(result.sites, 1);
  assert.equal(result.positions, 1);
  assert.equal(fake.released, true);

  const sqls = fake.calls.map((call) => call.sql);
  assert.ok(sqls.includes('BEGIN'));
  assert.ok(sqls.includes('COMMIT'));
  assert.ok(sqls.indexOf('COMMIT') > sqls.indexOf('BEGIN'));
  assert.ok(sqls.some((sql) => sql.includes('INSERT INTO sources')));
  assert.ok(sqls.some((sql) => sql.includes('INSERT INTO plugin_manifests')));
  assert.ok(sqls.some((sql) => sql.includes('INSERT INTO import_runs')));
  assert.ok(sqls.some((sql) => sql.includes('INSERT INTO source_records')));
  assert.ok(sqls.some((sql) => sql.includes('INSERT INTO companies')));
  assert.ok(sqls.some((sql) => sql.includes('INSERT INTO company_sites')));
  assert.ok(sqls.some((sql) => sql.includes('DELETE FROM positions')));
  assert.ok(!sqls.some((sql) => sql.includes('UPDATE positions SET source_id')));

  const companyCall = fake.calls.find((call) => call.sql.includes('INSERT INTO companies'));
  assert.equal(companyCall.params[0], 'fake-hz');
  assert.equal(companyCall.params[1], 'Fake');
  assert.equal(companyCall.params[9], 12); // tier fallback
  assert.equal(companyCall.params[10], 'other'); // category fallback

  const positionCall = fake.calls.find((call) => call.sql.includes('INSERT INTO positions'));
  assert.equal(positionCall.params[3], 'Fake role');
  assert.equal(positionCall.params[7], 100);
  assert.equal(positionCall.params[13], '2026-12-31');
  assert.equal(positionCall.params[14], 'official');
  assert.equal(positionCall.params[16], 'open');
  assert.equal(positionCall.params[17], 'source-fake');
  assert.equal(positionCall.params[18], '2026-08-20T10:30:00Z');
  assert.equal(positionCall.params[19], '2026-12-31T23:59:59Z');
});

test('applyRecruitmentImport writes each site/position source provenance independently', async () => {
  const plan = {
    companies: [
      {
        slug: 'deepseek',
        name: 'DeepSeek',
        source: 'official-career',
        industries: ['ai'],
        scale: 'unicorn',
        sites: [
          { id: 'official-site', name: '官网站点', source: 'official-career' },
          { id: 'radar-site', name: '雷达站点', source: 'xiaozhao-radar' },
        ],
        positions: [
          {
            externalId: 'portal-deepseek',
            title: '官网岗位',
            siteId: 'official-site',
            source: 'official-career',
            family: 'campus',
            status: 'open',
            retrievedAt: '2026-08-20',
          },
          {
            externalId: 'radar-deepseek',
            title: '雷达岗位',
            siteId: 'radar-site',
            source: 'xiaozhao-radar',
            family: 'campus',
            status: 'open',
            retrievedAt: '2026-08-21',
          },
        ],
      },
    ],
    issues: [],
    dropped: 0,
  };
  const fake = fakeApplyPool({ sourceIds: { 'official-career': 'source-official', 'xiaozhao-radar': 'source-radar' } });
  const result = await applyRecruitmentImport(plan, fake.pool);
  assert.equal(result.positions, 2);
  const positionCalls = fake.calls.filter((call) => call.sql.includes('INSERT INTO positions'));
  assert.deepEqual(positionCalls.map((call) => call.params[17]), ['source-official', 'source-radar']);
  const siteCalls = fake.calls.filter((call) => call.sql.includes('INSERT INTO company_sites'));
  assert.deepEqual(siteCalls.map((call) => call.params[11]), ['source-official', 'source-radar']);
  const recordCalls = fake.calls.filter((call) => call.sql.includes('INSERT INTO source_records'));
  assert.equal(recordCalls.length, 2);
  assert.deepEqual(recordCalls.map((call) => call.params[0]), ['source-official', 'source-radar']);
});

test('applyRecruitmentImport reuses an existing company site instead of inserting', async () => {
  const fake = fakeApplyPool({ existingSite: true });
  const result = await applyRecruitmentImport(fakeImportPlan(), fake.pool);
  assert.equal(result.wrote, true);
  assert.ok(fake.calls.some((call) => call.sql.includes('UPDATE company_sites SET')));
  assert.ok(!fake.calls.some((call) => call.sql.includes('INSERT INTO company_sites')));
});

test('applyRecruitmentImport rolls back and releases the client on failure', async () => {
  const fake = fakeApplyPool({ failAt: 'company' });
  await assert.rejects(applyRecruitmentImport(fakeImportPlan(), fake.pool), /company upsert failed/);
  assert.ok(fake.calls.some((call) => call.sql === 'ROLLBACK'));
  assert.ok(fake.calls.some((call) => call.sql === 'BEGIN'));
  assert.equal(fake.released, true);
});

test('applyRecruitmentImport records missing retrieval time as a failed audit record without inventing now', async () => {
  const plan = fakeImportPlan();
  plan.companies[0].positions[0].retrievedAt = undefined;
  const fake = fakeApplyPool();
  const result = await applyRecruitmentImport(plan, fake.pool);
  assert.equal(result.wrote, true);
  assert.equal(result.positions, 0);
  assert.equal(fake.calls.some((call) => call.sql.includes('INSERT INTO source_records')), false);
  const runUpdates = fake.calls.filter((call) => call.sql.includes('UPDATE import_runs'));
  assert.ok(runUpdates.some((call) => call.params[1] === 'failed'));
  assert.doesNotMatch(JSON.stringify(runUpdates), /2026-08-27/);
});

test('applyRecruitmentImport returns early for an empty plan', async () => {
  let connected = false;
  const pool = {
    connect: async () => {
      connected = true;
      throw new Error('must not connect');
    },
  };
  const result = await applyRecruitmentImport({ companies: [], issues: [], dropped: 0 }, pool);
  assert.deepEqual(result, {
    wrote: false,
    reason: 'empty-plan',
    companies: 0,
    sites: 0,
    positions: 0,
  });
  assert.equal(connected, false);
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
  assert.match(store, /province = \$6, city_code = \$7/);
  assert.match(store, /siteCityOf\(site\)/);
  assert.match(store, /company\.tier \?\? TIER_DEFAULT/);
  assert.match(store, /company\.category \?\? 'other'/);
});

test('site upsert never nulls existing geocoded coords when the drop lacks them', () => {
  // 2026-08-19 事故回归契约:import:apply 曾把 lng/lat 覆盖成 NULL,
  // 地图 79 pins → 2。UPDATE 必须 COALESCE 保既有坐标。
  const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const store = readFileSync(join(srcRoot, 'lib/recruitment-import.ts'), 'utf8');
  assert.match(store, /lng = COALESCE\(\$8, lng\), lat = COALESCE\(\$9, lat\)/);
});

test('site merge keys on site_key, not name (multi-city sites must not collapse)', () => {
  // 2026-08-19 事故:按 (company_id, name) 合并 → 得物×5 个同名站点折叠成 1 行,
  // city/坐标互相覆盖 (米哈游 city=北京市 坐标却在上海)。合并必须键 site_key
  // (drop 的 site.id), 存量行按 (name, city) 一次性认领并回填。
  const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const store = readFileSync(join(srcRoot, 'lib/recruitment-import.ts'), 'utf8');
  assert.match(store, /site_key = \$2 LIMIT 1/);
  assert.match(store, /AND site_key IS NULL/);
  assert.match(store, /city IS NOT DISTINCT FROM \$3/);
  assert.match(store, /INSERT INTO company_sites \(company_id, name, site_key/);
  assert.doesNotMatch(store, /WHERE company_id = \$1 AND name = \$2 LIMIT 1/);
});

test('positions dedup is scoped to each record source and does not migrate provenance', () => {
  // 2026-08-20: 同 external_id 曾在旧 source(seed) 与新真实 source 下各存一行,
  // upsert 唯一键 (source_id, external_id) 不冲突 → 旧行不删 → 双行并存 →
  // poi-card 同 key 警告上百条。apply 事务内自愈, 顺序不可颠倒:
  // 先去重保 MIN(id) → 再迁移旧行 source → 最后 ON CONFLICT upsert。
  // 若先迁移: 同 external_id 的旧行与新增行共享 (source_id, external_id),
  // UPDATE 语句内即触发唯一索引冲突 (_bt_check_unique), 事务回滚
  // (2026-08-20 boss 实测: 重跑 import:seed:apply 报唯一键冲突, DB 未变)。
  const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const store = readFileSync(join(srcRoot, 'lib/recruitment-import.ts'), 'utf8');

  // 1) 去重: 每 external_id 保 MIN(id) 一行 (USING 子查询按组取最小行;
  //    保最早行 → applications.position_id 引用不悬空)
  assert.match(store, /DELETE FROM positions p/);
  assert.match(store, /MIN\(id\) AS keep_id/);
  assert.match(store, /GROUP BY source_id, external_id/);
  assert.match(store, /p\.id <> keep\.keep_id/);

  assert.match(store, /source_id = \$2 AND external_id = ANY\(\$1::text\[\]\)/);
  assert.match(store, /p\.source_id = keep\.source_id/);
  assert.doesNotMatch(store, /UPDATE positions SET source_id/);

  // Cross-source rows are intentionally not migrated: source_id is an
  // auditable fact, not a deduplication hint.
  assert.match(store, /isAuthenticPositionRecord/);
});

test('positions dedup is scoped by plan external ids and per-source', () => {
  const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const store = readFileSync(join(srcRoot, 'lib/recruitment-import.ts'), 'utf8');
  // 去重按「本次 plan 的 external_id 集合 + 记录级 source」双重限定 — 绝不整表
  // 扫描式清理, 其他公司 / 其他来源的岗位不受影响。
  assert.match(store, /source_id = \$2 AND external_id = ANY\(\$1::text\[\]\)/);
  assert.match(store, /p\.source_id = keep\.source_id/);
  // 跨源迁移已删除: source_id 是审计事实, 不是去重提示。
  assert.doesNotMatch(store, /UPDATE positions SET source_id/);
});

test('planSeedImport excludes the seed scaffold (strict DB-only import)', () => {
  // 2026-08-26: seed 示例数据已归档 tech/backup/seed-data, 不再作为灌库源;
  // 真实 drops (qqdoc/official/radar/embodied 等) 仍按官方优先合并。
  const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const store = readFileSync(join(srcRoot, 'lib/recruitment-import.ts'), 'utf8');
  assert.doesNotMatch(store, /seedRecruitmentAdapter|\.\.\.seed\b|'\.\/recruitment-adapters\/seed'/);
  assert.match(
    store,
    /\.\.\.qqdocOfficial,\s*\.\.\.qqdocJobs,\s*\.\.\.official,\s*\.\.\.radar,\s*\.\.\.boss,\s*\.\.\.nowcoder,\s*\.\.\.shixiseng/,
  );
});

test('portal-* positions suppress radar-* aggregate rows on the same company', () => {
  // 2026-08-19 数据策略: 官方 ATS 直爬 (portal-*) 是真实岗位, radar-* 是
  // 快照聚合行 (合成岗位)。同 slug 并存时, portal 优先, radar 行被抑制 —
  // 地图上不再同时出现真实岗位和「汇总岗位」。
  const portal = sample();
  portal.positions[0] = { ...portal.positions[0], externalId: 'portal-feishu-123' };
  const radar = sample();
  radar.positions[0] = { ...radar.positions[0], externalId: 'radar-abc123' };
  const merged = planRecruitmentImport([portal, radar]);
  assert.equal(merged.companies.length, 1); // 同 slug 合并
  assert.ok(merged.companies[0].positions.some((p) => p.externalId.startsWith('radar-')), 'merge keeps both before suppress');
  const suppressed = suppressRadarForPortalCompanies(merged);
  assert.ok(suppressed.companies[0].positions.every((p) => !p.externalId.startsWith('radar-')), 'radar rows are gone');
  assert.ok(suppressed.companies[0].positions.some((p) => p.externalId.startsWith('portal-')), 'portal rows survive');

  // 无 portal 的公司保留 radar 行 (没有更好数据时不隐藏)。
  const radarOnly = sample();
  radarOnly.positions[0] = { ...radarOnly.positions[0], externalId: 'radar-abc123' };
  const kept = suppressRadarForPortalCompanies(planRecruitmentImport([radarOnly]));
  assert.ok(kept.companies[0].positions.some((p) => p.externalId.startsWith('radar-')));
});
