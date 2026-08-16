// search.ts 核心逻辑单元测试（node:test + Node 原生 TS 支持）
// 运行：cd server && node --test tests/search-logic.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyFilters,
  distanceFilterMeters,
  metersToDistanceKm,
  pointAtDistanceEast,
  matchKeyword,
  parseSearchQuery,
  applyTagSuggestion,
  poiMatchesQuery,
  runPOIPipeline,
  sortPOIs,
  suggestRecruitment,
  widenSearchScope,
} from '../src/lib/search.ts';
import { INTERNSHIP_SEED } from '../src/lib/seed-data.ts';
import { resolveApplyLink, withDistance } from '../src/lib/types.ts';
import { ACTIVE_MODES, getMode, replayRecentSearch } from '../src/lib/modes.ts';
import { positionMatchesTaxonomy } from '../src/lib/job-taxonomy.ts';
import { trendingForMode } from '../src/lib/trending-search.ts';

test('matchKeyword: case-insensitive multi-keyword AND', () => {
  assert.equal(matchKeyword('阿里巴巴 杭州', '阿里'), true);
  assert.equal(matchKeyword('阿里巴巴 杭州', '杭州'), true);
  assert.equal(matchKeyword('阿里巴巴 杭州', '阿里 杭州'), true);
  assert.equal(matchKeyword('阿里巴巴 杭州', '阿里 北京'), false);
  assert.equal(matchKeyword('Alibaba Cloud', 'alibaba'), true);
  assert.equal(matchKeyword('', ''), true);
});

test('poiMatchesQuery: recruitment matches company, industry, or position', () => {
  const alibaba = INTERNSHIP_SEED.find((c) => c.id === 'alibaba-xixi');
  assert.ok(alibaba, 'alibaba seed present');
  assert.equal(poiMatchesQuery(alibaba, '阿里巴巴'), true);
  assert.equal(poiMatchesQuery(alibaba, '互联网'), true); // industry
  assert.equal(poiMatchesQuery(alibaba, 'Java'), true); // position skill
  assert.equal(poiMatchesQuery(alibaba, '前端'), true); // position title
  assert.equal(poiMatchesQuery(alibaba, '腾讯'), false);
});

test('suggestRecruitment: companies and jobs, never domain places', () => {
  const byCompany = suggestRecruitment(INTERNSHIP_SEED, '阿里');
  assert.ok(byCompany.some((s) => s.kind === 'company' && s.name.includes('阿里')));
  assert.ok(byCompany.every((s) => s.kind === 'company' || s.kind === 'job'));

  const byJob = suggestRecruitment(INTERNSHIP_SEED, 'Java');
  assert.ok(byJob.some((s) => s.kind === 'job' && /java/i.test(s.name + s.subtitle)));
  assert.ok(byJob.every((s) => s.poiId));

  const empty = suggestRecruitment(INTERNSHIP_SEED, '西湖风景名胜区');
  assert.equal(empty.length, 0);
});

test('applyFilters: industry multi-select filters companies', () => {
  const seed = INTERNSHIP_SEED;
  const tech = applyFilters(seed, { industry: ['internet'] });
  assert.ok(tech.length < seed.length, 'filtered subset');
  assert.ok(tech.length > 0, 'still has results');
  // 深度筛选：AI 独角兽
  const ai = applyFilters(seed, { industry: ['ai'] });
  assert.ok(ai.every((p) => {
    if (p.kind !== 'recruitment') return false;
    return p.company.industries.includes('ai');
  }));
});

test('applyFilters: scale filter narrows to bigtech', () => {
  const big = applyFilters(INTERNSHIP_SEED, { scale: ['bigtech'] });
  assert.ok(big.length > 0);
  assert.ok(big.every((p) => p.kind === 'recruitment' && p.company.scale === 'bigtech'));
});

test('applyFilters: salary range keeps companies with matching position', () => {
  const highSalary = applyFilters(INTERNSHIP_SEED, { salary: [10, 25] });
  assert.ok(highSalary.length > 0);
  // 深度求索（12-25K）应在结果中
  assert.ok(highSalary.some((p) => p.id === 'deepseek'));
});

test('applyFilters: benefits toggle for shuttle', () => {
  const withShuttle = applyFilters(INTERNSHIP_SEED, { providesShuttle: true });
  assert.ok(withShuttle.every((p) =>
    p.kind === 'recruitment' && (p.benefits || []).some((b) => b.includes('班车'))
  ));
});

test('sortPOIs: salaryDesc ranks highest salary first', () => {
  const sorted = sortPOIs(INTERNSHIP_SEED, 'salaryDesc');
  const vals = sorted.map((p) => {
    if (p.kind !== 'recruitment') return 0;
    return Math.max(...p.positions.map((pos) => pos.salary ? pos.salary.max : 0));
  });
  for (let i = 1; i < vals.length; i++) {
    assert.ok(vals[i - 1] >= vals[i], `descending order at ${i}`);
  }
  assert.equal(sorted[0].id, 'deepseek'); // 最高薪公司排第一
});

