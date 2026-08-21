// Drops 坐标一致性契约 (2026-08-20, w1 sweep 防回归)。
//
// 背景: fecef85 事故 (2026-08-19) 把 7d19271 的杭州 office 坐标复制到所有
// 城市 site (快手 site-beijing/shanghai/guangzhou/shenzhen 全部 = 杭州坐标),
// 前端 cityLabelMatchesCoordinates (src/lib/city-cluster.ts:86) 把「上海标签
// + 杭州坐标」的串味行从聚合徽章剔除 → 徽章计数错误 (数据脏, 防御逻辑对)。
// fix-sweep-accident-coords.mjs 已清扫 drops; 本测试防止未来再被污染。
//
// 与 src/lib/spatial-query.ts 同源 (bareCityName / CITY_REFERENCE_BOXES /
// cityLabelMatchesCoordinates), 数据语义与前端防御一致:
//   1. 任何非杭州 city 站点坐标不得落在杭州参考框内 (清扫规则本身;
//      豁免: 坐标精确等于 cityCenter(city) 的静态行政中心 —— 金华中心
//      119.65/29.08 地理上在杭州框内, 但不是事故坐标, 见 2026-08-21
//      city-split 补点);
//   2. 全量站点 city↔坐标必须通过 cityLabelMatchesCoordinates
//      (聚合徽章防御同源函数, 覆盖全部已知参考框);
//   3. 杭州站点真坐标存在性抽查 (快手 / 蚂蚁集团等);
//   4. 清扫不得制造半边坐标 (lng 或 lat 单边为 null)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bareCityName,
  CITY_REFERENCE_BOXES,
  cityLabelMatchesCoordinates,
} from '../src/lib/spatial-query.ts';
import { cityCenter } from '../src/lib/city-centers.ts';

const dataRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'recruitment');
const DROP_DIRS = ['radar', 'official-career'];

/** 载入全部 drops: [{ dir, file, data }]. */
function loadDrops() {
  const drops = [];
  for (const dir of DROP_DIRS) {
    for (const file of readdirSync(join(dataRoot, dir))) {
      if (!file.endsWith('.json')) continue;
      const data = JSON.parse(readFileSync(join(dataRoot, dir, file), 'utf8'));
      drops.push({ dir, file, data });
    }
  }
  return drops;
}

/** 遍历站点, 只保留带 city 且坐标齐全 (number) 的站点. */
function coordSites() {
  const rows = [];
  for (const { dir, file, data } of loadDrops()) {
    for (const site of data.sites ?? []) {
      const city = site?.city?.trim();
      if (!city) continue;
      const { lng, lat } = site.location ?? {};
      if (typeof lng !== 'number' || typeof lat !== 'number') continue;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      rows.push({ dir, file, site, city, lng, lat });
    }
  }
  return rows;
}

test('无任何非杭州 drop 站点坐标落在杭州参考框内 (fecef85 清扫回归)', () => {
  const hzBox = CITY_REFERENCE_BOXES.find((r) => bareCityName(r.city) === '杭州');
  assert.ok(hzBox, 'CITY_REFERENCE_BOXES 收录杭州参考框');
  const { west, south, east, north } = hzBox.box;
  const offenders = [];
  let nonHangzhouChecked = 0;
  for (const row of coordSites()) {
    if (bareCityName(row.city) === '杭州') continue;
    nonHangzhouChecked += 1;
    if (row.lng >= west && row.lng <= east && row.lat >= south && row.lat <= north) {
      // CITY_CENTERS 静态行政中心坐标豁免 (2026-08-21 city-split 补点): 金华
      // 中心 119.65/29.08 地理上落在杭州框内 (框是 杭州+周边 的宽松裁切超集),
      // 但它等于 cityCenter('金华') —— 是城市行政中心, 不是 7d19271 杭州
      // office 坐标 (120.221266/30.201767) 的复制。精确等值判定与事故复制
      // 坐标可区分; 无法区分/非静态中心 → 仍判为串味。
      const center = cityCenter(row.city);
      if (center && center.lng === row.lng && center.lat === row.lat) continue;
      // 2026-08-22 (geocode r4): 真实 geocode 坐标豁免 —— 邻市(绍兴柯桥
      // 120.512/30.093 等)真实办公点地理上落在杭州宽松框内, 但
      // cityLabelMatchesCoordinates 证明坐标属于其自身城市参考框 →
      // 是 geocode 产物, 不是 7d19271 杭州 office 坐标的复制串味。
      if (cityLabelMatchesCoordinates(row.city, row.lng, row.lat)) continue;
      offenders.push({
        file: `${row.dir}/${row.file}`,
        site: row.site.id ?? row.site.name ?? '?',
        city: row.city,
        lng: row.lng,
        lat: row.lat,
      });
    }
  }
  assert.ok(nonHangzhouChecked > 0, '非杭州带坐标站点应存在 (抽样人口非空)');
  assert.deepEqual(
    offenders,
    [],
    `非杭州站点坐标落在杭州框 (${offenders.length} 条, 需重跑 fix-sweep-accident-coords.mjs): ${JSON.stringify(offenders)}`,
  );
});

