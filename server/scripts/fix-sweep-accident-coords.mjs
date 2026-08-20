#!/usr/bin/env node
// ============================================================
// fix-sweep-accident-coords.mjs — 清扫 fecef85 事故坐标 (2026-08-20, w1)
//
// 背景: refresh-radar 再生 (fbc4448) 丢失 8/17 geocode 的坐标; fecef85
// 修复时把 7d19271 的杭州 office 坐标 (120.221266/30.201767) 复制到了所有
// 城市 site (如快手 site-beijing/shanghai/guangzhou/shenzhen 全部 = 杭州坐标)。
// 前端 cityLabelMatchesCoordinates (src/lib/city-cluster.ts:86) 把「上海标签
// + 杭州坐标」的串味行从聚合徽章剔除 → 徽章数量错误 (上海 26 vs DB 44)。
// 防御逻辑正确, 数据脏 —— 本脚本清扫 drops 数据, 不改任何其他数据语义。
//
// 规则 (与 src/lib/spatial-query.ts bareCityName / CITY_REFERENCE_BOXES 同源):
//   - site.city 存在且裸城名 ≠ '杭州' (bareCityName: 去 省/市/区 后缀)
//   - location.lng/lat 都是有限 number 且落在杭州参考框
//     (118.3 ≤ lng ≤ 120.8 且 29.05 ≤ lat ≤ 30.75)
//   → 删除 location.lng/lat 键, 保留 address (无 address 也保留空结构)
//   - 杭州 site (裸城名 = 杭州/杭州市) 坐标一律保留不动 (7d19271 真杭州坐标)
//
// 为什么「删除键」而不是「置 null」: recruitment-import.ts validateSourceCompany
// 只认「缺省 (undefined) = 待 geocode 的合法 address-only 站点」, `lng: null`
// 会触发 Number.isFinite(null) 失败 → planSeedImport 把整家公司判为 invalid
// 丢弃 (46 家)。删除键与既有 address-only 站点形状 (如海天集团.json) 一致。
//
// 幂等: 二次运行零改动。输出清理统计 (文件数/站点数/城市分布)。
// 只扫 radar/ 与 official-career/ 两个 drops 目录 (任务边界)。
// ============================================================

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'recruitment');
const DROP_DIRS = ['radar', 'official-career'];

// 杭州参考框 (与 src/lib/spatial-query.ts CITY_REFERENCE_BOXES 杭州框一致)
const HANGZHOU_BOX = { west: 118.3, south: 29.05, east: 120.8, north: 30.75 };

/** bareCityName 同源语义 (去 省/市/区 后缀, 见 src/lib/spatial-query.ts). */
function bareCityName(value) {
  return value.replace(/[省市区]$/, '');
}

/** 坐标是否落在杭州参考框内 (含边界, 与任务规则一致). */
function inHangzhouBox(lng, lat) {
  return (
    lng >= HANGZHOU_BOX.west &&
    lng <= HANGZHOU_BOX.east &&
    lat >= HANGZHOU_BOX.south &&
    lat <= HANGZHOU_BOX.north
  );
}

function loadDrops() {
  const drops = [];
  for (const dir of DROP_DIRS) {
    for (const file of readdirSync(join(dataRoot, dir))) {
      if (!file.endsWith('.json')) continue;
      const path = join(dataRoot, dir, file);
      const text = readFileSync(path, 'utf8');
      drops.push({ dir, file, path, text, data: JSON.parse(text) });
    }
  }
  return drops;
}

function main() {
  const drops = loadDrops();
  const cleanedByCity = new Map(); // 裸城名 -> 清理数
  const cleanedSites = []; // 明细, 供抽样人工核对
  let filesChanged = 0;
  let sitesScanned = 0; // 非杭州且有数值坐标的站点 (可清理人口)

  for (const drop of drops) {
    let fileChanged = false;
    for (const site of drop.data.sites ?? []) {
      const city = site?.city?.trim();
      if (!city) continue; // 无 city → 不可判断, 不动
      if (bareCityName(city) === '杭州') continue; // 杭州 site 坐标一律保留
      const loc = site?.location;
      if (!loc || typeof loc !== 'object') continue;
      const { lng, lat } = loc;
      if (typeof lng !== 'number' || typeof lat !== 'number') continue; // 无坐标 → 不动
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue; // 非法坐标 → 不动
      sitesScanned += 1;
      if (inHangzhouBox(lng, lat)) {
        delete loc.lng;
        delete loc.lat;
        fileChanged = true;
        const bare = bareCityName(city);
        cleanedByCity.set(bare, (cleanedByCity.get(bare) ?? 0) + 1);
        cleanedSites.push({ file: `${drop.dir}/${drop.file}`, site: site.id ?? site.name ?? '?', city, lng, lat });
      }
    }
    if (fileChanged) {
      // 保持原文件换行风格, 只写有改动的文件
      const out = JSON.stringify(drop.data, null, 2) + (drop.text.endsWith('\n') ? '\n' : '');
      writeFileSync(drop.path, out, 'utf8');
      filesChanged += 1;
    }
  }

  console.log(`扫描 drops: ${drops.length} 文件 (${DROP_DIRS.join(', ')})`);
  console.log(`非杭州且有坐标站点: ${sitesScanned}`);
  console.log(`清理事故站点: ${cleanedSites.length} (涉及文件 ${filesChanged})`);
  const dist = [...cleanedByCity.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  console.log('城市分布 (裸城名: 清理数):');
  for (const [city, count] of dist) console.log(`  ${city}: ${count}`);
  if (cleanedSites.length > 0) {
    console.log('清理明细 (前 20 条):');
    for (const s of cleanedSites.slice(0, 20)) {
      console.log(`  ${s.file} ${s.site} [${s.city}] (${s.lng}, ${s.lat})`);
    }
    if (cleanedSites.length > 20) console.log(`  … 其余 ${cleanedSites.length - 20} 条`);
  }
  console.log(
    cleanedSites.length === 0 ? '结果: 无事故坐标, 幂等零改动' : `结果: 清理完成, 共 ${cleanedSites.length} 个事故站点`,
  );
}

main();
