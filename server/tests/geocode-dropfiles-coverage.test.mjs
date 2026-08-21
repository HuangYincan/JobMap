import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  addressConflictsWithCity,
  geocodeQueryForSite,
  planSiteGeocode,
  regeoMatchesTarget,
  siteCityTarget,
  siteHasStreetAddress,
  sitesNeedingGeocode,
} from '../src/lib/site-geocode.ts';

// 2026-08-22 (fix/geocode-qqdoc-embodied, w3): geocode-sites-apply.mjs 的
// dropFiles() 原只扫描 radar + official-career 两个目录 — w2 回填进
// qqdoc-jobs / qqdoc-official / embodied-jobs 的 342 个有地址站点永远不会被
// geocode 落坐标, 永远上不了地图。本测试锁定 dropFiles 覆盖 5 源 + dry-run
// 计划 (planSiteGeocode) 对三源样例站点生成地址 geocode query。

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 5 源目录常量名 — 契约测试对比脚本 dropFiles() 数组字面量的 token。 */
const DIR_CONSTANT_NAMES = ['RADAR_DIR', 'OFFICIAL_CAREER_DIR', 'QQDOC_JOBS_DIR', 'QQDOC_OFFICIAL_DIR', 'EMBODIED_JOBS_DIR'];

// --- 样例: 真实 drop 形态 (2026-08-22 w2 回填后) ------------------------------

/** qqdoc-official: city_pending 标记 + city 仍为「XX总部」脏值, 地址已回填。 */
const QQDOC_OFFICIAL_PENDING = {
  slug: 'qq-中国矿产资源集团',
  name: '中国矿产资源集团',
  sources: ['qqdoc-official'],
  city_pending: true,
  sites: [
    {
      id: 'qq-中国矿产资源集团-site-hq',
      name: '中国矿产资源集团',
      city: '中国矿产资源集团总部',
      province: '',
      location: { address: '河北省雄安新区启动区中谷甲1号' },
    },
  ],
};

/** qqdoc-jobs: 有街道地址、无坐标 (w2 回填形态)。 */
const QQDOC_JOBS_SAMPLE = {
  slug: 'qqj-新东方西安学校',
  name: '新东方西安学校',
  sources: ['qqdoc-jobs'],
  sites: [
    {
      id: 'qqj-新东方西安学校-site',
      name: '新东方西安学校',
      city: '西安市',
      province: '',
      location: { address: '陕西省西安市碑林区南二环西段27号新东方大厦' },
    },
  ],
};

/** embodied-jobs: 有街道地址、无坐标 (w2 回填形态)。 */
const EMBODIED_JOBS_SAMPLE = {
  slug: 'embj-高仙机器人',
  name: '高仙机器人',
  sources: ['embodied-jobs'],
  sites: [
    {
      id: 'embj-高仙机器人-site',
      name: '高仙机器人',
      city: '上海市',
      province: '',
      location: { address: '上海市闵行区新虹街道申滨南路998号龙湖天街E栋8楼' },
    },
  ],
};

// --- dropFiles 覆盖 5 源 --------------------------------------------------------

// 脚本顶层跑主循环 + 真实网络 (fetch 打桩/超时 + 顶层 await), 无法 import —
// 与 geocode-plan-count.test.mjs 同模式: 契约级断言脚本源码, 运行时行为用
// 目录常量直连真实数据目录验证 (下方「5 源目录真实存在」测试)。
test('dropFiles: 契约 — 扫描数组列出全部 5 个源目录常量', () => {
  const script = readFileSync(new URL('../scripts/geocode-sites-apply.mjs', import.meta.url), 'utf8');
  // 三个新源的 import 必须真实存在 (否则运行期 ReferenceError, 契约测试测不到)
  for (const line of [
    `import { QQDOC_JOBS_DIR } from '../src/lib/recruitment-adapters/qqdoc-jobs.ts';`,
    `import { QQDOC_OFFICIAL_DIR } from '../src/lib/recruitment-adapters/qqdoc-official.ts';`,
    `import { EMBODIED_JOBS_DIR } from '../src/lib/recruitment-adapters/embodied-jobs.ts';`,
  ]) {
    assert.ok(script.includes(line), `脚本应包含 ${line}`);
  }
  const body = script.match(/function dropFiles\(\) \{([\s\S]*?)^\}/m);
  assert.ok(body, 'dropFiles() 函数体应存在');
  const dirsLine = body[1].match(/const dirs = \[([^\]]*)\]/);
  assert.ok(dirsLine, 'dropFiles() 内应有 dirs 数组字面量');
  const listed = (dirsLine[1].match(/[A-Z_]+_DIR/g) ?? []).sort();
  assert.deepEqual(listed, [...DIR_CONSTANT_NAMES].sort());
});

