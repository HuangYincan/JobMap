import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAction } from '../src/lib/agent/action-schema.ts';
import { toolKind } from '../src/lib/agent/run-agent.ts';
import { workTools, resolvePositionsFromCatalog } from '../src/lib/agent/tools/work.ts';
import { navigationTools } from '../src/lib/agent/tools/navigation.ts';
import { loadWorkPositionByExternalIdFromDb } from '../src/lib/recruitment-store.ts';
import { loadWorkPositionsByExternalIdsFromDb } from '../src/lib/navigation/position-resolver.ts';
import { parseTopK } from '../src/lib/agent/tools/navigation.ts';
import { createRouteService } from '../src/lib/navigation/route-service.ts';
import { createRouteArtifactStore } from '../src/lib/navigation/route-artifacts.ts';
import { OPAQUE_ROUTE_ID_PATTERN } from '../src/lib/navigation/constants.ts';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const FULL_JD = 'FULL_JD_SHOULD_NEVER_APPEAR_IN_TOOL_TEXT';
const FINGERPRINT = 'a'.repeat(64);
const NOW = Date.parse('2026-08-28T08:00:00.000Z');

function ctx(overrides = {}) {
  return {
    lang: 'zh',
    requestId: 'nav-agent-test',
    signal: new AbortController().signal,
    navigationSession: { fingerprint: FINGERPRINT },
    ...overrides,
  };
}

function coord(label, lng, lat, extra = {}) {
  return {
    kind: 'coordinate',
    label,
    lng,
    lat,
    coordinateSystem: 'gcj02',
    precision: 'approximate',
    ...extra,
  };
}

function poi({ id, name, city, lng, lat, siteId, siteName, positions }) {
  return {
    id,
    kind: 'recruitment',
    name,
    mode: 'work',
    source: 'api',
    location: { lng, lat, address: city },
    company: { name, industries: ['internet'], scale: 'bigtech', tier: 3, category: '64', logoUrl: `https://store.is.autonavi.com/${id.split(':')[0]}.png` },
    sites: [
      {
        id: siteId,
        name: siteName,
        location: { lng, lat },
        city,
      },
    ],
    positions,
  };
}

function position(overrides) {
  return {
    id: 'pos-default',
    siteId: 'site-1',
    title: 'AI产品实习',
    type: 'intern',
    taxonomy: { family: 'intern' },
    salary: { min: 8000, max: 12000 },
    status: 'open',
    deadline: '2026-12-31',
    apply: { source: 'official', url: 'https://careers.example/x' },
    description: FULL_JD,
    ...overrides,
  };
}

function catalog() {
  return [
    poi({
      id: 'tencent:11',
      name: '腾讯',
      city: '杭州',
      lng: 120.12,
      lat: 30.28,
      siteId: '11',
      siteName: '杭州园区',
      positions: [
        position({ id: 'pos-tx-ai', title: 'AI产品实习', siteId: '11' }),
        position({
          id: 'pos-tx-closed',
          title: '已下线产品岗',
          siteId: '11',
          status: 'closed',
          deadline: '2020-01-01',
        }),
      ],
    }),
    poi({
      id: 'alibaba:21',
      name: '阿里巴巴',
      city: '杭州',
      lng: 120.13,
      lat: 30.29,
      siteId: '21',
      siteName: '西溪园区',
      positions: [position({ id: 'pos-ali-ai', title: '阿里 AI 产品岗', type: 'social', taxonomy: { family: 'social' }, siteId: '21' })],
    }),
    poi({
      id: 'farco:31',
      name: '远郊公司',
      city: '杭州',
      lng: 121.6,
      lat: 31.2,
      siteId: '31',
      siteName: '远郊办公点',
      positions: [position({ id: 'pos-far', title: '远郊 AI 实习', siteId: '31' })],
    }),
  ];
}

function workDeps() {
  const data = catalog();
  return {
    loadCatalog: async () => data,
    getPosition: async (id) => {
      const [hit] = resolvePositionsFromCatalog(data, [id], new Date('2026-08-28T00:00:00'));
      return hit;
    },
    now: () => new Date('2026-08-28T00:00:00'),
  };
}

