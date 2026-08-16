// Search / filter integration: the same composition the API routes use
// (seed → parse tags → pipeline → page → industry aggregations).
// Does not boot Next; Playwright E2E stays a later item.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSearchQuery, runPOIPipeline } from '../src/lib/search.ts';
import { INTERNSHIP_SEED } from '../src/lib/seed-data.ts';
import { isRecruitmentMode, withDistance } from '../src/lib/types.ts';
import { MODES } from '../src/lib/modes.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function src(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

const HANGZHOU = { lng: 120.15, lat: 30.27 };

function searchLikeRoute(body) {
  const mode = body.mode || 'work';
  const page = Math.max(1, Math.floor(body.page || 1));
  const pageSize = Math.min(50, Math.max(1, Math.floor(body.pageSize || 20)));
  const parsed = parseSearchQuery(body.q || '');
  const filters = { ...parsed.filters, ...(body.filters || {}) };
  const pois = isRecruitmentMode(mode) ? INTERNSHIP_SEED : [];
  const processed = runPOIPipeline(pois, {
    query: parsed.text || body.q,
    filters,
    sort: body.sort,
    center: HANGZHOU,
  });
  const start = (page - 1) * pageSize;
  const results = processed.slice(start, start + pageSize);
  const industries = {};
  if (isRecruitmentMode(mode)) {
    for (const poi of processed) {
      if (poi.kind !== 'recruitment') continue;
      for (const ind of poi.company.industries) {
        industries[ind] = (industries[ind] || 0) + 1;
      }
    }
  }
  return {
    total: processed.length,
    page,
    pageSize,
    results: withDistance(results, HANGZHOU),
    aggregations: { industries },
  };
}

test('POST /api/search contract: invalid JSON 400, work seed + cache + pipeline', () => {
  const route = src('app/api/search/route.ts');
  assert.match(route, /status: 400/);
  assert.match(route, /invalid JSON body/);
  assert.match(route, /INTERNSHIP_SEED/);
  assert.match(route, /runPOIPipeline/);
  assert.match(route, /writePublicCache/);
  assert.match(route, /aggregations: \{ industries \}/);
  assert.match(route, /pageSize = Math\.min\(50/);
});

test('GET /api/pois contract: work seed, domain examples, unknown mode empty', () => {
  const route = src('app/api/pois/route.ts');
  assert.match(route, /INTERNSHIP_SEED/);
  assert.match(route, /hz-westlake/);
  assert.match(route, /未实现模式：空结果/);
  assert.match(route, /runPOIPipeline/);
  assert.match(route, /parseFilters/);
});

test('GET /api/filter-options contract: unknown mode 400, work has taxonomy + district', () => {
  const route = src('app/api/filter-options/route.ts');
  assert.match(route, /INVALID_MODE/);
  assert.match(route, /status: 400/);
  assert.ok(MODES.work);
  const keys = MODES.work.filters.map((f) => f.key);
  assert.ok(keys.includes('jobTaxonomy'));
  assert.ok(keys.includes('district'));
  assert.ok(keys.includes('industry'));
  assert.ok(keys.includes('distance'));
  assert.ok(MODES.work.sortOptions.length >= 3);
});

test('GET /api/suggest contract: work matches company/job/tag; empty q shows hot searches', () => {
  const route = src('app/api/suggest/route.ts');
  assert.match(route, /HOT_SEARCHES/);
  assert.match(route, /type: 'poi'/);
  assert.match(route, /type: 'position'/);
  assert.match(route, /type: 'tag'/);
  assert.match(route, /slice\(0, 10\)/);
});

test('search flow: keyword + #大厂 returns only bigtech and paginates', () => {
  const first = searchLikeRoute({ mode: 'work', q: '#大厂 前端', page: 1, pageSize: 2 });
  assert.ok(first.total > 0);
  assert.equal(first.pageSize, 2);
  assert.ok(first.results.length <= 2);
  assert.ok(first.results.every((p) => p.kind === 'recruitment' && p.company.scale === 'bigtech'));
  assert.ok(first.results.every((p) => typeof p.distance === 'number'));
  assert.ok(first.aggregations.industries.internet > 0);

  if (first.total > 2) {
    const second = searchLikeRoute({ mode: 'work', q: '#大厂 前端', page: 2, pageSize: 2 });
    assert.equal(second.page, 2);
    const overlap = first.results.some((a) => second.results.some((b) => b.id === a.id));
    assert.equal(overlap, false);
  }
});

test('search flow: industry filter + salary sort stays inside the seed', () => {
  const out = searchLikeRoute({
    mode: 'work',
    q: '',
    filters: { industry: ['ai'] },
    sort: 'salaryDesc',
    page: 1,
    pageSize: 20,
  });
  assert.ok(out.total > 0);
  assert.ok(out.results.every((p) => p.kind === 'recruitment' && p.company.industries.includes('ai')));
  const highs = out.results.map((p) =>
    p.kind === 'recruitment' ? Math.max(...p.positions.map((job) => job.salaryMax || 0)) : 0,
  );
  const sorted = [...highs].sort((a, b) => b - a);
  assert.deepEqual(highs, sorted);
});

test('search flow: domain and unknown modes stay empty on the server', () => {
  const domain = searchLikeRoute({ mode: 'domain', q: '西湖' });
  assert.equal(domain.total, 0);
  assert.deepEqual(domain.results, []);
  const college = searchLikeRoute({ mode: 'college', q: '浙大' });
  assert.equal(college.total, 0);
});

test('filter options for work expose at least five dimensions', () => {
  assert.ok(MODES.work.filters.length >= 5);
  assert.ok(MODES.domain.filters.some((f) => f.key === 'category'));
});
