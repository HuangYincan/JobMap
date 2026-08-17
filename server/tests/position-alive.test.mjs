import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deadlineLocalMidnight,
  isAlivePosition,
  alivePositions,
  withAlivePositions,
} from '../src/lib/position-alive.ts';

// 固定「今天」= 2026-08-17 10:00 本地时间
const NOW = new Date(2026, 7, 17, 10, 0, 0);

function pos(overrides = {}) {
  return {
    id: 'p1',
    title: '后端开发',
    type: 'social',
    status: 'open',
    ...overrides,
  };
}

test('isAlivePosition: open without deadline is alive', () => {
  assert.equal(isAlivePosition(pos(), NOW), true);
});

test('isAlivePosition: open with future deadline is alive', () => {
  assert.equal(isAlivePosition(pos({ deadline: '2026-09-30' }), NOW), true);
});

test('isAlivePosition: open with today deadline still counts as alive', () => {
  assert.equal(isAlivePosition(pos({ deadline: '2026-08-17' }), NOW), true);
});

test('isAlivePosition: open with past deadline is not alive', () => {
  assert.equal(isAlivePosition(pos({ deadline: '2026-08-16' }), NOW), false);
});

test('isAlivePosition: closed / paused never alive, even with future deadline', () => {
  assert.equal(isAlivePosition(pos({ status: 'closed', deadline: '2026-12-31' }), NOW), false);
  assert.equal(isAlivePosition(pos({ status: 'paused', deadline: '2026-12-31' }), NOW), false);
});

test('isAlivePosition: unparseable deadline treated as alive (do not kill real jobs)', () => {
  assert.equal(isAlivePosition(pos({ deadline: '尽快' }), NOW), true);
});

test('deadlineLocalMidnight parses YYYY-MM-DD as local midnight (no UTC drift)', () => {
  const d = deadlineLocalMidnight('2026-08-17');
  assert.ok(d);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 7);
  assert.equal(d.getDate(), 17);
  assert.equal(d.getHours(), 0);
});

test('alivePositions keeps order and filters mixed list', () => {
  const poi = {
    positions: [
      pos({ id: 'a', status: 'open', deadline: '2026-09-01' }),
      pos({ id: 'b', status: 'closed' }),
      pos({ id: 'c', status: 'open', deadline: '2026-08-01' }),
      pos({ id: 'd', status: 'open' }),
    ],
  };
  assert.deepEqual(
    alivePositions(poi, NOW).map((p) => p.id),
    ['a', 'd']
  );
});

test('withAlivePositions: drops POI when no alive positions remain', () => {
  const poi = { id: 'x', positions: [pos({ status: 'closed' }), pos({ deadline: '2026-07-01' })] };
  assert.equal(withAlivePositions(poi, NOW), null);
});

test('withAlivePositions: keeps POI with stripped positions and new reference', () => {
  const poi = {
    id: 'x',
    positions: [pos({ id: 'alive', deadline: '2026-09-01' }), pos({ id: 'dead', deadline: '2026-07-01' })],
  };
  const kept = withAlivePositions(poi, NOW);
  assert.ok(kept);
  assert.notEqual(kept, poi); // 新引用,不修改原对象
  assert.deepEqual(kept.positions.map((p) => p.id), ['alive']);
});
