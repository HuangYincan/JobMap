import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  gradeOfficePoi,
  pickBestOfficePoi,
  placeSearchMemoFile,
  placeSearchMemoKey,
  placeSearchMemoSet,
  placeTextSearchRest,
} from '../src/lib/site-geocode.ts';

// 2026-08-21 (fix/geocode-place-memo): AMap place-text 免费配额 100 次/天, 而
// 同一公司同一城市的多个 office 站点 (安克创新 38 站 / 元气森林 71 站 /
// 小鹏 52 站) 用相同 query+region 逐站重复调用 place-text 是结构性浪费。
// memo 按 (query, province, city) 只缓存成功命中; 失败/空结果/配额类失败绝不
// 缓存 — 配额恢复后必须重新尝试, 缓存旧失败会永久卡死站点。

const TARGET_SH = { city: '上海市', province: '上海市' };
const TARGET_HZ = { city: '杭州市', province: '浙江省' };
const TARGET_SZ = { city: '深圳市', province: '广东省' };

/** 通过 grader 的上海市 POI (query='得物' 时 strong 命中 + street 地址).
 * 注意 location 必须是 AMap 的 "lng,lat" 字符串 — parseOfficePoi 只认这个形态. */
const SH_POI = {
  name: '得物',
  address: '徐汇区宜山路1号',
  location: '121.512,31.272',
  type: '公司企业',
  adname: '徐汇区',
  pname: '上海市',
  cityname: '上海市',
};

// --- key 精确性 (不同 region 不串) ---------------------------------------------

test('placeSearchMemoKey: 同 query+同城市 → 同 key', () => {
  assert.equal(placeSearchMemoKey('安克创新', TARGET_HZ), placeSearchMemoKey('安克创新', TARGET_HZ));
});

test('placeSearchMemoKey: 同 query 不同城市 → 不同 key (不串)', () => {
  assert.notEqual(placeSearchMemoKey('安克创新', TARGET_HZ), placeSearchMemoKey('安克创新', TARGET_SZ));
});

test('placeSearchMemoKey: 不同 query 同城市 → 不同 key', () => {
  assert.notEqual(placeSearchMemoKey('安克创新', TARGET_HZ), placeSearchMemoKey('元气森林', TARGET_HZ));
});

test('placeSearchMemoKey: province 也参与 key — 同城不同省不串', () => {
  const wrongProvince = { city: '杭州市', province: '广东省' };
  assert.notEqual(placeSearchMemoKey('安克创新', TARGET_HZ), placeSearchMemoKey('安克创新', wrongProvince));
});

test('placeSearchMemoKey delimits fields without source-hostile control bytes', () => {
  const key = placeSearchMemoKey('a\tb\nc', { province: 'p|q', city: 'c|r' });
  assert.equal(key, JSON.stringify(['a\tb\nc', 'p|q', 'c|r']));
  assert.doesNotMatch(key, /[\0\r\n]/);
  assert.notEqual(
    placeSearchMemoKey('a', { province: 'p', city: 'c' }),
    placeSearchMemoKey('a', { province: 'p\rc', city: '' }),
  );
});

// --- 写策略: 只缓存成功命中 -----------------------------------------------------

test('placeSearchMemoSet: 成功命中 (poi 非空) 才入 memo', () => {
  const memo = new Map();
  placeSearchMemoSet(memo, 'k', { poi: SH_POI, confidence: 'high', reason: 'matched:得物', provider: 'amap' });
  assert.equal(memo.size, 1);
  assert.equal(memo.get('k').poi.name, '得物');
  assert.equal(memo.get('k').provider, 'amap');
});

test('placeSearchMemoSet: 失败/空结果/配额类失败绝不缓存', () => {
  const memo = new Map();
  placeSearchMemoSet(memo, 'k1', { poi: null, confidence: null, reason: 'no-pois', provider: 'amap' });
  placeSearchMemoSet(memo, 'k2', { poi: null, confidence: null, reason: 'quota', provider: 'amap' });
  placeSearchMemoSet(memo, 'k3', { poi: null, confidence: null, reason: 'baidu-status:302', provider: 'baidu' });
  placeSearchMemoSet(memo, 'k4', { poi: null, confidence: null, reason: 'no-key', provider: 'amap' });
  placeSearchMemoSet(memo, 'k5', { poi: null, confidence: null, reason: 'http', provider: 'amap' });
  placeSearchMemoSet(memo, 'k6', { poi: null, confidence: null, reason: 'empty', provider: 'amap' });
  placeSearchMemoSet(memo, 'k7', null);
  placeSearchMemoSet(memo, 'k8', undefined);
  assert.equal(memo.size, 0);
});

