import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  addresslessQueryVariants,
  backfillAddressFromRegeo,
  baiduRegeoCityRest,
  gradeVariantHit,
  pickBestOfficePoi,
  placeSearchMemoKey,
  placeSearchMemoSet,
  placeTextSearchRest,
  poiAddressUsable,
  regeoCityRest,
  tencentRegeoCityRest,
} from '../src/lib/site-geocode.ts';

// 2026-08-21 (fix/geocode-address-first): 只带城市无地址的站点把网络检索当首要
// 通道 — 先精确候选「公司名 站点名」(网易 杭州研究院), 未命中/地址缺失回落
// 宽候选 (裸公司名, 既有行为)。每站点 place-text ≤ 2 次; memo 按变体 key 独立
// 缓存成功命中。命中 POI 地址缺失/过短 → 宽候选补查 + regeo 格式化地址兜底
// (零额外配额), 补查成功重评分可写回, 失败保持 medium 不写回。

const TARGET_HZ = { city: '杭州市', province: '浙江省' };
const TARGET_SH = { city: '上海市', province: '上海市' };

/** AMap 形态 POI (location 必须是 "lng,lat" 字符串 — parseOfficePoi 只认这个形态). */
const INSTITUTE = {
  name: '网易杭州研究院',
  address: '滨江区网商路599号',
  location: '120.19,30.19',
  type: '公司企业',
  adname: '滨江区',
  pname: '浙江省',
  cityname: '杭州市',
};
const HQ = { ...INSTITUTE, name: '网易大厦', address: '西湖区文一西路969号', location: '120.13,30.26', adname: '西湖区' };

// --- 变体生成: 顺序与去重 ------------------------------------------------

test('addresslessQueryVariants: 站点名存在 → [精确, 宽], 顺序精确在前, gradeName 都是公司名', () => {
  const variants = addresslessQueryVariants('网易', '杭州研究院', TARGET_HZ);
  assert.deepEqual(
    variants.map((v) => [v.kind, v.searchQuery, v.gradeName]),
    [
      ['precise', '网易 杭州研究院', '网易'],
      ['broad', '网易', '网易'],
    ],
  );
});

test('addresslessQueryVariants: 站点名 = 公司名 / 空 / 只是城市名 → 只留宽候选', () => {
  const only = (name) => addresslessQueryVariants('网易', name, TARGET_HZ).map((v) => v.kind);
  assert.deepEqual(only('网易'), ['broad']); // 站点名 = 公司名 → 精确=宽, 去重
  assert.deepEqual(only('  '), ['broad']);
  assert.deepEqual(only(''), ['broad']);
  assert.deepEqual(only(null), ['broad']);
  assert.deepEqual(only(undefined), ['broad']);
  // 站点名只是城市名 → 无定位信息, 跳过精确
  assert.deepEqual(only('杭州'), ['broad']);
  assert.deepEqual(only('杭州市'), ['broad']);
  assert.deepEqual(only('北京市'), ['broad']); // 其他城市名同样跳过
});

test('addresslessQueryVariants: 站点名含公司名 → 直接以站点名检索 (更精确)', () => {
  const variants = addresslessQueryVariants('网易', '网易杭州研究院', TARGET_HZ);
  assert.deepEqual(
    variants.map((v) => [v.kind, v.searchQuery]),
    [
      ['precise', '网易杭州研究院'],
      ['broad', '网易'],
    ],
  );
});

test('memo key: 不同变体 (精确/宽) 不同 key; 同 query+region 同 key', () => {
  const precise = placeSearchMemoKey('网易 杭州研究院', TARGET_HZ);
  const broad = placeSearchMemoKey('网易', TARGET_HZ);
  assert.notEqual(precise, broad, '不同变体不同 key, 不串');
  assert.equal(precise, placeSearchMemoKey('网易 杭州研究院', TARGET_HZ));
  assert.equal(broad, placeSearchMemoKey('网易', TARGET_HZ));
  assert.notEqual(placeSearchMemoKey('网易', TARGET_HZ), placeSearchMemoKey('网易', TARGET_SH));
});