test('5 源目录常量互不相同且真实存在、含 json drops (dropFiles 运行时扫描)', async () => {
  // 脚本的运行契约是 cwd=server (npm run geocode:sites:apply); adapter 的
  // *_DIR 常量在模块加载时按 process.cwd() 解析 — 测试先锚定 cwd 再动态
  // import, 与脚本同契约 (node --test 每文件独立进程, chdir 不外泄)。
  process.chdir(SERVER_DIR);
  const [radar, official, qqdocJobs, qqdocOfficial, embodied] = await Promise.all([
    import('../src/lib/recruitment-adapters/radar.ts'),
    import('../src/lib/recruitment-adapters/official-career.ts'),
    import('../src/lib/recruitment-adapters/qqdoc-jobs.ts'),
    import('../src/lib/recruitment-adapters/qqdoc-official.ts'),
    import('../src/lib/recruitment-adapters/embodied-jobs.ts'),
  ]);
  const dirs = [radar.RADAR_DIR, official.OFFICIAL_CAREER_DIR, qqdocJobs.QQDOC_JOBS_DIR, qqdocOfficial.QQDOC_OFFICIAL_DIR, embodied.EMBODIED_JOBS_DIR];
  assert.equal(new Set(dirs).size, 5, '5 个目录常量应互不相同 (非同一目录别名)');
  const files = [];
  for (const dir of dirs) {
    assert.equal(path.dirname(dir), path.join(SERVER_DIR, 'data', 'recruitment'), `目录应锚定 server/data/recruitment: ${dir}`);
    assert.ok(existsSync(dir), `目录应存在: ${dir}`);
    const names = readdirSync(dir).filter((n) => n.endsWith('.json') && !n.startsWith('.'));
    assert.ok(names.length > 0, `目录应含 json drops: ${dir}`);
    files.push(...names);
  }
  assert.ok(files.length >= 5, `5 源合计应至少 5 个 drop 文件, 实际 ${files.length}`);
});

// --- dry-run 计划: 三源样例站点 → 地址 geocode query ---------------------------

test('planSiteGeocode: qqdoc-official city_pending + 脏 city 站点照常生成 needs (不崩)', () => {
  const plan = planSiteGeocode([QQDOC_OFFICIAL_PENDING]);
  assert.equal(plan.needs.length, 1);
  const need = plan.needs[0];
  assert.equal(need.slug, 'qq-中国矿产资源集团');
  // 有地址 → 地址 geocode query (地址在前, 公司名殿后), 不回落城市级检索
  assert.equal(need.query, '河北省雄安新区启动区中谷甲1号 中国矿产资源集团');
  assert.equal(need.query, geocodeQueryForSite('中国矿产资源集团', QQDOC_OFFICIAL_PENDING.sites[0]));
  // 街道地址判定: 主循环会走 geocodeAddressRest 分支
  assert.equal(siteHasStreetAddress(QQDOC_OFFICIAL_PENDING.sites[0]), true);
  // 脏 city 不崩: 地址-城市一致性闸门放行 (无已知区县冲突判定), regeo 城市闸门
  // 把脏 city 站点按 mismatch 跳过 — 可接受行为, 不会写入错误坐标
  const target = siteCityTarget(QQDOC_OFFICIAL_PENDING.sites[0]);
  assert.equal(target.city, '中国矿产资源集团总部');
  assert.equal(addressConflictsWithCity('河北省雄安新区启动区中谷甲1号', target.city), false);
  // 真实 regeo (河北省/雄安) vs 脏 city target → outside-province 跳过, 非崩溃
  const re = regeoMatchesTarget({ ok: true, province: '河北省', cityname: '', district: '容城县' }, target);
  assert.deepEqual(re, { ok: false, reason: 'outside-province:河北省' });
});

test('planSiteGeocode: qqdoc-jobs / embodied-jobs 有地址站点 → 地址 geocode query', () => {
  const plan = planSiteGeocode([QQDOC_JOBS_SAMPLE, EMBODIED_JOBS_SAMPLE]);
  assert.equal(plan.needs.length, 2);
  assert.equal(plan.alreadyLocated, 0);
  assert.equal(plan.skippedNoAddress, 0);
  const [need1, need2] = plan.needs;
  assert.equal(need1.slug, 'qqj-新东方西安学校');
  assert.equal(need1.query, '陕西省西安市碑林区南二环西段27号新东方大厦 新东方西安学校');
  assert.equal(need1.city, '西安市');
  assert.equal(need2.slug, 'embj-高仙机器人');
  assert.equal(need2.query, '上海市闵行区新虹街道申滨南路998号龙湖天街E栋8楼 高仙机器人');
  assert.equal(need2.city, '上海市');
  // 预扫口径 (脚本 planTotal 用 sitesNeedingGeocode): 三源样例全部缺坐标
  const needing = sitesNeedingGeocode([QQDOC_OFFICIAL_PENDING, QQDOC_JOBS_SAMPLE, EMBODIED_JOBS_SAMPLE]);
  assert.deepEqual(needing.map((n) => n.site.id).sort(), [
    'embj-高仙机器人-site',
    'qq-中国矿产资源集团-site-hq',
    'qqj-新东方西安学校-site',
  ]);
});