test('placeSearchMemoSet: 低置信度 (grader 拒收 → poi null) 不缓存', () => {
  const memo = new Map();
  // gradeOfficePoi low (pname 省份不符) → picked 被拒 → out.poi = null
  const out = { poi: null, confidence: 'low', reason: 'outside-province:北京市', provider: 'amap' };
  placeSearchMemoSet(memo, 'k', out);
  assert.equal(memo.size, 0);
});

// --- 全流程: 镜像 searchCompanyPoi 的 memo 流程 (真实 placeTextSearchRest +
// fetch stub 计数) — 契约测试锁定脚本接线, 这里跑真实策略 + 真实 grader. ---------

/** 镜像 scripts/geocode-sites-apply.mjs searchCompanyPoi 的 memo 流程. */
function makeMemoizedSearch(memo, fetchImpl) {
  return async function search(query, target) {
    const key = placeSearchMemoKey(query, target);
    const cached = memo.get(key);
    if (cached) return cached;
    const hit = await placeTextSearchRest(query, target.city, fetchImpl);
    const out = { poi: null, confidence: null, reason: '', provider: 'amap' };
    if (hit.ok && hit.pois.length) {
      const picked = pickBestOfficePoi(hit.pois, query, target.province, target.city);
      if (picked) {
        const grade = gradeOfficePoi(picked, query, target.province, target.city);
        out.poi = grade.confidence === 'low' ? null : picked;
        out.confidence = grade.confidence;
        out.reason = grade.reason;
      }
    } else {
      out.reason = hit.reason ?? 'no-pois';
    }
    if (hit.provider) out.provider = hit.provider;
    placeSearchMemoSet(memo, key, out);
    return out;
  };
}

test('memo 流程: 同 query+region 第二次不发出请求; 不同 region 各自请求', async () => {
  const requestedCities = [];
  const fetchImpl = async (input) => {
    const city = new URL(String(input)).searchParams.get('city') ?? '';
    requestedCities.push(city);
    const beijing = city === '北京市';
    return {
      ok: true,
      json: async () => ({
        status: '1',
        pois: [
          beijing
            ? { ...SH_POI, address: '朝阳区望京街1号', location: '116.48,39.99', adname: '朝阳区', pname: '北京市', cityname: '北京市' }
            : SH_POI,
        ],
      }),
    };
  };
  const prev = process.env.AMAP_WEB_KEY;
  process.env.AMAP_WEB_KEY = 'test-web-key';
  try {
    const memo = new Map();
    const search = makeMemoizedSearch(memo, fetchImpl);

    const r1 = await search('得物', TARGET_SH);
    assert.equal(r1.poi.name, '得物');
    assert.deepEqual(requestedCities, ['上海市']);

    // 第二次同 query+region → memo 命中, 零网络请求
    const r2 = await search('得物', TARGET_SH);
    assert.equal(r2.poi.lng, r1.poi.lng);
    assert.deepEqual(requestedCities, ['上海市']);

    // 不同城市 → 不同 key, 各自请求 (不串)
    const r3 = await search('得物', { city: '北京市', province: '北京市' });
    assert.equal(r3.poi.lng, 116.48);
    assert.deepEqual(requestedCities, ['上海市', '北京市']);
  } finally {
    if (prev == null) delete process.env.AMAP_WEB_KEY;
    else process.env.AMAP_WEB_KEY = prev;
  }
});

