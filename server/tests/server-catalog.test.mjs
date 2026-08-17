// Public catalog: seed when there is no DB; imported work rows when Postgres has them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { INTERNSHIP_SEED } from '../src/lib/seed-data.ts';
import {
  loadServerCatalog,
  loadServerCatalogById,
  serverCatalog,
  serverCatalogById,
} from '../src/lib/server-catalog.ts';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function src(rel) {
  return readFileSync(join(srcRoot, rel), 'utf8');
}

test('sync catalog is still the seed (tests and dry helpers)', () => {
  const work = serverCatalog('work');
  assert.equal(work.length, INTERNSHIP_SEED.length);
  assert.ok(work.every((p) => p.kind === 'recruitment'));
  assert.ok(serverCatalogById('work', 'alibaba-xixi'));
  assert.equal(serverCatalogById('domain', 'hz-westlake')?.name, '西湖');
  assert.equal(serverCatalog('college').length, 0);
});

test('async catalog keeps only authentic positions (radar/portal) when there is no DATABASE_URL', async () => {
  const work = await loadServerCatalog('work');
  assert.ok(work.length > 0);
  // No scaffold example jobs anywhere: every position is radar-* or portal-*.
  for (const poi of work) {
    for (const pos of poi.positions) {
      assert.ok(pos.id.startsWith('radar-') || pos.id.startsWith('portal-'), `${poi.id} has ${pos.id}`);
    }
  }
  // Portal companies with curated coordinates still pin with portal-* jobs.
  const betta = await loadServerCatalogById('work', 'betta-hangzhou');
  assert.ok(betta?.kind === 'recruitment' && betta.positions.some((p) => p.id.startsWith('portal-')));
  const deepseek = await loadServerCatalogById('work', 'deepseek');
  assert.ok(deepseek?.kind === 'recruitment' && deepseek.positions.some((p) => p.id.startsWith('portal-')));
  // Multi-city radar drops carry city text, not coordinates, until geocoded →
  // they stay off the offline map; their authentic radar-* positions only
  // appear after geocode-sites-apply + import.
  assert.equal(await loadServerCatalogById('work', 'alibaba-xixi'), undefined);
  assert.equal(await loadServerCatalogById('work', 'netease-hangzhou'), undefined);
  // Companies with only example jobs (no radar/portal rows) are not shown.
  assert.equal(await loadServerCatalogById('work', 'tencent-hangzhou'), undefined);
  assert.equal(await loadServerCatalogById('work', 'huawei-hangzhou'), undefined);
  assert.equal(await loadServerCatalogById('work', 'xiaomi-hangzhou'), undefined);
  assert.equal(await loadServerCatalogById('work', 'zhejiang-lab:zhejiang-lab-site'), undefined);
  // zhejiang-lab's radar positions live on an ungeocoded multi-city site → off.
  assert.equal(await loadServerCatalogById('work', 'zhejiang-lab'), undefined);
  const westlake = await loadServerCatalogById('domain', 'hz-westlake');
  assert.equal(westlake?.name, '西湖');
});

test('radar-only companies without coordinates stay off the offline map', async () => {
  const work = await loadServerCatalog('work');
  // No (0,0) placeholder pins; only plausible coordinates reach the map.
  assert.equal(work.some((p) => p.location?.lng === 0 && p.location?.lat === 0), false);
  // Curated portal companies with coordinates still pin.
  assert.ok(await loadServerCatalogById('work', 'betta-hangzhou'));
  // Multi-city radar drops carry city text, not coordinates, until geocoded →
  // they stay off the offline map. geocode-sites-apply resolves them per city.
  assert.equal(await loadServerCatalogById('work', '招商银行'), undefined);
  assert.equal(await loadServerCatalogById('work', '理想汽车'), undefined);
  // Companies with no resolvable office in AMap POI stay off.
  assert.equal(await loadServerCatalogById('work', '海天集团'), undefined);
  assert.equal(await loadServerCatalogById('work', '恒瑞医药'), undefined);
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

test('loadServerCatalog prefers imported work rows, then seed + file drops', () => {
  const catalog = src('lib/server-catalog.ts');
  assert.match(catalog, /loadWorkCatalogFromDb/);
  assert.match(catalog, /if \(imported && \(imported\.length > 0 \|\| clip\)\) return imported/);
  assert.match(catalog, /loadOfflineWorkCatalog/);
  assert.match(catalog, /mergeCompaniesIntoPois/);
  assert.match(catalog, /hasPlausibleCoord/);
  assert.match(catalog, /clip\?: SpatialClip/);
  assert.match(catalog, /loadWorkCatalogFromDb\(clip\)/);
  assert.match(catalog, /BOSS_DIR/);
  assert.match(catalog, /NOWCODER_DIR/);
  assert.match(catalog, /SHIXISENG_DIR/);
  assert.match(catalog, /RADAR_DIR/);
});
