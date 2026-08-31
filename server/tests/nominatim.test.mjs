import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  NOMINATIM_MIN_INTERVAL_MS,
  NOMINATIM_QUERY_MAX_LEN,
  NOMINATIM_TIMEOUT_MS,
  NOMINATIM_USER_AGENT,
  gradeNominatimHit,
  isOverseasCity,
  nominatimMatchTokens,
  nominatimQueryVariants,
  nominatimReverseRest,
  nominatimSearchMemoKey,
  nominatimSearchMemoSet,
  nominatimSearchRest,
  parseNominatimPoi,
  pickBestNominatimPoi,
} from '../src/lib/site-geocode.ts';

// --- 政策合规常量 (Nominatim Usage Policy: UA 标识 + ≥1 req/s + 10s 超时) ------

test('Nominatim 政策常量: UA 带项目标识, 限速 ≥1s, 超时 10s', () => {
  assert.match(NOMINATIM_USER_AGENT, /DomainMap\/1\.0/);
  assert.ok(NOMINATIM_MIN_INTERVAL_MS >= 1000, '限速必须 ≥1 req/s');
  assert.equal(NOMINATIM_TIMEOUT_MS, 10_000, '单次请求超时 10s');
});

// --- 海外站判定 (isOverseasCity, 独立命名不污染国内路径) ----------------------

test('isOverseasCity: 海外/港澳台 CJK 城市 → true', () => {
  for (const city of [
    '新加坡市', '悉尼市', '慕尼黑市', '东京市', '伦敦市', '洛杉矶市',
    '中国香港', '香港', '九龙', '新界', '台北市', '台北',
    '墨尔本', '雅加达', '胡志明市', '横滨市', '札幌市', '多伦多', '温哥华',
    '三菱东京日联银行总部', '北京 洛阳  海外',
  ]) {
    assert.equal(isOverseasCity(city), true, city);
  }
});

test('isOverseasCity: 纯拉丁城市串 → true', () => {
  for (const city of ['Mountain View, CA', 'Singapore', 'London', 'Austin, TX', 'USA | Summer 2026', 'San Francisco, CA']) {
    assert.equal(isOverseasCity(city), true, city);
  }
});

test('isOverseasCity: 国内城市 / 空值 → false', () => {
  for (const city of ['杭州市', '北京市', '上海', '三亚市', '安庆', '咸宁', '青岛', null, undefined, '']) {
    assert.equal(isOverseasCity(city), false, String(city));
  }
});

// --- nominatimSearchRest: URL / UA / 解析 / 降级 ---------------------------------

/** 捕获请求的 mock fetch — init 携带 UA 头与超时 signal. */
function captureFetch(captured, respond) {
  return async (input, init) => {
    captured.input = String(input);
    captured.init = init;
    return respond();
  };
}

const MUNICH_HIT = {
  display_name: 'Anker Innovations, Georg-Muche-Straße 3, 80807 Munich, Germany',
  lon: '11.582',
  lat: '48.149',
  type: 'building',
  address: { city: 'Munich', city_district: 'Schwabing-Freimann', country: 'Germany' },
};

test('nominatimSearchRest: 正确 URL (jsonv2/limit=3/城市约束追加) + UA 头 + 解析', async () => {
  const captured = {};
  const res = await nominatimSearchRest('Georg-Muche-Street 3 安克创新', { city: '慕尼黑市' }, captureFetch(captured, async () => ({ ok: true, json: async () => [MUNICH_HIT] })));
  assert.equal(res.ok, true);
  assert.equal(res.provider, 'nominatim');
  assert.equal(res.pois.length, 1);
  assert.equal(res.pois[0].lng, 11.582);
  assert.equal(res.pois[0].lat, 48.149);
  assert.equal(res.pois[0].name, MUNICH_HIT.display_name);
  assert.equal(res.pois[0].cityname, 'Munich');
  assert.equal(res.pois[0].adname, 'Schwabing-Freimann');
  assert.equal(res.pois[0].pname, 'Germany');
  const u = new URL(captured.input);
  assert.equal(u.origin + u.pathname, 'https://nominatim.openstreetmap.org/search');
  assert.equal(u.searchParams.get('q'), 'Georg-Muche-Street 3 安克创新 慕尼黑');
  assert.equal(u.searchParams.get('format'), 'jsonv2');
  assert.equal(u.searchParams.get('limit'), '3');
  assert.equal(u.searchParams.get('addressdetails'), '1');
  assert.equal(captured.init.headers['User-Agent'], NOMINATIM_USER_AGENT);
  assert.ok(captured.init.signal instanceof AbortSignal, '超时 signal 必须传递');
});

