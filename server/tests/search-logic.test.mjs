// search.ts 核心逻辑单元测试（node:test + Node 原生 TS 支持）
// 运行：cd server && node --test tests/search-logic.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyFilters,
  matchKeyword,
  poiMatchesQuery,
  runPOIPipeline,
  sortPOIs,
} from '../src/lib/search.ts';
import { INTERNSHIP_SEED } from '../src/lib/seed-data.ts';
import { withDistance } from '../src/lib/types.ts';

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