// --- 地址可用性判定 --------------------------------------------------------

test('poiAddressUsable: 空串/仅区名 → false (触发补查); 街道/门牌 → true', () => {
  assert.equal(poiAddressUsable(''), false);
  assert.equal(poiAddressUsable('   '), false);
  assert.equal(poiAddressUsable('滨江区'), false); // 仅区名
  assert.equal(poiAddressUsable('文一西路969号'), true);
  assert.equal(poiAddressUsable('黄兴路221号'), true);
  assert.equal(poiAddressUsable('望京东路6号'), true);
});

// --- 两级评分 (精确候选整名命中) -------------------------------------------

test('gradeVariantHit: 精确候选按完整检索串评分, 通用形态回落公司名, 陷阱两级都拒', () => {
  const institute = { ...INSTITUTE };
  const hq = { ...HQ };
  const trap = { ...INSTITUTE, name: '杭州网易严选贸易有限公司', address: '解放路88号' };
  // 完整名 POI (网易杭州研究院) → 按完整检索串命中 → high
  assert.equal(gradeVariantHit(institute, '网易 杭州研究院', '网易', '浙江省', '杭州市').confidence, 'high');
  // 通用形态 (网易大厦) → 完整串 low → 回落公司名 → high
  assert.equal(gradeVariantHit(hq, '网易 杭州研究院', '网易', '浙江省', '杭州市').confidence, 'high');
  // 同品牌陷阱 → 两级都拒 → low (name-match 闸门不绕过)
  assert.equal(gradeVariantHit(trap, '网易 杭州研究院', '网易', '浙江省', '杭州市').confidence, 'low');
  // searchQuery === gradeName → 单一评分 (宽候选/既有调用行为不变): 通用形态
  // POI 照常命中。2026-08-22 (fix/geocode-grader-relax) 后整名 POI 的
  // 「杭州研究院」后缀 (城市+限定词复合序列) 也被裸公司名单级评分接受 → high
  // (放宽目标: 真实办公室不再因复合限定词被拒); 两级评分的动机保留 — 含非限定
  // 词段的全名 POI (杭州网易严选贸易) 仍两级都拒 (name-match 闸门不绕过).
  assert.equal(gradeVariantHit(hq, '网易', '网易', '浙江省', '杭州市').confidence, 'high');
  assert.equal(gradeVariantHit(institute, '网易', '网易', '浙江省', '杭州市').confidence, 'high');
  assert.equal(gradeVariantHit(trap, '网易', '网易', '浙江省', '杭州市').confidence, 'low');
});

test('pickBestOfficePoi: 精确候选 searchQuery 参与内部评分 (完整名 POI 不被误拒)', () => {
  // 旧签名 (searchQuery 缺省 = companyName): 2026-08-22 (fix/geocode-grader-relax)
  // 后「杭州研究院」后缀 (城市+限定词复合) 被裸公司名接受 → 完整名 POI 直接命中;
  // 精确检索串两级评分路径仍在 (更完整名的 POI 见 gradeVariantHit 陷阱组).
  const picked = pickBestOfficePoi([{ ...INSTITUTE }], '网易', '浙江省', '杭州市');
  assert.equal(picked?.name, '网易杭州研究院');
  // 新签名 (传入精确检索串): 完整名 POI 同样命中
  const pickedPrecise = pickBestOfficePoi([{ ...INSTITUTE }], '网易', '浙江省', '杭州市', '网易 杭州研究院');
  assert.equal(pickedPrecise?.name, '网易杭州研究院');
});

// --- regeo 格式化地址兜底补查 ----------------------------------------------