test('全量 drop 站点 city↔坐标通过 cityLabelMatchesCoordinates (聚合徽章防御同源)', () => {
  const rows = coordSites();
  assert.ok(rows.length > 0, 'drops 中应存在带坐标站点');
  const mismatches = rows
    .filter((row) => !cityLabelMatchesCoordinates(row.city, row.lng, row.lat))
    .map((row) => ({
      file: `${row.dir}/${row.file}`,
      site: row.site.id ?? row.site.name ?? '?',
      city: row.city,
      lng: row.lng,
      lat: row.lat,
    }));
  assert.deepEqual(
    mismatches,
    [],
    `city↔坐标不一致站点 (${mismatches.length} 条, 会被聚合徽章剔除): ${JSON.stringify(mismatches)}`,
  );
});

test('杭州站点坐标存在性抽查 (快手 / 蚂蚁集团等真杭州坐标保留)', () => {
  // 抽查按 site.id 全量扫描 (不要求 city 键 — 部分 official-career 站点无 city)。
  const byId = new Map();
  for (const { dir, file, data } of loadDrops()) {
    for (const site of data.sites ?? []) {
      const { lng, lat } = site.location ?? {};
      if (typeof lng === 'number' && typeof lat === 'number') {
        byId.set(`${dir}/${file}#${site.id}`, { lng, lat });
      }
    }
  }
  const kuaishou = byId.get('radar/快手.json#快手-site-hangzhou');
  assert.ok(kuaishou, '快手 site-hangzhou 存在且带坐标');
  assert.equal(kuaishou.lng, 120.221266);
  assert.equal(kuaishou.lat, 30.201767);
  const antgroup = byId.get('official-career/antgroup-hangzhou.json#antgroup-hangzhou-site');
  assert.ok(antgroup, '蚂蚁集团 hangzhou site 存在且带坐标');
  assert.equal(antgroup.lng, 120.108);
  assert.equal(antgroup.lat, 30.267);
  // 全量: 杭州站点带坐标数量应保持充足 (7d19271 真坐标不被清扫)
  const hangzhouWithCoords = coordSites().filter((row) => bareCityName(row.city) === '杭州').length;
  assert.ok(hangzhouWithCoords >= 60, `杭州站点带坐标数量过少: ${hangzhouWithCoords} (期望 ≥ 60)`);
});

test('清扫不产生半边坐标 (lng/lat 只缺其一)', () => {
  const halfPairs = [];
  for (const { dir, file, data } of loadDrops()) {
    for (const site of data.sites ?? []) {
      const { lng, lat } = site.location ?? {};
      const hasLng = typeof lng === 'number';
      const hasLat = typeof lat === 'number';
      if (hasLng !== hasLat) {
        halfPairs.push({ file: `${dir}/${file}`, site: site.id ?? '?', lng, lat });
      }
    }
  }
  assert.deepEqual(halfPairs, [], `半边坐标站点: ${JSON.stringify(halfPairs)}`);
});
