// Public catalog — 严格 DB-only(2026-08-26):读 Postgres;无 DB / 失败 → null(路由 502)。
// seed 示例数据已归档 tech/backup/seed-data,不再作为任何回退来源。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadServerCatalog, loadServerCatalogById } from '../src/lib/server-catalog.ts';
import {
  countWorkTagMatchesFromDb,
  loadWorkCatalogByIdFromDb,
  loadWorkCatalogFromDb,
  loadWorkSuggestionsFromDb,
} from '../src/lib/recruitment-store.ts';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function src(rel) {
  return readFileSync(join(srcRoot, rel), 'utf8');
}

test('strict DB-only: no DATABASE_URL → work catalog is null (no seed fallback)', async () => {
  // 测试环境无 DATABASE_URL → getPool() null → loadWorkCatalogFromDb null。
  // 路由层把 null 变成 502(不缓存);本函数不再把故障折叠成 []。
  assert.equal(await loadServerCatalog('work'), null);
  assert.equal(await loadServerCatalog('internship'), null);
  assert.deepEqual(await loadServerCatalog('domain'), []);
  assert.equal(await loadServerCatalogById('work', 'alibaba-xixi'), undefined);
  assert.equal(await loadServerCatalogById('domain', 'hz-westlake'), undefined);
  assert.deepEqual(await loadServerCatalog('college'), []);
});

test('loadWorkCatalogFromDb joins companies + sites + open positions', () => {
  const store = src('lib/recruitment-store.ts');
  assert.match(store, /FROM companies ORDER BY slug/);
  assert.match(store, /FROM company_sites/);
  assert.match(store, /FROM positions WHERE status = 'open'/);
  assert.match(store, /companySites\.length === 1 \? company\.slug : `\$\{company\.slug\}:\$\{site\.id\}`/);
  assert.match(store, /companySitesSpatialSql/);
  assert.match(store, /s\.geom IS NOT NULL/);
  assert.match(store, /site_id = ANY\(\$1::bigint\[\]\)/);
  assert.match(store, /id = ANY\(\$1::bigint\[\]\)/);
});

