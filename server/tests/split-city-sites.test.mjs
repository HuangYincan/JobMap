// split-city-sites:多城市字符串拆分 + 单城市无坐标补中心点(2026-08-21, boss city-split w1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cityCenter, bareCityName } from '../src/lib/city-centers.ts';
import { cityLabelMatchesCoordinates } from '../src/lib/spatial-query.ts';
import {
  fullCityName,
  patchCityCenterCoords,
  planSiteSplit,
  processCompany,
  processFile,
  remountPositions,
  siteHasCoords,
  splittableCities,
  splitCityText,
} from '../scripts/split-city-sites.mjs';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'recruitment');
const TARGET_DIRS = ['radar', 'qqdoc-jobs', 'qqdoc-official', 'official-career'];

// —— 字符串解析 ——

test('splitCityText: 分隔符 、 , ， / 空白 全部识别(含多空格)', () => {
  assert.deepEqual(splitCityText('北京、杭州、上海'), ['北京', '杭州', '上海']);
  assert.deepEqual(splitCityText('北京/上海/苏州'), ['北京', '上海', '苏州']);
  assert.deepEqual(splitCityText('上海 北京 深圳 广州'), ['上海', '北京', '深圳', '广州']);
  assert.deepEqual(splitCityText('上海  北京'), ['上海', '北京']); // 双空格
  assert.deepEqual(splitCityText('北京,上海，深圳/广州 武汉'), ['北京', '上海', '深圳', '广州', '武汉']);
});

test('splitCityText: 剔除「等/等地/等城市」尾巴与说明词', () => {
  assert.deepEqual(splitCityText('北京、杭州、上海、成都、深圳等'), ['北京', '杭州', '上海', '成都', '深圳']);
  assert.deepEqual(splitCityText('上海等地'), ['上海']);
  assert.deepEqual(splitCityText('深圳等城市'), ['深圳']);
  assert.deepEqual(splitCityText('北京 上海 广州 全国其他'), ['北京', '上海', '广州']);
  assert.deepEqual(splitCityText('上海 北京 深圳 广州 线上 远程'), ['上海', '北京', '深圳', '广州']);
  assert.deepEqual(splitCityText('海外'), []);
  assert.deepEqual(splitCityText(''), []);
  assert.deepEqual(splitCityText(undefined), []);
  assert.deepEqual(splitCityText(null), []);
});

test('splittableCities: 只保留 CITY_CENTERS 城市,去重保序,全称归一裸名', () => {
  assert.deepEqual(splittableCities('北京、杭州、上海'), ['北京', '杭州', '上海']);
  assert.deepEqual(splittableCities('上海市 深圳市'), ['上海', '深圳']);
  assert.deepEqual(splittableCities('北京 北京 上海'), ['北京', '上海']); // 去重
  // 未收录城市(三四线/海外未收录)不处理;已收录海外城市处理
  assert.deepEqual(splittableCities('哈尔滨 北京 大连 香港 泰国 新加坡'), ['哈尔滨', '北京', '大连', '新加坡']);
  assert.deepEqual(splittableCities('泰国 新加坡'), ['新加坡']);
  assert.deepEqual(splittableCities('全国其他'), []);
});

test('splittableCities: 「省+城市」连写归一后命中(广西柳州 / 河南洛阳)', () => {
  assert.deepEqual(splittableCities('广西柳州'), ['柳州']);
  assert.deepEqual(splittableCities('河南洛阳 郑州'), ['洛阳', '郑州']);
});

// —— 城市全称 ——

test('fullCityName: 裸城名 → 城市全称(与 CITY_CENTERS 键归一风格一致)', () => {
  assert.equal(fullCityName('北京'), '北京市');
  assert.equal(fullCityName('上海'), '上海市');
  assert.equal(fullCityName('重庆'), '重庆市');
  assert.equal(bareCityName(fullCityName('杭州')), '杭州'); // 归一可逆
});

// —— 多城市拆分 ——

