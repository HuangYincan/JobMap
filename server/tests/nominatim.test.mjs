import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NOMINATIM_MIN_INTERVAL_MS,
  NOMINATIM_TIMEOUT_MS,
  NOMINATIM_USER_AGENT,
  gradeNominatimHit,
  isOverseasCity,
  nominatimMatchTokens,
  nominatimQueryVariants,
  nominatimReverseRest,
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
