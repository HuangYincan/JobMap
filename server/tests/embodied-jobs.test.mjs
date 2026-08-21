import test from 'node:test';
import assert from 'node:assert/strict';

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { embodiedJobsAdapter, fileEmbodiedJobsAdapter } from '../src/lib/recruitment-adapters/embodied-jobs.ts';
import { industriesOf } from '../src/lib/recruitment-adapters/qqdoc-official.ts';
import {
  dedupeSourceCompanies,
  planRecruitmentImport,
  SOURCE_META,
  validateSourceCompany,
} from '../src/lib/recruitment-import.ts';

// Fixtures are self-contained (WS-1 drops are not in this worktree) and mirror
// the REAL embj-* drop shape (2026-08-21): slug embj-* / name / source
// 'embodied-jobs' / careerUrl / sites(单站 id embj-<name>-site, city/province,
// location {}) / positions(externalId embj-*, family social|campus|intern,
// taxonomy, status open, applySource official, applyUrl, retrievedAt) —
// deliberately WITHOUT industries / scale (drops stay lean; the adapter fills
// them). 2 valid drops + 1 broken file.

const AGIBOT = {
  slug: 'embj-agibot',
  name: '智元机器人',
  source: 'embodied-jobs',
  careerUrl: 'https://www.agibot.com/',
  sites: [
    { id: 'embj-agibot-site-shanghai', name: '智元机器人(上海)', city: '上海市', province: '上海市', location: {} },
    { id: 'embj-agibot-site-shenzhen', name: '智元机器人(深圳)', city: '深圳市', province: '广东省', location: {} },
  ],
  positions: [
    {
      externalId: 'embj-agibot-001',
      title: '具身智能算法工程师',
      siteId: 'embj-agibot-site-shanghai',
      family: 'social',
      taxonomy: { family: 'social' },
      status: 'open',
      applySource: 'official',
      applyUrl: 'https://www.agibot.com/career/social/1',
      retrievedAt: '2026-08-21',
    },
    {
      externalId: 'embj-agibot-002',
      title: '2027届校招-机器人控制算法',
      siteId: 'embj-agibot-site-shanghai',
      family: 'campus',
      taxonomy: { family: 'campus' },
      status: 'open',
      applySource: 'official',
      applyUrl: 'https://www.agibot.com/career/campus/2',
      retrievedAt: '2026-08-21',
    },
    {
      externalId: 'embj-agibot-003',
      title: '具身智能实习生',
      siteId: 'embj-agibot-site-shenzhen',
      family: 'intern',
      taxonomy: { family: 'intern' },
      status: 'open',
      applySource: 'official',
      applyUrl: 'https://www.agibot.com/career/intern/3',
      retrievedAt: '2026-08-21',
    },
  ],
};

const UNITREE = {
  slug: 'embj-unitree',
  name: '宇树科技',
  source: 'embodied-jobs',
  careerUrl: 'https://www.unitree.com/',
  sites: [{ id: 'embj-unitree-site-hangzhou', name: '宇树科技(杭州)', city: '杭州市', province: '浙江省', location: {} }],
  positions: [
    {
      externalId: 'embj-unitree-001',
      title: '机器人运动控制工程师',
      siteId: 'embj-unitree-site-hangzhou',
      family: 'campus',
      taxonomy: { family: 'campus' },
      status: 'open',
      applySource: 'official',
      applyUrl: 'https://www.unitree.com/jobs/1',
      retrievedAt: '2026-08-21',
    },
    {
      externalId: 'embj-unitree-002',
      title: '具身智能算法工程师',
      siteId: 'embj-unitree-site-hangzhou',
      family: 'social',
      taxonomy: { family: 'social' },
      status: 'open',
      applySource: 'official',
      applyUrl: 'https://www.unitree.com/jobs/2',
      retrievedAt: '2026-08-21',
    },
  ],
};

// 夹具本身不带 industries/scale —— 与真实 embj-* drops 完全一致。
for (const drop of [AGIBOT, UNITREE]) {
  assert.equal('industries' in drop, false, 'fixture must mirror real drops: no industries field');
  assert.equal('scale' in drop, false, 'fixture must mirror real drops: no scale field');
}

async function fixtureDir() {
  const dir = await mkdtemp(join(tmpdir(), 'embodied-jobs-test-'));
  await writeFile(join(dir, 'embj-agibot.json'), JSON.stringify(AGIBOT), 'utf8');
  await writeFile(join(dir, 'embj-unitree.json'), JSON.stringify(UNITREE), 'utf8');
  // 一个坏文件(非法 JSON)——adapter 应跳过,不影响其他文件。
  await writeFile(join(dir, 'broken.json'), '{ not json', 'utf8');
  return dir;
}

