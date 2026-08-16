// Search / filter integration: the same composition the API routes use
// (seed → parse tags → pipeline → page → industry aggregations).
// Does not boot Next; Playwright E2E stays a later item.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSearchQuery } from '../src/lib/search.ts';
import { searchPublicCatalog } from '../src/lib/public-search.ts';
import { serverCatalog, serverCatalogById } from '../src/lib/server-catalog.ts';
import { getMode, MODES } from '../src/lib/modes.ts';
import { trendingForMode } from '../src/lib/trending-search.ts';
import { poiMatchesDistrict } from '../src/lib/spatial-filters.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function src(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

function searchLikeRoute(body) {
  const parsed = parseSearchQuery(body.q || '');
  const filters = { ...parsed.filters, ...(body.filters || {}) };
  return searchPublicCatalog(serverCatalog(body.mode || 'work'), {
    mode: body.mode,
    q: parsed.text || body.q,
    filters,
    sort: body.sort,
    bounds: body.bounds,
    page: body.page,
    pageSize: body.pageSize,
  });
}

test('POST /api/search contract: invalid JSON 400, work seed + cache + pipeline', () => {
  const route = src('app/api/search/route.ts');
  assert.match(route, /status: 400/);
  assert.match(route, /invalid JSON body/);
  assert.match(route, /loadServerCatalog/);
  assert.match(route, /searchPublicCatalog/);
  assert.match(route, /spatialClipFromSearch/);
  assert.match(route, /writePublicCache/);
  assert.doesNotMatch(route, /aggregations: \{ industries \}/);
});

test('GET /api/pois contract: shared server catalog + pipeline', () => {
  const route = src('app/api/pois/route.ts');
  assert.match(route, /loadServerCatalog/);
  assert.match(route, /searchPublicCatalog/);
  assert.match(route, /spatialClipFromSearch/);
  assert.match(route, /parseFilters/);
  assert.ok(serverCatalog('work').length > 0);
  assert.ok(serverCatalog('domain').some((p) => p.id === 'hz-westlake'));
  assert.equal(serverCatalog('college').length, 0);
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
  assert.ok(keys.includes('onlyOpen'));
  assert.ok(keys.includes('education'));
  assert.ok(keys.includes('roleFamily'));
  assert.ok(keys.includes('deadline'));
  assert.equal(getMode('internship').filters, MODES.work.filters);
  assert.ok(MODES.work.sortOptions.some((option) => option.key === 'deadline'));
  assert.ok(MODES.work.sortOptions.length >= 3);
});

test('GET /api/suggest contract: work matches company/job/tag; empty q uses trendingForMode', () => {
  const route = src('app/api/suggest/route.ts');
  assert.match(route, /trendingForMode/);
  assert.match(route, /loadServerCatalog/);
  assert.match(route, /type: 'poi'/);
  assert.match(route, /type: 'position'/);
  assert.match(route, /type: 'tag'/);
  assert.match(route, /suggestSearchTags/);
  assert.match(route, /poiId: poi\.id/);
  assert.match(route, /slice\(0, 10\)/);
  assert.ok(trendingForMode('work').some((item) => item.query === '#大厂'));
  assert.ok(trendingForMode('domain').some((item) => item.query === '西湖'));
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

test('search flow: domain seed matches 西湖; college stays empty', () => {
  const domain = searchLikeRoute({ mode: 'domain', q: '西湖' });
  assert.ok(domain.total > 0);
  assert.ok(domain.results.some((p) => p.id === 'hz-westlake'));
  const college = searchLikeRoute({ mode: 'college', q: '浙大' });
  assert.equal(college.total, 0);
});

test('GET /api/pois/[id] contract: shared catalog, 404 when missing', () => {
  const route = src('app/api/pois/[id]/route.ts');
  assert.match(route, /loadServerCatalogById/);
  assert.match(route, /status: 404/);
  assert.equal(serverCatalogById('domain', 'hz-westlake')?.name, '西湖');
  assert.ok(serverCatalogById('work', 'alibaba-xixi'));
  assert.equal(serverCatalogById('domain', 'no-such'), undefined);
});

test('filter options for work expose at least five dimensions', () => {
  assert.ok(MODES.work.filters.length >= 5);
  assert.ok(MODES.domain.filters.some((f) => f.key === 'category'));
  assert.ok(MODES.domain.filters.some((f) => f.key === 'price'));
  assert.ok(MODES.domain.sortOptions.some((option) => option.key === 'priceAsc'));
  assert.ok(MODES.work.sortOptions.some((option) => option.key === 'relevance'));
});

test('public search clips to a tight Hangzhou west-lake box', () => {
  const out = searchLikeRoute({
    mode: 'work',
    bounds: '120.01,30.26,120.04,30.29',
    pageSize: 50,
  });
  assert.ok(out.total > 0);
  assert.ok(out.total < serverCatalog('work').length);
  assert.ok(out.results.every((p) => p.location.lng >= 120.01 && p.location.lng <= 120.04));
  assert.ok(out.results.some((p) => p.id === 'alibaba-xixi'));
});

test('district filter keeps address hits and falls back to the coarse box', () => {
  const yuhang = searchLikeRoute({ mode: 'work', filters: { district: ['余杭区'] }, pageSize: 50 });
  assert.ok(yuhang.total > 0);
  assert.ok(yuhang.results.every((p) => poiMatchesDistrict(p, ['余杭区'])));
  assert.ok(yuhang.results.some((p) => p.id === 'alibaba-xixi'));

  const unnamed = {
    ...serverCatalogById('work', 'alibaba-xixi'),
    location: { lng: 120.023, lat: 30.279, address: '文一西路969号' },
  };
  assert.equal(poiMatchesDistrict(unnamed, ['余杭区']), true);
  assert.equal(poiMatchesDistrict(unnamed, ['萧山区']), false);
});