test('loadWorkCatalogFromDb normalizes joined rows and drops ungeocoded or empty sites', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('FROM company_sites')) {
        return {
          rows: [
            {
              id: '101', company_id: '10', name: 'Western', address: 'Western Rd', city: '杭州市',
              province: '浙江省', city_code: '330100', lng: 120.1, lat: 30.2,
              career_url: 'https://careers.example/site', logo_url: null,
            },
            {
              id: '102', company_id: '10', name: 'Eastern', address: 'Eastern Rd', city: '杭州市',
              province: '浙江省', city_code: '330100', lng: 120.2, lat: 30.25,
              career_url: null, logo_url: null,
            },
            {
              id: '103', company_id: '10', name: 'Bad pin', address: 'Unknown', city: '杭州市',
              province: '浙江省', city_code: '330100', lng: 0, lat: 0,
              career_url: null, logo_url: null,
            },
            {
              id: '201', company_id: '20', name: 'Brand HQ', address: 'Brand Rd', city: '杭州市',
              province: '浙江省', city_code: '330100', lng: 120.15, lat: 30.22,
              career_url: null, logo_url: null,
            },
          ],
        };
      }
      if (sql.includes('FROM companies')) {
        return {
          rows: [
            {
              id: '10', slug: 'acme-hz', name: 'Acme', industries: ['internet'], scale: null,
              tier: '3', category: 'technology', rating: '4.2', summary: 'A company',
              career_url: 'https://careers.example', logo_url: null, logo_emoji: null,
            },
            {
              id: '20', slug: 'brand-hz', name: 'Brand', industries: ['finance'], scale: 'bank',
              tier: 2, category: 'enterprise', rating: 4.5, summary: null,
              career_url: null, logo_url: 'https://cdn.example/logo.png', logo_emoji: 'B',
            },
          ],
        };
      }
      if (sql.includes('FROM positions')) {
        return {
          rows: [
            {
              company_id: '10', site_id: '101', external_id: 'portal-1', title: 'Backend',
              department: 'RD', family: 'campus', taxonomy: { family: 'campus', aggregate: false },
              salary_min: '100', salary_max: '200', education: '本科', majors: ['CS'], skills: ['Go'],
              description: 'JD one', deadline: new Date('2026-12-31T00:00:00'),
              apply_source: 'official', apply_url: 'https://apply.example/1', status: 'open',
            },
            {
              company_id: '10', site_id: '102', external_id: 'portal-2', title: 'Frontend',
              department: 'Web', family: 'campus', taxonomy: { family: 'campus' },
              salary_min: 300, salary_max: 400, education: '本科', majors: [], skills: [],
              description: 'JD two', deadline: '2026-11-15T00:00:00.000Z',
              apply_source: null, apply_url: null, status: 'open',
            },
            {
              company_id: '20', site_id: '201', external_id: 'portal-3', title: 'Analyst',
              department: null, family: 'social', taxonomy: null,
              salary_min: null, salary_max: null, education: null, majors: null, skills: null,
              description: null, deadline: null, apply_source: null, apply_url: null, status: 'open',
            },
          ],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };

  const pois = await loadWorkCatalogFromDb(undefined, pool);
  assert.equal(pois?.length, 3);
  const byId = new Map(pois.map((poi) => [poi.id, poi]));
  assert.ok(byId.has('acme-hz:101'));
  assert.ok(byId.has('acme-hz:102'));
  assert.ok(byId.has('brand-hz'));
  assert.equal(byId.get('acme-hz:101').company.logo, '🏢');
  assert.match(byId.get('acme-hz:101').company.logoUrl, /^https:\/\//);
  assert.equal(byId.get('brand-hz').company.logo, 'B');
  assert.equal(byId.get('brand-hz').company.logoUrl, 'https://cdn.example/logo.png');

  const west = byId.get('acme-hz:101');
  assert.equal(west.kind, 'recruitment');
  assert.deepEqual(west.location, { lng: 120.1, lat: 30.2, address: 'Western Rd' });
  assert.equal(west.company.scale, 'startup');
  assert.equal(west.company.tier, 3);
  assert.equal(west.company.rating, 4.2);
  assert.equal(west.company.careerUrl, 'https://careers.example/site');
  assert.deepEqual(west.sites[0].city, '杭州市');
  assert.equal(west.positions.length, 1);
  assert.deepEqual(west.positions[0].salary, { min: 100, max: 200 });
  assert.equal(west.positions[0].deadline, '2026-12-31');
  assert.equal(west.positions[0].apply.source, 'official');
  assert.equal(west.positions[0].apply.url, 'https://apply.example/1');
  assert.equal(west.positions[0].aggregate, undefined);

  const east = byId.get('acme-hz:102');
  assert.equal(east.positions[0].deadline, '2026-11-15');
  assert.equal(east.positions[0].salary.min, 300);

  const brand = byId.get('brand-hz');
  assert.equal(brand.positions[0].salary, undefined);
  assert.equal(brand.positions[0].apply, undefined);
  assert.equal(brand.positions[0].deadline, undefined);
  assert.deepEqual(brand.positions[0].taxonomy, { family: 'social' });
  assert.equal(queries.length, 3);
  assert.ok(queries.every((call) => !call.sql.includes(' WHERE s.geom IS NOT NULL')));
});

