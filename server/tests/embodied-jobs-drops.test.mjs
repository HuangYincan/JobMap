// embodied-jobs drops 语料校验 (20260821-boss-embodied-jobs 批次 ws1 产物)。
// 覆盖: 新建 embj-* drops (server/data/recruitment/embodied-jobs/) + 同名匹配
// 追加后的现有 drops (radar / official-career / qqdoc-official / qqdoc-jobs)。
//
// 校验路径与真实读路径对齐: 现有 drops 经各自 adapter 归一化 (industries 缺省
// 用 industriesOf 启发式, scale 缺省 enterprise — 见 qqdoc-official/qqdoc-jobs
// adapter), 再跑 recruitment-import.validateSourceCompany (纯函数, 无 DB)。
// 断言零 bad issues — 有任一 issue 即 FAILED (回归防线: 追加不得破坏现有 drop)。
import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateSourceCompany } from '../src/lib/recruitment-import.ts';
import { industriesOf } from '../src/lib/recruitment-adapters/qqdoc-official.ts';

const RECRUITMENT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'recruitment');
const DIRS = ['embodied-jobs', 'radar', 'official-career', 'qqdoc-official', 'qqdoc-jobs'];
const FAMILIES = new Set(['social', 'campus', 'intern']);
const FAMILY_CODES = /^(social|campus|intern)$/;

/** 与 adapters 相同的读路径归一化 (drop 自带 industries/scale 优先)。 */
function normalizeDrop(raw) {
  const drop = raw;
  return {
    slug: drop.slug,
    name: drop.name,
    source: drop.source,
    industries:
      Array.isArray(drop.industries) && drop.industries.length > 0 ? drop.industries : industriesOf(drop.name),
    scale: drop.scale || 'enterprise',
    careerUrl: drop.careerUrl,
    sites: Array.isArray(drop.sites) ? drop.sites : [],
    positions: Array.isArray(drop.positions) ? drop.positions : [],
  };
}

function readDrops(dir) {
  const out = []; // { dir, file, drop }
  const path = join(RECRUITMENT_ROOT, dir);
  let names;
  try {
    names = readdirSync(path);
  } catch {
    return out;
  }
  for (const file of names.sort()) {
    if (!file.endsWith('.json') || file.startsWith('.')) continue;
    try {
      const drop = JSON.parse(readFileSync(join(path, file), 'utf8'));
      if (drop && typeof drop === 'object') out.push({ dir, file, drop });
    } catch {
      // 坏 JSON 由 import 规划器另行报告; 这里跳过 (与 adapters 一致)
    }
  }
  return out;
}

test('全部生成 drops (embodied-jobs + 4 个现有目录) 零校验 issue', () => {
  const failures = [];
  let companies = 0;
  let files = 0;
  for (const dir of DIRS) {
    for (const { file, drop } of readDrops(dir)) {
      files += 1;
      if (!drop.name) continue; // 无 name 的畸形文件跳过 (adapter 读不到)
      companies += 1;
      const issues = validateSourceCompany(normalizeDrop(drop));
      if (issues.length > 0) {
        failures.push(`${dir}/${file}: ${issues.map((i) => `${i.field}(${i.message})`).join(', ')}`);
      }
    }
  }
  assert.ok(files >= 1000, `drops corpus should be >= 1000 files, got ${files}`);
  assert.equal(failures.length, 0, `zero bad issues expected:\n${failures.slice(0, 10).join('\n')}`);
});