test('planSiteSplit: 多城市字符串 → 主站点 + 每城一个站点,坐标 = cityCenter', () => {
  const site = { id: 'qqj-x-site', name: 'X公司', city: '上海 深圳 北京', province: '', location: {} };
  const plan = planSiteSplit(site, []);
  assert.ok(plan);
  assert.deepEqual(plan.main.city, '上海市');
  assert.equal(plan.main.id, 'qqj-x-site'); // 主站点 id 不变
  assert.deepEqual(plan.main.location, cityCenter('上海'));
  assert.equal(plan.splits.length, 2);
  assert.deepEqual(plan.splits[0], {
    id: 'qqj-x-site-深圳',
    name: 'X公司',
    city: '深圳市',
    location: cityCenter('深圳'),
  });
  assert.deepEqual(plan.splits[1], {
    id: 'qqj-x-site-北京',
    name: 'X公司',
    city: '北京市',
    location: cityCenter('北京'),
  });
  // 串味防御:拆出坐标必须等于 cityCenter,且命中参考框城市时通过一致性判定
  for (const s of [plan.main, ...plan.splits]) {
    assert.deepEqual(s.location, cityCenter(s.city));
    assert.ok(cityLabelMatchesCoordinates(s.city, s.location.lng, s.location.lat), `${s.city} 坐标↔标签一致`);
  }
});

test('planSiteSplit: 首个原始 token 不可归一时,主站点取第一个可归一城市(否则无坐标不可见)', () => {
  const site = { id: 's-site', name: 'S', city: '哈尔滨 北京 上海', location: {} };
  const plan = planSiteSplit(site, []);
  assert.ok(plan);
  assert.equal(plan.main.city, '哈尔滨市');
  assert.deepEqual(plan.main.location, cityCenter('哈尔滨'));
  assert.deepEqual(plan.splits.map((s) => s.city), ['北京市', '上海市']);
});

test('planSiteSplit: 已有坐标的 site 不动(幂等 + 街道级坐标优先)', () => {
  const site = { id: 's-site', name: 'S', city: '上海 北京', location: { lng: 121.2, lat: 31.1, address: '某街道' } };
  assert.equal(planSiteSplit(site, []), null);
});

test('planSiteSplit: 单城市 / 无可归一城市 / 不足两个可归一城市 → null', () => {
  assert.equal(planSiteSplit({ id: 'a', name: 'A', city: '上海市', location: {} }, []), null);
  assert.equal(planSiteSplit({ id: 'b', name: 'B', city: '泰国 新加坡', location: {} }, []), null);
  assert.equal(planSiteSplit({ id: 'c', name: 'C', city: '北京 三亚 韶关', location: {} }, []), null);
});

test('processCompany: 拆分城市 id 与公司现有 site id 撞车 → 跳过该拆分城市', () => {
  const company = {
    slug: 'collide',
    name: '撞车',
    sites: [
      { id: 'c-site', city: '上海 深圳 北京', location: {} },
      { id: 'c-site-北京', city: '北京市', location: {} }, // 已存在同 id 站点(无坐标)
    ],
    positions: [{ externalId: 'p1', siteId: 'c-site', title: '岗1' }],
  };
  const { company: next, stats } = processCompany(company);
  assert.equal(stats.multiSites, 1);
  assert.equal(stats.newSites, 1); // 北京 撞车被跳过,只拆出 深圳
  const ids = next.sites.map((s) => s.id);
  assert.ok(ids.includes('c-site-深圳'));
  assert.equal(ids.filter((id) => id === 'c-site-北京').length, 1); // 撞车 → 不创建重复站点
  assert.equal(new Set(ids).size, ids.length); // id 全局唯一
  // 撞车的现有站点 c-site-北京 走单城市补点(有中心坐标,主站点语义不丢)
  assert.ok(siteHasCoords(next.sites.find((s) => s.id === 'c-site-北京')));
});

test('planSiteSplit: 岗位按 position.city 匹配拆分城市,siteId 同步改挂;无法匹配留主站点', () => {
  const site = { id: 'qqj-x-site', name: 'X', city: '上海 深圳 北京', location: {} };
  const positions = [
    { externalId: 'p-sz', siteId: 'qqj-x-site', title: '深圳岗', city: '深圳市' },
    { externalId: 'p-bj', siteId: 'qqj-x-site', title: '北京岗', workCity: '北京' },
    { externalId: 'p-hz', siteId: 'qqj-x-site', title: '杭州岗', city: '杭州市' }, // 非拆分城市 → 不匹配
    { externalId: 'p-null', siteId: 'qqj-x-site', title: '无城市岗' },
    { externalId: 'p-other-site', siteId: 'qqj-other-site', title: '别的站点岗', city: '深圳' }, // 非本 site → 不动
  ];
  const plan = planSiteSplit(site, positions);
  assert.deepEqual(
    plan.moved.map((m) => [m.externalId, m.to]),
    [
      ['p-sz', 'qqj-x-site-深圳'],
      ['p-bj', 'qqj-x-site-北京'],
    ],
  );
  const remounted = remountPositions(positions, plan);
  assert.equal(remounted.find((p) => p.externalId === 'p-sz').siteId, 'qqj-x-site-深圳');
  assert.equal(remounted.find((p) => p.externalId === 'p-bj').siteId, 'qqj-x-site-北京');
  assert.equal(remounted.find((p) => p.externalId === 'p-hz').siteId, 'qqj-x-site'); // 留主站点
  assert.equal(remounted.find((p) => p.externalId === 'p-null').siteId, 'qqj-x-site');
  assert.equal(remounted.find((p) => p.externalId === 'p-other-site').siteId, 'qqj-other-site'); // 未动
});

