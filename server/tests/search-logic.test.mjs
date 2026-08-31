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
  suggestSearchTags,
  activeFilterChips,
  removeFilterChip,
  runPOIPipeline,
  sortPOIs,
  suggestRecruitment,
  widenSearchScope,
} from '../src/lib/search.ts';
import { INTERNSHIP_SEED, DOMAIN_SEED } from './fixtures/seed-data.ts';
import { resolveApplyLink, withDistance, cardDisplayOrigin, cardDisplayMeters } from '../src/lib/types.ts';
import { ACTIVE_MODES, getMode, replayRecentSearch } from '../src/lib/modes.ts';
import { positionMatchesRole, positionMatchesTaxonomy } from '../src/lib/job-taxonomy.ts';
import { trendingForMode } from '../src/lib/trending-search.ts';

test('matchKeyword: case-insensitive multi-keyword AND', () => {
  assert.equal(matchKeyword('阿里巴巴 杭州', '阿里'), true);
  assert.equal(matchKeyword('阿里巴巴 杭州', '杭州'), true);
  assert.equal(matchKeyword('阿里巴巴 杭州', '阿里 杭州'), true);
  assert.equal(matchKeyword('阿里巴巴 杭州', '阿里 北京'), false);
  assert.equal(matchKeyword('Alibaba Cloud', 'alibaba'), true);
  assert.equal(matchKeyword('', ''), true);
});

test('matchKeyword: FE / frontend aliases match 前端 titles', () => {
  assert.equal(matchKeyword('前端开发工程师', 'FE'), true);
  assert.equal(matchKeyword('前端开发工程师', 'frontend'), true);
  assert.equal(matchKeyword('Front-end Engineer', '前端'), true);
  assert.equal(matchKeyword('Java 后端开发工程师', 'backend'), true);
  assert.equal(matchKeyword('产品经理实习生', 'PM'), true);
  assert.equal(matchKeyword('Java 后端开发工程师', 'FE'), false);
  assert.equal(matchKeyword('阿里巴巴', 'be'), false);
  assert.equal(matchKeyword('算法工程师', 'ml'), true);
});

test('matchKeyword: West Lake aliases match 西湖', () => {
  assert.equal(matchKeyword('西湖', 'westlake'), true);
  assert.equal(poiMatchesQuery(DOMAIN_SEED[0], 'West Lake'), true);
  assert.equal(poiMatchesQuery(DOMAIN_SEED[0], 'westlake'), true);
  assert.equal(matchKeyword('阿里巴巴', 'westlake'), false);
});

