// aggregate 行公司级 fan-out(2026-08-26, fix/aggregate-site-fanout):
// radar 全国大类标题(aggregate: true, crawler main_site_id = 首城占位)是
// 「公司级在招信号」→ 计入公司每个站点 POI;具体行只归属声明站点。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mergeCompaniesIntoPois,
  sourceCompanyToCatalogPois,
  sourceCompanyToPois,
} from '../src/lib/recruitment-source.ts';

function company(overrides = {}) {
  return {
    slug: 'tencent',
    name: '腾讯',
    industries: ['internet'],
    scale: 'enterprise',
    sites: [
      { id: 'sz', name: '深圳', location: { lng: 113.9, lat: 22.5 } },
      { id: 'sh', name: '上海', location: { lng: 121.4, lat: 31.1 } },
    ],
    positions: [],
    ...overrides,
  };
}

test('aggregate row fanned out to every site; specific row stays on its own site', () => {
  const co = company({
    positions: [
      {
        externalId: 'radar-agg-1',
        title: '技术类 产品类',
        siteId: 'sz',
        family: 'intern',
        status: 'open',
        aggregate: true,
      },
      {
        externalId: 'radar-spec-sh',
        title: '前端开发',
        siteId: 'sh',
        family: 'campus',
        status: 'open',
      },
    ],
  });
  const pois = sourceCompanyToCatalogPois(co, 'api');
  assert.equal(pois.length, 2);
  const sz = pois.find((p) => p.id === 'tencent:sz');
  const sh = pois.find((p) => p.id === 'tencent:sh');
  assert.ok(sz && sh, 'both cities pin');

  assert.deepEqual(sz.positions.map((p) => p.id), ['radar-agg-1']);
  assert.deepEqual(sh.positions.map((p) => p.id), ['radar-agg-1', 'radar-spec-sh']);
  // 聚合标志随行流出, 展示层按 position.aggregate 渲染 — fan-out 不改语义。
  assert.equal(sz.positions[0].aggregate, true);
  assert.equal(sh.positions[0].aggregate, true);
  assert.equal(sh.positions[1].aggregate, undefined);
  assert.equal(sz.positions[0].siteId, 'sz'); // 聚合行保留原占位 siteId(radar 约定)
});

test('aggregate row whose siteId equals a site id is not double-counted there', () => {
  const co = company({
    positions: [
      { externalId: 'radar-agg-1', title: '技术类', siteId: 'sz', family: 'intern', status: 'open', aggregate: true },
      { externalId: 'radar-spec-sz', title: '后端', siteId: 'sz', family: 'campus', status: 'open' },
    ],
  });
  const pois = sourceCompanyToCatalogPois(co, 'api');
  const sz = pois.find((p) => p.id === 'tencent:sz');
  const sh = pois.find((p) => p.id === 'tencent:sh');
  // sz 同时命中 specific 与「占位 siteId == 本站」的聚合行 → 各一次, 不双计。
  assert.deepEqual(sz.positions.map((p) => p.id).sort(), ['radar-agg-1', 'radar-spec-sz']);
  assert.deepEqual(sh.positions.map((p) => p.id), ['radar-agg-1']);
});

test('single-site company is unchanged by fan-out (one POI, no duplicates)', () => {
  const co = company({
    sites: [{ id: 'sz', name: '深圳', location: { lng: 113.9, lat: 22.5 } }],
    positions: [
      { externalId: 'radar-agg-1', title: '技术类', siteId: 'sz', family: 'intern', status: 'open', aggregate: true },
    ],
  });
  const pois = sourceCompanyToCatalogPois(co, 'api');
  assert.equal(pois.length, 1);
  assert.equal(pois[0].id, 'tencent');
  assert.deepEqual(pois[0].positions.map((p) => p.id), ['radar-agg-1']);
});

