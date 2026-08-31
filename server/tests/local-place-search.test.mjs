import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expandPlaceSearchTerms,
  formatLocalPlaceHits,
  parsePlaceQuery,
  preferLocalPlaceSearch,
  searchLocalPlaces,
} from '../src/lib/agent/local-place-search.ts';

test('parsePlaceQuery: 深圳腾讯 → city 深圳 + keyword 腾讯', () => {
  assert.deepEqual(parsePlaceQuery('深圳腾讯'), { keyword: '腾讯', city: '深圳' });
  assert.deepEqual(parsePlaceQuery('腾讯大厦', '深圳市'), { keyword: '腾讯', city: '深圳' });
  assert.deepEqual(parsePlaceQuery('咖啡'), { keyword: '咖啡' });
});

test('expandPlaceSearchTerms: 腾讯别名含 tencent', () => {
  const terms = expandPlaceSearchTerms('腾讯大厦');
  assert.ok(terms.includes('腾讯'));
  assert.ok(terms.includes('tencent'));
});

test('searchLocalPlaces: 招聘目录命中且带城市时不查杭州 POI', async () => {
  let domainCalls = 0;
  const hits = await searchLocalPlaces('深圳腾讯', undefined, {
    searchWork: async (terms, city) => {
      assert.ok(terms.includes('腾讯'));
      assert.equal(city, '深圳');
      return [{ source: 'work', name: '腾讯', address: '滨海大厦', city: '深圳市', lng: 113.93, lat: 22.54 }];
    },
    searchDomain: async () => {
      domainCalls += 1;
      return [{ source: 'domain', name: '不该出现', address: '西湖', city: '杭州', lng: 120.1, lat: 30.2 }];
    },
  });
  assert.equal(domainCalls, 0);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, '腾讯');
});

test('searchLocalPlaces: 无城市时本地招聘未命中再查杭州 POI', async () => {
  const hits = await searchLocalPlaces('星巴克', undefined, {
    searchWork: async () => [],
    searchDomain: async (keyword) => {
      assert.equal(keyword, '星巴克');
      return [{ source: 'domain', name: '星巴克(湖滨)', address: '西湖区', city: '杭州', lng: 120.16, lat: 30.26 }];
    },
  });
  assert.equal(hits[0].source, 'domain');
});

test('preferLocalPlaceSearch: MCP 检索本地命中则不调用原工具', async () => {
  let called = 0;
  const inner = {
    name: 'amap__maps_text_search',
    description: 'search',
    inputSchema: { type: 'object', properties: {} },
    provider: 'amap',
    async call() {
      called += 1;
      return { ok: false, error: 'should not run' };
    },
  };
  const wrapped = preferLocalPlaceSearch(inner, async () => [
    { source: 'work', name: '腾讯', address: '滨海大厦', city: '深圳市', lng: 113.93, lat: 22.54 },
  ]);
  const r = await wrapped.call({ query: '深圳腾讯' }, { lang: 'zh', requestId: 't', signal: new AbortController().signal });
  assert.equal(called, 0);
  assert.equal(r.ok, true);
  if (r.ok) assert.match(r.text, /本地目录命中/);
});

test('preferLocalPlaceSearch: 非检索工具不包装', () => {
  const inner = {
    name: 'builtin__viewport',
    description: 'vp',
    inputSchema: { type: 'object', properties: {} },
    provider: 'builtin',
    async call() {
      return { ok: true, text: 'vp' };
    },
  };
  assert.equal(preferLocalPlaceSearch(inner), inner);
});

test('formatLocalPlaceHits: 标明未请求地图 API', () => {
  const text = formatLocalPlaceHits([
    { source: 'work', name: '腾讯', address: '滨海大厦', city: '深圳市', lng: 113.93, lat: 22.54 },
  ]);
  assert.match(text, /未请求地图 API/);
  assert.match(text, /113\.93,22\.54/);
});
