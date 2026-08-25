// 城市中心假坐标重跑 — 真实 drop 数据契约 (2026-08-22, fix/geocode-citycenter-rerun)。
//
// 背景: city-centers 批次把无坐标站点钉在城市中心 (上海 121.47/31.23 堆 376 站、
// 北京 327 …), w2/w4 回填街道地址后 siteNeedsGeocode 仍「有坐标即跳过」→ apply
// 永不重跑 → 地图几百 POI 永久堆在同一中心点 (用户反馈)。本测试在真实 drop
// 数据上钉住新语义 (site-geocode.test.mjs 的单元级断言之外的数据级验证):
//   坐标命中城市中心 (±0.0005) 的站点:
//     - 地址为城市名 (上海 / 上海市 / 仅含城市名) → siteNeedsGeocode === false (留在中心)
//     - 地址非空且非城市名 (街道地址 / 北京/上海/深圳/成都 城市列表占位) → true (重新 geocode)
//     - 无地址 → false (规则要求地址非空)
// 计数快照 (2026-08-22, 5 源 drops 全量): 中心钉点 1634 = 需要重跑 1380 + 留在中心 254
// (上海 319 / 北京 296 / 深圳 225 / 成都 124 / 广州 105 居前)。apply 重跑后站点
// 离开中心桶, 断言随之变空洞但不误报 — 本测试只钉语义不变式, 不钉会漂移的计数。
// 城市中心钉点数据契约: 中心钉点站语义与数据一致, 只钉不变式不钉会漂移的计数。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  cityCenterBareNames,
  isCityNameAddress,
  matchesCityCenter,
  siteNeedsGeocode,
  siteNeedsPlaceSearch,
} from '../src/lib/site-geocode.ts';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DROP_DIRS = ['radar', 'official-career', 'qqdoc-jobs', 'qqdoc-official', 'embodied-jobs'];

/** 全部 drop 中坐标命中城市中心 (±0.0005) 的站点。 */
function centerSites() {
  const rows = [];
  for (const d of DROP_DIRS) {
    const dir = path.join(SERVER_DIR, 'data', 'recruitment', d);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json') || name.startsWith('.')) continue;
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      const arr = Array.isArray(raw) ? raw : [raw];
      for (const company of arr) {
        for (const site of company.sites ?? []) {
          const { lng, lat } = site.location ?? {};
          if (typeof lng !== 'number' || typeof lat !== 'number') continue;
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
          if (!matchesCityCenter(lng, lat)) continue;
          rows.push({ file: `${d}/${name}`, site, lng, lat });
        }
      }
    }
  }
  return rows;
}

test('中心钉点站数据契约: 城市名地址留中心 / 非城市名地址重新 geocode', () => {
  const rows = centerSites();
  assert.ok(rows.length >= 1000, `中心钉点站应大量存在 (city-centers 批次落点), 实际 ${rows.length}`);
  const violations = [];
  for (const { file, site, lng, lat } of rows) {
    const address = site.location?.address?.trim() ?? '';
    const isCityName = isCityNameAddress(address, site.city, cityCenterBareNames(lng, lat));
    const expected = address !== '' && !isCityName;
    if (siteNeedsGeocode(site) === expected) continue;
    violations.push({ file, site: site.id ?? site.name ?? '?', address, expected });
  }
  assert.deepEqual(
    violations,
    [],
    `中心钉点站语义与数据不符 (${violations.length} 条): ${JSON.stringify(violations)}`,
  );
});

test('中心钉点站数据契约: 占位/无地址站 → 地点检索补全通道 (2026-08-25)', () => {
  // fix/site-place-search: 地址为城市名占位/无地址的中心钉站 (旧口径 stayCenter/
  // noAddress) 需要「公司名+城市」地点检索补全; 街道地址站走地址 geocode。
  const rows = centerSites();
  const violations = [];
  for (const { file, site } of rows) {
    const address = site.location?.address?.trim() ?? '';
    const isCityName = isCityNameAddress(address, site.city, cityCenterBareNames(site.location.lng, site.location.lat));
    const expected = address === '' || isCityName;
    if (siteNeedsPlaceSearch(site) === expected) continue;
    violations.push({ file, site: site.id ?? site.name ?? '?', address });
  }
  assert.deepEqual(
    violations,
    [],
    `中心钉点站 place-search 通道判定与数据不符 (${violations.length} 条): ${JSON.stringify(violations)}`,
  );
});