test('nominatimSearchRest: 检索串已含城市名 → 不重复追加', async () => {
  const captured = {};
  await nominatimSearchRest('新加坡 安克创新', { city: '新加坡市' }, captureFetch(captured, async () => ({ ok: true, json: async () => [] })));
  const u = new URL(captured.input);
  assert.equal(u.searchParams.get('q'), '新加坡 安克创新');
});

test('nominatimSearchRest: 失败优雅降级 — http/超时/解析/空串, 不崩溃', async () => {
  // http 非 ok
  let res = await nominatimSearchRest('x', null, captureFetch({}, async () => ({ ok: false, status: 503 })));
  assert.deepEqual({ ok: res.ok, reason: res.reason }, { ok: false, reason: 'http' });
  // 超时 (AbortSignal.timeout 抛 TimeoutError)
  res = await nominatimSearchRest('x', null, captureFetch({}, async () => {
    throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
  }));
  assert.deepEqual({ ok: res.ok, reason: res.reason }, { ok: false, reason: 'timeout' });
  // 网络异常
  res = await nominatimSearchRest('x', null, captureFetch({}, async () => {
    throw new Error('ECONNREFUSED');
  }));
  assert.deepEqual({ ok: res.ok, reason: res.reason }, { ok: false, reason: 'http' });
  // 非数组 JSON
  res = await nominatimSearchRest('x', null, captureFetch({}, async () => ({ ok: true, json: async () => ({ error: 'bad' }) })));
  assert.deepEqual({ ok: res.ok, reason: res.reason }, { ok: false, reason: 'parse' });
  // 空数组 = 正常空结果
  res = await nominatimSearchRest('x', null, captureFetch({}, async () => ({ ok: true, json: async () => [] })));
  assert.equal(res.ok, true);
  assert.equal(res.pois.length, 0);
  // 空串 query → 不请求网络
  let called = false;
  res = await nominatimSearchRest('   ', null, captureFetch({}, async () => {
    called = true;
    return { ok: true, json: async () => [] };
  }));
  assert.deepEqual({ ok: res.ok, reason: res.reason }, { ok: false, reason: 'empty' });
  assert.equal(called, false, '空串不应发起网络请求');
});

// --- parseNominatimPoi -------------------------------------------------------

test('parseNominatimPoi: 缺坐标行 → null', () => {
  assert.equal(parseNominatimPoi({ display_name: 'x', address: {} }), null);
  assert.equal(parseNominatimPoi({ display_name: 'x', lon: 'abc', lat: '1', address: {} }), null);
});

// --- nominatimReverseRest ----------------------------------------------------

test('nominatimReverseRest: URL (lat/lon) + UA + 解析 display_name/城市/国家', async () => {
  const captured = {};
  const res = await nominatimReverseRest(11.582, 48.149, captureFetch(captured, async () => ({
    ok: true,
    json: async () => ({ display_name: 'Anker Innovations, Munich, Germany', address: { city: 'Munich', country: 'Germany' } }),
  })));
  assert.equal(res.ok, true);
  assert.equal(res.displayName, 'Anker Innovations, Munich, Germany');
  assert.equal(res.city, 'Munich');
  assert.equal(res.country, 'Germany');
  const u = new URL(captured.input);
  assert.equal(u.origin + u.pathname, 'https://nominatim.openstreetmap.org/reverse');
  assert.equal(u.searchParams.get('lat'), '48.149');
  assert.equal(u.searchParams.get('lon'), '11.582');
  assert.equal(u.searchParams.get('format'), 'jsonv2');
  assert.equal(captured.init.headers['User-Agent'], NOMINATIM_USER_AGENT);
});

