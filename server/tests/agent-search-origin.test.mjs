import test from 'node:test';
import assert from 'node:assert/strict';
import { agentSearchOrigin, formatAgentMapContext, isFiniteLngLat } from '../src/lib/agent/search-origin.ts';

test('isFiniteLngLat rejects non-finite and out-of-range', () => {
  assert.equal(isFiniteLngLat({ lng: 120.15, lat: 30.28 }), true);
  assert.equal(isFiniteLngLat({ lng: 181, lat: 30 }), false);
  assert.equal(isFiniteLngLat({ lng: 120, lat: Number.NaN }), false);
  assert.equal(isFiniteLngLat(null), false);
});

test('agentSearchOrigin prefers userLocation over viewport center', () => {
  assert.deepEqual(
    agentSearchOrigin({
      userLocation: { lng: 121.47, lat: 31.23 },
      viewport: { center: { lng: 120.15, lat: 30.28 }, zoom: 12 },
    }),
    { lng: 121.47, lat: 31.23 },
  );
  assert.deepEqual(
    agentSearchOrigin({ viewport: { center: { lng: 120.15, lat: 30.28 }, zoom: 12 } }),
    { lng: 120.15, lat: 30.28 },
  );
  assert.equal(agentSearchOrigin({}), undefined);
});

test('formatAgentMapContext labels user location as search origin', () => {
  const zh = formatAgentMapContext({
    userLocation: { lng: 121.47, lat: 31.23 },
    viewport: { center: { lng: 120.15, lat: 30.28 }, zoom: 13 },
  }, 'zh');
  assert.match(zh, /用户位置\(附近检索\/岗位检索起点\): 121\.470000,31\.230000/);
  assert.match(zh, /视野中心: 120\.150000,30\.280000/);
  const unknown = formatAgentMapContext({
    viewport: { center: { lng: 120.15, lat: 30.28 }, zoom: 13 },
  }, 'zh');
  assert.match(unknown, /用户位置未知/);
  assert.equal(formatAgentMapContext({}, 'zh'), undefined);
});