test('backfillAddressFromRegeo: 地址缺失 → 格式化地址补全 + 重评分 high; 不突变原对象', () => {
  const noStreet = { ...INSTITUTE, address: '' };
  // 精确候选命中 (整名 POI 网易杭州研究院): 补查重评分必须用同一口径 (searchQuery
  // 两级评分) — 否则裸公司名会把 杭州研究院 后缀误判 name-mismatch.
  const bf = backfillAddressFromRegeo(noStreet, '浙江省杭州市滨江区网商路599号', '网易', TARGET_HZ, '网易 杭州研究院');
  assert.ok(bf);
  assert.equal(bf.poi.address, '浙江省杭州市滨江区网商路599号');
  assert.equal(bf.confidence, 'high'); // name-match-no-street medium → high, 可写回
  assert.equal(noStreet.address, '', '返回拷贝, 不突变 memo 缓存里的 POI');
  // 宽候选 (searchQuery 缺省 = 公司名, 单级评分): 通用形态 POI 同样升级
  const hqNoStreet = { ...HQ, address: '西湖区' };
  const bfHq = backfillAddressFromRegeo(hqNoStreet, '浙江省杭州市西湖区文一西路969号', '网易', TARGET_HZ);
  assert.equal(bfHq?.confidence, 'high');
  assert.equal(bfHq?.poi.address, '浙江省杭州市西湖区文一西路969号');
});

test('backfillAddressFromRegeo: 已有街道地址 / 无格式化地址 → 不补查 (null)', () => {
  const withStreet = { ...INSTITUTE, address: '网商路599号' };
  assert.equal(backfillAddressFromRegeo(withStreet, '浙江省杭州市滨江区网商路599号', '网易', TARGET_HZ), null);
  assert.equal(backfillAddressFromRegeo({ ...INSTITUTE, address: '' }, '', '网易', TARGET_HZ), null);
  assert.equal(backfillAddressFromRegeo({ ...INSTITUTE, address: '' }, undefined, '网易', TARGET_HZ), null);
  assert.equal(backfillAddressFromRegeo({ ...INSTITUTE, address: '' }, '   ', '网易', TARGET_HZ), null);
});

test('backfillAddressFromRegeo: 补查后名字仍不匹配 → low (低置信不写回)', () => {
  const trap = { ...INSTITUTE, name: '杭州网易严选贸易有限公司', address: '' };
  const bf = backfillAddressFromRegeo(trap, '浙江省杭州市滨江区网商路599号', '网易', TARGET_HZ);
  assert.equal(bf?.confidence, 'low');
});

test('regeo 三 provider 都带格式化地址 (补查来源)', async () => {
  const prev = process.env.AMAP_WEB_KEY;
  process.env.AMAP_WEB_KEY = 'test-web-key';
  try {
    const re = await regeoCityRest(120.19, 30.19, async () => ({
      ok: true,
      json: async () => ({
        status: '1',
        regeocode: {
          addressComponent: { province: '浙江省', city: '杭州市', district: '滨江区' },
          formatted_address: '浙江省杭州市滨江区网商路599号',
        },
      }),
    }));
    assert.equal(re.formattedAddress, '浙江省杭州市滨江区网商路599号');
    // 无 formatted_address → undefined (兼容旧响应)
    const re2 = await regeoCityRest(120.19, 30.19, async () => ({
      ok: true,
      json: async () => ({ status: '1', regeocode: { addressComponent: { province: '浙江省' } } }),
    }));
    assert.equal(re2.formattedAddress, undefined);
  } finally {
    if (prev == null) delete process.env.AMAP_WEB_KEY;
    else process.env.AMAP_WEB_KEY = prev;
  }
  const prevBaidu = process.env.BAIDU_MAP_AK;
  process.env.BAIDU_MAP_AK = 'test-baidu-ak';
  try {
    const re = await baiduRegeoCityRest(120.19, 30.19, async () => ({
      ok: true,
      json: async () => ({ status: 0, result: { addressComponent: { province: '浙江省', city: '杭州市', district: '滨江区' }, formatted_address: '滨江区网商路599号' } }),
    }));
    assert.equal(re.formattedAddress, '滨江区网商路599号');
  } finally {
    if (prevBaidu == null) delete process.env.BAIDU_MAP_AK;
    else process.env.BAIDU_MAP_AK = prevBaidu;
  }
  const prevTencent = process.env.TENCENT_MAP_KEY;
  process.env.TENCENT_MAP_KEY = 'test-tencent-key';
  try {
    const re = await tencentRegeoCityRest(120.19, 30.19, async () => ({
      ok: true,
      json: async () => ({ status: 0, result: { ad_info: { province: '浙江省', city: '杭州市', district: '滨江区' }, address: '浙江省杭州市滨江区网商路599号' } }),
    }));
    assert.equal(re.formattedAddress, '浙江省杭州市滨江区网商路599号');
  } finally {
    if (prevTencent == null) delete process.env.TENCENT_MAP_KEY;
    else process.env.TENCENT_MAP_KEY = prevTencent;
  }
});