test('nominatimReverseRest: 非法坐标/接口错误/超时 → ok:false 降级', async () => {
  let res = await nominatimReverseRest(Number.NaN, 1);
  assert.deepEqual({ ok: res.ok, reason: res.reason }, { ok: false, reason: 'parse' });
  res = await nominatimReverseRest(1, 2, captureFetch({}, async () => ({ ok: true, json: async () => ({ error: 'Unable to geocode' }) })));
  assert.deepEqual({ ok: res.ok, reason: res.reason }, { ok: false, reason: 'empty' });
  res = await nominatimReverseRest(1, 2, captureFetch({}, async () => {
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  }));
  assert.deepEqual({ ok: res.ok, reason: res.reason }, { ok: false, reason: 'timeout' });
});

// --- nominatimMatchTokens (跨语言归一: Straße↔Street, CJK 滑窗 bigram) ----------

test('nominatimMatchTokens: 拉丁 token 小写去变音 + ß→ss', () => {
  const tokens = nominatimMatchTokens('Georg-Muche-Straße 3 Munich');
  assert.ok(tokens.has('georg'));
  assert.ok(tokens.has('muche'));
  assert.ok(tokens.has('strasse'), 'ß 必须归一为 ss');
  assert.ok(tokens.has('munich'));
  assert.ok(!tokens.has('3'), '短 token (≤2) 不取');
});

test('nominatimMatchTokens: CJK 滑窗 bigram (渋谷区神宮前 → 渋谷/谷区/区神/神宮/宮前)', () => {
  const tokens = nominatimMatchTokens('渋谷区神宮前');
  for (const bigram of ['渋谷', '谷区', '区神', '神宮', '宮前']) assert.ok(tokens.has(bigram), bigram);
});

// --- gradeNominatimHit (海外独立评分口径) --------------------------------------

test('gradeNominatimHit: 公司名出现在 display_name → high (自家 POI 命中)', () => {
  const poi = parseNominatimPoi({ display_name: '得物, 渋谷区神宮前1-5-8 神宮前タワービル13階, 渋谷, 東京, Japan', lon: '139.7', lat: '35.66', type: 'building', address: {} });
  const grade = gradeNominatimHit(poi, '得物', '得物 东京市', '东京市');
  assert.equal(grade.confidence, 'high');
  assert.equal(grade.reason, 'nominatim-company-match');
});

test('gradeNominatimHit: 地址 token 重叠 ≥2 且含门牌 → high (跨语言 Straße↔Street)', () => {
  const poi = parseNominatimPoi({ display_name: 'Anker Innovations, Georg-Muche-Straße 3, 80807 Munich, Germany', lon: '11.582', lat: '48.149', type: 'building', address: {} });
  const grade = gradeNominatimHit(poi, '安克创新', 'Georg-Muche-Street 3 Munich 安克创新', '慕尼黑市');
  assert.equal(grade.confidence, 'high');
  assert.match(grade.reason, /^nominatim-address-match:/);
});

test('gradeNominatimHit: 地址 token 重叠 ≥2 但无门牌 → medium (城市级)', () => {
  // 可达场景: 检索串含街道名但无门牌号 (如 "Fifth Avenue 公司名"), display_name
  // 不含公司名 — 街道级证据不足 → medium (不写回)。
  const poi = parseNominatimPoi({ display_name: 'The Plaza, Fifth Avenue, New York, NY', lon: '-73.98', lat: '40.76', type: 'hotel', address: {} });
  const grade = gradeNominatimHit(poi, '某司', 'Fifth Avenue 某司', '纽约市');
  assert.equal(grade.confidence, 'medium');
  assert.match(grade.reason, /^nominatim-city-match:/);
});