// 2026-08-26 (fix/aggregate-site-fanout): DB 读路径把 aggregate 行(taxonomy jsonb)
// fan-out 到公司每个站点; site_id 恰等于本站时不双计; 不跨公司泄漏。
test('loadWorkCatalogFromDb fans aggregate rows out to every site of the company', async () => {
  const pool = {
    async query(sql) {
      if (sql.includes('FROM company_sites')) {
        return {
          rows: [
            {
              id: '101', company_id: '10', name: 'Western', address: 'Western Rd', city: '杭州市',
              province: '浙江省', city_code: '330100', lng: 120.1, lat: 30.2,
              career_url: null, logo_url: null,
            },
            {
              id: '102', company_id: '10', name: 'Eastern', address: 'Eastern Rd', city: '杭州市',
              province: '浙江省', city_code: '330100', lng: 120.2, lat: 30.25,
              career_url: null, logo_url: null,
            },
            {
              id: '201', company_id: '20', name: 'Brand HQ', address: 'Brand Rd', city: '杭州市',
              province: '浙江省', city_code: '330100', lng: 120.15, lat: 30.22,
              career_url: null, logo_url: null,
            },
          ],
        };
      }
      if (sql.includes('FROM companies')) {
        return {
          rows: [
            {
              id: '10', slug: 'acme-hz', name: 'Acme', industries: ['internet'], scale: null,
              tier: null, category: null, rating: null, summary: null,
              career_url: null, logo_url: null, logo_emoji: null,
            },
            {
              id: '20', slug: 'brand-hz', name: 'Brand', industries: ['finance'], scale: 'bank',
              tier: 2, category: 'enterprise', rating: 4.5, summary: null,
              career_url: null, logo_url: null, logo_emoji: 'B',
            },
          ],
        };
      }
      if (sql.includes('FROM positions')) {
        return {
          rows: [
            {
              company_id: '10', site_id: '101', external_id: 'portal-1', title: 'Backend',
              department: 'RD', family: 'campus', taxonomy: { family: 'campus' },
              salary_min: null, salary_max: null, education: null, majors: [], skills: [],
              description: null, deadline: null, apply_source: null, apply_url: null,
              status: 'open',
            },
            {
              // 聚合行: crawler 占位 site_id 恰为本站 → 不得双计
              company_id: '10', site_id: '101', external_id: 'radar-agg-1', title: '技术类 产品类',
              department: 'RD', family: 'intern', taxonomy: { family: 'intern', aggregate: true },
              salary_min: null, salary_max: null, education: null, majors: [], skills: [],
              description: null, deadline: null, apply_source: null, apply_url: null,
              status: 'open',
            },
            {
              company_id: '10', site_id: '102', external_id: 'portal-2', title: 'Frontend',
              department: 'Web', family: 'campus', taxonomy: { family: 'campus' },
              salary_min: null, salary_max: null, education: null, majors: [], skills: [],
              description: null, deadline: null, apply_source: null, apply_url: null,
              status: 'open',
            },
            {
              // 另一家公司的聚合行: 不得 fan-out 到 Acme
              company_id: '20', site_id: '201', external_id: 'radar-agg-brand', title: '分析类',
              department: null, family: 'campus', taxonomy: { family: 'campus', aggregate: true },
              salary_min: null, salary_max: null, education: null, majors: [], skills: [],
              description: null, deadline: null, apply_source: null, apply_url: null,
              status: 'open',
            },
          ],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };

  const pois = await loadWorkCatalogFromDb(undefined, pool);
  const byId = new Map(pois.map((poi) => [poi.id, poi]));

  const west = byId.get('acme-hz:101');
  assert.deepEqual(west.positions.map((p) => p.id), ['portal-1', 'radar-agg-1']);
  assert.equal(west.positions.filter((p) => p.id === 'radar-agg-1').length, 1, '占位 site_id 命中本站不双计');
  assert.equal(west.positions[1].aggregate, true);

  const east = byId.get('acme-hz:102');
  assert.deepEqual(east.positions.map((p) => p.id), ['portal-2', 'radar-agg-1']);
  assert.equal(east.positions[1].aggregate, true);
  assert.equal(east.positions.filter((p) => p.id === 'radar-agg-1').length, 1);

  const brand = byId.get('brand-hz');
  assert.deepEqual(brand.positions.map((p) => p.id), ['radar-agg-brand'], '聚合行按公司隔离, 不跨公司 fan-out');
});

// 2026-08-27 (fix/agg-fanout-clipped): 城市裁剪查询也必须加载公司级聚合行。
// 聚合岗的 site_id 是首城占位(如北京), 只按 site_id = ANY(located) 加载会把它们
// 挡在 aggregateRows 之外 → 扇出失效 → 单城市视野下多城公司整条不出现
// (实测重庆视野 2 POI → 修复后 6)。
test('loadWorkCatalogFromDb fans company-level aggregate rows on a clipped city view', async () => {
  const pool = {
    async query(sql, params) {
      if (sql.includes('FROM company_sites s')) {
        // 城市裁剪: 只返回重庆站点(北京占位站不在本视野)
        return {
          rows: [
            {
              id: '3050', company_id: '10', name: 'Acme 重庆', address: '重庆市江津区枫林大道1号',
              city: '重庆市', province: '重庆市', city_code: '500100', lng: 106.31, lat: 29.4,
              career_url: null, logo_url: null,
            },
          ],
        };
      }
      if (sql.includes('FROM companies')) {
        return {
          rows: [
            {
              id: '10', slug: 'acme', name: 'Acme', industries: ['internet'], scale: 'enterprise',
              tier: 7, category: '64', rating: null, summary: null,
              career_url: null, logo_url: null, logo_emoji: null,
            },
          ],
        };
      }
      if (sql.includes('FROM positions')) {
        const [siteIds, companyIds] = params;
        // 新 SQL: site_id = ANY($1) OR (aggregate AND company_id = ANY($2))
        // —— 聚合行挂在北京占位站(930), 不在本视野 siteIds, 但 company_id 命中必须返回。
        assert.deepEqual(siteIds, ['3050'], '裁剪 siteIds 只含视野内站点');
        assert.deepEqual(companyIds, ['10'], '裁剪 companyIds 传公司 id');
        return {
          rows: [
            {
              // 重庆站的具体岗(在 siteIds 内)
              company_id: '10', site_id: '3050', external_id: 'portal-cq', title: '后端工程师',
              department: null, family: 'campus', taxonomy: { family: 'campus' },
              salary_min: null, salary_max: null, education: null, majors: [], skills: [],
              description: null, deadline: null, apply_source: null, apply_url: null,
              status: 'open',
            },
            {
              // 聚合岗: 首城占位站 930(北京), 不在 siteIds → 必须靠 company_id 分支返回
              company_id: '10', site_id: '930', external_id: 'radar-agg', title: '技术类 产品类',
              department: null, family: 'intern', taxonomy: { family: 'intern', aggregate: true },
              salary_min: null, salary_max: null, education: null, majors: [], skills: [],
              description: null, deadline: null, apply_source: null, apply_url: null,
              status: 'open',
            },
          ],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };

  const pois = await loadWorkCatalogFromDb({ city: '重庆市', maxTier: 21 }, pool);
  assert.equal(pois?.length, 1);
  const cq = pois[0];
  // 公司仅一个站点在本视野 → id = slug(与多站视野的 slug:site.id 区分)
  assert.equal(cq.id, 'acme');
  assert.deepEqual(
    cq.positions.map((p) => p.id),
    ['portal-cq', 'radar-agg'],
    '城市裁剪视野下聚合岗仍须扇出到本城站点',
  );
  assert.equal(cq.positions[1].aggregate, true);
});

test('loadWorkCatalogFromDb applies spatial clips and returns empty when no clipped sites', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [] };
    },
  };

  const result = await loadWorkCatalogFromDb(
    { bounds: { west: 120.0, south: 30.2, east: 120.2, north: 30.3 } },
    pool,
  );
  assert.deepEqual(result, []);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /FROM company_sites s/);
  assert.match(queries[0].sql, /s\.geom IS NOT NULL/);
  assert.match(queries[0].sql, /ST_MakeEnvelope\(\$1, \$2, \$3, \$4, 4326\)/);
  assert.deepEqual(queries[0].params, [120.0, 30.2, 120.2, 30.3, '%浙江%', '%杭州%']);
});

test('loadWorkCatalogFromDb passes clipped ids and maxTier through to company/position queries', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('FROM company_sites')) {
        return {
          rows: [
            {
              id: '101', company_id: '10', name: 'Acme HQ', address: 'West Rd', city: '杭州市',
              province: '浙江省', city_code: '330100', lng: 120.1, lat: 30.2,
              career_url: null, logo_url: null,
            },
          ],
        };
      }
      if (sql.includes('FROM companies')) {
        return {
          rows: [
            {
              id: '10', slug: 'acme-hz', name: 'Acme', industries: ['internet'], scale: 'startup',
              tier: 1, category: 'technology', rating: null, summary: null,
              career_url: null, logo_url: null, logo_emoji: null,
            },
          ],
        };
      }
      if (sql.includes('FROM positions')) {
        return {
          rows: [
            {
              company_id: '10', site_id: '101', external_id: 'radar-1', title: 'Role',
              department: null, family: 'campus', taxonomy: { family: 'campus' },
              salary_min: null, salary_max: null, education: null, majors: [], skills: [],
              description: null, deadline: null, apply_source: null, apply_url: null,
              status: 'open',
            },
          ],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };

  const result = await loadWorkCatalogFromDb(
    { bounds: { west: 120.0, south: 30.2, east: 120.2, north: 30.3 }, maxTier: 1 },
    pool,
  );
  assert.equal(result?.length, 1);
  assert.equal(result[0].id, 'acme-hz');
  assert.equal(result[0].company.tier, 1);

  const companies = queries.find((call) => call.sql.includes('FROM companies'));
  assert.match(companies.sql, /WHERE id = ANY\(\$1::bigint\[\]\) AND tier <= \$2/);
  assert.deepEqual(companies.params, [['10'], 1]);

  const positions = queries.find((call) => call.sql.includes('FROM positions'));
  assert.match(
    positions.sql,
    /WHERE status = 'open'[\s\S]*\(site_id = ANY\(\$1::bigint\[\]\)\s+OR \(taxonomy->>'aggregate' = 'true' AND company_id = ANY\(\$2::bigint\[\]\)\)\)/,
    '裁剪查询按 site_id 加载视野站岗位, 并按 company_id 补加载公司级聚合行',
  );
  assert.deepEqual(positions.params, [['101'], ['10']]);
});

