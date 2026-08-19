import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AMAP_DEFAULT_RADIUS,
  AMAP_NEARBY_MAX_RADIUS,
  AMAP_PAGE_SIZE,
  AMAP_QPS,
  batchMatchesCurrentMode,
  buildSearchQueue,
  categoryMatches,
  isCommonOrExactName,
  isCommonPoi,
  inBounds,
  mapScaleMetersPerCm,
  mergePoisById,
  MORE_PAGE_SIZE,
  parseBoundsParam,
  POI_HARD_CAP,
  POI_SOFT_CAP,
  popularityScore,
  sampleViewportGrid,
  searchRadiusMeters,
  zoomStrategy,
} from '../src/lib/viewport-search.ts';
import {
  createViewportLoader,
  catalogCoversView,
  fetchWorkViewportPage,
  loadWorkViewport,
  needsViewportAlign,
  VIEWPORT_ALIGN_CENTER_KM,
  VIEWPORT_ALIGN_ZOOM_DELTA,
  VIEWPORT_DEBOUNCE_MS,
} from '../src/lib/viewport-search.ts';
import { sortPOIs } from '../src/lib/search.ts';

test('sampleViewportGrid: 4x4 yields 16 interior centers', () => {
  const pts = sampleViewportGrid(
    { west: 120, south: 30, east: 121, north: 31 },
    4,
    4
  );
  assert.equal(pts.length, 16);
  assert.ok(pts.every((p) => p.lng > 120 && p.lng < 121));
  assert.ok(pts.every((p) => p.lat > 30 && p.lat < 31));
  const uniq = new Set(pts.map((p) => `${p.lng},${p.lat}`));
  assert.equal(uniq.size, 16);
});

test('zoomStrategy: national view uses landmarks, city view uses all', () => {
  const s = zoomStrategy(4);
  assert.equal(s.categories, 'landmark');
  assert.equal(s.city, '全国');
  assert.equal(zoomStrategy(7).categories, 'core');
  assert.equal(zoomStrategy(13).categories, 'all');
});

test('searchRadiusMeters is scale × 30, default 3000 when over 50km', () => {
  const street = searchRadiusMeters(16, 30.27);
  const city = searchRadiusMeters(13, 30.27);
  const national = searchRadiusMeters(5, 30.27);
  assert.ok(street > 0 && street <= AMAP_NEARBY_MAX_RADIUS);
  assert.ok(city > street);
  assert.equal(national, AMAP_DEFAULT_RADIUS);
  assert.ok(Math.abs(street - mapScaleMetersPerCm(16, 30.27) * 30) < 1);
});

test('mergePoisById dedupes and respects cap', () => {
  const a = [{ id: '1' }, { id: '2' }];
  const b = [{ id: '2' }, { id: '3' }, { id: '4' }];
  const merged = mergePoisById(a, b, 3);
  assert.deepEqual(merged.map((p) => p.id), ['1', '2', '3']);
});

test('buildSearchQueue is one center: categories then pages', () => {
  const queue = buildSearchQueue(['风景名胜', '高等院校', '购物服务'], 2);
  assert.equal(queue.length, 6);
  assert.deepEqual(queue.slice(0, 3).map((t) => t.keyword), ['风景名胜', '高等院校', '购物服务']);
  assert.ok(queue.slice(0, 3).every((t) => t.page === 1));
  assert.ok(queue.slice(3).every((t) => t.page === 2));
});

test('categoryMatches maps UI values to AMap type prefixes', () => {
  assert.equal(categoryMatches('餐饮服务', 'food'), true);
  assert.equal(categoryMatches('餐饮服务', '餐饮服务'), true);
  assert.equal(categoryMatches('购物服务', 'shopping'), true);
  assert.equal(categoryMatches('餐饮服务', '住宿服务'), false);
  assert.equal(categoryMatches('餐饮服务', 'all'), true);
});