test('gradeNominatimHit: 无公司名 + 无地址重叠 → low (城市名占位检索不误收)', () => {
  const poi = parseNominatimPoi({ display_name: 'Anker Innovations, Singapore', lon: '103.85', lat: '1.29', type: 'company', address: {} });
  const grade = gradeNominatimHit(poi, '安克创新', '安克创新 新加坡市', '新加坡市');
  assert.equal(grade.confidence, 'low');
  assert.match(grade.reason, /^nominatim-name-mismatch:/);
});

test('gradeNominatimHit: 城市 token 从地址部分剔除 (去掉后零 token → low)', () => {
  const poi = parseNominatimPoi({ display_name: 'Dewu, 新加坡, Singapore', lon: '103.85', lat: '1.29', type: 'company', address: {} });
  const grade = gradeNominatimHit(poi, '得物', '得物 新加坡', '新加坡市');
  assert.equal(grade.confidence, 'low');
});

// --- pickBestNominatimPoi ----------------------------------------------------

test('pickBestNominatimPoi: 首个非 low 候选胜出 (Nominatim relevance 已排序)', () => {
  const bad = parseNominatimPoi({ display_name: 'Anker Innovations, Singapore', lon: '103.85', lat: '1.29', type: 'company', address: {} });
  const good = parseNominatimPoi({ display_name: 'Anker Innovations, Georg-Muche-Straße 3, Munich, Germany', lon: '11.582', lat: '48.149', type: 'building', address: {} });
  const picked = pickBestNominatimPoi([bad, good], '安克创新', 'Georg-Muche-Street 3 Munich 安克创新', '慕尼黑市');
  assert.equal(picked, good);
  assert.equal(pickBestNominatimPoi([bad], '安克创新', '安克创新 新加坡市', '新加坡市'), undefined);
});

// --- nominatimQueryVariants (海外路由: 每站点 ≤2 次检索) ------------------------

test('nominatimQueryVariants: 街道地址 → [地址+公司, 公司+城市]', () => {
  assert.deepEqual(
    nominatimQueryVariants('安克创新', 'Georg-Muche-Street 3, 80807 Munich', '慕尼黑市'),
    ['Georg-Muche-Street 3, 80807 Munich 安克创新', '安克创新 慕尼黑市'],
  );
});

test('nominatimQueryVariants: 城市名占位地址 (新加坡/非中国大陆地区) → 只公司+城市', () => {
  assert.deepEqual(nominatimQueryVariants('安克创新', '新加坡', '新加坡市'), ['安克创新 新加坡市']);
  assert.deepEqual(nominatimQueryVariants('安克创新', '非中国大陆地区', '台北市'), ['安克创新 台北市']);
  assert.deepEqual(nominatimQueryVariants('安克创新', null, '悉尼市'), ['安克创新 悉尼市']);
});

// 限速契约: nominatimSearchRest 自身不 sleep (调用方 throttleMs('nominatim')=1000
// 在 geocode-sites-apply.mjs 调用点执行) — 上述 mock 全部即时返回即可证明无
// 内部限速; ≥1s 的下限由 NOMINATIM_MIN_INTERVAL_MS 常量测试钉住。

// --- Nominatim search memo (scan r2 #6) + q 长度上限 (scan r2 #7) --------------

test('nominatimSearchMemoKey: 同 query+同城市 → 同 key;不同城市/不同 query 不串', () => {
  assert.equal(nominatimSearchMemoKey('安克创新 慕尼黑市', '慕尼黑市'), nominatimSearchMemoKey('安克创新 慕尼黑市', '慕尼黑市'));
  assert.notEqual(nominatimSearchMemoKey('安克创新 慕尼黑市', '慕尼黑市'), nominatimSearchMemoKey('安克创新 慕尼黑市', '新加坡市'));
  assert.notEqual(nominatimSearchMemoKey('安克创新 慕尼黑市', '慕尼黑市'), nominatimSearchMemoKey('元气森林 慕尼黑市', '慕尼黑市'));
});