function providerValue(overrides = {}) {
  return {
    provider: 'amap',
    quality: 'provider_route',
    mode: 'transit',
    durationSeconds: 1_200,
    distanceMeters: 8_000,
    trafficAware: false,
    fetchedAt: '2026-08-28T08:00:00.000Z',
    expiresAt: '2026-08-28T08:10:00.000Z',
    coordinateSystem: 'gcj02',
    geometry: [
      { lng: 120.1, lat: 30.2 },
      { lng: 120.12, lat: 30.28 },
    ],
    warnings: [],
    ...overrides,
  };
}

function fakeProvider(overrides = {}) {
  return {
    id: 'amap',
    isConfigured: () => true,
    supports: () => true,
    plan: async () => ({ ok: true, value: providerValue() }),
    ...overrides,
  };
}

function countingService(inner) {
  const calls = [];
  return {
    calls,
    async plan(request, session, signal) {
      calls.push({ request, session });
      return inner.plan(request, session, signal);
    },
  };
}

function tool(tools, name) {
  const found = tools.find((item) => item.name === name);
  assert.ok(found, `missing tool ${name}`);
  return found;
}

function assertNoGeometry(text) {
  assert.doesNotMatch(text, /geometry|polyline/i);
  assert.doesNotMatch(text, /\[\s*\{\s*"?lng"?\s*:/);
  assert.doesNotMatch(text, /dm_navigation_session/);
  assert.doesNotMatch(text, /AMAP_WEB_KEY|sk-/);
}

test('five domain tools expose schema, names and providers', () => {
  const tools = [...workTools(workDeps()), ...navigationTools({ routeService: countingService(createRouteService({ providers: [] })) })];
  assert.deepEqual(
    tools.map((item) => `${item.provider}:${item.name}`),
    [
      'work:work__searchPositions',
      'work:work__getPositionDetail',
      'navigation:navigation__planRoute',
      'navigation:navigation__compareCommutes',
      'navigation:navigation__filterByCommute',
    ],
  );
  assert.equal(toolKind('work__searchPositions'), 'project');
  assert.equal(toolKind('work__getPositionDetail'), 'project');
  assert.equal(toolKind('navigation__planRoute'), 'directions');
  assert.equal(toolKind('navigation__compareCommutes'), 'directions');
  assert.equal(toolKind('navigation__filterByCommute'), 'directions');
});

test('work__searchPositions ranks by userLocation over viewport center and attaches logos', async () => {
  const search = tool(workTools(workDeps()), 'work__searchPositions');
  const shanghai = await search.call(
    { query: 'AI' },
    ctx({
      userLocation: { lng: 121.6, lat: 31.2 },
      viewport: { center: { lng: 120.15, lat: 30.28 }, zoom: 12 },
    }),
  );
  assert.equal(shanghai.ok, true);
  const farIdx = shanghai.text.indexOf('pos-far');
  const txIdx = shanghai.text.indexOf('pos-tx-ai');
  assert.ok(farIdx !== -1 && txIdx !== -1 && farIdx < txIdx, '上海用户位置应让远郊岗位排在杭州岗位前');
  assert.match(shanghai.text, /距起点/);
  assert.ok(Array.isArray(shanghai.images) && shanghai.images.length > 0);
  assert.ok(shanghai.images[0].url.startsWith('https://'));

  const hangzhouView = await search.call(
    { query: 'AI' },
    ctx({
      viewport: { center: { lng: 120.12, lat: 30.28 }, zoom: 12 },
    }),
  );
  assert.equal(hangzhouView.ok, true);
  assert.ok(hangzhouView.text.indexOf('pos-tx-ai') < hangzhouView.text.indexOf('pos-far'));
});

test('work__searchPositions uses injected catalog; omits full JD; clamps pageSize', async () => {
  const search = tool(workTools(workDeps()), 'work__searchPositions');
  const result = await search.call({ query: 'AI产品', city: '杭州', family: 'intern', pageSize: 100 }, ctx());
  assert.equal(result.ok, true);
  assert.match(result.text, /pos-tx-ai/);
  assert.match(result.text, /mapId=tencent:11/);
  assert.match(result.text, /办公点 GCJ-02 120\.12,30\.28/);
  assert.match(result.text, /禁止写入对用户正文/);
  assert.equal(result.mapHints?.length, 1);
  assert.equal(result.mapHints[0].mapId, 'tencent:11');
  assert.equal(result.mapHints[0].positionId, 'pos-tx-ai');
  assert.equal(result.mapHints[0].lng, 120.12);
  assert.match(result.text, /每页 20/);
  assert.doesNotMatch(result.text, new RegExp(FULL_JD));
  assert.doesNotMatch(result.text, /pos-tx-closed/);
  assertNoGeometry(result.text);
});

test('work__getPositionDetail fail-closed for missing/offline; no full JD', async () => {
  const detail = tool(workTools(workDeps()), 'work__getPositionDetail');
  const missing = await detail.call({ positionId: 'no-such-job' }, ctx());
  assert.equal(missing.ok, false);
  assert.match(missing.error, /不存在或已下线/);

  const closed = await detail.call({ positionId: 'pos-tx-closed' }, ctx());
  assert.equal(closed.ok, false);
  assert.match(closed.error, /不存在或已下线/);

  const ok = await detail.call({ positionId: 'pos-tx-ai' }, ctx());
  assert.equal(ok.ok, true);
  assert.match(ok.text, /pos-tx-ai/);
  assert.match(ok.text, /mapId=tencent:11/);
  assert.match(ok.text, /gcj02/);
  assert.doesNotMatch(ok.text, new RegExp(FULL_JD));
  assert.equal(ok.mapHints?.length, 1);
  assert.equal(ok.mapHints[0].mapId, 'tencent:11');
  assert.equal(ok.mapHints[0].lng, 120.12);
});

test('loadWorkPositionByExternalIdFromDb is a targeted open/alive read without description', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      return {
        rows: [{
          external_id: 'portal-target',
          title: 'Target role',
          department: 'RD',
          family: 'social',
          salary_min: 10,
          salary_max: 20,
          education: '本科',
          deadline: null,
          apply_source: 'official',
          status: 'open',
          site_id: '102',
          slug: 'acme',
          company_name: 'Acme',
          site_name: 'Beijing',
          city: '北京市',
          lng: 116.41,
          lat: 39.91,
        }],
      };
    },
  };
  const record = await loadWorkPositionByExternalIdFromDb('portal-target', pool);
  assert.equal(record?.positionId, 'portal-target');
  assert.equal(record?.companyCatalogId, 'acme:102');
  assert.equal(record?.location?.coordinateSystem, 'gcj02');
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, ['portal-target']);
  assert.match(queries[0].sql, /p\.external_id = \$1/);
  assert.match(queries[0].sql, /status = 'open'/);
  assert.match(queries[0].sql, /p\.deadline IS NULL OR p\.deadline >= CURRENT_DATE/);
  assert.doesNotMatch(queries[0].sql, /p\.description/);
  assert.doesNotMatch(queries[0].sql, /FROM companies ORDER BY slug/);
  assert.equal(await loadWorkPositionByExternalIdFromDb('', pool), undefined);
});