test('mergePoisById grows a catalog toward the display cap', () => {
  const existing = Array.from({ length: 3 }, (_, i) => ({ id: `e${i}` }));
  const incoming = Array.from({ length: 5 }, (_, i) => ({ id: `n${i}` }));
  const merged = mergePoisById(existing, incoming, POI_HARD_CAP);
  assert.equal(merged.length, 8);
  assert.equal(POI_SOFT_CAP, 300);
  assert.equal(MORE_PAGE_SIZE, 300);
  assert.ok(POI_HARD_CAP > POI_SOFT_CAP);
});

test('isCommonPoi drops anonymous shops without rating or photos', () => {
  assert.equal(isCommonPoi({ category: '餐饮服务' }), false);
  assert.equal(isCommonPoi({ category: '餐饮服务', rating: 4.2 }), true);
  assert.equal(isCommonPoi({ category: '风景名胜' }), true);
});

test('isCommonOrExactName keeps an exact-name hit despite sparse data', () => {
  assert.equal(isCommonOrExactName({ name: '西湖', category: '餐饮服务' }, '西湖'), true);
  assert.equal(isCommonOrExactName({ name: '西 湖', category: '餐饮服务' }, '西湖'), true);
  assert.equal(isCommonOrExactName({ name: '西湖风景区', category: '餐饮服务' }, '西湖'), false);
  assert.equal(isCommonOrExactName({ name: '无名小店', category: '餐饮服务' }, '咖啡'), false);
  assert.equal(isCommonOrExactName({ name: '西湖', rating: 4.2 }, '随便'), true);
});

test('buildSearchQueue pageOffset advances PlaceSearch page', () => {
  const first = buildSearchQueue(['餐饮服务', '购物服务'], 1, 0);
  const more = buildSearchQueue(['餐饮服务', '购物服务'], 1, 1);
  assert.ok(first.every((t) => t.page === 1));
  assert.ok(more.every((t) => t.page === 2));
});

test('zoomStrategy pageSize stays within AMap PlaceSearch max and QPS is 3', () => {
  assert.ok(zoomStrategy(14).pageSize <= AMAP_PAGE_SIZE);
  assert.ok(zoomStrategy(7).pageSize <= AMAP_PAGE_SIZE);
  assert.equal(AMAP_QPS, 3);
});

test('popularityScore differs from rating so sorts can diverge', () => {
  const highRateLowPop = {
    id: 'a',
    kind: 'domain',
    name: 'A',
    mode: 'domain',
    source: 'amap',
    location: { lng: 120, lat: 30 },
    category: '其他',
    rating: 5,
    reviewCount: 2,
    photos: [],
  };
  const midRateHighPop = {
    id: 'b',
    kind: 'domain',
    name: 'B',
    mode: 'domain',
    source: 'amap',
    location: { lng: 120, lat: 30 },
    category: '风景名胜',
    rating: 3.2,
    reviewCount: 900,
    photos: ['x', 'y'],
  };
  const byRating = sortPOIs([highRateLowPop, midRateHighPop], 'rating');
  const byPop = sortPOIs([highRateLowPop, midRateHighPop], 'popularity');
  assert.equal(byRating[0].id, 'a');
  assert.equal(byPop[0].id, 'b');
  assert.ok(popularityScore(midRateHighPop) > popularityScore(highRateLowPop));
});

test('parseBoundsParam and inBounds clip to the requested box', () => {
  assert.equal(parseBoundsParam('bad'), null);
  assert.equal(parseBoundsParam('121,30,120,31'), null);
  const box = parseBoundsParam('120.0,30.2,120.2,30.3');
  assert.ok(box);
  assert.equal(inBounds({ lng: 120.1, lat: 30.25 }, box), true);
  assert.equal(inBounds({ lng: 121, lat: 30.25 }, box), false);
  assert.equal(inBounds({ lng: 120.1, lat: 30.25 }, [120, 30.2, 120.2, 30.3]), true);
});

// ---- 工作模式视口按需加载(WS4)----

