import test from 'node:test';
import assert from 'node:assert/strict';

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { embodiedJobsAdapter, fileEmbodiedJobsAdapter } from '../src/lib/recruitment-adapters/embodied-jobs.ts';
import { SOURCE_META, validateSourceCompany } from '../src/lib/recruitment-import.ts';

// Fixtures are self-contained (WS-1 drops are not in this worktree): a temp
// dir with 2 valid drops + 1 broken file, shaped as SourceCompany:
//   slug embj-* / source 'embodied-jobs' / sites 单站 id embj-<name>-site /
//   positions externalId embj-*, family social|campus|intern, status open,
//   applyUrl 每岗链接, retrievedAt.

const AGIBOT = {
  slug: 'embj-agibot',
  name: '智元机器人',
  source: 'embodied-jobs',
  industries: ['robotics'],
  scale: 'unicorn',
  careerUrl: 'https://www.agibot.com/',
  sites: [
    { id: 'embj-agibot-site-shanghai', name: '智元机器人(上海)', city: '上海市', province: '上海市' },
    { id: 'embj-agibot-site-shenzhen', name: '智元机器人(深圳)', city: '深圳市', province: '广东省' },
  ],
  positions: [
    {
      externalId: 'embj-agibot-001',
      title: '具身智能算法工程师',
      siteId: 'embj-agibot-site-shanghai',
      family: 'social',
      status: 'open',
      applyUrl: 'https://www.agibot.com/career/social/1',
      retrievedAt: '2026-08-21T00:00:00Z',
    },
    {
      externalId: 'embj-agibot-002',
      title: '2027届校招-机器人控制算法',
      siteId: 'embj-agibot-site-shanghai',
      family: 'campus',
      status: 'open',
      applyUrl: 'https://www.agibot.com/career/campus/2',
      retrievedAt: '2026-08-21T00:00:00Z',
    },
    {
      externalId: 'embj-agibot-003',
      title: '具身智能实习生',
      siteId: 'embj-agibot-site-shenzhen',
      family: 'intern',
      status: 'open',
      applyUrl: 'https://www.agibot.com/career/intern/3',
      retrievedAt: '2026-08-21T00:00:00Z',
    },
  ],
};

const UNITREE = {
  slug: 'embj-unitree',
  name: '宇树科技',
  source: 'embodied-jobs',
  industries: ['robotics'],
  scale: 'unicorn',
  careerUrl: 'https://www.unitree.com/',
  sites: [{ id: 'embj-unitree-site-hangzhou', name: '宇树科技(杭州)', city: '杭州市', province: '浙江省' }],
  positions: [
    {
      externalId: 'embj-unitree-001',
      title: '机器人运动控制工程师',
      siteId: 'embj-unitree-site-hangzhou',
      family: 'campus',
      status: 'open',
      applyUrl: 'https://www.unitree.com/jobs/1',
      retrievedAt: '2026-08-21T00:00:00Z',
    },
    {
      externalId: 'embj-unitree-002',
      title: '具身智能算法工程师',
      siteId: 'embj-unitree-site-hangzhou',
      family: 'social',
      status: 'open',
      applyUrl: 'https://www.unitree.com/jobs/2',
      retrievedAt: '2026-08-21T00:00:00Z',
    },
  ],
};

async function fixtureDir() {
  const dir = await mkdtemp(join(tmpdir(), 'embodied-jobs-test-'));
  await writeFile(join(dir, 'embj-agibot.json'), JSON.stringify(AGIBOT), 'utf8');
  await writeFile(join(dir, 'embj-unitree.json'), JSON.stringify(UNITREE), 'utf8');
  // 一个坏文件(非法 JSON)——file-drop 读取器应跳过,不影响其他文件。
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

test('embodied-jobs fixture drops pass import validation (zero issues)', async () => {
  const dir = await fixtureDir();
  const companies = await embodiedJobsAdapter(dir).list();
  assert.equal(companies.length, 2, 'broken.json must be skipped');
  const allIssues = companies.flatMap((company) => validateSourceCompany(company));
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