test('loadWorkPositionsByExternalIdsFromDb batches, de-duplicates, and restores request order', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows: [
          {
            external_id: 'pos-b', title: 'B', department: null, family: 'social',
            salary_min: null, salary_max: null, education: null, deadline: null,
            apply_source: null, status: 'open', site_id: '2', slug: 'co', company_name: 'Co',
            site_name: 'Site B', city: '杭州', lng: 120.2, lat: 30.2,
          },
          {
            external_id: 'pos-a', title: 'A', department: null, family: 'social',
            salary_min: null, salary_max: null, education: null, deadline: null,
            apply_source: null, status: 'open', site_id: '1', slug: 'co', company_name: 'Co',
            site_name: 'Site A', city: '杭州', lng: 120.1, lat: 30.1,
          },
        ],
      };
    },
  };
  const records = await loadWorkPositionsByExternalIdsFromDb(['pos-a', 'pos-a', 'missing', 'pos-b'], pool);
  assert.deepEqual(records.map((record) => record.positionId), ['pos-a', 'pos-b']);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /ANY\(\$1::text\[\]\)/);
  assert.match(calls[0].sql, /array_position/);
  assert.deepEqual(calls[0].params, [['pos-a', 'missing', 'pos-b']]);
});

test('parseTopK rejects non-finite, fractional, and out-of-range values', () => {
  assert.equal(parseTopK(undefined), 5);
  assert.equal(parseTopK(1), 1);
  assert.equal(parseTopK(5), 5);
  for (const value of [NaN, Infinity, 0, -1, 1.5, 6, '5', null]) {
    assert.equal(parseTopK(value), null, `invalid topK ${String(value)} must be rejected`);
  }
});

