// Public catalog — 严格 DB-only(2026-08-26):读 Postgres;无 DB / 失败 → 空。
// seed 示例数据已归档 tech/backup/seed-data,不再作为任何回退来源。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadServerCatalog, loadServerCatalogById } from '../src/lib/server-catalog.ts';
import { loadWorkCatalogFromDb } from '../src/lib/recruitment-store.ts';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function src(rel) {
  return readFileSync(join(srcRoot, rel), 'utf8');
}

test('strict DB-only: no DATABASE_URL → work catalog is empty (no seed fallback)', async () => {
  // 测试环境无 DATABASE_URL → getPool() null → loadWorkCatalogFromDb null →
  // loadServerCatalog 返回 [],绝不再回退离线 seed 目录。
  assert.deepEqual(await loadServerCatalog('work'), []);
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
  assert.match(positions.sql, /WHERE status = 'open'[\s\S]*site_id = ANY\(\$1::bigint\[\]\)/);
  assert.deepEqual(positions.params, [['101']]);
});

// 2026-08-25 (fix/server-catalog-semantics): null/[] 契约 — SQL 命中但 JS 侧过滤
// (hasPlausibleCoord / isCityCenterPin)后为空 = DB 健康 + 范围空, 必须返回 []
// (而非 null); null 会被 loadServerCatalog 当作「失败」→ 严格 DB-only 下返回空。
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
  // 无 clip(全量读): 表全被过滤 → null → loadServerCatalog 严格 DB-only 下返回 []。
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
  assert.match(catalog, /\?\? \[\]/);
  // 不再 import/导出示例数据、离线目录或同步 seed catalog(注释里提及 archive 不算)。
  assert.doesNotMatch(catalog, /DOMAIN_SEED|INTERNSHIP_SEED|loadOfflineWorkCatalog|mergeCompaniesIntoPois|export function serverCatalog\b|from '\.\/seed-data/);
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
