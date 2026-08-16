import test from 'node:test';
import assert from 'node:assert/strict';

import { INTERNSHIP_SEED } from '../src/lib/seed-data.ts';
import { mergeMapPois, overlayBounds, savedPlacesToOverlay } from '../src/lib/saved-overlay.ts';

test('savedPlacesToOverlay uses live recruitment when catalog hits', () => {
  const overlay = savedPlacesToOverlay(
    [
      {
        id: 's1',
        poiId: 'alibaba-xixi',
        name: '阿里巴巴西溪',
        mode: 'work',
        kind: 'recruitment',
        lng: 120.02,
        lat: 30.28,
        createdAt: '2026-08-16T00:00:00.000Z',
      },
    ],
    INTERNSHIP_SEED,
  );
  assert.equal(overlay.length, 1);
  assert.equal(overlay[0].kind, 'recruitment');
  assert.equal(overlay[0].name, '阿里巴巴');
});

test('savedPlacesToOverlay falls back to a pin from the snapshot', () => {
  const overlay = savedPlacesToOverlay(
    [
      {
        id: 's2',
        poiId: 'hz-cafe',
        name: '某咖啡',
        mode: 'domain',
        kind: 'domain',
        address: '西湖区',
        lng: 120.16,
        lat: 30.25,
        createdAt: '2026-08-16T00:00:00.000Z',
      },
      {
        id: 's3',
        poiId: 'no-coords',
        name: '没坐标',
        mode: 'domain',
        kind: 'domain',
        createdAt: '2026-08-16T00:00:00.000Z',
      },
    ],
    [],
  );
  assert.equal(overlay.length, 1);
  assert.equal(overlay[0].kind, 'domain');
  assert.equal(overlay[0].location.lng, 120.16);
});

test('mergeMapPois keeps search results first and only adds missing saved pins', () => {
  const alibaba = INTERNSHIP_SEED.find((item) => item.id === 'alibaba-xixi');
  assert.ok(alibaba);
  const overlay = savedPlacesToOverlay(
    [
      {
        id: 's1',
        poiId: 'alibaba-xixi',
        name: '阿里',
        mode: 'work',
        kind: 'recruitment',
        createdAt: '2026-08-16T00:00:00.000Z',
      },
      {
        id: 's2',
        poiId: 'extra',
        name: '额外',
        mode: 'domain',
        kind: 'domain',
        lng: 120.1,
        lat: 30.2,
        createdAt: '2026-08-16T00:00:00.000Z',
      },
    ],
    INTERNSHIP_SEED,
  );
  const merged = mergeMapPois([alibaba], overlay, true);
  assert.equal(merged[0].id, 'alibaba-xixi');
  assert.ok(merged.some((poi) => poi.id === 'extra'));
  assert.equal(mergeMapPois([alibaba], overlay, false).length, 1);
});

test('overlayBounds covers every saved pin', () => {
  const bounds = overlayBounds([
    { id: 'a', kind: 'domain', name: 'A', mode: 'domain', source: 'api', location: { lng: 120, lat: 30 }, category: '收藏' },
    { id: 'b', kind: 'domain', name: 'B', mode: 'domain', source: 'api', location: { lng: 121, lat: 31 }, category: '收藏' },
  ]);
  assert.ok(bounds);
  assert.equal(bounds.sw.lng, 120);
  assert.equal(bounds.sw.lat, 30);
  assert.equal(bounds.ne.lng, 121);
  assert.equal(bounds.ne.lat, 31);
  assert.equal(overlayBounds([]), null);
});