test('memo 流程: 失败/空结果/配额类失败不缓存 — 同 query 第二次仍重新请求', async () => {
  let payload = { status: '1', pois: [] }; // 空结果
  const requested = [];
  const fetchImpl = async (input) => {
    requested.push(String(input));
    return { ok: true, json: async () => payload };
  };
  const prev = process.env.AMAP_WEB_KEY;
  process.env.AMAP_WEB_KEY = 'test-web-key';
  try {
    const memo = new Map();
    const search = makeMemoizedSearch(memo, fetchImpl);

    // 空结果 (no-pois): 不缓存 → 第二次重新请求
    const r1 = await search('得物', TARGET_SH);
    assert.equal(r1.poi, null);
    assert.equal(r1.reason, 'no-pois');
    assert.equal(requested.length, 1);
    const r2 = await search('得物', TARGET_SH);
    assert.equal(r2.poi, null);
    assert.equal(requested.length, 2);
    assert.equal(memo.size, 0);

    // 配额类失败 (AMap 10044): 不缓存 → 下次运行/站点仍会重试
    payload = { status: '0', info: 'USER_DAILY_QUERY_OVER_LIMIT', infocode: '10044' };
    const r3 = await search('得物', TARGET_SH);
    assert.equal(r3.poi, null);
    assert.equal(r3.reason, 'quota');
    assert.equal(requested.length, 3);
    const r4 = await search('得物', TARGET_SH);
    assert.equal(r4.poi, null);
    assert.equal(requested.length, 4);
    assert.equal(memo.size, 0);
  } finally {
    if (prev == null) delete process.env.AMAP_WEB_KEY;
    else process.env.AMAP_WEB_KEY = prev;
  }
});

// --- 脚本接线 (契约测试, 对齐 geocode-quota-short-circuit.test.mjs) ------------

test('geocode-sites-apply.mjs 接线: searchCompanyPoi 按 (query, province, city) memo 成功命中', () => {
  const script = readFileSync(new URL('../scripts/geocode-sites-apply.mjs', import.meta.url), 'utf8');
  // memo 容器 + key 精确到 query+target (城市不同不串); 2026-08-25
  // (fix/site-place-search): place-search 模式 memo 键加 "ps:" 前缀 —
  // 同一 query+城市 占位站 (pickPlaceSearchPoi 选点) 与地址 geocode 站
  // (pickBestOfficePoi 选点) 不串; base key 仍是 query+target。
  assert.match(script, /const placeSearchMemo = new Map\(\)/);
  assert.match(script, /const memoKey = placeSearchMode \? `ps:\$\{placeSearchMemoKey\(query, target\)\}` : placeSearchMemoKey\(query, target\)/);
  // 命中优先: memo get 在 place-text 请求之前 → 同 query+region 第二次零请求
  const getIdx = script.indexOf('placeSearchMemo.get(memoKey)');
  const fetchIdx = script.indexOf('placeTextSearchRest(query, target.city)');
  assert.ok(getIdx !== -1 && fetchIdx !== -1, 'memo get 与 place-text 请求都必须在 searchCompanyPoi 内');
  assert.ok(getIdx < fetchIdx, 'memo get 必须先于 place-text 请求 (第二次不发出请求)');
  // 失败分支 (else) 不写 memo; 解析完成后才统一经 placeSearchMemoSet 写 (poi 非空才入)
  const elseIdx = script.indexOf("out.reason = hit.reason ?? 'no-pois'");
  const setIdx = script.indexOf('placeSearchMemoSet(placeSearchMemo, memoKey, out)');
  assert.ok(elseIdx !== -1 && setIdx !== -1, '失败分支与 memo 写入点都必须在 searchCompanyPoi 内');
  assert.ok(setIdx > elseIdx, 'memo 写入必须发生在解析完成之后 (只缓存成功命中)');
});

// --- 持久化默认路径 (bundle 安全, 2026-08-25 fix/geocode-persist-memo 回归) ----

test('placeSearchMemoFile: 默认路径 = cwd/.geocode-memo.json (调用期求值, 无顶层资产解析)', () => {
  // 顶层 new URL(相对路径, import.meta.url) 会被 Turbopack 当资产引用静态解析,
  // .geocode-memo.json 已 gitignore → CI checkout 无此文件 → next build 失败。
  // 修复后路径调用期求值: cwd 契约 = server/ (npm scripts / next dev|start)。
  assert.equal(placeSearchMemoFile(), join(process.cwd(), '.geocode-memo.json'));
});