test('planRoute without session or missing origin does not call the provider', async () => {
  const inner = countingService(createRouteService({ providers: [fakeProvider()], clock: () => NOW }));
  const tools = navigationTools({ routeService: inner });
  const plan = tool(tools, 'navigation__planRoute');

  const noSession = await plan.call(
    { origin: coord('家', 120.1, 30.2), destination: coord('园', 120.12, 30.28), mode: 'transit' },
    ctx({ navigationSession: undefined }),
  );
  assert.equal(noSession.ok, false);
  assert.equal(inner.calls.length, 0);

  const missing = await plan.call(
    { task: 'job_search', city: '杭州', missingSlots: ['origin'], mode: 'transit' },
    ctx(),
  );
  assert.equal(missing.ok, false);
  assert.equal(inner.calls.length, 0);
});

test('planRoute estimate has no routeId or geometry; fake provider issues routeId without geometry in text', async () => {
  const estimateService = countingService(createRouteService({ providers: [], clock: () => NOW }));
  const estimateTools = navigationTools({ routeService: estimateService });
  const estimate = await tool(estimateTools, 'navigation__planRoute').call(
    { origin: coord('家', 120.1, 30.2), destination: coord('园', 120.12, 30.28), mode: 'transit' },
    ctx(),
  );
  assert.equal(estimate.ok, true);
  assert.match(estimate.text, /quality=estimate/);
  assert.doesNotMatch(estimate.text, /routeId=/);
  assertNoGeometry(estimate.text);

  const issued = `rte_${'b'.repeat(32)}`;
  const live = createRouteService({
    providers: [fakeProvider()],
    artifactStore: createRouteArtifactStore({ clock: () => NOW }),
    clock: () => NOW,
    idGenerator: () => issued,
  });
  const liveTools = navigationTools({ routeService: live });
  const providerHit = await tool(liveTools, 'navigation__planRoute').call(
    { origin: coord('家', 120.1, 30.2), destination: coord('园', 120.12, 30.28), mode: 'transit' },
    ctx(),
  );
  assert.equal(providerHit.ok, true);
  assert.match(providerHit.text, /quality=provider_route/);
  assert.match(providerHit.text, new RegExp(`routeId=${issued}`));
  assert.ok(OPAQUE_ROUTE_ID_PATTERN.test(issued));
  assertNoGeometry(providerHit.text);
});

test('compareCommutes builds a 2-5 matrix, surfaces partial failure, and has no score field', async () => {
  const service = {
    async plan(request) {
      if (request.destination.label === '失败点') {
        return { ok: false, error: { code: 'TIMEOUT', message: '路线服务响应超时', retryable: true } };
      }
      return {
        ok: true,
        plan: {
          mode: 'transit',
          originLabel: '家',
          destinationLabel: request.destination.label,
          durationSeconds: 900,
          distanceMeters: 4000,
          provider: 'estimate',
          quality: 'estimate',
          trafficAware: false,
          fetchedAt: '2026-08-28T08:00:00.000Z',
          expiresAt: '2026-08-28T08:05:00.000Z',
          warnings: ['基于两点直线距离估算，不代表道路路线、实时路况或可信路线几何'],
        },
      };
    },
  };
  const compare = tool(navigationTools({ routeService: service }), 'navigation__compareCommutes');
  const result = await compare.call(
    {
      origin: coord('家', 120.1, 30.2),
      mode: 'transit',
      destinations: [
        { id: 'a', label: '近点', location: coord('近点', 120.12, 30.28) },
        { id: 'b', label: '失败点', location: coord('失败点', 120.13, 30.29) },
        { id: 'c', label: '另一点', location: coord('另一点', 120.14, 30.27) },
      ],
    },
    ctx(),
  );
  assert.equal(result.ok, true);
  assert.match(result.text, /近点/);
  assert.match(result.text, /失败 TIMEOUT/);
  assert.match(result.text, /另一点/);
  assert.doesNotMatch(result.text, /总分|score|recommend/i);
  assertNoGeometry(result.text);
});