// 2026-08-25 (fix/server-catalog-semantics): null/[] 契约 — SQL 命中但 JS 侧过滤
// (hasPlausibleCoord / isCityCenterPin)后为空 = DB 健康 + 范围空, 必须返回 []
// (而非 null); null 由路由层变成 502,不得再折叠成 200 空目录。
test('loadWorkCatalogFromDb returns [] when clipped rows are all filtered out (clip-miss stays empty)', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('FROM company_sites')) {
        return {
          rows: [
            {
              id: '301', company_id: '30', name: 'Downtown fake', address: 'City Center', city: '杭州市',
              province: '浙江省', city_code: '330100', lng: 120.15, lat: 30.27, // 杭州行政中心 = 城市中心钉
              career_url: null, logo_url: null,
            },
            {
              id: '302', company_id: '30', name: 'Origin fake', address: null, city: '杭州市',
              province: '浙江省', city_code: '330100', lng: 0, lat: 0, // (0,0) 无合理坐标
              career_url: null, logo_url: null,
            },
          ],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };

  const result = await loadWorkCatalogFromDb(
    { bounds: { west: 120.0, south: 30.2, east: 120.2, north: 30.3 } },
    pool,
  );
  assert.deepEqual(result, []);
  assert.equal(queries.length, 1); // 过滤后为空 → 提前返回, 不再查 companies/positions
});