const VIEWPORT_BOX = { west: 120, south: 30, east: 121, north: 31 };

function recruitmentPoi(id, positions) {
  return {
    id,
    kind: 'recruitment',
    name: id,
    mode: 'work',
    source: 'api',
    location: { lng: 120.1, lat: 30.2, address: 'X' },
    company: { name: id, industries: [], scale: 'bigtech' },
    positions,
  };
}

function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const daysFromNow = (n) => fmtDate(new Date(Date.now() + n * 86_400_000));

test('fetchWorkViewportPage sends bounds + maxTier and keeps only alive positions', async () => {
  let seenUrl = '';
  const results = [
    recruitmentPoi('a', [
      { id: 'p1', title: '后端', type: 'social', status: 'open', deadline: daysFromNow(30) },
      { id: 'p2', title: '算法', type: 'social', status: 'open', deadline: daysFromNow(-3) },
    ]),
    recruitmentPoi('b', [{ id: 'p3', title: '产品', type: 'social', status: 'closed' }]),
    recruitmentPoi('c', [{ id: 'p4', title: '设计', type: 'social', status: 'open' }]),
  ];
  const fetcher = async (url) => {
    seenUrl = String(url);
    return { ok: true, json: async () => ({ results }) };
  };
  const { pois } = await fetchWorkViewportPage(
    { bounds: VIEWPORT_BOX, maxTier: 1, page: 1, filters: { onlyOpen: 'true' } },
    fetcher
  );
  const parsed = new URL(seenUrl, 'http://x');
  assert.equal(parsed.searchParams.get('mode'), 'work');
  assert.equal(parsed.searchParams.get('bounds'), '120,30,121,31');
  assert.equal(parsed.searchParams.get('page'), '1');
  assert.equal(
    parsed.searchParams.get('filters'),
    JSON.stringify({ onlyOpen: 'true', maxTier: 1 })
  );
  // b 全部岗位 closed、a 的过期岗位被剔除;只剩 a(1 个在招)+ c
  assert.equal(pois.length, 2);
  const a = pois.find((p) => p.id === 'a');
  assert.equal(a.positions.length, 1);
  assert.equal(a.positions[0].id, 'p1');
});

test('fetchWorkViewportPage: 透出服务端 total(poi-loading D noMore 判定用)', async () => {
  const fetcher = async () => ({
    ok: true,
    json: async () => ({ total: 137, results: [recruitmentPoi('a', [{ id: 'p1', title: '后端', type: 'social', status: 'open' }])] }),
  });
  const page = await fetchWorkViewportPage({ bounds: VIEWPORT_BOX }, fetcher);
  assert.equal(page.total, 137);
});

test('fetchWorkViewportPage: non-ok 响应抛错(错误 ≠ 没有更多,可重试,poi-loading A)', async () => {
  const fetcher = async () => ({ ok: false });
  await assert.rejects(
    fetchWorkViewportPage({ bounds: VIEWPORT_BOX, filters: { onlyOpen: 'true' } }, fetcher),
    /api\/pois failed/
  );
});