test('filterByCommute keeps strict hits vs over-limit nearest; Top-K budget blocks N+1', async () => {
  const calls = [];
  const service = {
    async plan(request) {
      calls.push(request.destination.label);
      const far = request.destination.label.includes('远');
      return {
        ok: true,
        plan: {
          mode: 'transit',
          originLabel: '家',
          destinationLabel: request.destination.label,
          durationSeconds: far ? 4_000 : 1_200,
          distanceMeters: far ? 40_000 : 6_000,
          provider: 'estimate',
          quality: 'estimate',
          trafficAware: false,
          fetchedAt: '2026-08-28T08:00:00.000Z',
          expiresAt: '2026-08-28T08:05:00.000Z',
          warnings: ['基于两点直线距离估算，不代表道路路线、实时路况或可信路线几何'],
        },
      };
    },
  };
  const data = catalog();
  const tools = navigationTools({
    routeService: service,
    resolvePositions: async (ids) => resolvePositionsFromCatalog(data, ids, new Date('2026-08-28T00:00:00')),
  });
  const filter = tool(tools, 'navigation__filterByCommute');
  const origin = coord('家', 120.1, 30.2, { city: '杭州' });

  const hits = await filter.call(
    { positionIds: ['pos-tx-ai', 'pos-ali-ai'], origin, maxMinutes: 45, mode: 'transit', topK: 5 },
    ctx(),
  );
  assert.equal(hits.ok, true);
  assert.match(hits.text, /严格命中 2 个/);
  assert.doesNotMatch(hits.text, /最接近候选/);

  calls.length = 0;
  const none = await filter.call(
    { positionIds: ['pos-far'], origin, maxMinutes: 45, mode: 'transit', topK: 5 },
    ctx(),
  );
  assert.equal(none.ok, true);
  assert.match(none.text, /严格命中 0 个/);
  assert.match(none.text, /最接近候选: pos-far/);
  assert.match(none.text, /放宽到/);

  calls.length = 0;
  const manyIds = ['pos-tx-ai', 'pos-ali-ai', 'pos-far', 'pos-tx-ai', 'pos-ali-ai', 'pos-far', 'pos-tx-ai', 'pos-ali-ai'];
  const budget = await filter.call(
    { positionIds: manyIds, origin, maxMinutes: 45, mode: 'transit', topK: 5 },
    ctx(),
  );
  assert.equal(budget.ok, true);
  assert.ok(calls.length <= 5, `Top-K budget, got ${calls.length} route calls`);
  assert.match(budget.text, /Top-K=5|路线调用预算/);
});

test('filterByCommute returns input error for invalid topK instead of empty candidates', async () => {
  let hydrated = false;
  const filter = tool(navigationTools({
    routeService: { async plan() { throw new Error('must not route'); } },
    resolvePositions: async () => { hydrated = true; return []; },
  }), 'navigation__filterByCommute');
  const result = await filter.call({
    positionIds: ['pos-a'],
    origin: coord('家', 120.1, 30.2),
    maxMinutes: 45,
    mode: 'transit',
    topK: NaN,
  }, ctx());
  assert.equal(result.ok, false);
  assert.match(result.error, /Top-K/);
  assert.equal(hydrated, false);
});

test('validateAction showRoute accepts opaque ids and rejects geometry', () => {
  const routeId = `rte_${'c'.repeat(32)}`;
  assert.deepEqual(validateAction({ type: 'showRoute', payload: { routeId } }), {
    type: 'showRoute',
    payload: { routeId },
  });
  assert.equal(validateAction({ type: 'showRoute', payload: { routeId: 'rte_xx' } }), null);
  assert.equal(
    validateAction({ type: 'showRoute', payload: { routeId, polyline: '1,2;3,4' } }),
    null,
  );
});

test('chat route and panel source: tools, cookie mint, showRoute label, validation before MCP/LLM', () => {
  const route = readFileSync(join(srcRoot, 'app/api/agent/chat/route.ts'), 'utf8');
  const panel = readFileSync(join(srcRoot, 'components/agent-panel.tsx'), 'utf8');
  assert.match(route, /workTools\(\)/);
  assert.match(route, /navigationTools\(\)/);
  assert.match(route, /createNavigationSessionToken/);
  assert.match(route, /serializeNavigationSessionCookie/);
  const mint = route.indexOf('readNavigationSessionToken');
  assert.ok(mint < route.indexOf('getMcpProvider('));
  assert.ok(mint < route.indexOf('runAgent('));
  assert.match(panel, /case "showRoute"/);
  assert.match(panel, /agentShowRoute/);
});

