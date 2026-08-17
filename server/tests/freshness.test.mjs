import test from 'node:test';
import assert from 'node:assert/strict';

import { positionFreshness, summarizeFreshness } from '../src/lib/freshness.ts';

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
