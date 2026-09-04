import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadWorkCatalogPageFromDb,
  supportsWorkCatalogPageQuery,
  isValidCalendarDate,
} from '../src/lib/work-catalog-page.ts';

const candidate = {
  company_id: '10', slug: 'acme', name: 'Acme', industries: ['internet'], scale: 'bigtech',
  rating: '4.2', summary: 'Platform company', career_url: 'https://careers.example',
  logo_url: null, logo_emoji: null, tier: 4, category: 'technology',
  site_id: '101', site_name: 'HQ', site_count: '1', address: 'West Rd', city: 'Hangzhou', province: 'Zhejiang',
  city_code: '330100', lng: 120.1, lat: 30.2, site_career_url: null, site_logo_url: null,
};

const position = {
  company_id: '10', site_id: '101', external_id: 'p-1', title: 'Platform engineer',
  department: 'RD', family: 'social', taxonomy: { family: 'social' }, salary_min: 20, salary_max: 30,
  education: '本科', majors: [], skills: ['TypeScript'], description: 'Build the platform',
  deadline: null, apply_source: 'official', apply_url: 'https://apply.example', status: 'open',
  expires_at: null, source_code: 'embodied-jobs',
};

function fakePool() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('/* work-page count */')) return { rows: [{ total: '3' }] };
      if (sql.includes('/* work-page aggregations */')) {
        return { rows: [{ industry: 'internet', count: '3' }] };
      }
      if (sql.includes('/* work-page rows */')) return { rows: [candidate] };
      if (sql.includes('/* work-page positions */')) return { rows: [position] };
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

test('bounded Work page supports literal and alias national queries, rejects semantic fallbacks', () => {
  assert.equal(supportsWorkCatalogPageQuery({ filters: {}, sort: 'rating' }), true);
  assert.equal(supportsWorkCatalogPageQuery({ q: 'platform', filters: {}, sort: 'positionCount' }), true);
  assert.equal(supportsWorkCatalogPageQuery({ q: 'alibaba', filters: {}, sort: 'rating' }), true);
  assert.equal(supportsWorkCatalogPageQuery({ q: 'west lake', filters: {}, sort: 'rating' }), true);
  assert.equal(supportsWorkCatalogPageQuery({ q: '#大厂', filters: {}, sort: 'rating' }), false);
  assert.equal(supportsWorkCatalogPageQuery({ filters: { city: '杭州' }, sort: 'rating' }), false);
  assert.equal(supportsWorkCatalogPageQuery({ filters: {}, sort: 'relevance' }), false);
});

test('bounded Work date filters require a real YYYY-MM-DD calendar date', () => {
  assert.equal(isValidCalendarDate('2024-02-29'), true);
  assert.equal(isValidCalendarDate('2025-02-29'), false);
  assert.equal(isValidCalendarDate('2026-02-31'), false);
  assert.equal(isValidCalendarDate('2026-2-03'), false);
  assert.equal(supportsWorkCatalogPageQuery({ filters: { deadline: '2026-02-31' } }), false);
  assert.equal(supportsWorkCatalogPageQuery({ filters: { deadline: '2026-09-03' } }), true);
});

test('bounded Work binds the validated deadline unchanged', async () => {
  const pool = fakePool();
  await loadWorkCatalogPageFromDb({ filters: { deadline: '2026-09-03' } }, pool);
  const count = pool.calls.find((call) => call.sql.includes('/* work-page count */'));
  assert.ok(count.sql.includes('::date'));
  assert.ok(count.params.includes('2026-09-03'));
});