test('nominatimSearchMemoSet: 成功命中 (poi 非空) 才入 memo;失败/空/超时绝不缓存', () => {
  const memo = new Map();
  const poi = parseNominatimPoi({ display_name: 'Anker Innovations, Munich', lon: '11.582', lat: '48.149', type: 'building', address: {} });
  nominatimSearchMemoSet(memo, 'k1', { poi, confidence: 'high', reason: 'nominatim-company-match', query: 'q' });
  assert.equal(memo.size, 1);
  nominatimSearchMemoSet(memo, 'k2', { poi: null, confidence: null, reason: 'nominatim-no-result', query: 'q' });
  nominatimSearchMemoSet(memo, 'k3', { poi: null, confidence: null, reason: 'http', query: 'q' });
  nominatimSearchMemoSet(memo, 'k4', { poi: null, confidence: null, reason: 'timeout', query: 'q' });
  nominatimSearchMemoSet(memo, 'k5', null);
  nominatimSearchMemoSet(memo, 'k6', undefined);
  assert.equal(memo.size, 1);
});

/** 镜像 scripts/geocode-sites-apply.mjs searchOverseasNominatim 的 memo 流程. */
function makeMemoizedNominatimSearch(memo, fetchImpl) {
  return async function search(companyQuery, address, city) {
    for (const q of nominatimQueryVariants(companyQuery, address, city)) {
      const memoKey = nominatimSearchMemoKey(q, city);
      const cached = memo.get(memoKey);
      if (cached) return cached;
      const res = await nominatimSearchRest(q, { city }, fetchImpl);
      if (!res.ok || !res.pois.length) continue;
      const picked = pickBestNominatimPoi(res.pois, companyQuery, q, city);
      if (!picked) continue;
      const grade = gradeNominatimHit(picked, companyQuery, q, city);
      const hit = { poi: picked, confidence: grade.confidence, reason: grade.reason, query: q };
      nominatimSearchMemoSet(memo, memoKey, hit);
      return hit;
    }
    return { poi: null, confidence: null, reason: 'nominatim-no-result', query: null };
  };
}

test('memo 流程: 同 query+同城市第二次零请求;不同城市各自请求 (scan r2 #6)', async () => {
  const requested = [];
  const fetchImpl = async (input) => {
    requested.push(String(input));
    // 按解码后的 q 参数分流: 新加坡检索 → 中文公司名 display (公司名强匹配 high);
    // 其余 → 慕尼黑地址命中 (URL 中 CJK 被百分号编码, 必须经 searchParams 解码)
    const q = new URL(String(input)).searchParams.get('q') ?? '';
    if (q.includes('新加坡')) {
      return { ok: true, json: async () => [{ display_name: '安克创新, Singapore', lon: '103.85', lat: '1.29', type: 'company', address: {} }] };
    }
    return { ok: true, json: async () => [MUNICH_HIT] };
  };
  const memo = new Map();
  const search = makeMemoizedNominatimSearch(memo, fetchImpl);

  // 同公司同城两个站点 (安克创新 38 站场景) — 第二次 memo 命中零请求
  const r1 = await search('安克创新', 'Georg-Muche-Street 3 Munich', '慕尼黑市');
  assert.equal(r1.poi.name, MUNICH_HIT.display_name);
  const calls1 = requested.length;
  assert.ok(calls1 >= 1, '第一站至少 1 次请求');
  const r2 = await search('安克创新', 'Georg-Muche-Street 3 Munich', '慕尼黑市');
  assert.equal(r2.poi.lng, r1.poi.lng);
  assert.equal(requested.length, calls1, '同 query+同城市第二次零请求 (memo 命中)');

  // 不同城市 → 不同 key, 各自请求 (不串)
  const r3 = await search('安克创新', null, '新加坡市');
  assert.equal(r3.poi.lng, 103.85);
  assert.ok(requested.length > calls1, '不同城市重新请求');
});

