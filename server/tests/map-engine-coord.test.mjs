// ============================================================
// 坐标转换测试 — MapEngine 内核(coord-utils)
// 固定点位对照(天安门 gcj02 ↔ bd09,±1e-5)、往返误差、境外零偏移。
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wgs84ToGcj02,
  gcj02ToWgs84,
  gcj02ToBd09,
  bd09ToGcj02,
} from '../src/lib/map-engine/coord-utils.ts';

const EPS = 1e-5;

function approx(actual, expected, label) {
  assert.ok(
    Math.abs(actual.lng - expected.lng) <= EPS && Math.abs(actual.lat - expected.lat) <= EPS,
    `${label}: got (${actual.lng}, ${actual.lat}), want ≈(${expected.lng}, ${expected.lat})`,
  );
}

test('天安门固定点位:gcj02 (116.397428, 39.90923) ↔ bd09 (116.403963, 39.915119)', () => {
  const gcj = { lng: 116.397428, lat: 39.90923 };
  const bd = { lng: 116.403963, lat: 39.915119 };
  approx(gcj02ToBd09(gcj.lng, gcj.lat), bd, 'gcj02→bd09');
  approx(bd09ToGcj02(bd.lng, bd.lat), gcj, 'bd09→gcj02');
});

test('gcj02 ↔ bd09 往返:多城点位误差 < 1e-5', () => {
  const points = [
    { lng: 116.397428, lat: 39.90923 }, // 北京天安门
    { lng: 121.473701, lat: 31.230416 }, // 上海人民广场
    { lng: 114.057868, lat: 22.543099 }, // 深圳市民中心
    { lng: 104.065735, lat: 30.659462 }, // 成都天府广场
    { lng: 87.61682, lat: 43.825592 }, // 乌鲁木齐
  ];
  for (const p of points) {
    const bd = gcj02ToBd09(p.lng, p.lat);
    approx(bd09ToGcj02(bd.lng, bd.lat), p, `gcj→bd→gcj ${p.lng},${p.lat}`);
  }
});

test('wgs84 ↔ gcj02 往返:境内点位误差 < 1e-5,且偏移显著', () => {
  const points = [
    { lng: 116.397428, lat: 39.90923 },
    { lng: 121.473701, lat: 31.230416 },
    { lng: 114.057868, lat: 22.543099 },
    { lng: 87.61682, lat: 43.825592 },
  ];
  for (const p of points) {
    const gcj = wgs84ToGcj02(p.lng, p.lat);
    approx(gcj02ToWgs84(gcj.lng, gcj.lat), p, `wgs→gcj→wgs ${p.lng},${p.lat}`);
    // 境内偏移通常数百米(>0.001°);至少保证有可见偏移(>0.0001°)
    assert.ok(
      Math.abs(gcj.lng - p.lng) > 1e-4 || Math.abs(gcj.lat - p.lat) > 1e-4,
      `境内坐标应有可见偏移: ${p.lng},${p.lat}`,
    );
  }
});

test('境外(中国大陆外):wgs84→gcj02 零偏移直通', () => {
  approx(wgs84ToGcj02(-122.4194, 37.7749), { lng: -122.4194, lat: 37.7749 }, '旧金山零偏移');
  approx(wgs84ToGcj02(0, 0), { lng: 0, lat: 0 }, '(0,0) 零偏移');
  approx(wgs84ToGcj02(151.2093, -33.8688), { lng: 151.2093, lat: -33.8688 }, '悉尼零偏移');
});

test('返回 LngLat 对象形态(lng/lat 数字)', () => {
  const r = gcj02ToBd09(116.397428, 39.90923);
  assert.equal(typeof r.lng, 'number');
  assert.equal(typeof r.lat, 'number');
  assert.deepEqual(Object.keys(r).sort(), ['lat', 'lng']);
  assert.equal(Number.isNaN(r.lng), false);
  assert.equal(Number.isNaN(r.lat), false);
});