test('openOnly filter stacks with aggregate fan-out: closed aggregate appears nowhere', () => {
  const co = company({
    positions: [
      { externalId: 'radar-agg-open', title: '技术类', siteId: 'sz', family: 'intern', status: 'open', aggregate: true },
      {
        externalId: 'radar-agg-closed',
        title: '旧聚合',
        siteId: 'sz',
        family: 'intern',
        status: 'closed',
        aggregate: true,
      },
    ],
  });
  const catalog = sourceCompanyToCatalogPois(co, 'api'); // openOnly: true
  for (const poi of catalog) {
    assert.deepEqual(poi.positions.map((p) => p.id), ['radar-agg-open']); // closed 聚合不 fan-out
  }
  // 无 openOnly 的路径(seed 直出等)保留 closed 行, 但同样每个站点各一次。
  const raw = sourceCompanyToPois(co, 'seed');
  for (const poi of raw) {
    assert.deepEqual(poi.positions.map((p) => p.id).sort(), ['radar-agg-closed', 'radar-agg-open']);
  }
});

test('mergeCompaniesIntoPois fans aggregate rows onto seed POIs and new-site pins exactly once', () => {
  const base = [
    {
      id: 'tencent',
      kind: 'recruitment',
      name: '腾讯',
      mode: 'work',
      source: 'seed',
      location: { lng: 113.9, lat: 22.5 },
      company: { name: '腾讯', scale: 'enterprise' },
      sites: [{ id: 'sz', name: '深圳', location: { lng: 113.9, lat: 22.5 } }],
      positions: [{ id: 'seed-1', siteId: 'sz', title: '旧的骨架岗位', type: 'intern' }],
    },
  ];
  const co = company({
    sites: [
      { id: 'sz', name: '深圳', location: { lng: 113.9, lat: 22.5 } },
      { id: 'sh', name: '上海', location: { lng: 121.4, lat: 31.1 } },
    ],
    positions: [
      { externalId: 'radar-agg-1', title: '技术类 产品类', siteId: 'sz', family: 'intern', status: 'open', aggregate: true },
      { externalId: 'radar-spec-sh', title: '前端', siteId: 'sh', family: 'campus', status: 'open' },
    ],
  });
  const merged = mergeCompaniesIntoPois(base, [co]);
  const sz = merged.find((p) => p.id === 'tencent');
  const sh = merged.find((p) => p.id === 'tencent:sh');
  assert.ok(sz && sh, 'seed POI 保留 + 新站 pin 出现');
  // seed POI: 原岗位 + 聚合行(不因站点不同而丢失); 聚合行恰一次。
  assert.deepEqual(sz.positions.map((p) => p.id), ['seed-1', 'radar-agg-1']);
  assert.deepEqual(sh.positions.map((p) => p.id), ['radar-agg-1', 'radar-spec-sh']);
  assert.equal(sz.positions.filter((p) => p.id === 'radar-agg-1').length, 1);
  assert.equal(sh.positions.filter((p) => p.id === 'radar-agg-1').length, 1);
});

test('mergeCompaniesIntoPois drops a closed aggregate tombstone from every POI', () => {
  const base = [
    {
      id: 'tencent',
      kind: 'recruitment',
      name: '腾讯',
      mode: 'work',
      source: 'seed',
      location: { lng: 113.9, lat: 22.5 },
      company: { name: '腾讯', scale: 'enterprise' },
      sites: [{ id: 'sz', name: '深圳', location: { lng: 113.9, lat: 22.5 } }],
      positions: [
        { id: 'radar-agg-old', siteId: 'sz', title: '旧聚合', type: 'intern', aggregate: true },
      ],
    },
  ];
  const co = company({
    sites: [{ id: 'sz', name: '深圳', location: { lng: 113.9, lat: 22.5 } }],
    positions: [
      { externalId: 'radar-agg-old', title: '旧聚合', siteId: 'sz', family: 'intern', status: 'closed', aggregate: true },
      { externalId: 'radar-agg-new', title: '新聚合', siteId: 'sz', family: 'intern', status: 'open', aggregate: true },
    ],
  });
  const merged = mergeCompaniesIntoPois(base, [co]);
  const sz = merged.find((p) => p.id === 'tencent');
  assert.ok(sz);
  assert.deepEqual(sz.positions.map((p) => p.id), ['radar-agg-new']); // 墓碑被清, 新聚合在
});
