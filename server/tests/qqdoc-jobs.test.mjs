import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isPlausibleApplyUrl,
  listQqdocJobsFiles,
  parseQqdocJobsPayload,
  qqdocJobsAdapter,
  qqdocJobsToSourceCompany,
} from '../src/lib/recruitment-adapters/qqdoc-jobs.ts';
import { planSeedImport, validateSourceCompany } from '../src/lib/recruitment-import.ts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const QQJ_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'recruitment', 'qqdoc-jobs');

function dropFile(name) {
  return JSON.parse(readFileSync(join(QQJ_DIR, name), 'utf8'));
}

test('qqdoc-jobs adapter reads all 163 drops into SourceCompany', async () => {
  const companies = await qqdocJobsAdapter().list();
  assert.equal(companies.length, 163, `expected 163 qqdoc-jobs companies, got ${companies.length}`);
  for (const company of companies) {
    assert.ok(company.slug.startsWith('qqj-'), `slug prefixed ${company.slug}`);
    assert.equal(company.source, 'qqdoc-jobs');
    assert.equal(company.scale, 'enterprise');
    assert.ok(company.industries.length >= 1, `${company.name} needs an industry tag`);
    assert.ok(company.sites.length >= 1, `${company.name} needs a site`);
    for (const pos of company.positions) {
      assert.ok(pos.externalId, `${company.name} position needs externalId`);
      assert.ok(pos.siteId, `${company.name} position needs siteId`);
    }
  }
});

test('qqdoc-jobs drops pass import validation (163 companies, zero issues)', async () => {
  const companies = await listQqdocJobsFiles();
  const allIssues = companies.flatMap((company) => validateSourceCompany(company));
  assert.deepEqual(allIssues, []);
});

test('planSeedImport includes qqdoc-jobs companies ahead of seed', async () => {
  const plan = await planSeedImport();
  const qqj = plan.companies.filter((company) => company.source === 'qqdoc-jobs');
  assert.equal(qqj.length, 163, `plan should carry 163 qqdoc-jobs companies, got ${qqj.length}`);
  assert.ok(
    plan.companies.findIndex((c) => c.slug === 'qqj-新东方西安学校') <
      plan.companies.findIndex((c) => c.slug === 'tencent-hangzhou'),
  );
});

test('isPlausibleApplyUrl: rejects placeholder texts, accepts real URLs', () => {
  assert.equal(isPlausibleApplyUrl(undefined), false);
  assert.equal(isPlausibleApplyUrl(''), false);
  assert.equal(isPlausibleApplyUrl('投递连接看官方公告'), false);
  assert.equal(isPlausibleApplyUrl('https://投递连接看官方公告'), false);
  assert.equal(isPlausibleApplyUrl('https://文中扫码投递简历'), false);
  assert.equal(isPlausibleApplyUrl('https://jobs.feishu.cn/s/abc123'), true);
  assert.equal(isPlausibleApplyUrl('https://join.chaitin.cn/plugins/career_site/sites/default'), true);
});

test('qqdoc-jobs adapter surfaces positions from drops and filters malformed rows', async () => {
  const companies = await listQqdocJobsFiles();
  const sample = qqdocJobsToSourceCompany({
    slug: 'qqj-测试',
    name: '测试公司',
    sources: ['qqdoc-jobs'],
    apply_url: 'https://demo.jobs.feishu.cn/s/abc',
    sites: [{ id: 'qqj-测试-site', name: '测试公司', city: '北京、杭州', province: '', location: {} }],
    positions: [
      { externalId: 'portal-feishu-1', title: '算法工程师', siteId: 'qqj-测试-site', family: 'campus', status: 'open' },
      { externalId: '', title: '缺 externalId', siteId: 'qqj-测试-site', family: 'campus', status: 'open' },
      { title: '缺 id 也没 externalId', siteId: 'qqj-测试-site', family: 'campus', status: 'open' },
    ],
  });
  assert.ok(sample);
  assert.equal(sample.positions.length, 1);
  assert.equal(sample.positions[0].externalId, 'portal-feishu-1');
  assert.equal(sample.careerUrl, 'https://demo.jobs.feishu.cn/s/abc');
  assert.deepEqual(sample.sites[0].location, {});
  assert.deepEqual(sample.sites[0].city, '北京、杭州');
});

test('placeholder apply_url never reaches the UI as careerUrl', async () => {
  const company = qqdocJobsToSourceCompany({
    slug: 'qqj-测试2',
    name: '测试公司2',
    sources: ['qqdoc-jobs'],
    apply_url: 'https://投递连接看官方公告',
    sites: [{ id: 'qqj-测试2-site', name: '测试公司2', city: '杭州', province: '', location: {} }],
  });
  assert.ok(company);
  assert.equal(company.careerUrl, undefined);
});

test('parseQqdocJobsPayload handles array / single / garbage', () => {
  const one = parseQqdocJobsPayload({
    slug: 'qqj-a',
    name: 'A',
    sites: [{ id: 'a-site', name: 'A' }],
  });
  assert.equal(one.length, 1);
  const many = parseQqdocJobsPayload([
    { slug: 'qqj-a', name: 'A', sites: [{ id: 'a-site', name: 'A' }] },
    { slug: 'qqj-b', name: 'B', sites: [{ id: 'b-site', name: 'B' }] },
  ]);
  assert.equal(many.length, 2);
  assert.deepEqual(parseQqdocJobsPayload(null), []);
  assert.deepEqual(parseQqdocJobsPayload({ name: 'no-slug' }), []);
  assert.deepEqual(parseQqdocJobsPayload({ slug: 'qqj-x', name: 'X', sites: [] }), []);
  assert.deepEqual(parseQqdocJobsPayload({ slug: 'qqj-y', name: 'Y' }), []);
});

test('qqdoc-jobs drops carry no city_pending-style placeholders as sites', async () => {
  // 2026-08-22 地址回填 (e506c4d): 单城市 site 的 city 归一为「西安市」, location 带回填 address;
  // 未回填时 location 仍可为空对象 {}, 不得被丢弃。
  const raw = dropFile('qqj-新东方西安学校.json');
  assert.equal(raw.sites.length, 1);
  assert.equal(raw.sites[0].city, '西安市');
  assert.ok(raw.sites[0].location.address.length > 0, 'location 含回填 address');
  assert.equal(raw.sites[0].location.address, '陕西省西安市碑林区南二环西段27号新东方大厦');
});