test('sortPOIs: distance sorts by distance field', () => {
  const withDist = withDistance(INTERNSHIP_SEED, { lng: 120.15, lat: 30.27 });
  const sorted = sortPOIs(withDist, 'distance');
  assert.ok(sorted[0].distance <= sorted[1].distance);
});

test('runPOIPipeline: full pipeline query + filter + center + sort', () => {
  const results = runPOIPipeline(INTERNSHIP_SEED, {
    query: '算法',
    center: { lng: 120.15, lat: 30.27 },
    sort: 'distance',
  });
  assert.ok(results.length > 0);
  // 所有结果都带 distance 且匹配"算法"
  for (const poi of results) {
    assert.equal(typeof poi.distance, 'number');
    assert.equal(poiMatchesQuery(poi, '算法'), true);
  }
});

test('runPOIPipeline: maxDistance spatial filter', () => {
  const within3km = runPOIPipeline(INTERNSHIP_SEED, {
    center: { lng: 120.15, lat: 30.27 },
    maxDistance: 3000,
  });
  const all = runPOIPipeline(INTERNSHIP_SEED, {
    center: { lng: 120.15, lat: 30.27 },
  });
  assert.ok(within3km.length <= all.length);
  for (const poi of within3km) {
    assert.ok(poi.distance <= 3000, `${poi.name} within 3km`);
  }
});

test('runPOIPipeline: robust on empty input', () => {
  assert.deepEqual(runPOIPipeline([], {}), []);
});

test('resolveApplyLink: position apply wins over company career portal', () => {
  const xixi = INTERNSHIP_SEED.find((c) => c.id === 'xixi-ai');
  assert.ok(xixi);
  const job = xixi.positions.find((p) => p.id === 'xixi-llm');
  assert.ok(job);
  const link = resolveApplyLink(xixi, job);
  assert.equal(link?.source, 'boss');
  assert.ok(link?.url.startsWith('https://www.zhipin.com/'));
});

test('resolveApplyLink: falls back to company careerUrl', () => {
  const huawei = INTERNSHIP_SEED.find((c) => c.id === 'huawei-hangzhou');
  assert.ok(huawei);
  const embedded = huawei.positions.find((p) => p.id === 'huawei-embedded');
  assert.ok(embedded);
  const link = resolveApplyLink(huawei, embedded);
  assert.equal(link?.source, 'official');
  assert.equal(link?.url, 'https://career.huawei.com/');
});

test('resolveApplyLink: rejects non-http urls', () => {
  const huawei = INTERNSHIP_SEED.find((c) => c.id === 'huawei-hangzhou');
  assert.ok(huawei);
  const fake = { ...huawei.positions[0], apply: { source: 'other', url: 'javascript:alert(1)' } };
  const company = { ...huawei, company: { ...huawei.company, careerUrl: 'not-a-url' } };
  assert.equal(resolveApplyLink(company, fake), null);
});

test('active modes are map + work, internship aliases to work', () => {
  assert.deepEqual(ACTIVE_MODES, ['domain', 'work']);
  assert.equal(getMode('internship').id, 'work');
  assert.equal(getMode('work').name, '工作');
  assert.ok(getMode('work').filters.some((f) => f.type === 'taxonomy' && f.key === 'jobTaxonomy'));
});

test('replayRecentSearch canonicalizes internship and flags a mode hop', () => {
  assert.deepEqual(replayRecentSearch('work', { query: 'Java #大厂', mode: 'internship' }), {
    mode: 'work',
    query: 'Java #大厂',
    modeChanged: false,
  });
  assert.deepEqual(replayRecentSearch('domain', { query: '西湖', mode: 'work' }), {
    mode: 'work',
    query: '西湖',
    modeChanged: true,
  });
});

test('applyFilters: jobTaxonomy plugin keeps companies with matching positions', () => {
  const campus = applyFilters(INTERNSHIP_SEED, { jobTaxonomy: ['campus'] });
  assert.ok(campus.length > 0);
  assert.ok(campus.every((p) =>
    p.kind === 'recruitment' && p.positions.some((pos) => positionMatchesTaxonomy(pos, 'campus'))
  ));

  const autumn = applyFilters(INTERNSHIP_SEED, { jobTaxonomy: ['campus', 'campus/autumn'] });
  assert.ok(autumn.some((p) => p.id === 'tencent-hangzhou'));
  assert.ok(!autumn.some((p) => p.id === 'netease-hangzhou'), 'spring campus should not match autumn leaf');
  assert.ok(autumn.every((p) =>
    p.kind === 'recruitment' && p.positions.some((pos) => positionMatchesTaxonomy(pos, 'campus/autumn'))
  ));

  const social = applyFilters(INTERNSHIP_SEED, { jobTaxonomy: ['social/1-3'] });
  assert.ok(social.some((p) => p.id === 'huawei-hangzhou'));
});

test('parseSearchQuery turns #tags into filter plugins', () => {
  const parsed = parseSearchQuery('Java #大厂 #互联网');
  assert.equal(parsed.text, 'Java');
  assert.deepEqual(parsed.filters.scale, ['bigtech']);
  assert.deepEqual(parsed.filters.industry, ['internet']);

  const campus = parseSearchQuery('#秋招');
  assert.equal(campus.text, '');
  assert.deepEqual(campus.filters.jobTaxonomy, ['campus/autumn']);

  const unknown = parseSearchQuery('#西湖');
  assert.equal(unknown.text, '西湖');
});