test('memo 流程: 失败/空结果/超时不缓存 — 同 query 第二次仍重新请求', async () => {
  let respond = async () => ({ ok: true, json: async () => [] });
  const requested = [];
  const fetchImpl = async (input) => {
    requested.push(String(input));
    return respond();
  };
  const memo = new Map();
  const search = makeMemoizedNominatimSearch(memo, fetchImpl);

  // 空结果: 不缓存 → 两次调用各重新请求
  const a1 = await search('安克创新', null, '新加坡市');
  assert.equal(a1.poi, null);
  const n1 = requested.length;
  const a2 = await search('安克创新', null, '新加坡市');
  assert.equal(a2.poi, null);
  assert.equal(requested.length, n1 + 1, '空结果不缓存 → 第二次重新请求');
  assert.equal(memo.size, 0);

  // http 失败: 不缓存 → 继续重试 (配额/服务恢复后必须重新尝试)
  respond = async () => ({ ok: false, status: 503 });
  await search('安克创新', null, '新加坡市');
  await search('安克创新', null, '新加坡市');
  assert.equal(memo.size, 0);
});

test('nominatimSearchRest: q 超 256 截断 — 保留公司名主体, 丢弃头部地址段 (scan r2 #7)', async () => {
  // 超长: 30 字符头部标记 + 270 字符地址 + 公司名 = 305 字符
  const longQ = `${'X'.repeat(30)}${'Y'.repeat(270)} 安克创新`;
  const captured = {};
  const res = await nominatimSearchRest(longQ, null, captureFetch(captured, async () => ({ ok: true, json: async () => [MUNICH_HIT] })));
  assert.equal(res.ok, true);
  const u = new URL(captured.input);
  const final = u.searchParams.get('q');
  assert.equal(final.length, NOMINATIM_QUERY_MAX_LEN, '超长必须截断到 256');
  assert.ok(!final.includes('X'), '头部地址段被丢弃');
  assert.ok(final.includes('Y'), '公司名前的地址主体保留');
  assert.ok(final.endsWith('安克创新'), '公司名主体保留在尾部');
  // 带城市约束同样受截断保护 (追加城市后仍 ≤256, 公司名不丢)
  const captured2 = {};
  await nominatimSearchRest(longQ, { city: '慕尼黑市' }, captureFetch(captured2, async () => ({ ok: true, json: async () => [MUNICH_HIT] })));
  const u2 = new URL(captured2.input);
  assert.ok(u2.searchParams.get('q').length <= NOMINATIM_QUERY_MAX_LEN);
  assert.ok(u2.searchParams.get('q').includes('安克创新'));
  // 未超长: 原样发送 (回归)
  const captured3 = {};
  await nominatimSearchRest('安克创新 慕尼黑市', { city: '慕尼黑市' }, captureFetch(captured3, async () => ({ ok: true, json: async () => [] })));
  assert.equal(new URL(captured3.input).searchParams.get('q'), '安克创新 慕尼黑市');
});

test('geocode-sites-apply.mjs 接线: searchOverseasNominatim 按 (变体串, city) memo 成功命中', () => {
  const script = readFileSync(new URL('../scripts/geocode-sites-apply.mjs', import.meta.url), 'utf8');
  assert.match(script, /const nominatimSearchMemo = new Map\(\)/);
  assert.match(script, /const memoKey = nominatimSearchMemoKey\(q, target\.city\)/);
  // 命中优先: memo get 在 Nominatim 请求之前 → 同 query+city 第二次零请求
  const getIdx = script.indexOf('nominatimSearchMemo.get(memoKey)');
  const fetchIdx = script.indexOf('nominatimSearchRest(q, target)');
  assert.ok(getIdx !== -1 && fetchIdx !== -1, 'memo get 与 Nominatim 请求都必须在 searchOverseasNominatim 内');
  assert.ok(getIdx < fetchIdx, 'memo get 必须先于 Nominatim 请求');
  // 只缓存成功命中: 写入发生在请求 + 评分之后
  const setIdx = script.indexOf('nominatimSearchMemoSet(nominatimSearchMemo, memoKey, hit)');
  assert.ok(setIdx !== -1 && setIdx > fetchIdx, 'memo 写入必须发生在请求与评分之后 (只缓存成功命中)');
});
