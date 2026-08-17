import test from 'node:test';
import assert from 'node:assert/strict';

import { isAlivePosition, positionFreshness, summarizeFreshness, todayDateString } from '../src/lib/freshness.ts';

test('positionFreshness classifies radar/portal/seed ids', () => {
  assert.equal(positionFreshness('radar-abc123'), 'radar');
  assert.equal(positionFreshness('portal-betta-campus'), 'portal');
  assert.equal(positionFreshness('netease-frontend'), 'seed');
  assert.equal(positionFreshness(undefined), 'seed');
  assert.equal(positionFreshness(''), 'seed');
});

test('summarizeFreshness aggregates company signals', () => {
  assert.deepEqual(summarizeFreshness([]), { recruiting: false, portal: false });
  assert.deepEqual(
    summarizeFreshness([{ id: 'netease-frontend' }, { id: 'radar-1' }]),
    { recruiting: true, portal: false },
  );
  assert.deepEqual(
    summarizeFreshness([{ id: 'portal-betta-campus' }, { id: 'radar-1' }]),
    { recruiting: true, portal: true },
  );
  assert.deepEqual(
    summarizeFreshness([{ id: 'portal-betta-campus' }]),
    { recruiting: false, portal: true },
  );
});

test('isAlivePosition keeps open jobs with no or future deadlines (A1)', () => {
  const now = new Date('2026-08-17T12:00:00');
  assert.equal(isAlivePosition({ status: 'open', deadline: '2026-10-15' }, now), true);
  assert.equal(isAlivePosition({ status: 'open' }, now), true);
  assert.equal(isAlivePosition({ status: 'open', deadline: '2026-08-17' }, now), true); // 截止当天仍算在招
  assert.equal(isAlivePosition({ status: 'open', deadline: '2026-08-16' }, now), false);
  assert.equal(isAlivePosition({ status: 'closed', deadline: '2026-10-15' }, now), false);
  assert.equal(isAlivePosition({ status: 'paused', deadline: '2026-10-15' }, now), false);
  assert.equal(isAlivePosition(undefined), false);
  assert.equal(isAlivePosition({ status: 'open', deadline: '招满即止' }, now), true); // 无法解析按未设截止
});

test('todayDateString is the local YYYY-MM-DD, aligned with DB CURRENT_DATE', () => {
  assert.equal(todayDateString(new Date('2026-08-17T00:00:00')), '2026-08-17');
  assert.equal(todayDateString(new Date('2026-08-17T23:59:59')), '2026-08-17');
  assert.equal(todayDateString(new Date('2026-12-31T12:00:00')), '2026-12-31');
});
