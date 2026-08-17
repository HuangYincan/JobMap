import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AMAP_FALLBACK_INITIAL_CALLS,
  DOMAIN_BATCH_SIZE,
  DOMAIN_POI_HARD_CAP,
  fallbackTaskWindow,
  inHangzhouBox,
  mergePoisById,
} from '../src/lib/viewport-search.ts';

test('常量:1000 上限 / 50 本地批 / 25 高德批', () => {
  assert.equal(DOMAIN_POI_HARD_CAP, 1000);
  assert.equal(DOMAIN_BATCH_SIZE, 50);
  assert.equal(AMAP_FALLBACK_INITIAL_CALLS, 1);
});

test('inHangzhouBox: 框内/框外', () => {
  assert.equal(inHangzhouBox({ lng: 120.15, lat: 30.27 }), true); // 西湖区
  assert.equal(inHangzhouBox({ lng: 119.0, lat: 29.5 }), true); // 淳安县
  assert.equal(inHangzhouBox({ lng: 121.4, lat: 31.2 }), false); // 上海
  assert.equal(inHangzhouBox({ lng: 116.4, lat: 39.9 }), false); // 北京
});

test('fallbackTaskWindow: 每次滚动 1 次(25 条)', () => {
  const keywords = ['餐饮服务', '购物服务', '风景名胜'];
  const w0 = fallbackTaskWindow(keywords, 4, 0);
  assert.equal(w0.length, AMAP_FALLBACK_INITIAL_CALLS);
  assert.deepEqual(w0[0], { keyword: '餐饮服务', page: 1 });
  const w1 = fallbackTaskWindow(keywords, 4, 1);
  assert.deepEqual(w1[0], { keyword: '购物服务', page: 1 }); // 续取下一任务
  const w2 = fallbackTaskWindow(keywords, 4, 2);
  assert.deepEqual(w2[0], { keyword: '风景名胜', page: 1 });
});

test('fallbackTaskWindow: 预算耗尽 → 空窗口', () => {
  const keywords = ['餐饮服务']; // 1 关键词 × 4 页 = 4 任务
  assert.equal(fallbackTaskWindow(keywords, 4, 0).length, 1);
  assert.equal(fallbackTaskWindow(keywords, 4, 1).length, 1);
  assert.equal(fallbackTaskWindow(keywords, 4, 3).length, 1);
  assert.equal(fallbackTaskWindow(keywords, 4, 4).length, 0); // 耗尽
});

test('mergePoisById: 到 DOMAIN_POI_HARD_CAP 停,不增长', () => {
  const existing = Array.from({ length: 1000 }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    mode: 'domain',
    kind: 'domain',
    source: 'api',
    location: { lng: 120 + i / 10000, lat: 30 },
    category: '餐饮服务',
  }));
  const incoming = Array.from({ length: 500 }, (_, i) => ({
    id: `q${i}`,
    name: `Q${i}`,
    mode: 'domain',
    kind: 'domain',
    source: 'api',
    location: { lng: 120.5 + i / 10000, lat: 30.2 },
    category: '购物服务',
  }));
  const merged = mergePoisById(existing, incoming, DOMAIN_POI_HARD_CAP);
  assert.equal(merged.length, DOMAIN_POI_HARD_CAP);
});

test('mergePoisById: 去重(同 id 不重复)', () => {
  const a = [{ id: 'x', name: 'X', mode: 'domain', kind: 'domain', source: 'api', location: { lng: 120, lat: 30 }, category: '餐饮服务' }];
  const b = [{ id: 'x', name: 'X2', mode: 'domain', kind: 'domain', source: 'api', location: { lng: 120, lat: 30 }, category: '餐饮服务' }];
  const merged = mergePoisById(a, b, DOMAIN_POI_HARD_CAP);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, 'X');
});