test('loadWorkCatalogFromDb returns null when an unclipped table has no located rows (empty signal)', async () => {
  const pool = {
    async query(sql) {
      if (sql.includes('FROM company_sites')) {
        return {
          rows: [
            {
              id: '401', company_id: '40', name: 'No coord', address: null, city: '杭州市',
              province: '浙江省', city_code: '330100', lng: 0, lat: 0,
              career_url: null, logo_url: null,
            },
          ],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  // 无 clip(全量读): 表全被过滤 → null(失败/无有效站);路由不得把它缓存成 200 空目录。
  assert.equal(await loadWorkCatalogFromDb(undefined, pool), null);
});

test('loadWorkCatalogFromDb returns null when the DB read fails', async () => {
  const pool = {
    async query() {
      throw new Error('connection refused');
    },
  };
  assert.equal(await loadWorkCatalogFromDb(undefined, pool), null);
});

test('loadServerCatalog is strict DB-only (no seed / offline fallback in source)', () => {
  const catalog = src('lib/server-catalog.ts');
  assert.match(catalog, /loadWorkCatalogFromDb/);
  assert.match(catalog, /loadWorkCatalogFromDb\(clip\)/);
  assert.doesNotMatch(catalog, /\?\? \[\]/);
  // 不再 import/导出示例数据、离线目录或同步 seed catalog(注释里提及 archive 不算)。
  assert.doesNotMatch(catalog, /DOMAIN_SEED|INTERNSHIP_SEED|loadOfflineWorkCatalog|mergeCompaniesIntoPois|export function serverCatalog\b|from '\.\/seed-data/);
});

test('loadWorkCatalogByIdFromDb targets one company/site without full catalog loading', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('FROM companies c')) {
        return {
          rows: [{
            id: '10', slug: 'acme', name: 'Acme', industries: ['internet'], scale: 'startup',
            tier: 3, category: '64', rating: null, summary: 'Target',
            career_url: null, logo_url: null, logo_emoji: 'A',
          }],
        };
      }
      if (sql.includes('FROM company_sites s')) {
        return {
          rows: [
            {
              id: '101', company_id: '10', name: 'Hangzhou', address: 'West Rd', city: '杭州市',
              province: '浙江省', city_code: '330100', lng: 120.1, lat: 30.2,
              career_url: null, logo_url: null,
            },
            {
              id: '102', company_id: '10', name: 'Beijing', address: 'North Rd', city: '北京市',
              province: '北京市', city_code: '110000', lng: 116.41, lat: 39.91,
              career_url: null, logo_url: null,
            },
          ],
        };
      }
      if (sql.includes('FROM positions p')) {
        return {
          rows: [{
            company_id: '10', site_id: '102', external_id: 'portal-target', title: 'Target role',
            department: 'RD', family: 'social', taxonomy: { family: 'social' },
            salary_min: null, salary_max: null, education: '本科', majors: [], skills: [],
            description: 'JD', deadline: null, apply_source: 'official', apply_url: 'https://apply.example',
            status: 'open',
          }],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };

  const poi = await loadWorkCatalogByIdFromDb('acme:102', pool);
  assert.equal(poi?.id, 'acme:102');
  assert.equal(poi?.company.name, 'Acme');
  assert.equal(poi?.positions[0].id, 'portal-target');
  assert.equal(queries.length, 3);
  assert.ok(queries[0].sql.includes('WHERE c.slug = $1'));
  assert.deepEqual(queries[0].params, ['acme']);
  assert.ok(queries[1].sql.includes('WHERE s.company_id = $1::bigint'));
  assert.ok(queries[2].sql.includes('p.site_id = ANY($1::bigint[])'));
  assert.ok(queries.every(({ sql }) => !sql.includes('FROM companies ORDER BY slug')));
});

test('loadWorkCatalogByIdFromDb preserves 404 semantics for unknown/malformed ids', async () => {
  let calls = 0;
  const pool = {
    async query() {
      calls += 1;
      return { rows: [] };
    },
  };
  assert.equal(await loadWorkCatalogByIdFromDb('bad:site', pool), undefined);
  assert.equal(calls, 0, 'malformed site ids are rejected before SQL');
  assert.equal(await loadWorkCatalogByIdFromDb('missing', pool), undefined);
  assert.equal(calls, 1, 'unknown slug uses one targeted company query');
});

test('loadWorkSuggestionsFromDb returns capped SQL matches without loading the catalog', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("'company'::text")) {
        return {
          rows: [{
            kind: 'company', slug: 'acme', company_name: 'Acme', industries: ['internet'],
            summary: 'Target', logo_emoji: 'A', site_id: '101', site_count: '1', lng: 120.1, lat: 30.2,
          }],
        };
      }
      if (sql.includes("'job'::text")) {
        return {
          rows: [{
            kind: 'job', slug: 'other', company_name: 'Other', industries: [], summary: null,
            logo_emoji: null, site_id: '201', site_count: '1', lng: 120.2, lat: 30.25,
            position_id: 'portal-job', position_title: 'Frontend Engineer', department: 'RD', education: '本科',
          }],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };

  const rows = await loadWorkSuggestionsFromDb('frontend', 99, pool);
  assert.equal(rows?.length, 2);
  assert.deepEqual(rows?.map((row) => row.kind), ['company', 'job']);
  assert.ok(queries.every(({ sql }) => sql.includes('LIMIT $')), 'each suggestion family is capped in SQL');
  assert.ok(queries.some(({ sql }) => sql.includes('ILIKE')));
  assert.ok(queries.every(({ params }) => params.at(-1) === 10));
  assert.ok(queries.every(({ sql }) => !sql.includes('FROM companies ORDER BY slug')));
});

test('countWorkTagMatchesFromDb uses an aggregate SQL count, not catalog materialization', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ count: '4' }] };
    },
  };
  assert.equal(await countWorkTagMatchesFromDb({ key: 'scale', value: 'bigtech' }, pool), 4);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /count\(DISTINCT s\.id\)/);
  assert.deepEqual(calls[0].params, ['bigtech']);
});