test('loadWorkViewport: 用服务端 total 判 noMore(满页但已取完 → 到底)', async () => {
  const seenPages = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const p = new URL(String(url), 'http://x').searchParams.get('page');
    seenPages.push(p);
    return {
      ok: true,
      json: async () => ({
        total: 2, // 整查询只有 2 条:第 1 页满页但已取完
        results: [
          recruitmentPoi('a', [{ id: 'p1', title: '后端', type: 'social', status: 'open' }]),
          recruitmentPoi('b', [{ id: 'p2', title: '算法', type: 'social', status: 'open' }]),
        ],
      }),
    };
  };
  try {
    const { noMore } = await loadWorkViewport({
      bounds: VIEWPORT_BOX,
      pageSize: 2,
      maxPages: 4,
      existing: [],
    });
    assert.deepEqual(seenPages, ['1']); // total 判到底,不白打后续页
    assert.equal(noMore, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loadWorkViewport: 失败抛错上抛,不置 noMore(可重试,poi-loading A)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false });
  try {
    await assert.rejects(
      loadWorkViewport({ bounds: VIEWPORT_BOX, pageSize: 2, existing: [] }),
      /api\/pois failed/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loadWorkViewport merges by id via injected fetcher', async () => {
  const existing = [
    recruitmentPoi('a', [{ id: 'p1', title: '后端', type: 'social', status: 'open' }]),
    recruitmentPoi('b', [{ id: 'p2', title: '算法', type: 'social', status: 'open' }]),
  ];
  const pagePois = [existing[1], recruitmentPoi('c', [{ id: 'p3', title: '产品', type: 'social', status: 'open' }])];
  let seenOptions = null;
  let lastBatch = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    seenOptions = String(url);
    return { ok: true, json: async () => ({ results: pagePois }) };
  };
  try {
    const { pois: merged, noMore } = await loadWorkViewport({
      bounds: VIEWPORT_BOX,
      maxTier: 2,
      existing,
      onBatch: (batch) => {
        lastBatch = batch;
      },
    });
    assert.deepEqual(merged.map((p) => p.id), ['a', 'b', 'c']); // 去重,不丢已有
    assert.equal(noMore, true); // 本页(2 条)< pageSize → 数据到底
    assert.deepEqual(lastBatch.map((p) => p.id), ['a', 'b', 'c']);
    const parsed = new URL(seenOptions, 'http://x');
    assert.equal(parsed.searchParams.get('bounds'), '120,30,121,31');
    assert.equal(parsed.searchParams.get('filters'), JSON.stringify({ maxTier: 2 }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loadWorkViewport: polluted existing pool with domain rows is purged to recruitment only', async () => {
  const existing = [
    recruitmentPoi('a', [{ id: 'p1', title: '后端', type: 'social', status: 'open' }]),
    {
      id: 'hz-leak',
      kind: 'domain',
      name: '某高德POI',
      mode: 'domain',
      source: 'api',
      location: { lng: 120.3, lat: 30.3 },
      category: '公司企业',
    },
  ];
  const pagePois = [recruitmentPoi('c', [{ id: 'p3', title: '产品', type: 'social', status: 'open' }])];
  let lastBatch = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ results: pagePois }) });
  try {
    const { pois: merged } = await loadWorkViewport({
      bounds: VIEWPORT_BOX,
      existing,
      onBatch: (batch) => {
        lastBatch = batch;
      },
    });
    assert.deepEqual(merged.map((p) => p.id), ['a', 'c']); // domain 行被剔除,不进列表
    assert.deepEqual(lastBatch.map((p) => p.id), ['a', 'c']);
    assert.ok(merged.every((p) => p.kind === 'recruitment'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loadWorkViewport maxPages: loops pages, dedupes, stops on a short page', async () => {
  const existing = [recruitmentPoi('a', [{ id: 'p1', title: '后端', type: 'social', status: 'open' }])];
  const pages = {
    1: [
      recruitmentPoi('b', [{ id: 'p2', title: '算法', type: 'social', status: 'open' }]),
      recruitmentPoi('c', [{ id: 'p3', title: '产品', type: 'social', status: 'open' }]),
    ],
    2: [
      recruitmentPoi('c', [{ id: 'p3', title: '产品', type: 'social', status: 'open' }]),
      recruitmentPoi('d', [{ id: 'p4', title: '设计', type: 'social', status: 'open' }]),
    ],
  };
  const seenPages = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const page = new URL(String(url), 'http://x').searchParams.get('page');
    seenPages.push(page);
    const results = pages[page] ?? [];
    return { ok: true, json: async () => ({ results }) };
  };
  const batches = [];
  try {
    const { pois: merged, noMore } = await loadWorkViewport({
      bounds: VIEWPORT_BOX,
      pageSize: 2, // 满页=2;第 1/2 页满 → 继续,第 3 页空 → 停
      maxPages: 4,
      existing,
      onBatch: (batch) => {
        batches.push(batch.map((p) => p.id));
      },
    });
    assert.deepEqual(seenPages, ['1', '2', '3']); // 空页后提前停,不请求第 4 页
    assert.deepEqual(merged.map((p) => p.id), ['a', 'b', 'c', 'd']); // 跨页去重
    assert.equal(noMore, false); // 第 3 页空 → 空批次不闩锁(ws1 Bug1,0 条 ≠ 到底)
    assert.deepEqual(batches, [['a', 'b', 'c'], ['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd']]); // 每页合并后回调
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loadWorkViewport: 全部页面满页时 noMore=false(未到底,哨兵继续)', async () => {
  const existing = [];
  const seenPages = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const p = Number(new URL(String(url), 'http://x').searchParams.get('page'));
    seenPages.push(String(p));
    const results = [
      recruitmentPoi(`r-${p}-1`, [{ id: `p-${p}-1`, title: '岗位', type: 'social', status: 'open' }]),
      recruitmentPoi(`r-${p}-2`, [{ id: `p-${p}-2`, title: '岗位', type: 'social', status: 'open' }]),
    ];
    return { ok: true, json: async () => ({ results }) };
  };
  try {
    const { pois: merged, noMore } = await loadWorkViewport({
      bounds: VIEWPORT_BOX,
      pageSize: 2, // 每页恰好满页 → 不 break
      maxPages: 3,
      existing,
    });
    assert.deepEqual(seenPages, ['1', '2', '3']); // 全部满页 → 取满 maxPages
    assert.equal(merged.length, 6);
    assert.equal(noMore, false); // 满页连续 → 可能还有下一页,不算到底
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loadWorkViewport with existing:[] replaces the catalog (viewport refresh replace semantics)', async () => {
  // Bug 7:工作模式视口刷新改为「替换」——existing=[] 时只保留本视野取回的一页,
  // 不再并入旧累计池;否则 79 家全捕获后去重无变化、列表冻结。
  const pagePois = [
    recruitmentPoi('a', [{ id: 'p1', title: '后端', type: 'social', status: 'open' }]),
    recruitmentPoi('b', [{ id: 'p2', title: '算法', type: 'social', status: 'open' }]),
  ];
  let lastBatch = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ results: pagePois }) });
  try {
    const { pois: merged } = await loadWorkViewport({
      bounds: VIEWPORT_BOX,
      maxTier: 2,
      existing: [], // 视口替换:新视野清空旧卡片
      onBatch: (batch) => {
        lastBatch = batch;
      },
    });
    assert.deepEqual(merged.map((p) => p.id), ['a', 'b']);
    assert.deepEqual(lastBatch.map((p) => p.id), ['a', 'b']);
    assert.ok(!merged.some((p) => p.id === 'old-x')); // 旧视野公司不残留
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('createViewportLoader: debounces rapid schedules into a single load', async () => {
  let calls = 0;
  const loader = createViewportLoader({ delayMs: 15, load: () => { calls += 1; } });
  loader.schedule();
  loader.schedule();
  loader.schedule();
  assert.equal(calls, 0); // 防抖窗口内不触发
  await sleep(60);
  assert.equal(calls, 1); // 窗口内的事件合并为一次
  loader.dispose();
});

test('createViewportLoader: schedule during in-flight coalesces to one follow-up', async () => {
  const calls = [];
  let release = null;
  const loader = createViewportLoader({
    delayMs: 10,
    load: () =>
      new Promise((resolve) => {
        calls.push('load');
        release = resolve;
      }),
  });
  loader.schedule();
  await sleep(30); // 第一次已 in-flight
  assert.equal(calls.length, 1);
  loader.schedule(); // in-flight 期间的「最新一次」
  loader.schedule(); // 合并掉中间态
  await sleep(10);
  assert.equal(calls.length, 1); // 仍只有一个 in-flight
  release();
  await sleep(30);
  assert.equal(calls.length, 2); // 完成后补跑最新一次,不堆积
  loader.dispose();
});

test('createViewportLoader: dispose cancels pending and stops future loads', async () => {
  let calls = 0;
  const loader = createViewportLoader({ delayMs: 10, load: () => { calls += 1; } });
  loader.schedule();
  loader.dispose();
  await sleep(40);
  assert.equal(calls, 0);
  loader.schedule(); // dispose 后无效
  await sleep(40);
  assert.equal(calls, 0);
});

test('VIEWPORT_DEBOUNCE_MS is 800ms (spec: UI 刷新防抖 800ms)', () => {
  assert.equal(VIEWPORT_DEBOUNCE_MS, 800);
});

test('batchMatchesCurrentMode: 同模式批次放行,跨模式批次丢弃(poi-mixing 回归)', () => {
  assert.equal(batchMatchesCurrentMode('work', 'work'), true);
  assert.equal(batchMatchesCurrentMode('domain', 'domain'), true);
  // 工作公司在飞时切到地图 → 工作批次必须被丢弃(「公司 POI 混入地图 POI」)
  assert.equal(batchMatchesCurrentMode('domain', 'work'), false);
  // 地图批次在飞时切到工作 → 同样丢弃
  assert.equal(batchMatchesCurrentMode('work', 'domain'), false);
  // internship 是 work 的兼容别名,同口径放行
  assert.equal(batchMatchesCurrentMode('internship', 'work'), true);
  assert.equal(batchMatchesCurrentMode('work', 'internship'), true);
  // 模式未就绪(首屏 geoSettled 前)不写任何批次
  assert.equal(batchMatchesCurrentMode(null, 'work'), false);
  assert.equal(batchMatchesCurrentMode(undefined, 'domain'), false);
});

test('loadWorkViewport: 信号取消后不再触发 onBatch(在飞批次模式切换时被抑制)', async () => {
  const existing = [];
  let onBatchCalls = 0;
  let release = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => new Promise((r) => { release = r; });
  try {
    const signal = { cancelled: false };
    const promise = loadWorkViewport({
      bounds: VIEWPORT_BOX,
      existing,
      signal,
      onBatch: () => { onBatchCalls += 1; },
    });
    // 在飞期间模拟模式切换:取消信号(主加载的 effect cleanup 行为)
    signal.cancelled = true;
    release({ ok: true, json: async () => ({ results: [] }) });
    await promise;
    assert.equal(onBatchCalls, 0); // 取消后不落库、不回调
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loadWorkViewport: 0 条 → noMore=false(空批次不闩锁,ws1 Bug1)', async () => {
  // 空批次可能由滤波/层级 maxTier 裁剪导致,不代表数据源到底。闩锁会让
  // 「整城无 POI」粘住「没有更多结果」,无限滚动失效,恢复只能等下一次
  // moveend——即使 total=0 也一律不闩锁(宁可滚动时多发一次空请求)。
  const seenPages = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const page = new URL(String(url), 'http://x').searchParams.get('page');
    seenPages.push(page);
    return { ok: true, json: async () => ({ results: [], total: 0 }) };
  };
  try {
    const { pois, noMore, vacant } = await loadWorkViewport({
      bounds: VIEWPORT_BOX,
      pageSize: 2,
      maxPages: 4,
      existing: [],
    });
    assert.equal(pois.length, 0);
    assert.equal(noMore, false); // 空批次不闩锁
    assert.equal(vacant, true); // 整个请求 0 条 → 真空标记(三态判定用)
    assert.deepEqual(seenPages, ['1']); // 空页提前停,不白打后续页
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loadWorkViewport: 短页(< pageSize,1..size-1 条)仍闩锁 noMore=true', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      results: [recruitmentPoi('a', [{ id: 'p1', title: '后端', type: 'social', status: 'open' }])],
      total: -1,
    }),
  });
  try {
    const { noMore, vacant } = await loadWorkViewport({
      bounds: VIEWPORT_BOX,
      pageSize: 2, // 1 条 < 2 → 短页
      existing: [],
    });
    assert.equal(noMore, true); // 短页仍按「到底」闩锁
    assert.equal(vacant, false); // 请求有数据 → 非真空
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loadWorkViewport: 首页满页 + 次页空 → vacant=false(请求有数据,非真空)', async () => {
  // 真空仅对「整个请求 0 条」(首取页即空)成立;首页已并入行,次页空只是
  // 本轮追加无新增(加载更多越过上限),不能清空目录。
  const originalFetch = globalThis.fetch;
  let pageNo = 0;
  globalThis.fetch = async () => {
    pageNo += 1;
    return {
      ok: true,
      json: async () =>
        pageNo === 1
          ? {
              results: [recruitmentPoi('a', [{ id: 'p1', title: '后端', type: 'social', status: 'open' }])],
              total: -1,
            }
          : { results: [], total: 0 },
    };
  };
  try {
    const { pois, noMore, vacant } = await loadWorkViewport({
      bounds: VIEWPORT_BOX,
      pageSize: 1, // 首页 1 条 = 满页 → 继续第 2 页
      maxPages: 3,
      existing: [],
    });
    assert.deepEqual(pois.map((p) => p.id), ['a']);
    assert.equal(noMore, false); // 次页空 → 空批次不闩锁
    assert.equal(vacant, false); // 首页有数据 → 非真空
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('catalogCoversView: 旧目录是否仍有 POI 落在视野内(空批次三态判定)', () => {
  const inView = recruitmentPoi('in', [{ id: 'p1', title: '后端', type: 'social', status: 'open' }]);
  inView.location = { lng: 120.2, lat: 30.25 }; // VIEWPORT_BOX 内
  const outView = recruitmentPoi('out', [{ id: 'p1', title: '后端', type: 'social', status: 'open' }]);
  outView.location = { lng: 130.0, lat: 35.0 }; // 视野外(旧城市 pin)
  // 有 POI 在视野内 → 保留旧目录(收藏 fitToPins 退化视野)
  assert.equal(catalogCoversView([inView], VIEWPORT_BOX), true);
  assert.equal(catalogCoversView([inView, outView], VIEWPORT_BOX), true);
  // 无任何 POI 在视野内 → 真空,可清空
  assert.equal(catalogCoversView([outView], VIEWPORT_BOX), false);
  // 空目录 / 无 bounds → 一律按真空处理
  assert.equal(catalogCoversView([], VIEWPORT_BOX), false);
  assert.equal(catalogCoversView([inView], null), false);
  assert.equal(catalogCoversView([inView], undefined), false);
});

test('needsViewportAlign: 无快照/远中心/zoom 差超阈值 → 不符(触发对齐加载)', () => {
  assert.equal(VIEWPORT_ALIGN_CENTER_KM, 25);
  assert.equal(VIEWPORT_ALIGN_ZOOM_DELTA, 2);
  const hz = { center: { lng: 120.15, lat: 30.27 }, zoom: 13 };
  // 旧缓存无快照字段 → 一律按不符处理
  assert.equal(needsViewportAlign(undefined, { lng: 120.15, lat: 30.27 }, 13), true);
  assert.equal(needsViewportAlign(null, { lng: 120.15, lat: 30.27 }, 13), true);
  // 杭州 ↔ 上海 ~168km > 25km → 不符
  assert.equal(needsViewportAlign(hz, { lng: 121.47, lat: 31.23 }, 13), true);
  // zoom 差 3 > 2 → 不符
  assert.equal(needsViewportAlign(hz, { lng: 120.16, lat: 30.28 }, 16), true);
  // 同城 ~5km 且 zoom 差 ≤ 2 → 相符,不触发
  assert.equal(needsViewportAlign(hz, { lng: 120.2, lat: 30.25 }, 13), false);
  assert.equal(needsViewportAlign(hz, { lng: 120.15, lat: 30.27 }, 15), false);
});
