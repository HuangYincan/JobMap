import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CENTER_NEAR_DEG, DEFAULT_MAP_CENTER, isNearDefaultCenter } from '../src/lib/camera-center.ts';

test('isNearDefaultCenter: 默认中心与阈值内为 true', () => {
  assert.equal(isNearDefaultCenter({ lng: DEFAULT_MAP_CENTER.lng, lat: DEFAULT_MAP_CENTER.lat }), true);
  // 半阈值偏移(≈5.5km)仍视为默认位置
  assert.equal(
    isNearDefaultCenter({
      lng: DEFAULT_MAP_CENTER.lng + DEFAULT_CENTER_NEAR_DEG * 0.5,
      lat: DEFAULT_MAP_CENTER.lat - DEFAULT_CENTER_NEAR_DEG * 0.5,
    }),
    true,
  );
});

test('isNearDefaultCenter: 阈值外(用户视野/其他城市)为 false', () => {
  // 北京
  assert.equal(isNearDefaultCenter({ lng: 116.397, lat: 39.909 }), false);
  // 上海
  assert.equal(isNearDefaultCenter({ lng: 121.47, lat: 31.23 }), false);
  // 两倍阈值
  assert.equal(
    isNearDefaultCenter({
      lng: DEFAULT_MAP_CENTER.lng + DEFAULT_CENTER_NEAR_DEG * 2,
      lat: DEFAULT_MAP_CENTER.lat,
    }),
    false,
  );
});

test('isNearDefaultCenter: 空值不判定为默认', () => {
  assert.equal(isNearDefaultCenter(null), false);
  assert.equal(isNearDefaultCenter(undefined), false);
});