test('countWorkTagMatchesFromDb preserves legacy JS semantics for DB-unsupported tags', async () => {
  let called = false;
  const pool = {
    async query() {
      called = true;
      return { rows: [{ count: '99' }] };
    },
  };
  // benefits 未持久化 → 与旧 countPoisMatchingTag 对 DB catalog 一致：恒 0，不发 SQL。
  assert.equal(await countWorkTagMatchesFromDb({ key: 'providesHousing', value: 'true' }, pool), 0);
  assert.equal(await countWorkTagMatchesFromDb({ key: 'providesShuttle', value: 'true' }, pool), 0);
  assert.equal(called, false);

  const calls = [];
  const countingPool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ count: '3' }] };
    },
  };
  // jobTaxonomy intern 细类：internKind 或 conversion 双路径（对齐 positionMatchesTaxonomy）。
  assert.equal(await countWorkTagMatchesFromDb({ key: 'jobTaxonomy', value: 'intern/summer' }, countingPool), 3);
  assert.match(calls.at(-1).sql, /p\.taxonomy->>'internKind' = \$2 OR p\.taxonomy->>'conversion' = \$2/);
  assert.deepEqual(calls.at(-1).params, ['intern', 'summer']);
  // roleFamily：关键词集下推 SQL（含 skills），不发全量加载。
  assert.equal(await countWorkTagMatchesFromDb({ key: 'roleFamily', value: 'tech' }, countingPool), 3);
  assert.match(calls.at(-1).sql, /array_to_string\(p\.skills, ' '\)/);
  assert.deepEqual(calls.at(-1).params, ['前端|后端|算法|开发|工程|Java|Android|iOS|SLAM|NLP|Infra|芯片|嵌入式|SRE|测试|数据', '运营', '产品经理']);
});