test('applyTagSuggestion merges a known hash into filters and clears the query', () => {
  const tagged = applyTagSuggestion({ query: '阿里', filters: { industry: ['internet'] } }, '#大厂');
  assert.equal(tagged.applied, true);
  assert.equal(tagged.query, '');
  assert.deepEqual(tagged.filters.industry, ['internet']);
  assert.deepEqual(tagged.filters.scale, ['bigtech']);

  const unknownTag = applyTagSuggestion({ query: '西湖', filters: {} }, '#未知标签');
  assert.equal(unknownTag.applied, false);
  assert.equal(unknownTag.query, '西湖');
});

test('runPOIPipeline: #大厂 keeps bigtech and still matches leftover keywords', () => {
  const tagged = runPOIPipeline(INTERNSHIP_SEED, { query: '#大厂' });
  assert.ok(tagged.length > 0);
  assert.ok(tagged.every((p) => p.kind === 'recruitment' && p.company.scale === 'bigtech'));

  const javaBig = runPOIPipeline(INTERNSHIP_SEED, { query: 'Java #大厂' });
  assert.ok(javaBig.some((p) => p.id === 'alibaba-xixi'));
  assert.ok(javaBig.every((p) => p.kind === 'recruitment' && p.company.scale === 'bigtech'));
});

test('distanceFilterMeters converts the km slider to meters', () => {
  assert.equal(distanceFilterMeters(undefined), 0);
  assert.equal(distanceFilterMeters({}), 0);
  assert.equal(distanceFilterMeters({ distance: 0 }), 0);
  assert.equal(distanceFilterMeters({ distance: 3 }), 3000);
});

test('metersToDistanceKm snaps a dragged radius back onto the slider', () => {
  assert.equal(metersToDistanceKm(0), 0);
  assert.equal(metersToDistanceKm(200), 0);
  assert.equal(metersToDistanceKm(3200), 3);
  assert.equal(metersToDistanceKm(3400), 3.5);
  assert.equal(metersToDistanceKm(50_000), 10);
});

test('pointAtDistanceEast stays on the same latitude', () => {
  const origin = { lng: 120.15, lat: 30.27 };
  const east = pointAtDistanceEast(origin, 3000);
  assert.equal(east.lat, origin.lat);
  assert.ok(east.lng > origin.lng);
});

test('widenSearchScope drops distance, then filters, then the query', () => {
  const dropDistance = widenSearchScope({ query: '咖啡', filters: { distance: 2, district: ['西湖区'] } });
  assert.equal(dropDistance.filters.distance, undefined);
  assert.deepEqual(dropDistance.filters.district, ['西湖区']);

  const dropFilters = widenSearchScope({ query: '咖啡', filters: { district: ['西湖区'] } });
  assert.deepEqual(dropFilters.filters, {});
  assert.equal(dropFilters.query, '咖啡');

  const dropQuery = widenSearchScope({ query: '咖啡', filters: {} });
  assert.equal(dropQuery.query, '');
  assert.equal(dropQuery.changed, true);

  assert.equal(widenSearchScope({ query: '', filters: {} }).changed, false);
});

test('trendingForMode is a plugin per map mode', () => {
  assert.ok(trendingForMode('work').some((item) => item.query.startsWith('#')));
  assert.ok(trendingForMode('internship').every((item) =>
    trendingForMode('work').some((work) => work.query === item.query)
  ));
  assert.ok(trendingForMode('domain').every((item) => !item.query.startsWith('#')));
});

test('applyFilters: district plugin matches Hangzhou office addresses', () => {
  const yuhang = applyFilters(INTERNSHIP_SEED, { district: ['余杭区'] });
  assert.ok(yuhang.some((p) => p.id === 'alibaba-xixi'));
  assert.ok(yuhang.every((p) => (p.location.address || '').includes('余杭')));

  const xihu = applyFilters(INTERNSHIP_SEED, { district: ['西湖区'] });
  assert.ok(xihu.length > 0);
  assert.ok(!xihu.some((p) => p.id === 'alibaba-xixi'));
});

test('applyFilters: minRating keeps only highly rated domain POIs', () => {
  const pois = [
    { id: 'a', kind: 'domain', name: 'A', mode: 'domain', source: 'amap', location: { lng: 120, lat: 30 }, category: '餐饮服务', rating: 4.6 },
    { id: 'b', kind: 'domain', name: 'B', mode: 'domain', source: 'amap', location: { lng: 120, lat: 30 }, category: '餐饮服务', rating: 3.1 },
    { id: 'c', kind: 'domain', name: 'C', mode: 'domain', source: 'amap', location: { lng: 120, lat: 30 }, category: '餐饮服务' },
  ];
  const kept = applyFilters(pois, { minRating: 4 });
  assert.deepEqual(kept.map((p) => p.id), ['a']);
  assert.equal(applyFilters(pois, { minRating: 0 }).length, 3);
});