// —— 单城市无坐标补中心点 ——

test('patchCityCenterCoords: 单城市无坐标 → 补 cityCenter 坐标,city 归一全称', () => {
  const patched = patchCityCenterCoords({ id: 'a-site', name: 'A', city: '上海市', location: {} });
  assert.deepEqual(patched.location, cityCenter('上海'));
  assert.equal(patched.city, '上海市');
  assert.deepEqual(patched.id, 'a-site');
  // 裸名城也归一
  assert.equal(patchCityCenterCoords({ id: 'b', name: 'B', city: '石家庄', location: {} }).city, '石家庄市');
  // 保留原有 address 文本(仅补坐标,不动其他字段)
  const withAddr = patchCityCenterCoords({ id: 'c', name: 'C', city: '广州市', location: { address: '广州' } });
  assert.deepEqual(withAddr.location, { address: '广州', ...cityCenter('广州') });
});

test('patchCityCenterCoords: 多城文本只剩一个可归一城市 → 归一城市并补点(不留多城标签)', () => {
  const patched = patchCityCenterCoords({ id: 'd', name: 'D', city: '北京 三亚 韶关', location: {} });
  assert.equal(patched.city, '北京市');
  assert.deepEqual(patched.location, cityCenter('北京'));
});

test('patchCityCenterCoords: 「省+城市」连写单城 → 归一并补点(东风柳汽场景)', () => {
  const patched = patchCityCenterCoords({ id: 'e', name: 'E', city: '广西柳州', location: {} });
  assert.equal(patched.city, '柳州市');
  assert.deepEqual(patched.location, cityCenter('柳州'));
  assert.deepEqual(patched.location, { lng: 109.41, lat: 24.32 });
});

test('patchCityCenterCoords: 未收录城市 / 已有坐标 → 原样返回(同引用)', () => {
  const unknown = { id: 'e', name: 'E', city: '三亚市', location: {} };
  assert.equal(patchCityCenterCoords(unknown), unknown);
  const located = { id: 'f', name: 'F', city: '上海市', location: { lng: 121.2, lat: 31.1 } };
  assert.equal(patchCityCenterCoords(located), located);
});

// —— 公司级处理 ——

test('processCompany: 只拆有 positions 的公司(无岗位不动)', () => {
  const company = { slug: 'x', name: 'X', sites: [{ id: 'x-site', city: '上海 北京', location: {} }], positions: [] };
  const { company: next, stats } = processCompany(company);
  assert.equal(next, company); // 同引用 = 未动
  assert.deepEqual(stats, { multiSites: 0, newSites: 0, patchedSites: 0, movedPositions: 0 });
});

test('processCompany: 混合场景 —— 多城市拆分 + 单城市补点 + 已有坐标不动', () => {
  const company = {
    slug: 'mix',
    name: '混合',
    sites: [
      { id: 'mix-site', name: '混合', city: '上海 深圳 北京', province: '', location: {} },
      { id: 'mix-site-gz', name: '混合', city: '广州市', location: { address: '广州' } },
      { id: 'mix-site-hz', name: '混合', city: '杭州市', location: { lng: 120.2, lat: 30.3 } },
    ],
    positions: [{ externalId: 'p1', siteId: 'mix-site', title: '岗1' }],
  };
  const { company: next, stats } = processCompany(company);
  assert.deepEqual(stats, { multiSites: 1, newSites: 2, patchedSites: 1, movedPositions: 0 });
  assert.deepEqual(next.sites.map((s) => s.id), [
    'mix-site',
    'mix-site-深圳',
    'mix-site-北京',
    'mix-site-gz',
    'mix-site-hz',
  ]);
  assert.deepEqual(next.sites[0].location, cityCenter('上海'));
  assert.deepEqual(next.sites[1].location, cityCenter('深圳'));
  assert.deepEqual(next.sites[3].location, { address: '广州', ...cityCenter('广州') });
  assert.deepEqual(next.sites[4].location, { lng: 120.2, lat: 30.3 }); // 已有坐标不动
  // 引用一致性:每个岗位的 siteId 都在站点 id 集合内
  const ids = new Set(next.sites.map((s) => s.id));
  for (const p of next.positions) assert.ok(ids.has(p.siteId), `${p.externalId} siteId=${p.siteId}`);
});