test('loadWorkCatalogFromDb filters by city / maxTier / alive when DATABASE_URL is set', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL is not set');
    return;
  }
  const full = await loadWorkCatalogFromDb();
  if (!full) {
    t.skip('Postgres pool unavailable');
    return;
  }
  // maxTier=3 等价于不过滤（tier 缺省 3）。
  assert.deepEqual(await loadWorkCatalogFromDb({ maxTier: 3 }), full);
  // maxTier=1 → 所有返回公司 tier <= 1（当前全部缺省 3，应为空数组）。
  const top = await loadWorkCatalogFromDb({ maxTier: 1 });
  assert.ok(Array.isArray(top));
  assert.ok(top.every((p) => (p.company.tier ?? 3) <= 1));
  // city 过滤不炸库：返回数组，且每条 pin 都带 site 城市字段（可能是 undefined）。
  const city = await loadWorkCatalogFromDb({ city: '杭州' });
  assert.ok(Array.isArray(city));
  for (const poi of city) {
    for (const site of poi.sites ?? []) {
      assert.ok('city' in site && 'province' in site && 'cityCode' in site);
    }
  }
  // alive 显式旗标：positions 全部 open（DB 读路径本来就恒开）。
  const alive = await loadWorkCatalogFromDb({ alive: true });
  assert.ok(Array.isArray(alive));
  assert.ok(alive.every((p) => p.positions.every((pos) => pos.status === 'open')));
});

test('loadServerCatalog keeps clip-miss empty instead of falling back to offline (DB healthy)', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL is not set');
    return;
  }
  const probe = await loadWorkCatalogFromDb();
  if (probe === null) {
    t.skip('Postgres pool unavailable');
    return;
  }
  // 东海无公司 → SQL 裁剪未命中; DB 健康时契约 = [] 空结果, 绝不回退离线目录。
  const empty = await loadServerCatalog('work', {
    bounds: { west: 122.5, south: 30.0, east: 123.5, north: 31.0 },
  });
  assert.deepEqual(empty, []);
});
