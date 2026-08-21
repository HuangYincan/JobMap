#!/usr/bin/env node
// ============================================================
// split-city-sites.mjs — 多城市字符串拆分 + 单城市无坐标补中心点
//
// 背景(2026-08-21, boss city-split w1):大量 drops 的 site.city 是多城市
// 字符串(「北京、杭州、上海、成都、深圳等」),或单城市字符串但 location 无
// 坐标 —— 这些站点进不了 POI(server-catalog.ts:53 hasPlausibleCoord 过滤),
// 有岗位的公司在地图/搜索不可见。项目已有 CITY_CENTERS(静态城市中心表,
// domain 聚合在用)与 cityCenter()。
//
// 本脚本(只处理有 positions 的公司;无岗位公司拆了也不显示):
//   1. 多城市字符串 site → 每个可归一城市一个 site:
//        - 原 site 保留为主站点(id 不变),city 取第一个可归一城市全称
//          (「北京市」,与 CITY_CENTERS 键归一风格一致),location 补该城市
//          行政中心坐标;首个原始 token 不可归一时(如「哈尔滨 北京 …」)
//          取第一个可归一城市 —— 否则主站点仍无坐标,公司依旧不可见;
//        - 其余城市各一个 site(id = `<site.id>-<裸城名>`),坐标 = cityCenter;
//        - 城市中心坐标全部取自 cityCenter(),天然落在 CITY_REFERENCE_BOXES
//          对应城市框内(串味防御),不自造坐标;
//   2. 单城市字符串但无坐标 → 补 cityCenter 坐标(城市行政中心),city 归一为
//      全称(避免「北京 哈尔滨 大连」这类多城文本残留在有坐标的站点上);
//   3. 已有坐标的 site 不动(街道级 geocode 坐标优先保留;同时是幂等闸门);
//   4. 岗位挂载:position.city(或 workCity / location.city,数据当前缺省)
//      匹配拆分城市 → positions.siteId 同步改挂该城市站点;无法匹配 → 留在
//      主站点(原 site.id 不变,引用一致性天然保持);
//   5. 幂等:有坐标的 site 整体跳过 —— 重复运行不重复拆分、不重复补点。
//
// 不调 geocode、不调任何外部 API。
//
//   node scripts/split-city-sites.mjs           # dry-run:只打印计划,不写
//   node scripts/split-city-sites.mjs --apply   # 写回 drop JSON(2 空格缩进)
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bareCityName, cityCenter } from '../src/lib/city-centers.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data', 'recruitment');
const TARGET_DIRS = ['radar', 'qqdoc-jobs', 'qqdoc-official', 'official-career'];

/** 非城市说明词(整词剔除):多城市字符串里的「等」「全国其他」等尾巴。 */
const NON_CITY_TOKENS = new Set([
  '等', '等地', '等城市', '全国', '全国其他', '全国范围', '海外', '线上',
  '远程', '其他', '多地', '办公地', '工作地', '常驻地', '地点', '城市', '及',
]);

/** site 是否已有可用坐标(0,0 视为无坐标,与 site-geocode.siteNeedsGeocode 同口径)。 */
export function siteHasCoords(site) {
  const loc = site?.location ?? {};
  return Number.isFinite(loc.lng) && Number.isFinite(loc.lat) && !(loc.lng === 0 && loc.lat === 0);
}

/**
 * 解析多城市字符串 → 原始城市 token 列表。
 * 分隔符:,、,，,/(半角/全角)/空白;剔除「北京等」「上海等地」「深圳等城市」
 * 的尾部说明词与 NON_CITY_TOKENS 整词。未归一、未去重。
 */
