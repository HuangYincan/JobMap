import test from 'node:test';
import assert from 'node:assert/strict';

import { fileRadarAdapter } from '../src/lib/recruitment-adapters/radar.ts';

// 上海试点公司清单 (tech/roles/data/shanghai-pilot.md)。试点跑法在 boss 合并后
// 执行 geocode:sites:apply —— 在此之前试点公司的非杭州站点一律不得携带坐标
// (fecef85 事故把杭州 office 坐标复制到了全部站点; 非杭州站点恢复 city-text,
// 等城市级 geocode 解析真实上海 office)。
const PILOT_SLUGS = [
  '得物',
  '米哈游',
  '哔哩哔哩',
  '拼多多',
  '携程集团',
  '商汤科技-无限原力',
  '上汽集团',
  '中微公司',
  '联影集团',
  '禾赛科技',
  '燧原科技',
  '智元机器人',
  '乐鑫科技',
  '上海电气',
  '春秋航空',
];

// 杭州市粗粒度包围盒 (lon 118.3-121.0, lat 29.1-30.9) —— 保留在杭州站点上的
// office 坐标必须落在杭州, 不允许跨市残留。
const HANGZHOU_BBOX = { lngMin: 118.3, lngMax: 121.0, latMin: 29.1, latMax: 30.9 };

test('shanghai pilot: every pilot company exists and carries a -shanghai site', async () => {
  const companies = await fileRadarAdapter.list();
  const bySlug = new Map(companies.map((c) => [c.slug, c]));
  for (const slug of PILOT_SLUGS) {
    const company = bySlug.get(slug);
    assert.ok(company, `pilot company ${slug} missing from radar drops`);
    assert.ok(
      company.sites.some((s) => s.id.endsWith('-site-shanghai')),
      `${slug} has no -shanghai site`,
    );
  }
});

test('shanghai pilot: non-Hangzhou sites carry no coordinates (fecef85 wipe)', async () => {
  const companies = await fileRadarAdapter.list();
  const bySlug = new Map(companies.map((c) => [c.slug, c]));
  for (const slug of PILOT_SLUGS) {
    const company = bySlug.get(slug);
    for (const site of company.sites) {
      const lng = site.location?.lng;
      const lat = site.location?.lat;
      const hasCoord = Number.isFinite(lng) && Number.isFinite(lat);
      if (!hasCoord) continue;
      const isHangzhouSite = site.city?.includes('杭州') ?? false;
      assert.ok(
        isHangzhouSite,
        `${slug} non-Hangzhou site ${site.id} still carries coords (${lng},${lat}) — fecef85 leftover`,
      );
    }
  }
});

test('shanghai pilot: kept Hangzhou-site coords sit inside 杭州市', async () => {
  const companies = await fileRadarAdapter.list();
  const bySlug = new Map(companies.map((c) => [c.slug, c]));
  for (const slug of PILOT_SLUGS) {
    const company = bySlug.get(slug);
    for (const site of company.sites) {
      const lng = site.location?.lng;
      const lat = site.location?.lat;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      if (!site.city?.includes('杭州')) continue;
      assert.ok(
        lng >= HANGZHOU_BBOX.lngMin && lng <= HANGZHOU_BBOX.lngMax,
        `${slug} ${site.id} lng ${lng} outside Hangzhou bbox`,
      );
      assert.ok(
        lat >= HANGZHOU_BBOX.latMin && lat <= HANGZHOU_BBOX.latMax,
        `${slug} ${site.id} lat ${lat} outside Hangzhou bbox`,
      );
    }
  }
});

test('shanghai pilot: 得物/商汤/禾赛 -shanghai sites specifically cleared', async () => {
  const companies = await fileRadarAdapter.list();
  const bySlug = new Map(companies.map((c) => [c.slug, c]));
  for (const slug of ['得物', '商汤科技-无限原力', '禾赛科技']) {
    const site = bySlug.get(slug).sites.find((s) => s.id.endsWith('-site-shanghai'));
    assert.equal(Number.isFinite(site.location?.lng), false, `${slug} -shanghai site must have no lng`);
    assert.equal(Number.isFinite(site.location?.lat), false, `${slug} -shanghai site must have no lat`);
  }
});
