// Public catalog: seed when there is no DB; imported work rows when Postgres has them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { INTERNSHIP_SEED } from '../src/lib/seed-data.ts';
import { todayDateString } from '../src/lib/freshness.ts';
import {
  loadOfflineWorkCatalog,
  loadServerCatalog,
  loadServerCatalogById,
  serverCatalog,
  serverCatalogById,
} from '../src/lib/server-catalog.ts';
import { loadWorkCatalogFromDb } from '../src/lib/recruitment-store.ts';

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
  const ali = await loadServerCatalogById('work', 'alibaba-xixi');
  assert.ok(ali?.kind === 'recruitment' && ali.positions.some((p) => p.id.startsWith('radar-')));
  const byte = await loadServerCatalogById('work', 'bytedance-hangzhou');
  assert.ok(byte?.kind === 'recruitment' && byte.positions.some((p) => p.id.startsWith('radar-')));
  const netease = await loadServerCatalogById('work', 'netease-hangzhou');
  assert.ok(netease?.kind === 'recruitment' && netease.positions.some((p) => p.id.startsWith('radar-')));
  const betta = await loadServerCatalogById('work', 'betta-hangzhou');
  assert.ok(betta?.kind === 'recruitment' && betta.positions.some((p) => p.id.startsWith('portal-')));
  // Companies with only example jobs (no radar/portal rows) are not shown.
  assert.equal(await loadServerCatalogById('work', 'tencent-hangzhou'), undefined);
  assert.equal(await loadServerCatalogById('work', 'huawei-hangzhou'), undefined);
  assert.equal(await loadServerCatalogById('work', 'xiaomi-hangzhou'), undefined);
  assert.equal(await loadServerCatalogById('work', 'zhejiang-lab:zhejiang-lab-site'), undefined);
  const lab = await loadServerCatalogById('work', 'zhejiang-lab');
  assert.equal(lab?.positions.filter((p) => p.id === 'zhejiang-lab-ml').length, 0); // example job gone
  const westlake = await loadServerCatalogById('domain', 'hz-westlake');
  assert.equal(westlake?.name, '西湖');
});

test('radar-only companies without coordinates stay off the offline map', async () => {
  const work = await loadServerCatalog('work');
  // 招商银行 / 理想汽车 were geocoded to real Hangzhou offices (2026-08-17) and now pin.
  assert.equal(work.some((p) => p.location?.lng === 0 && p.location?.lat === 0), false);
  assert.ok(await loadServerCatalogById('work', '招商银行'));
  assert.ok(await loadServerCatalogById('work', '理想汽车'));
  // Companies with no resolvable Hangzhou office in AMap POI (海天集团 / 恒瑞医药) stay off.
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

test('offline catalog keeps every position alive (A1: open + deadline future or none)', async () => {
  const work = await loadOfflineWorkCatalog();
  const today = todayDateString();
  for (const poi of work) {
    for (const pos of poi.positions) {
      if (pos.deadline) {
        assert.ok(Date.parse(pos.deadline) >= Date.parse(today), `${poi.id} expired ${pos.deadline}`);
      }
    }
  }
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