test('bounded Work page pushes filters, sort, offset/limit, and hydrates only selected sites', async () => {
  const pool = fakePool();
  const page = await loadWorkCatalogPageFromDb({
    filters: { maxTier: 4, industry: ['internet'], scale: ['bigtech'] },
    sort: 'rating', page: 2, pageSize: 2,
  }, pool);

  assert.equal(page.total, 3);
  assert.equal(page.page, 2);
  assert.equal(page.pageSize, 2);
  assert.deepEqual(page.aggregations, { industries: { internet: 3 } });
  assert.deepEqual(page.results.map((poi) => poi.id), ['acme']);
  assert.equal(page.results[0].positions[0].id, 'p-1');
  assert.equal(page.results[0].distance, 9146);

  const count = pool.calls.find((call) => call.sql.includes('/* work-page count */'));
  assert.match(count.sql, /COALESCE\(c\.tier, 12\) <= \$1/);
  assert.match(count.sql, /c\.industries @> \$2::text\[\]/);
  assert.match(count.sql, /c\.scale = ANY\(\$3::text\[\]\)/);
  assert.deepEqual(count.params, [4, ['internet'], ['bigtech']]);

  const rows = pool.calls.find((call) => call.sql.includes('/* work-page rows */'));
  assert.match(rows.sql, /ORDER BY COALESCE\(c\.rating, 0\) DESC, c\.slug ASC, s\.id ASC/);
  assert.match(rows.sql, /OFFSET \$4 LIMIT \$5/);
  assert.deepEqual(rows.params.slice(-2), [2, 2]);

  const positions = pool.calls.find((call) => call.sql.includes('/* work-page positions */'));
  assert.deepEqual(positions.params, [['101'], ['10']]);
  assert.equal(pool.calls.length, 4);
  assert.equal(pool.calls.some((call) => call.sql.includes('FROM company_sites\n')), false);
});

test('bounded Work page preserves slug:site ids when a company has multiple national sites', async () => {
  const pool = fakePool();
  pool.query = async (sql, params) => {
    pool.calls.push({ sql, params });
    if (sql.includes('/* work-page count */')) return { rows: [{ total: '2' }] };
    if (sql.includes('/* work-page aggregations */')) return { rows: [{ industry: 'internet', count: '2' }] };
    if (sql.includes('/* work-page rows */')) return { rows: [{ ...candidate, site_count: '2' }] };
    if (sql.includes('/* work-page positions */')) return { rows: [position] };
    throw new Error(`unexpected SQL: ${sql}`);
  };
  const page = await loadWorkCatalogPageFromDb({ filters: {}, page: 1, pageSize: 1 }, pool);
  assert.deepEqual(page.results.map((poi) => poi.id), ['acme:101']);
});

test('bounded Work page uses slug order for distance sort when center is omitted', async () => {
  const pool = fakePool();
  pool.query = async (sql, params) => {
    pool.calls.push({ sql, params });
    if (sql.includes('/* work-page count */')) return { rows: [{ total: '0' }] };
    if (sql.includes('/* work-page aggregations */')) return { rows: [] };
    if (sql.includes('/* work-page rows */')) return { rows: [] };
    throw new Error(`unexpected SQL: ${sql}`);
  };
  await loadWorkCatalogPageFromDb({ filters: {}, sort: 'distance', page: 3, pageSize: 4 }, pool);
  const rows = pool.calls.find((call) => call.sql.includes('/* work-page rows */'));
  assert.match(rows.sql, /ORDER BY c\.slug ASC, s\.id ASC/);
  assert.doesNotMatch(rows.sql, /ST_DistanceSphere/);
  assert.match(rows.sql, /OFFSET \$1 LIMIT \$2/);
  assert.deepEqual(rows.params, [8, 4]);
});

test('bounded Work page numbers explicit sort-center parameters before offset and limit', async () => {
  const pool = fakePool();
  pool.query = async (sql, params) => {
    pool.calls.push({ sql, params });
    if (sql.includes('/* work-page count */')) return { rows: [{ total: '0' }] };
    if (sql.includes('/* work-page aggregations */')) return { rows: [] };
    if (sql.includes('/* work-page rows */')) return { rows: [] };
    throw new Error(`unexpected SQL: ${sql}`);
  };
  await loadWorkCatalogPageFromDb({
    filters: {},
    sort: 'distance',
    page: 3,
    pageSize: 4,
    center: { lng: 116.4, lat: 39.9 },
  }, pool);
  const rows = pool.calls.find((call) => call.sql.includes('/* work-page rows */'));
  assert.match(rows.sql, /ST_DistanceSphere\(s\.geom, ST_SetSRID\(ST_MakePoint\(\$1, \$2\), 4326\)\)/);
  assert.match(rows.sql, /OFFSET \$3 LIMIT \$4/);
  assert.deepEqual(rows.params, [116.4, 39.9, 8, 4]);
});