test('embodied-jobs adapter reads fixture drops into SourceCompany (source code / positions passthrough)', async () => {
  const dir = await fixtureDir();
  const companies = await embodiedJobsAdapter(dir).list();
  assert.equal(companies.length, 2, `expected 2 companies, got ${companies.length}`);
  for (const company of companies) {
    assert.ok(company.slug.startsWith('embj-'), `slug prefixed ${company.slug}`);
    assert.equal(company.source, 'embodied-jobs');
    assert.equal(company.careerUrl, company.name === '智元机器人' ? AGIBOT.careerUrl : UNITREE.careerUrl);
  }

  // 多城市 site 透传。
  const agibot = companies.find((c) => c.slug === 'embj-agibot');
  assert.ok(agibot);
  assert.deepEqual(
    agibot.sites.map((s) => [s.id, s.city]),
    [
      ['embj-agibot-site-shanghai', '上海市'],
      ['embj-agibot-site-shenzhen', '深圳市'],
    ],
  );

  // positions 透传: externalId embj-*、family 三值齐、status open、applyUrl/retrievedAt 原样。
  assert.deepEqual(
    agibot.positions.map((p) => [p.externalId, p.family, p.status, p.applyUrl, p.retrievedAt]),
    AGIBOT.positions.map((p) => [p.externalId, p.family, p.status, p.applyUrl, p.retrievedAt]),
  );
  assert.deepEqual(
    new Set(agibot.positions.map((p) => p.family)),
    new Set(['social', 'campus', 'intern']),
    'family 三值 social|campus|intern 齐',
  );

  const unitree = companies.find((c) => c.slug === 'embj-unitree');
  assert.ok(unitree);
  assert.equal(unitree.sites.length, 1);
  assert.deepEqual(
    unitree.positions.map((p) => p.externalId),
    ['embj-unitree-001', 'embj-unitree-002'],
  );
});

test('adapter normalizes real-shape drops: industries filled via industriesOf, scale defaulted', async () => {
  const dir = await fixtureDir();
  const companies = await embodiedJobsAdapter(dir).list();
  assert.equal(companies.length, 2, 'broken.json must be skipped');
  for (const company of companies) {
    // drops 不带 industries/scale → 适配器补齐(industriesOf 有 'other' 兜底,永不空)。
    assert.ok(Array.isArray(company.industries) && company.industries.length > 0, `industries filled for ${company.slug}`);
    assert.deepEqual(company.industries, industriesOf(company.name), 'industries must come from the shared industriesOf heuristic');
    assert.equal(company.scale, 'enterprise', 'scale defaults to the qqdoc-precedent value');
  }
});

// 回归测试(2026-08-21 FOLLOWUP): 真实 drops 形状(无 industries)曾让
// planSeedImport → dedupeSourceCompanies → cloneCompany 对 [...undefined]
// spread 抛 TypeError。此测试在真实形状下必须红→绿,防止跨 WS 缺口再现。
test('regression: real-shape drops survive dedupe/cloneCompany path with zero validation issues', async () => {
  const dir = await fixtureDir();
  const companies = await embodiedJobsAdapter(dir).list();
  assert.equal(companies.length, 2, 'broken.json must be skipped');

  // dedupeSourceCompanies → cloneCompany: industries 缺失时曾抛 TypeError。
  const deduped = dedupeSourceCompanies(companies);
  assert.equal(deduped.length, 2);
  assert.deepEqual(new Set(deduped.map((c) => c.slug)), new Set(['embj-agibot', 'embj-unitree']));

  // planRecruitmentImport(planSeedImport 的核心路径): 零 bad issues、零 dropped。
  const plan = planRecruitmentImport(companies);
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.dropped, 0);
  assert.equal(plan.companies.length, 2);

  // validateSourceCompany 直接断言: 全量零 bad issues。
  const allIssues = deduped.flatMap((company) => validateSourceCompany(company));
  assert.deepEqual(allIssues, []);
});

test('embodied-jobs adapter: empty dir and missing dir both return []', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'embodied-jobs-empty-'));
  assert.deepEqual(await embodiedJobsAdapter(empty).list(), []);
  assert.deepEqual(await embodiedJobsAdapter(join(empty, 'does-not-exist')).list(), []);
});

test('fileEmbodiedJobsAdapter singleton is registered under the embodied-jobs kind', () => {
  assert.equal(fileEmbodiedJobsAdapter.kind, 'embodied-jobs');
});

test('SOURCE_META registers embodied-jobs with published-github-file basis', () => {
  const meta = SOURCE_META['embodied-jobs'];
  assert.ok(meta, 'SOURCE_META must contain embodied-jobs');
  assert.equal(meta.originUri, 'https://raw.githubusercontent.com/Octoday-Hub/Embodied-AI/main/topics/02-jobs.md');
  assert.equal(meta.authorizationBasis, 'published-github-file');
  assert.equal(meta.accessMethod, 'public-file');
  assert.match(meta.attribution, /no LICENSE file/);
  assert.match(meta.attribution, /Octoday-Hub\/Embodied-AI/);
  assert.equal(meta.retention, 'until-replaced');
  assert.equal(meta.deletion, 'delete-with-source');
});

test('RecruitmentSourceKind union includes embodied-jobs', () => {
  const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const store = readFileSync(join(srcRoot, 'lib/recruitment-source.ts'), 'utf8');
  const unionLine = store.split('\n').find((line) => line.includes('RecruitmentSourceKind ='));
  assert.ok(unionLine, 'RecruitmentSourceKind union line exists');
  assert.match(unionLine, /'embodied-jobs'/);
});