// --- 全流程: 镜像脚本的变体链 (真实 placeTextSearchRest + fetch stub 计数) ----

/**
 * 镜像 scripts/geocode-sites-apply.mjs 的 searchCompanyPoi + searchCompanyPoiVariants
 * (memo + 两级评分 + 变体链), 用 fetch stub 计数请求 — 契约测试锁定脚本接线。
 */
function makeVariantSearch(memo, fetchImpl) {
  async function searchPoi(query, target, gradeName = query) {
    const key = placeSearchMemoKey(query, target);
    const cached = memo.get(key);
    if (cached) return cached;
    const hit = await placeTextSearchRest(query, target.city, fetchImpl);
    const out = { poi: null, confidence: null, reason: '', provider: 'amap' };
    if (hit.ok && hit.pois.length) {
      const picked = pickBestOfficePoi(hit.pois, gradeName, target.province, target.city, query);
      if (picked) {
        const grade = gradeVariantHit(picked, query, gradeName, target.province, target.city);
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
  }
  async function searchVariants(query, target, siteName) {
    const variants = addresslessQueryVariants(query, siteName, target);
    let firstHit = null;
    let lastMiss = null;
    for (const v of variants) {
      const res = await searchPoi(v.searchQuery, target, v.gradeName);
      const tagged = { ...res, variant: v.kind, searchQuery: v.searchQuery };
      if (!res.poi) {
        lastMiss = tagged;
        continue;
      }
      if (poiAddressUsable(res.poi.address)) return tagged;
      if (!firstHit) firstHit = tagged;
    }
    if (firstHit) return firstHit;
    return lastMiss ?? { poi: null, confidence: null, reason: 'no-pois', provider: 'amap' };
  }
  return { searchVariants };
}

/** AMap place-text stub: 按 keywords 路由到预设响应, 记录请求序列. */
function makeFetchStub(routes) {
  const requests = [];
  const fetchImpl = async (input) => {
    const keywords = new URL(String(input)).searchParams.get('keywords') ?? '';
    requests.push(keywords);
    return { ok: true, json: async () => routes[keywords] ?? { status: '1', pois: [] } };
  };
  return { requests, fetchImpl };
}

const EMPTY = { status: '1', pois: [] };

test('变体链: 精确命中且地址可用 → 1 次请求, variant=precise', async () => {
  const { requests, fetchImpl } = makeFetchStub({ '网易 杭州研究院': { status: '1', pois: [INSTITUTE] } });
  const prev = process.env.AMAP_WEB_KEY;
  process.env.AMAP_WEB_KEY = 'test-web-key';
  try {
    const { searchVariants } = makeVariantSearch(new Map(), fetchImpl);
    const res = await searchVariants('网易', TARGET_HZ, '杭州研究院');
    assert.equal(res.poi.name, '网易杭州研究院');
    assert.equal(res.confidence, 'high');
    assert.equal(res.variant, 'precise');
    assert.deepEqual(requests, ['网易 杭州研究院']); // 精确命中即收, 不烧宽候选
  } finally {
    if (prev == null) delete process.env.AMAP_WEB_KEY;
    else process.env.AMAP_WEB_KEY = prev;
  }
});

test('变体链: 精确候选未命中 → 回落宽候选 (2 次请求, variant=broad)', async () => {
  const { requests, fetchImpl } = makeFetchStub({ '网易': { status: '1', pois: [HQ] } });
  const prev = process.env.AMAP_WEB_KEY;
  process.env.AMAP_WEB_KEY = 'test-web-key';
  try {
    const { searchVariants } = makeVariantSearch(new Map(), fetchImpl);
    const res = await searchVariants('网易', TARGET_HZ, '杭州研究院');
    assert.equal(res.variant, 'broad');
    assert.equal(res.poi.name, '网易大厦');
    assert.deepEqual(requests, ['网易 杭州研究院', '网易']);
  } finally {
    if (prev == null) delete process.env.AMAP_WEB_KEY;
    else process.env.AMAP_WEB_KEY = prev;
  }
});

test('变体链: 精确命中但地址缺失 → 宽候选补查; 补查仍缺 → 保留第一个命中 (medium 不写回)', async () => {
  const noStreetInstitute = { ...INSTITUTE, address: '滨江区' }; // 仅区名
  const noStreetHq = { ...HQ, address: '西湖区' };
  const { requests, fetchImpl } = makeFetchStub({
    '网易 杭州研究院': { status: '1', pois: [noStreetInstitute] },
    '网易': { status: '1', pois: [noStreetHq] },
  });
  const prev = process.env.AMAP_WEB_KEY;
  process.env.AMAP_WEB_KEY = 'test-web-key';
  try {
    const { searchVariants } = makeVariantSearch(new Map(), fetchImpl);
    const res = await searchVariants('网易', TARGET_HZ, '杭州研究院');
    assert.deepEqual(requests, ['网易 杭州研究院', '网易']); // 补查触发
    assert.equal(res.variant, 'precise'); // 补查失败 → 保留第一个命中
    assert.equal(res.poi.name, '网易杭州研究院');
    assert.equal(res.confidence, 'medium'); // name-match-no-street
    // 写回闸门 (镜像脚本): medium 不写回
    assert.equal(res.confidence === 'high', false);
  } finally {
    if (prev == null) delete process.env.AMAP_WEB_KEY;
    else process.env.AMAP_WEB_KEY = prev;
  }
});

test('变体链: 补查后地址可用 → 宽候选命中收下 (地址+坐标齐)', async () => {
  const noStreetInstitute = { ...INSTITUTE, address: '' }; // 空地址
  const { requests, fetchImpl } = makeFetchStub({
    '网易 杭州研究院': { status: '1', pois: [noStreetInstitute] },
    '网易': { status: '1', pois: [HQ] },
  });
  const prev = process.env.AMAP_WEB_KEY;
  process.env.AMAP_WEB_KEY = 'test-web-key';
  try {
    const { searchVariants } = makeVariantSearch(new Map(), fetchImpl);
    const res = await searchVariants('网易', TARGET_HZ, '杭州研究院');
    assert.deepEqual(requests, ['网易 杭州研究院', '网易']);
    assert.equal(res.variant, 'broad');
    assert.equal(res.poi.address, '西湖区文一西路969号');
    assert.equal(res.confidence, 'high');
  } finally {
    if (prev == null) delete process.env.AMAP_WEB_KEY;
    else process.env.AMAP_WEB_KEY = prev;
  }
});

test('变体链: memo 按变体 key 独立 — 同 query+region 第二次零请求, 不同变体各自请求', async () => {
  const { requests, fetchImpl } = makeFetchStub({
    '网易': { status: '1', pois: [HQ] },
    '网易 研究院': EMPTY,
  });
  const prev = process.env.AMAP_WEB_KEY;
  process.env.AMAP_WEB_KEY = 'test-web-key';
  try {
    const memo = new Map();
    const { searchVariants } = makeVariantSearch(memo, fetchImpl);
    // 站点名 = 公司名 → 只宽候选 → 缓存 broad key
    const r0 = await searchVariants('网易', TARGET_HZ, '网易');
    assert.equal(r0.variant, 'broad');
    assert.deepEqual(requests, ['网易']);
    // 第二个站点: 精确变体是新 key → 发请求; 宽变体 memo 命中 → 零请求
    const r1 = await searchVariants('网易', TARGET_HZ, '研究院');
    assert.equal(r1.variant, 'broad');
    assert.equal(r1.poi.name, '网易大厦');
    assert.deepEqual(requests, ['网易', '网易 研究院']); // broad 第二次零请求
    assert.equal(memo.has(placeSearchMemoKey('网易', TARGET_HZ)), true);
    assert.equal(memo.has(placeSearchMemoKey('网易 研究院', TARGET_HZ)), false); // 失败变体不缓存
  } finally {
    if (prev == null) delete process.env.AMAP_WEB_KEY;
    else process.env.AMAP_WEB_KEY = prev;
  }
});

test('变体链: 全 miss → 最后变体 reason (no-pois), 失败不缓存', async () => {
  const { requests, fetchImpl } = makeFetchStub({});
  const prev = process.env.AMAP_WEB_KEY;
  process.env.AMAP_WEB_KEY = 'test-web-key';
  try {
    const memo = new Map();
    const { searchVariants } = makeVariantSearch(memo, fetchImpl);
    const res = await searchVariants('网易', TARGET_HZ, '研究院');
    assert.equal(res.poi, null);
    assert.equal(res.reason, 'no-pois');
    assert.deepEqual(requests, ['网易 研究院', '网易']);
    assert.equal(memo.size, 0, '失败/空结果绝不缓存 (配额恢复后必须重试)');
  } finally {
    if (prev == null) delete process.env.AMAP_WEB_KEY;
    else process.env.AMAP_WEB_KEY = prev;
  }
});

test('变体链: 配额类失败原样传播 (quota) — 配额短路不被绕过', async () => {
  const { requests, fetchImpl } = makeFetchStub({});
  const quotaFetch = async (input) => {
    requests.push(String(input));
    return { ok: true, json: async () => ({ status: '0', info: 'USER_DAILY_QUERY_OVER_LIMIT', infocode: '10044' }) };
  };
  const prev = process.env.AMAP_WEB_KEY;
  process.env.AMAP_WEB_KEY = 'test-web-key';
  try {
    const memo = new Map();
    const { searchVariants } = makeVariantSearch(memo, quotaFetch);
    const res = await searchVariants('网易', TARGET_HZ, '杭州研究院');
    assert.equal(res.poi, null);
    assert.equal(res.reason, 'quota');
    assert.equal(requests.length, 2); // 精确 + 宽都尝试 (均为配额失败)
    assert.equal(memo.size, 0, '配额类失败不缓存');
  } finally {
    if (prev == null) delete process.env.AMAP_WEB_KEY;
    else process.env.AMAP_WEB_KEY = prev;
  }
});

test('写回保障: 补查成功 → address 到 location.address (镜像脚本写回路径)', async () => {
  // 脚本路径: variant 链命中 medium (无街道) → regeo 格式化地址补查 → 重评分 high
  // → 写回 { address, lng, lat }。镜像关键一步: backfill 结果进入写回闸门。
  const noStreetInstitute = { ...INSTITUTE, address: '滨江区' };
  const { requests, fetchImpl } = makeFetchStub({ '网易 杭州研究院': { status: '1', pois: [noStreetInstitute] } });
  const prev = process.env.AMAP_WEB_KEY;
  process.env.AMAP_WEB_KEY = 'test-web-key';
  try {
    const { searchVariants } = makeVariantSearch(new Map(), fetchImpl);
    const res = await searchVariants('网易', TARGET_HZ, '杭州研究院');
    assert.equal(res.confidence, 'medium');
    assert.equal(res.searchQuery, '网易 杭州研究院'); // 变体检索串透出, 供补查同口径评分
    // 脚本主循环: backfillAddressFromRegeo(poi, finalRe.formattedAddress, query, target, variantQuery)
    const bf = backfillAddressFromRegeo(res.poi, '浙江省杭州市滨江区网商路599号', '网易', TARGET_HZ, res.searchQuery);
    assert.ok(bf);
    assert.equal(bf.confidence, 'high'); // 补查成功 → 可写回
    const written = { address: bf.poi.address, lng: bf.poi.lng, lat: bf.poi.lat };
    assert.equal(written.address, '浙江省杭州市滨江区网商路599号');
    assert.ok(Number.isFinite(written.lng) && Number.isFinite(written.lat));
    // 补查失败 (无格式化地址) → 保持 medium → 不写回
    const bfFail = backfillAddressFromRegeo(res.poi, undefined, '网易', TARGET_HZ, res.searchQuery);
    assert.equal(bfFail, null);
    assert.equal(res.confidence === 'high', false);
    assert.deepEqual(requests, ['网易 杭州研究院', '网易']); // 变体补查 (宽候选) 已触发, 无命中
  } finally {
    if (prev == null) delete process.env.AMAP_WEB_KEY;
    else process.env.AMAP_WEB_KEY = prev;
  }
});

// --- 脚本接线 (contract) -----------------------------------------------------

test('geocode-sites-apply.mjs 接线: 变体链 + memo 全变体 + 地址补查 + 回填保障', () => {
  const script = readFileSync(new URL('../scripts/geocode-sites-apply.mjs', import.meta.url), 'utf8');
  // 无地址站点 (公司检索路径) 走变体链
  assert.match(script, /searchCompanyPoiVariants\(query, target, site\)/);
  assert.match(script, /addresslessQueryVariants\(query, site\.name, target\)/);
  // 每站点 ≤ 2 次 place-text: 链只遍历变体 (最多 2 个), 命中可用地址即提前返回
  assert.match(script, /for \(const v of variants\)/);
  assert.match(script, /poiAddressUsable\(res\.poi\.address\)/);
  // memo 覆盖所有变体 key: searchCompanyPoi 内 memo key 用变体 query, 命中优先于请求
  assert.ok(script.indexOf('placeSearchMemo.get(memoKey)') < script.indexOf('placeTextSearchRest(query, target.city)'));
  // 精确候选两级评分 (完整串 → 公司名)
  assert.match(script, /gradeVariantHit\(picked, query, gradeName, target\.province, target\.city\)/);
  assert.match(script, /pickBestOfficePoi\(hit\.pois, gradeName, target\.province, target\.city, query\)/);
  // 地址缺失 → regeo 格式化地址兜底补查 + 重评分; finalRe 绑定校验最终 poi 的那次 regeo;
  // 变体检索串透出, 补查与命中时同口径评分 (精确候选整名 POI 不被裸公司名误拒)
  assert.match(script, /backfillAddressFromRegeo\(poi, finalRe\.formattedAddress, query, target, variantQuery \?\? undefined\)/);
  assert.match(script, /variantQuery = res\.searchQuery \?\? null;/);
  assert.match(script, /finalRe = re2;/);
  assert.match(script, /finalRe = re;/);
  // 回填保障: 区名前缀逻辑保留 + resolution 地址非空兜底
  assert.match(script, /let address = district && !poi\.address\.includes\(district\)/);
  assert.match(script, /if \(!address\.trim\(\)\) address = verified === 'unverified' \? poi\.address : verified;/);
  // 写回闸门不变: 只写 high 或 override; 地址用补查后的 address
  assert.match(script, /confidence === 'high' \|\| override/);
  assert.match(script, /setSiteLocation\(file, slug, site\.id, \{ address, lng: round\(poi\.lng\), lat: round\(poi\.lat\) \}\)/);
  // 变体信息进 resolution 记录
  assert.match(script, /provider, variant \}\)/);
});