test('bounded Work page applies the public source and freshness gate to eligibility, sort, and hydration', async () => {
  const pool = fakePool();
  await loadWorkCatalogPageFromDb({ q: 'platform', filters: {}, sort: 'positionCount' }, pool);

  const count = pool.calls.find((call) => call.sql.includes('/* work-page count */'));
  const aggregates = pool.calls.find((call) => call.sql.includes('/* work-page aggregations */'));
  const rows = pool.calls.find((call) => call.sql.includes('/* work-page rows */'));
  const positions = pool.calls.find((call) => call.sql.includes('/* work-page positions */'));
  for (const call of [count, aggregates, rows, positions]) {
    assert.ok(call, 'every bounded phase should issue a query');
    // A missing source_id cannot pass the inner source-registry join; seed and
    // none-policy rows cannot pass the registry allow-list; official-career
    // rows must also carry the portal-* identity.
    assert.match(call.sql, /JOIN sources/);
    assert.match(call.sql, /code IN \('feishu-ats', 'xiaozhao-radar', 'radar', 'qqdoc-jobs', 'embodied-jobs'\)/);
    assert.match(call.sql, /official-career.*external_id LIKE 'portal-%'/);
    assert.match(call.sql, /expires_at IS NULL OR [a-z]+\.expires_at >= CURRENT_TIMESTAMP/);
  }
  assert.doesNotMatch(count.sql, /code = 'seed'/);
  assert.doesNotMatch(count.sql, /code = 'qqdoc-official'/);
  assert.match(positions.sql, /position_source\.code AS source_code/);
});


test('bounded Work page keeps multi-word aliases as one phrase group', async () => {
  const pool = fakePool();
  pool.query = async (sql, params) => {
    pool.calls.push({ sql, params });
    if (sql.includes('/* work-page count */')) return { rows: [{ total: '0' }] };
    if (sql.includes('/* work-page aggregations */')) return { rows: [] };
    if (sql.includes('/* work-page rows */')) return { rows: [] };
    throw new Error(`unexpected SQL: ${sql}`);
  };
  await loadWorkCatalogPageFromDb({ q: 'west lake', filters: {}, sort: 'rating' }, pool);
  const count = pool.calls.find((call) => call.sql.includes('/* work-page count */'));
  assert.ok(count.params.includes('%西湖%'));
  assert.ok(count.params.includes('%west lake%'));
  assert.ok(count.params.includes('%westlake%'));
});

test('bounded Work page binds literal q with LIKE escaping and preserves empty page total', async () => {
  const pool = fakePool();
  pool.query = async (sql, params) => {
    pool.calls.push({ sql, params });
    if (sql.includes('/* work-page count */')) return { rows: [{ total: '9' }] };
    if (sql.includes('/* work-page aggregations */')) return { rows: [] };
    if (sql.includes('/* work-page rows */')) return { rows: [] };
    throw new Error(`unexpected SQL: ${sql}`);
  };
  const page = await loadWorkCatalogPageFromDb({ q: '100%_platform', filters: {}, page: 5, pageSize: 10 }, pool);
  assert.equal(page.total, 9);
  assert.deepEqual(page.results, []);
  const count = pool.calls.find((call) => call.sql.includes('/* work-page count */'));
  assert.match(count.sql, /ESCAPE E'\\\\'/);
  assert.ok(count.params.some((value) => value === '%100\\%\\_platform%'));
  assert.ok(count.sql.includes('ILIKE'));
  assert.equal(pool.calls.length, 3);
});