test('matchKeyword: English company names hit Chinese titles', () => {
  const alibaba = INTERNSHIP_SEED.find((c) => c.id === 'alibaba-xixi');
  const bytedance = INTERNSHIP_SEED.find((c) => c.id === 'bytedance-hangzhou');
  assert.ok(alibaba && bytedance);
  assert.equal(poiMatchesQuery(alibaba, 'alibaba'), true);
  assert.equal(poiMatchesQuery(alibaba, '阿里'), true);
  assert.equal(poiMatchesQuery(bytedance, 'bytedance'), true);
  assert.equal(poiMatchesQuery(alibaba, 'bytedance'), false);
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

  const byAlias = suggestRecruitment(INTERNSHIP_SEED, 'FE');
  assert.ok(byAlias.some((s) => s.kind === 'job' && /前端|frontend/i.test(s.name + s.subtitle)));

  const byEnglish = suggestRecruitment(INTERNSHIP_SEED, 'alibaba');
  assert.ok(byEnglish.some((s) => s.kind === 'company' && s.name.includes('阿里')));

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

test('applyFilters: roleFamily keeps companies with a matching function', () => {
  const product = applyFilters(INTERNSHIP_SEED, { roleFamily: ['product'] });
  assert.ok(product.length > 0);
  assert.ok(product.every((p) =>
    p.kind === 'recruitment' && p.positions.some((pos) => positionMatchesRole(pos, 'product'))
  ));
  const hashed = parseSearchQuery('#产品');
  assert.deepEqual(hashed.filters.roleFamily, ['product']);
  const ops = parseSearchQuery('#运营');
  assert.deepEqual(ops.filters.roleFamily, ['ops']);
});

test('applyFilters: deadline date keeps jobs still open on that day', () => {
  const soon = {
    ...INTERNSHIP_SEED[0],
    id: 'closes-sept',
    positions: INTERNSHIP_SEED[0].positions.map((pos) => ({ ...pos, deadline: '2026-09-01' })),
  };
  const later = {
    ...INTERNSHIP_SEED[1],
    id: 'closes-dec',
    positions: INTERNSHIP_SEED[1].positions.map((pos) => ({ ...pos, deadline: '2026-12-01' })),
  };
  const kept = applyFilters([soon, later], { deadline: '2026-10-01' });
  assert.deepEqual(kept.map((p) => p.id), ['closes-dec']);
});

test('sortPOIs: deadline ranks the soonest close date first', () => {
  const soon = {
    ...INTERNSHIP_SEED[0],
    id: 'soon-deadline',
    positions: INTERNSHIP_SEED[0].positions.map((pos, i) => (
      i === 0 ? { ...pos, deadline: '2026-09-01' } : pos
    )),
  };
  const later = {
    ...INTERNSHIP_SEED[1],
    id: 'later-deadline',
    positions: INTERNSHIP_SEED[1].positions.map((pos, i) => (
      i === 0 ? { ...pos, deadline: '2026-12-01' } : pos
    )),
  };
  const sorted = sortPOIs([later, soon, INTERNSHIP_SEED[2]], 'deadline');
  assert.equal(sorted[0].id, 'soon-deadline');
  assert.equal(sorted[1].id, 'later-deadline');
});

test('applyFilters: education keeps companies with a matching position', () => {
  const masters = applyFilters(INTERNSHIP_SEED, { education: ['硕士'] });
  assert.ok(masters.length > 0);
  assert.ok(masters.every((p) =>
    p.kind === 'recruitment' && p.positions.some((pos) => pos.education === '硕士')
  ));
  const hashed = parseSearchQuery('#硕士');
  assert.deepEqual(hashed.filters.education, ['硕士']);
});

test('applyFilters: benefits toggle for shuttle', () => {
  const withShuttle = applyFilters(INTERNSHIP_SEED, { providesShuttle: true });
  assert.ok(withShuttle.every((p) =>
    p.kind === 'recruitment' && (p.benefits || []).some((b) => b.includes('班车'))
  ));
  const housed = { ...INTERNSHIP_SEED[0], id: 'housed-office', benefits: ['提供住宿'] };
  const withHousing = applyFilters([INTERNSHIP_SEED[0], housed], { providesHousing: true });
  assert.deepEqual(withHousing.map((p) => p.id), ['housed-office']);
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

test('cardDisplayOrigin prefers user location, falls back to view center', () => {
  const view = { lng: 116.4, lat: 39.9 };
  const user = { lng: 120.15, lat: 30.27 };
  assert.deepEqual(cardDisplayOrigin(user, view), user);
  assert.deepEqual(cardDisplayOrigin(null, view), view);
  assert.deepEqual(cardDisplayOrigin(undefined, view), view);
});

test('job card display distance uses user location; pipeline sort stays on view center', () => {
  const viewCenter = { lng: 116.4, lat: 39.9 };
  const user = { lng: 120.15, lat: 30.27 };
  const job = (id, lng, lat) => ({
    id,
    kind: 'recruitment',
    name: id,
    mode: 'work',
    source: 'seed',
    location: { lng, lat },
    company: { name: id, industries: [], scale: 'startup' },
    positions: [],
  });
  const nearView = job('near-view', 116.41, 39.91);
  const nearUser = job('near-user', 120.16, 30.28);
  const sorted = runPOIPipeline([nearUser, nearView], { sort: 'distance', center: viewCenter });
  assert.equal(sorted[0].id, 'near-view');
  assert.equal(sorted[1].id, 'near-user');
  assert.ok(sorted[0].distance < sorted[1].distance);

  const origin = cardDisplayOrigin(user, viewCenter);
  const displayNearView = cardDisplayMeters(sorted[0], origin);
  const displayNearUser = cardDisplayMeters(sorted[1], origin);
  assert.ok(typeof displayNearView === 'number' && typeof displayNearUser === 'number');
  assert.ok(displayNearUser < displayNearView);
  assert.deepEqual(cardDisplayMeters(sorted[0], null), sorted[0].distance);
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
  assert.equal(parsed.text, 'Java 互联网');
  assert.deepEqual(parsed.filters.scale, ['bigtech']);

  const campus = parseSearchQuery('#秋招');
  assert.equal(campus.text, '');
  assert.deepEqual(campus.filters.jobTaxonomy, ['campus/autumn']);

  const unknown = parseSearchQuery('#西湖');
  assert.equal(unknown.text, '西湖');

  // 被移除的筛选项（行业/行政区/班车）不再映射为隐形筛选，退化为关键词
  const district = parseSearchQuery('#西湖区');
  assert.equal(district.text, '西湖区');
  assert.deepEqual(district.filters, {});

  const yuhang = parseSearchQuery('#余杭');
  assert.equal(yuhang.text, '余杭');
  assert.deepEqual(yuhang.filters, {});

  const hiring = parseSearchQuery('#在招');
  assert.equal(hiring.text, '');
  assert.equal(hiring.filters.onlyOpen, true);

  const shuttle = parseSearchQuery('#班车');
  assert.equal(shuttle.text, '班车');
  assert.deepEqual(shuttle.filters, {});
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

test('suggestSearchTags covers scale and campus hashes, not only industries', () => {
  const autumn = suggestSearchTags('秋招');
  assert.ok(autumn.some((tag) => tag.title === '#秋招' && tag.value === 'campus/autumn'));
  const big = suggestSearchTags('#大');
  assert.ok(big.some((tag) => tag.title === '#大厂' && tag.value === 'bigtech'));
  // 行业/行政区标签已随筛选移除，不再被建议
  assert.equal(suggestSearchTags('西湖区').length, 0);
  assert.equal(suggestSearchTags('互联网').some((tag) => tag.key === 'industry'), false);
  assert.equal(suggestSearchTags('').length, 0);
});

test('countPoisMatchingTag uses applyFilters for district and campus tags', async () => {
  const { countPoisMatchingTag } = await import('../src/lib/search.ts');
  const yuhang = countPoisMatchingTag(INTERNSHIP_SEED, { key: 'district', value: '余杭区' });
  const autumn = countPoisMatchingTag(INTERNSHIP_SEED, { key: 'jobTaxonomy', value: 'campus/autumn' });
  const open = countPoisMatchingTag(INTERNSHIP_SEED, { key: 'onlyOpen', value: 'true' });
  assert.ok(yuhang > 0);
  assert.ok(autumn > 0);
  assert.equal(open, INTERNSHIP_SEED.length);
});

test('activeFilterChips lists applied plugins and removeFilterChip drops one', () => {
  const filters = { scale: ['bigtech'], education: ['本科', '硕士'] };
  const chips = activeFilterChips(filters);
  assert.ok(chips.some((chip) => chip.title === '#大厂'));
  assert.ok(chips.some((chip) => chip.title === '#本科'));
  const dropped = removeFilterChip(filters, { key: 'education', value: '本科' });
  assert.deepEqual(dropped.education, ['硕士']);
  assert.deepEqual(dropped.scale, ['bigtech']);
  const empty = removeFilterChip({ scale: ['bigtech'] }, { key: 'scale', value: 'bigtech' });
  assert.equal(empty.scale, undefined);
});

test('activeFilterChips uses mode configs for scale, salary, and distance', () => {
  const chips = activeFilterChips(
    { scale: ['bigtech'], salary: [15, 30], distance: 3 },
    getMode('work').filters,
  );
  assert.ok(chips.some((chip) => chip.title === '#大厂'));
  assert.ok(chips.some((chip) => chip.title.includes('15') && chip.title.includes('30')));
  assert.ok(chips.some((chip) => chip.key === 'distance' && chip.value === '3'));
  const cleared = removeFilterChip({ salary: [15, 30], distance: 3 }, { key: 'salary', value: '15-30' });
  assert.equal(cleared.salary, undefined);
  assert.equal(cleared.distance, 3);
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
  assert.equal(metersToDistanceKm(3400), 3); // step 1 四舍五入到整公里
  assert.equal(metersToDistanceKm(1500), 2);
  assert.equal(metersToDistanceKm(50_000), 50);
  assert.equal(metersToDistanceKm(60_000), 50); // clamp at max
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
  assert.ok(trendingForMode('work').some((item) => item.query === '#西湖区'));
  assert.ok(trendingForMode('internship').every((item) =>
    trendingForMode('work').some((work) => work.query === item.query)
  ));
  assert.ok(trendingForMode('domain').every((item) => !item.query.startsWith('#')));
  // Reserved modes must not borrow work's queries before they activate.
  assert.deepEqual(trendingForMode('college'), []);
  assert.deepEqual(trendingForMode('overseas'), []);
});

test('applyFilters: district plugin matches Hangzhou office addresses', () => {
  const yuhang = applyFilters(INTERNSHIP_SEED, { district: ['余杭区'] });
  assert.ok(yuhang.some((p) => p.id === 'alibaba-xixi'));
  assert.ok(yuhang.every((p) => (p.location.address || '').includes('余杭')));

  const xihu = applyFilters(INTERNSHIP_SEED, { district: ['西湖区'] });
  assert.ok(xihu.length > 0);
  assert.ok(!xihu.some((p) => p.id === 'alibaba-xixi'));
});

test('applyFilters: onlyOpen drops companies with no open jobs', () => {
  const closed = {
    ...INTERNSHIP_SEED[0],
    id: 'closed-office',
    positions: INTERNSHIP_SEED[0].positions.map((pos) => ({ ...pos, status: 'closed' })),
  };
  const kept = applyFilters([INTERNSHIP_SEED[0], closed], { onlyOpen: true });
  assert.deepEqual(kept.map((p) => p.id), [INTERNSHIP_SEED[0].id]);
  assert.equal(applyFilters([closed], {}).length, 1);
});

test('activeFilterChips lists #在招 when onlyOpen is on', () => {
  const chips = activeFilterChips(
    { onlyOpen: true, providesHousing: true },
    getMode('work').filters,
  );
  assert.ok(chips.some((chip) => chip.key === 'onlyOpen' && chip.title === '#在招'));
  assert.ok(chips.some((chip) => chip.key === 'providesHousing' && chip.title === '#住宿'));
  const cleared = removeFilterChip({ onlyOpen: true, scale: ['bigtech'] }, { key: 'onlyOpen', value: 'true' });
  assert.equal(cleared.onlyOpen, undefined);
  assert.deepEqual(cleared.scale, ['bigtech']);
});

test('applyFilters: price range maps priceLevel to tier midpoints', () => {
  // priceLevel 1..4 → 档位中点 50/200/800/3000（tech/22）
  const cheap = applyFilters(DOMAIN_SEED, { price: [0, 200] });
  assert.ok(cheap.some((p) => p.priceLevel === 2));
  assert.ok(cheap.every((p) => p.kind === 'domain' && (p.priceLevel === undefined || p.priceLevel <= 2)));
  const mid = applyFilters(DOMAIN_SEED, { price: [0, 800] });
  assert.ok(mid.some((p) => p.priceLevel === 3));
  assert.ok(mid.every((p) => p.kind === 'domain' && (p.priceLevel === undefined || p.priceLevel <= 3)));
  const priced = DOMAIN_SEED.filter((p) => typeof p.priceLevel === 'number');
  const byPrice = sortPOIs(priced, 'priceAsc');
  const levels = byPrice.map((p) => p.kind === 'domain' ? (p.priceLevel ?? 99) : 99);
  for (let i = 1; i < levels.length; i++) {
    assert.ok(levels[i - 1] <= levels[i], `priceAsc at ${i}`);
  }
});

test('sortPOIs: priceDesc ranks priced POIs high→low, missing price last', () => {
  const sorted = sortPOIs(DOMAIN_SEED, 'priceDesc');
  const levels = sorted.map((p) => (p.kind === 'domain' ? (p.priceLevel ?? null) : null));
  const firstMissing = levels.indexOf(null);
  assert.ok(firstMissing > 0, 'priced POIs keep ahead of price-less ones');
  assert.ok(levels.slice(firstMissing).every((l) => l === null), 'price-less POIs all at tail');
  const priced = levels.slice(0, firstMissing);
  for (let i = 1; i < priced.length; i++) {
    assert.ok(priced[i - 1] >= priced[i], `priceDesc high→low at ${i}`);
  }
  // 档位 4 → 3 → 2（去重后）
  assert.deepEqual(priced.filter((l, i) => i === 0 || l !== priced[i - 1]), [4, 3, 2]);
  assert.equal(sorted[0].id, 'hz-yinyuequan'); // priceLevel 4
  // priceAsc 现状保持：缺失价格仍排末
  const asc = sortPOIs(DOMAIN_SEED, 'priceAsc');
  const ascMissing = asc.map((p) => (p.priceLevel ?? null)).indexOf(null);
  assert.ok(ascMissing > 0);
  assert.ok(asc.slice(ascMissing).every((p) => p.priceLevel === undefined));
});

test('applyFilters: price prefers real cost over priceLevel tier', () => {
  const poi = {
    id: 'x', kind: 'domain', name: 'X', mode: 'domain', source: 'amap',
    location: { lng: 120, lat: 30 }, category: '餐饮服务',
    priceLevel: 4, cost: 60, // 真实人均 60，不是档位中点 3000
  };
  assert.equal(applyFilters([poi], { price: [0, 100] }).length, 1);
  assert.equal(applyFilters([poi], { price: [0, 50] }).length, 0);
  assert.equal(applyFilters([poi], { price: [3000, 3000] }).length, 0);
});

test('sortPOIs: relevance ranks an exact name match first', () => {
  const ranked = sortPOIs(DOMAIN_SEED, 'relevance', '西湖');
  assert.equal(ranked[0].id, 'hz-westlake');
});

test('applyFilters: rating range keeps only POIs inside the band', () => {
  const pois = [
    { id: 'a', kind: 'domain', name: 'A', mode: 'domain', source: 'amap', location: { lng: 120, lat: 30 }, category: '餐饮服务', rating: 4.6 },
    { id: 'b', kind: 'domain', name: 'B', mode: 'domain', source: 'amap', location: { lng: 120, lat: 30 }, category: '餐饮服务', rating: 3.1 },
    { id: 'c', kind: 'domain', name: 'C', mode: 'domain', source: 'amap', location: { lng: 120, lat: 30 }, category: '餐饮服务' },
  ];
  const high = applyFilters(pois, { minRating: [4, 5] });
  assert.deepEqual(high.map((p) => p.id), ['a']);
  const full = applyFilters(pois, { minRating: [0, 5] });
  assert.equal(full.length, 3);
  const band = applyFilters(pois, { minRating: [2, 3.5] });
  assert.deepEqual(band.map((p) => p.id), ['b']);
  // 旧 slider 数值（下限）仍兼容
  assert.equal(applyFilters(pois, { minRating: 4 }).length, 1);
});

test('applyFilters: maxTier keeps only companies with tier <= maxTier (default 12)', () => {
  const base = INTERNSHIP_SEED[0];
  const position = base.positions[0] ?? { id: 'x', title: 'x', type: 'intern', status: 'open' };
  const tier0 = { ...base, id: 't0', company: { ...base.company, tier: 0 }, positions: [position] };
  const tier1 = { ...base, id: 't1', company: { ...base.company, tier: 1 }, positions: [position] };
  const tier2 = { ...base, id: 't2', company: { ...base.company, tier: 2 }, positions: [position] };
  const tier3 = { ...base, id: 't3', company: { ...base.company, tier: 3 }, positions: [position] };
  const noTier = { ...base, id: 'nt', company: { ...base.company, tier: undefined }, positions: [position] };
  assert.deepEqual(applyFilters([tier0, tier1, tier2, tier3, noTier], { maxTier: 0 }).map((p) => p.id), ['t0']);
  assert.deepEqual(applyFilters([tier0, tier1, tier2, tier3, noTier], { maxTier: 1 }).map((p) => p.id), ['t0', 't1']);
  assert.deepEqual(
    applyFilters([tier0, tier1, tier2, tier3, noTier], { maxTier: 2 }).map((p) => p.id).sort(),
    ['t0', 't1', 't2'],
  );
  assert.deepEqual(
    applyFilters([tier0, tier1, tier2, tier3, noTier], { maxTier: 3 }).map((p) => p.id).sort(),
    ['t0', 't1', 't2', 't3'],
  );
  // 缺省 tier 12 的公司要 zoom >= 12 才可见
  assert.equal(applyFilters([tier0, tier1, tier2, tier3, noTier], { maxTier: 11 }).length, 4);
  assert.equal(applyFilters([tier0, tier1, tier2, tier3, noTier], { maxTier: 12 }).length, 5);
  // 非法值视为不过滤。
  assert.equal(applyFilters([tier0, tier1, tier2, tier3, noTier], { maxTier: 21 }).length, 5);
  assert.equal(applyFilters([tier0, tier1, tier2, tier3, noTier], { maxTier: -1 }).length, 5);
});

test('applyFilters: city matches site city / province / address text (SQL is the superset)', () => {
  const base = INTERNSHIP_SEED[0];
  const position = base.positions[0] ?? { id: 'x', title: 'x', type: 'intern', status: 'open' };
  const beijing = {
    ...base,
    id: 'bj',
    company: { ...base.company },
    sites: [{ id: 'bj-site', name: '北京办公点', city: '北京', province: '北京市' }],
    location: { ...base.location, address: '北京市海淀区中关村' },
    positions: [position],
  };
  const codeCity = {
    ...base,
    id: 'code',
    company: { ...base.company },
    sites: [{ id: 'code-site', name: '海淀', cityCode: '110108' }],
    positions: [position],
  };
  const hangzhou = { ...base, id: 'hz', company: { ...base.company }, positions: [position] };
  assert.deepEqual(applyFilters([beijing, codeCity, hangzhou], { city: '北京' }).map((p) => p.id), ['bj']);
  assert.deepEqual(applyFilters([beijing, codeCity, hangzhou], { city: '北京市' }).map((p) => p.id), ['bj']);
  assert.deepEqual(applyFilters([beijing, codeCity, hangzhou], { city: '110108' }).map((p) => p.id), ['code']);
  assert.deepEqual(applyFilters([beijing, codeCity, hangzhou], { city: '上海' }), []);
});

test('applyFilters: alive keeps only open positions with future or no deadline', () => {
  const base = INTERNSHIP_SEED[0];
  const fresh = { ...base, id: 'fresh', company: { ...base.company }, positions: [{ id: 'p1', title: 't', type: 'intern', status: 'open', deadline: '2026-10-15' }] };
  const expired = { ...base, id: 'expired', company: { ...base.company }, positions: [{ id: 'p2', title: 't', type: 'intern', status: 'open', deadline: '2026-01-01' }] };
  const noDeadline = { ...base, id: 'nd', company: { ...base.company }, positions: [{ id: 'p3', title: 't', type: 'intern', status: 'open' }] };
  const closed = { ...base, id: 'closed', company: { ...base.company }, positions: [{ id: 'p4', title: 't', type: 'intern', status: 'closed', deadline: '2026-10-15' }] };
  const kept = applyFilters([fresh, expired, noDeadline, closed], { alive: true });
  assert.deepEqual(kept.map((p) => p.id).sort(), ['fresh', 'nd']);
});