test('embodied-jobs 语料: 47 个新 drop, 537 个 embj-* 岗位, 结构逐项合法', () => {
  const embjDrops = readDrops('embodied-jobs');
  assert.equal(embjDrops.length, 47, '2026-08-21 快照 → 47 家无同名匹配的公司新建 embj-* drop');

  const seenExternalIds = new Set();
  let positionsTotal = 0;
  let zeroLinkDrops = 0;
  let withAddrCount = 0;
  let emptyLocCount = 0;
  for (const { file, drop } of embjDrops) {
    assert.match(drop.slug, /^embj-/, `${file} slug embj- 前缀`);
    assert.equal(drop.source, 'embodied-jobs', `${file} source`);
    assert.ok(drop.name, `${file} name`);
    assert.equal(drop.sites.length, 1, `${file} 单一聚合 site`);
    const site = drop.sites[0];
    assert.equal(site.id, `embj-${drop.name}-site`, `${file} site.id`);
    assert.equal(site.name, drop.name, `${file} site.name`);
    assert.ok(site.city.length > 0, `${file} site.city 城市并集非空`);
    assert.deepEqual(site.province, '', `${file} province 留空`);
    // 2026-08-22 地址回填 (e506c4d + r2 768adc4) + geocode:sites:apply 后契约: location 为空对象
    // (2 站海外无办公点可查)、仅含 address (已回填未 geocode), 或 {address, lng, lat}
    // (geocode 写回坐标形态); 禁止仅坐标无地址的畸形形态 (防丢地址)。
    assert.ok(site.location && typeof site.location === 'object', `${file} location 为对象`);
    const locKeys = Object.keys(site.location).sort();
    const shapeOk =
      locKeys.length === 0 ||
      (locKeys.length === 1 && locKeys[0] === 'address') ||
      (locKeys.length === 3 && locKeys[0] === 'address' && locKeys[1] === 'lat' && locKeys[2] === 'lng');
    assert.ok(shapeOk, `${file} location 为空对象、仅含 address 或 {address, lng, lat} (got ${JSON.stringify(site.location)})`);
    if (site.location.address) {
      assert.ok(site.location.address.length > 0, `${file} address 非空`);
      withAddrCount += 1;
    } else {
      assert.deepEqual(site.location, {}, `${file} location 未回填仍为空对象`);
      emptyLocCount += 1;
    }
    if (drop.careerUrl) assert.match(drop.careerUrl, /^https?:\/\//, `${file} careerUrl http(s)`);
    assert.ok(Array.isArray(drop.positions), `${file} positions 数组`);
    if (drop.positions.length === 0) zeroLinkDrops += 1;
    positionsTotal += drop.positions.length;

    for (const pos of drop.positions) {
      const expectedId = new RegExp(`^embj-${escapeRegExp(drop.name)}-\\d+$`);
      assert.match(pos.externalId, expectedId, `${file} externalId 编号`);
      assert.equal(seenExternalIds.has(pos.externalId), false, `externalId 全局唯一: ${pos.externalId}`);
      seenExternalIds.add(pos.externalId);
      assert.equal(pos.siteId, site.id, `${file} 岗位挂唯一 site`);
      assert.ok(FAMILIES.has(pos.family), `${file} family ∈ {social,campus,intern}: ${pos.family}`);
      assert.equal(pos.taxonomy?.family, pos.family, `${file} taxonomy.family 与 family 一致`);
      assert.equal(pos.status, 'open', `${file} status open`);
      assert.equal(pos.applySource, 'official', `${file} applySource official`);
      assert.match(pos.applyUrl, /^https?:\/\//, `${file} applyUrl http(s) (2026-08-21 快照全行有链接)`);
      assert.equal(pos.retrievedAt, '2026-08-21', `${file} retrievedAt 快照日期`);
    }
  }
  // 地址回填快照事实 (2026-08-22, r2 768adc4 后): 45 站带 address, 2 站为空 (AIM/Grit 海外无办公点可查)
  assert.equal(withAddrCount, 45, '回填后 45 站带 address');
  assert.equal(emptyLocCount, 2, '回填后 2 站仍为空对象');
  // 抽查个别站点地址非空 (跨国 / 国内 / 高校各一)
  const addrOf = (name) => embjDrops.find((r) => r.drop.name === name)?.drop.sites[0].location.address;
  for (const name of ['Tesla', '柏楚', '浙江大学']) {
    assert.ok(typeof addrOf(name) === 'string' && addrOf(name).length > 0, `${name} 地址已回填且非空`);
  }
  assert.equal(positionsTotal, 301, '新建 47 个 embj-* drop 共 301 岗 (总 537 − 匹配追加 236)');
  assert.equal(zeroLinkDrops, 0, '本快照无零链接公司');
});

test('同名匹配追加: 现有 drop 里 embj-* 岗位 siteId 指向其首个 site, 跨节合并岗位数正确', () => {
  const all = [];
  for (const dir of ['radar', 'official-career', 'qqdoc-official', 'qqdoc-jobs']) {
    all.push(...readDrops(dir));
  }
  const appended = [];
  const seen = new Set();
  for (const { dir, file, drop } of all) {
    const embjPositions = (drop.positions || []).filter((p) => typeof p?.externalId === 'string' && p.externalId.startsWith('embj-'));
    if (embjPositions.length === 0) continue;
    const firstSiteId = drop.sites?.[0]?.id;
    assert.ok(firstSiteId, `${dir}/${file} 有首个 site`);
    for (const pos of embjPositions) {
      assert.equal(pos.siteId, firstSiteId, `${dir}/${file} embj 岗位挂首个 site`);
      assert.equal(seen.has(pos.externalId), false, `externalId 全局唯一: ${pos.externalId}`);
      seen.add(pos.externalId);
      assert.ok(FAMILY_CODES.test(pos.family), `${file} family: ${pos.family}`);
      assert.match(pos.applyUrl, /^https?:\/\//, `${file} applyUrl`);
    }
    appended.push({ dir, file, name: drop.name, count: embjPositions.length, sources: drop.sources, externalIds: embjPositions.map((p) => p.externalId) });
  }

  // 快照事实: 26 家同名匹配 (21 精确 + 5 别名), 岗位 = 537 总岗 - 新建 drops 岗位数
  const newDropPositions = readDrops('embodied-jobs').reduce((n, r) => n + (r.drop.positions || []).length, 0);
  const appendedPositions = appended.reduce((n, r) => n + r.count, 0);
  assert.equal(appended.length, 26, `26 家匹配追加 (got ${appended.length})`);
  assert.equal(appendedPositions + newDropPositions, 537);
  assert.equal(newDropPositions, 301, '新建 47 个 embj-* drop 共 301 岗');

  // 快照公司名 (从 externalId 前缀还原, 别名 drop 的 name 字段不同)
  const byName = new Map();
  for (const r of appended) {
    const snapshotName = r.externalIds[0].replace(/^embj-/, '').replace(/-\d+$/, '');
    byName.set(snapshotName, r);
  }
  assert.equal(byName.get('地平线')?.count, 16, '地平线 国内+专项 合并 16 岗');
  assert.equal(byName.get('商汤科技')?.count, 6, '商汤科技 国内+专项 合并 6 岗');
  assert.equal(byName.get('NVIDIA')?.count, 7, 'NVIDIA 海外+专项 合并 7 岗');

  // 别名匹配 5 家 (九号→九号公司 / 傅利叶智能→傅利叶 / 商汤科技→无限原力 / 小鹏汽车→物理AI / 荣耀→HONOR)
  const aliasNames = ['九号', '傅利叶智能', '商汤科技', '小鹏汽车', '荣耀'];
  for (const name of aliasNames) assert.ok(byName.has(name), `别名匹配追加: ${name}`);

  // sources 数组追加 'embodied-jobs' (埃斯顿 qqdoc-jobs drop 是唯一 sources 数组命中)
  const estun = all.find((r) => r.file === 'qqj-埃斯顿.json');
  assert.ok(estun, 'qqj-埃斯顿.json 存在');
  assert.deepEqual(estun.drop.sources, ['qqdoc-jobs', 'embodied-jobs'], 'sources 追加 embodied-jobs');

  // source 单值的现有 drop 不动 (radar 奥比中光)
  const obe = all.find((r) => r.file === '奥比中光.json');
  assert.equal(obe.drop.source, 'xiaozhao-radar', 'radar source 单值不动');
  assert.equal(Array.isArray(obe.drop.sources), false, 'radar drop 无 sources 数组');
});

test('幂等产物: 脚本可重复运行 — 现有 embj 岗位不重复追加', () => {
  // 直接断言 externalId 无重复即可 (重复运行会 skip, 不会写重; 这里是语料级防线)
  const seen = new Set();
  for (const dir of DIRS) {
    for (const { file, drop } of readDrops(dir)) {
      for (const pos of drop.positions || []) {
        if (typeof pos?.externalId === 'string' && pos.externalId.startsWith('embj-')) {
          assert.equal(seen.has(pos.externalId), false, `duplicate ${pos.externalId} (${dir}/${file})`);
          seen.add(pos.externalId);
        }
      }
    }
  }
  assert.equal(seen.size, 537, '语料里 embj-* externalId 总数为 537');
});

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