test('processCompany: 幂等 —— 二次运行不再拆分/补点', () => {
  const company = {
    slug: 'idem',
    name: '幂等',
    sites: [
      { id: 'idem-site', city: '上海 深圳 北京', location: {} },
      { id: 'idem-site-cd', city: '成都市', location: {} },
    ],
    positions: [{ externalId: 'p1', siteId: 'idem-site', title: '岗1' }],
  };
  const first = processCompany(company);
  assert.equal(first.stats.multiSites, 1);
  assert.equal(first.stats.patchedSites, 1);
  const second = processCompany(first.company);
  assert.deepEqual(second.stats, { multiSites: 0, newSites: 0, patchedSites: 0, movedPositions: 0 });
  assert.equal(second.company, first.company); // 无变化 → 同引用
});

// —— 真实数据冒烟(引用一致性,结构与 adapters 契约一致) ——

test('真实数据: 四目录全量跑一遍,site id 唯一 + 岗位 siteId 全部可解析(拆分后不破坏契约)', () => {
  let files = 0;
  for (const dir of TARGET_DIRS) {
    const dirPath = join(DATA_DIR, dir);
    const names = readdirSync(dirPath).filter((f) => f.endsWith('.json'));
    for (const name of names) {
      const raw = JSON.parse(readFileSync(join(dirPath, name), 'utf8'));
      const { raw: next } = processFile(raw);
      const companies = Array.isArray(next) ? next : [next];
      for (const company of companies) {
        if (!Array.isArray(company.sites) || !Array.isArray(company.positions)) continue;
        const ids = new Set();
        for (const site of company.sites) {
          assert.ok(!ids.has(site.id), `${company.slug} duplicate site id ${site.id}`);
          ids.add(site.id);
        }
        for (const pos of company.positions) {
          assert.ok(ids.has(pos.siteId), `${company.slug} ${pos.externalId} siteId ${pos.siteId} 不可解析`);
        }
      }
      files += 1;
    }
  }
  assert.ok(files >= 1000, `至少扫描全部 drop 文件(实际 ${files})`);
});

test('真实数据: qqj-临界点(上海 深圳 北京,100 岗)拆分后主站点补点、岗位仍可解析、二次运行幂等', () => {
  const raw = JSON.parse(
    readFileSync(join(DATA_DIR, 'qqdoc-jobs', 'qqj-临界点.json'), 'utf8'),
  );
  // 数据已应用拆分(主站点单城 + 中心坐标,拆出城市站点)—— 断言最终状态
  const main = raw.sites.find((s) => s.id === 'qqj-临界点-site');
  assert.equal(main.city, '上海市');
  // 2026-08-22 地址回填 (e506c4d): 主站点坐标之上叠加回填 address (街道级), 坐标仍等于 cityCenter;
  // 2026-08-22 geocode r4 (3e6deb3): 主站点坐标重跑解析到真实办公点
  // (上海市徐汇区天平路185号11层1107室 → 121.439346/31.197401, 徐汇区地理范围 ~121.44/31.20),
  // 不再等于 cityCenter('上海') 121.47/31.23 —— 期望对齐 r4 实际坐标 (实测值, 见数据文件)
  assert.deepEqual(main.location, { lng: 121.439346, lat: 31.197401, address: '上海市徐汇区天平路185号11层1107室' });
  assert.ok(siteHasCoords(main));
  const splits = raw.sites.filter((s) => s.id.startsWith('qqj-临界点-site-'));
  assert.deepEqual(
    splits.map((s) => [s.city, s.location]),
    [
      ['深圳市', cityCenter('深圳')],
      ['北京市', cityCenter('北京')],
    ],
  );
  const ids = new Set(raw.sites.map((s) => s.id));
  assert.equal(ids.size, raw.sites.length); // site id 唯一
  for (const p of raw.positions) assert.ok(ids.has(p.siteId), `${p.externalId} siteId 可解析`);
  // 幂等:已拆分数据再跑一遍 → 零改动
  const { stats, company } = processCompany(raw);
  assert.deepEqual(stats, { multiSites: 0, newSites: 0, patchedSites: 0, movedPositions: 0 });
  assert.equal(company, raw);
});