export function splitCityText(cityText) {
  if (typeof cityText !== 'string') return [];
  const tokens = cityText
    .split(/[、,，/／\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const out = [];
  for (let t of tokens) {
    t = t.replace(/(等城市|等地|等)$/, '');
    if (!t || NON_CITY_TOKENS.has(t)) continue;
    out.push(t);
  }
  return out;
}

/**
 * 可归一城市列表:token 命中 CITY_CENTERS 才保留(海外/未收录城市不处理),
 * 输出裸城名(去「省/市/区」后缀),去重且保持出现顺序。
 */
export function splittableCities(cityText) {
  const seen = new Set();
  const out = [];
  for (const token of splitCityText(cityText)) {
    if (!cityCenter(token)) continue;
    const bare = bareCityName(token);
    if (seen.has(bare)) continue;
    seen.add(bare);
    out.push(bare);
  }
  return out;
}

/** 裸城名 → 城市全称(「北京」→「北京市」,与 CITY_CENTERS 键归一风格一致)。 */
export function fullCityName(bare) {
  return `${bare}市`;
}

/**
 * 拆分计划(纯函数,不落盘)。
 * 多城市字符串且 ≥2 个可归一城市 → 返回 { main, splits, moved }:
 *   - main:  原 site(id 不变),city = 第一个可归一城市全称,location 补中心坐标;
 *   - splits: 其余城市各一个 site(id = `<site.id>-<裸城名>`,city 全称,中心坐标;
 *             与公司其他 site id 撞车的拆分城市由 processCompany 层过滤);
 *   - moved:  岗位重挂清单 [{ externalId, to }] —— 仅限 siteId 指向本 site 且
 *             position.city/workCity/location.city 命中拆分城市(裸名比对)的岗位。
 * 不需要拆分(非多城市 / 无可归一城市 / 已有坐标)→ 返回 null。
 */
export function planSiteSplit(site, positions = []) {
  if (!site || typeof site !== 'object') return null;
  if (siteHasCoords(site)) return null;
  const cities = splittableCities(site.city ?? '');
  if (cities.length < 2) return null;

  const mainCity = cities[0];
  const center = cityCenter(mainCity);
  const main = {
    ...site,
    city: fullCityName(mainCity),
    location: { ...(site.location ?? {}), lng: center.lng, lat: center.lat },
  };

  // 拆分城市 id = `<site.id>-<裸城名>`(恒长于 site.id,与主站点不会撞车;
  // 与公司其他站点撞车由 processCompany 层过滤)。
  const splits = [];
  for (const bare of cities.slice(1)) {
    const c = cityCenter(bare);
    splits.push({
      id: `${site.id}-${bare}`,
      name: site.name,
      city: fullCityName(bare),
      location: { lng: c.lng, lat: c.lat },
    });
  }
  if (splits.length === 0) return null;

  const splitIdByBare = new Map(splits.map((s) => [bareCityName(s.city), s.id]));
  const moved = [];
  for (const pos of positions) {
    if (!pos || pos.siteId !== site.id) continue;
    const posCity = pos.city ?? pos.workCity ?? pos.location?.city;
    if (!posCity) continue;
    const bare = bareCityName(String(posCity).trim());
    const to = splitIdByBare.get(bare);
    if (to) moved.push({ externalId: pos.externalId, to });
  }
  return { main, splits, moved };
}

/**
 * 单城市字符串但无坐标 → 补 cityCenter 坐标(该城市行政中心),city 归一为全称。
 * 无需处理(有坐标 / 非单可归一城市) → 原样返回(同引用,便于调用方判断)。
 */
export function patchCityCenterCoords(site) {
  if (!site || typeof site !== 'object') return site;
  if (siteHasCoords(site)) return site;
  const cities = splittableCities(site.city ?? '');
  if (cities.length !== 1) return site; // 多城市走拆分;0 城市(未收录)不动
  const center = cityCenter(cities[0]);
  return {
    ...site,
    city: fullCityName(cities[0]),
    location: { ...(site.location ?? {}), lng: center.lng, lat: center.lat },
  };
}

/** 岗位重挂:把 plan.moved 应用到 positions(只改 siteId,重建数组不突变)。 */
export function remountPositions(positions, plan) {
  if (!plan?.moved?.length) return positions;
  const toByExternal = new Map(plan.moved.map((m) => [m.externalId, m.to]));
  return positions.map((pos) => {
    const to = toByExternal.get(pos?.externalId);
    return to ? { ...pos, siteId: to } : pos;
  });
}

/**
 * 处理一家公司(纯函数):返回 { company, stats }。
 * 只拆有 positions 的公司;已有坐标的 site 跳过(幂等 + 街道级坐标优先)。
 */
export function processCompany(company) {
  const stats = { multiSites: 0, newSites: 0, patchedSites: 0, movedPositions: 0 };
  if (!company || typeof company !== 'object' || !Array.isArray(company.sites)) {
    return { company, stats };
  }
  const positions = Array.isArray(company.positions) ? company.positions : [];
  if (positions.length === 0) return { company, stats }; // 无岗位不拆

  let nextPositions = positions;
  let changed = false;
  const sites = [];
  // 拆分城市 id 不得与公司现有任何 site id 撞车(含后续未处理的站点)
  const existingIds = new Set(company.sites.map((s) => s?.id).filter(Boolean));
  for (const site of company.sites) {
    if (siteHasCoords(site)) {
      sites.push(site);
      continue;
    }
    const plan = planSiteSplit(site, nextPositions);
    if (plan) {
      const splits = plan.splits.filter((s) => !existingIds.has(s.id));
      if (splits.length > 0) {
        stats.multiSites += 1;
        stats.newSites += splits.length;
        stats.movedPositions += plan.moved.length;
        sites.push(plan.main, ...splits);
        nextPositions = remountPositions(nextPositions, plan);
        changed = true;
        continue;
      }
    }
    const patched = patchCityCenterCoords(site);
    if (patched !== site) {
      stats.patchedSites += 1;
      changed = true;
    }
    sites.push(patched);
  }
  if (!changed) return { company, stats }; // 幂等:无变化返回原引用
  return { company: { ...company, sites, positions: nextPositions }, stats };
}

/** 处理一个文件(raw 为单公司对象或公司数组)。 */
export function processFile(raw) {
  if (Array.isArray(raw)) {
    const results = raw.map(processCompany);
    const stats = results.reduce(
      (a, r) => ({
        multiSites: a.multiSites + r.stats.multiSites,
        newSites: a.newSites + r.stats.newSites,
        patchedSites: a.patchedSites + r.stats.patchedSites,
        movedPositions: a.movedPositions + r.stats.movedPositions,
      }),
      { multiSites: 0, newSites: 0, patchedSites: 0, movedPositions: 0 },
    );
    return { raw: results.map((r) => r.company), stats };
  }
  const { company, stats } = processCompany(raw);
  return { raw: company, stats };
}

// —— main(仅直接执行时运行;被测试 import 时不跑) ——
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

async function main() {
  const APPLY = process.argv.includes('--apply');
  const totals = { files: 0, changedFiles: 0, multiSites: 0, newSites: 0, patchedSites: 0, movedPositions: 0 };
  const splitExamples = [];

  for (const dir of TARGET_DIRS) {
    const dirPath = path.join(DATA_DIR, dir);
    if (!fs.existsSync(dirPath)) continue;
    const names = fs
      .readdirSync(dirPath)
      .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
      .sort();
    for (const name of names) {
      const filePath = path.join(dirPath, name);
      let raw;
      try {
        raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch {
        continue; // 不可读/非法文件跳过(与 adapters 同容错)
      }
      const before = JSON.stringify(raw);
      const { raw: next, stats } = processFile(raw);
      totals.files += 1;
      totals.multiSites += stats.multiSites;
      totals.newSites += stats.newSites;
      totals.patchedSites += stats.patchedSites;
      totals.movedPositions += stats.movedPositions;
      if (stats.multiSites > 0) {
        splitExamples.push({ file: `${dir}/${name}`, ...stats });
      }
      if (JSON.stringify(next) === before) continue;
      totals.changedFiles += 1;
      if (APPLY) fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`);
    }
  }

  console.log(`文件数: ${totals.files}`);
  console.log(`改动文件: ${totals.changedFiles}${APPLY ? '(已写回)' : '(dry-run,加 --apply 写回)'}`);
  console.log(`多城市站点拆分: ${totals.multiSites} 家`);
  console.log(`拆出城市级站点: ${totals.newSites}`);
  console.log(`单城市无坐标补中心点: ${totals.patchedSites}`);
  console.log(`岗位重挂(positions.siteId 更新): ${totals.movedPositions}`);
  if (splitExamples.length) {
    console.log('拆分明细:');
    for (const e of splitExamples) {
      console.log(`  ${e.file}: 拆 ${e.multiSites} 站点 → +${e.newSites} 城市站点, 补点 ${e.patchedSites}, 岗位重挂 ${e.movedPositions}`);
    }
  }
}

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
