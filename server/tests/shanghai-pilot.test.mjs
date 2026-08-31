import test from 'node:test';
import assert from 'node:assert/strict';

import { fileRadarAdapter } from '../src/lib/recruitment-adapters/radar.ts';

// 上海试点公司清单 (tech/roles/data/shanghai-pilot.md)。试点跑法在 boss 合并后
// 执行 geocode:sites:apply (AMap→Baidu 兜底, 2026-08-19 落地)——之后契约升级:
// 15 家的 -shanghai 站点必须携带落在上海市 bbox 内的真实坐标; 非杭州站点允许
// 有坐标但必须落在自己站点城市的 bbox 内 (多城市办公点), 不允许跨市残留。
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

// 粗粒度包围盒 (lon/lat 范围极宽松, 只拦截跨市残留的明显错误坐标).
const HANGZHOU_BBOX = { lngMin: 118.3, lngMax: 121.0, latMin: 29.1, latMax: 30.9 };
const CITY_BBOXES = {
  杭州市: HANGZHOU_BBOX,
  上海市: { lngMin: 120.8, lngMax: 122.1, latMin: 30.6, latMax: 31.9 },
  北京市: { lngMin: 115.4, lngMax: 117.5, latMin: 39.4, latMax: 41.1 },
  深圳市: { lngMin: 113.7, lngMax: 114.7, latMin: 22.4, latMax: 22.9 },
  广州市: { lngMin: 112.8, lngMax: 114.4, latMin: 22.5, latMax: 24.0 },
  成都市: { lngMin: 102.9, lngMax: 105.0, latMin: 30.0, latMax: 31.5 },
  武汉市: { lngMin: 113.8, lngMax: 115.1, latMin: 29.9, latMax: 31.4 },
};

function inBox(bbox, lng, lat) {
  return lng >= bbox.lngMin && lng <= bbox.lngMax && lat >= bbox.latMin && lat <= bbox.latMax;
}

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

test('shanghai pilot: every -shanghai site carries coords inside 上海市 (geocode applied)', async () => {
  const companies = await fileRadarAdapter.list();
  const bySlug = new Map(companies.map((c) => [c.slug, c]));
  for (const slug of PILOT_SLUGS) {
    const company = bySlug.get(slug);
    const site = company.sites.find((s) => s.id.endsWith('-site-shanghai'));
    const lng = site.location?.lng;
    const lat = site.location?.lat;
    assert.ok(Number.isFinite(lng) && Number.isFinite(lat), `${slug} -shanghai site has no coords`);
    assert.ok(
      inBox(CITY_BBOXES['上海市'], lng, lat),
      `${slug} -shanghai coords (${lng},${lat}) outside 上海市 bbox`,
    );
  }
});

test('shanghai pilot: every coord sits inside its own site city (no cross-city leftovers)', async () => {
  const companies = await fileRadarAdapter.list();
  const bySlug = new Map(companies.map((c) => [c.slug, c]));
  for (const slug of PILOT_SLUGS) {
    const company = bySlug.get(slug);
    for (const site of company.sites) {
      const lng = site.location?.lng;
      const lat = site.location?.lat;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      const bbox = CITY_BBOXES[site.city] ?? HANGZHOU_BBOX;
      assert.ok(
        inBox(bbox, lng, lat),
        `${slug} ${site.id} coords (${lng},${lat}) outside ${site.city ?? '杭州市(默认)'} bbox`,
      );
    }
  }
});
