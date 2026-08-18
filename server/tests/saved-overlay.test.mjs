import test from 'node:test';
import assert from 'node:assert/strict';

import { INTERNSHIP_SEED } from '../src/lib/seed-data.ts';
import {
  amapStyleUrl,
  parseMapStyle,
  overlayBounds,
  mergeMapPois,
  resolveSavedForFly,
  savedPlacesToOverlay,
} from '../src/lib/saved-overlay.ts';

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

test('savedPlacesToOverlay work mode keeps only work/internship saves, drops domain places', () => {
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
      {
        id: 's2',
        poiId: 'intern-save',
        name: '实习公司',
        mode: 'internship',
        kind: 'recruitment',
        lng: 120.1,
        lat: 30.2,
        createdAt: '2026-08-16T00:00:00.000Z',
      },
      {
        id: 's3',
        poiId: 'hz-cafe',
        name: '某咖啡',
        mode: 'domain',
        kind: 'domain',
        lng: 120.16,
        lat: 30.25,
        createdAt: '2026-08-16T00:00:00.000Z',
      },
    ],
    [],
    'work',
  );
  assert.equal(overlay.length, 2);
  assert.ok(overlay.every((poi) => poi.id !== 'hz-cafe'));
  assert.ok(overlay.some((poi) => poi.id === 'alibaba-xixi'));
  assert.ok(overlay.some((poi) => poi.id === 'intern-save'));
});

test('savedPlacesToOverlay internship mode aliases work filter', () => {
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
      {
        id: 's2',
        poiId: 'hz-cafe',
        name: '某咖啡',
        mode: 'domain',
        kind: 'domain',
        lng: 120.16,
        lat: 30.25,
        createdAt: '2026-08-16T00:00:00.000Z',
      },
    ],
    [],
    'internship',
  );
  assert.deepEqual(overlay.map((poi) => poi.id), ['alibaba-xixi']);
});

test('savedPlacesToOverlay domain mode keeps only domain places, drops work saves', () => {
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
      {
        id: 's2',
        poiId: 'hz-cafe',
        name: '某咖啡',
        mode: 'domain',
        kind: 'domain',
        lng: 120.16,
        lat: 30.25,
        createdAt: '2026-08-16T00:00:00.000Z',
      },
    ],
    [],
    'domain',
  );
  assert.equal(overlay.length, 1);
  assert.equal(overlay[0].kind, 'domain');
  assert.equal(overlay[0].id, 'hz-cafe');
});

test('work saved company missing from catalog falls back to a recruitment pin, not a domain pin', () => {
  const overlay = savedPlacesToOverlay(
    [
      {
        id: 's1',
        poiId: 'no-live-company',
        name: '冷门公司',
        mode: 'work',
        kind: 'recruitment',
        lng: 120.02,
        lat: 30.28,
        createdAt: '2026-08-16T00:00:00.000Z',
      },
    ],
    [],
    'work',
  );
  assert.equal(overlay.length, 1);
  assert.equal(overlay[0].kind, 'recruitment');
  assert.equal(overlay[0].mode, 'work');
  assert.equal(overlay[0].positions.length, 0);
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

test('parseMapStyle only accepts the three basemap keys', () => {
  assert.equal(parseMapStyle('satellite'), 'satellite');
  assert.equal(parseMapStyle('whitesmoke'), 'whitesmoke');
  assert.equal(parseMapStyle('normal'), 'normal');
  assert.equal(parseMapStyle('dark'), null);
  assert.equal(parseMapStyle(null), null);
});

test('amapStyleUrl never points satellite at a style URL', () => {
  assert.equal(amapStyleUrl('normal'), 'amap://styles/normal');
  assert.equal(amapStyleUrl('whitesmoke'), 'amap://styles/whitesmoke');
});

test('resolveSavedForFly prefers the first live catalog hit', () => {
  const alibaba = INTERNSHIP_SEED.find((item) => item.id === 'alibaba-xixi');
  assert.ok(alibaba);
  const hit = resolveSavedForFly({ poiId: 'alibaba-xixi' }, [alibaba]);
  assert.equal(hit?.id, 'alibaba-xixi');
  assert.equal(resolveSavedForFly({ poiId: 'missing', lng: 120, lat: 30 }, []), undefined);
});