test('scenario A commute search chain with injected catalog/route', async () => {
  const data = catalog();
  const work = workTools(workDeps());
  const service = {
    async plan(request) {
      const far = request.destination.label.includes('远郊');
      return {
        ok: true,
        plan: {
          mode: 'transit',
          originLabel: '家',
          destinationLabel: request.destination.label,
          durationSeconds: far ? 5_000 : 1_000,
          distanceMeters: far ? 50_000 : 5_000,
          provider: 'estimate',
          quality: 'estimate',
          trafficAware: false,
          fetchedAt: '2026-08-28T08:00:00.000Z',
          expiresAt: '2026-08-28T08:05:00.000Z',
          warnings: ['基于两点直线距离估算，不代表道路路线、实时路况或可信路线几何'],
        },
      };
    },
  };
  const nav = navigationTools({
    routeService: service,
    resolvePositions: async (ids) => resolvePositionsFromCatalog(data, ids, new Date('2026-08-28T00:00:00')),
  });
  const found = await tool(work, 'work__searchPositions').call(
    { query: 'AI', city: '杭州', family: 'intern' },
    ctx(),
  );
  assert.match(found.text, /pos-tx-ai/);
  const filtered = await tool(nav, 'navigation__filterByCommute').call(
    {
      positionIds: ['pos-tx-ai', 'pos-far'],
      origin: coord('地铁站', 120.1, 30.2, { city: '杭州' }),
      maxMinutes: 45,
      mode: 'transit',
    },
    ctx(),
  );
  assert.match(filtered.text, /严格命中 1 个/);
  assert.match(filtered.text, /pos-tx-ai/);
  assert.doesNotMatch(filtered.text, /严格命中 2/);
});

test('scenario B job+commute compare chain', async () => {
  const detail = tool(workTools(workDeps()), 'work__getPositionDetail');
  const tx = await detail.call({ positionId: 'pos-tx-ai' }, ctx());
  const ali = await detail.call({ positionId: 'pos-ali-ai' }, ctx());
  assert.match(tx.text, /腾讯/);
  assert.match(ali.text, /阿里巴巴/);
  const compare = tool(
    navigationTools({
      routeService: {
        async plan() {
          return {
            ok: true,
            plan: {
              mode: 'transit',
              originLabel: '家',
              destinationLabel: '园',
              durationSeconds: 1100,
              distanceMeters: 7000,
              provider: 'estimate',
              quality: 'estimate',
              trafficAware: false,
              fetchedAt: '2026-08-28T08:00:00.000Z',
              expiresAt: '2026-08-28T08:05:00.000Z',
              warnings: ['基于两点直线距离估算，不代表道路路线、实时路况或可信路线几何'],
            },
          };
        },
      },
    }),
    'navigation__compareCommutes',
  );
  const matrix = await compare.call(
    {
      origin: coord('家', 120.1, 30.2),
      mode: 'transit',
      destinations: [
        { id: 'pos-tx-ai', label: '腾讯杭州', location: coord('腾讯杭州', 120.12, 30.28) },
        { id: 'pos-ali-ai', label: '阿里杭州', location: coord('阿里杭州', 120.13, 30.29) },
      ],
    },
    ctx(),
  );
  assert.match(matrix.text, /腾讯杭州/);
  assert.match(matrix.text, /阿里杭州/);
  assert.doesNotMatch(matrix.text, /总分/);
});

test('scenario C interview arrival reverse-plan uses arrivalAt', async () => {
  const estimate = createRouteService({ providers: [], clock: () => NOW });
  const plan = tool(navigationTools({ routeService: estimate }), 'navigation__planRoute');
  const result = await plan.call(
    {
      origin: coord('家', 120.1, 30.2),
      destination: coord('腾讯杭州园区', 120.12, 30.28),
      mode: 'transit',
      arrivalAt: '2026-08-29T01:00:00.000Z',
      timezone: 'Asia/Shanghai',
    },
    ctx(),
  );
  assert.equal(result.ok, true);
  assert.match(result.text, /quality=estimate/);
  assert.match(result.text, /arrivalAt=2026-08-29T01:00:00.000Z/);
  assert.match(result.text, /departureAt=/);
  assert.doesNotMatch(result.text, /routeId=/);
  assertNoGeometry(result.text);
});
