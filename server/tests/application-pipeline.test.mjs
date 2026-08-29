import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  addStatus,
  createCustomStatus,
  defaultApplicationStatuses,
  fallbackStatusId,
  formatRelativeTime,
  matchesWatchFilter,
  removeStatus,
  renameStatus,
  resolveStatusLabel,
  sanitizeApplicationPipeline,
  sanitizeApplicationStatusId,
} from '../src/lib/application-pipeline.ts';

test('default pipeline has twelve builtin stages', () => {
  const statuses = defaultApplicationStatuses();
  assert.equal(statuses.length, 12);
  assert.equal(statuses[0].id, 'applied');
  assert.equal(statuses.find((item) => item.id === 'waiting')?.group, 'active');
  assert.equal(statuses.find((item) => item.id === 'rejected_r1')?.group, 'closed');
  assert.equal(fallbackStatusId(statuses), 'applied');
});

test('sanitize aliases viewed and drops illegal ids', () => {
  assert.equal(sanitizeApplicationStatusId('viewed'), 'applied');
  assert.equal(sanitizeApplicationStatusId('r1'), 'r1');
  assert.equal(sanitizeApplicationStatusId('c_abc1234567'), 'c_abc1234567');
  assert.equal(sanitizeApplicationStatusId('HR面'), null);
  assert.equal(sanitizeApplicationStatusId(''), null);
  const pipeline = sanitizeApplicationPipeline({
    statuses: [
      { id: 'waiting', label: '等面试', group: 'closed' },
      { id: 'waiting', label: 'dup' },
      { id: 'nope' },
      { id: 'c_offerwatch1', label: '等HC', group: 'active' },
    ],
  });
  assert.equal(pipeline.statuses.length, 2);
  assert.equal(pipeline.statuses[0].group, 'closed');
  assert.equal(pipeline.statuses[0].builtin, true);
  assert.equal(pipeline.statuses[1].builtin, false);
});

test('users can add rename and remove custom stages but not empty the catalog', () => {
  let catalog = defaultApplicationStatuses();
  const created = createCustomStatus('HR面', 'active', () => 'c_hr00000001');
  assert.ok(created);
  catalog = addStatus(catalog, created);
  assert.equal(catalog.at(-1)?.label, 'HR面');
  catalog = renameStatus(catalog, 'waiting', '等面试通知');
  assert.equal(catalog.find((item) => item.id === 'waiting')?.label, '等面试通知');
  const only = [{ id: 'applied', label: '', group: 'active', builtin: true }];
  assert.equal(removeStatus(only, 'applied'), only);
  assert.ok(removeStatus(catalog, created.id).every((item) => item.id !== created.id));
});

test('watch filters match group and status id', () => {
  const catalog = defaultApplicationStatuses();
  assert.equal(matchesWatchFilter('r1', { kind: 'all' }, catalog), true);
  assert.equal(matchesWatchFilter('r1', { kind: 'group', group: 'active' }, catalog), true);
  assert.equal(matchesWatchFilter('rejected_r1', { kind: 'group', group: 'active' }, catalog), false);
  assert.equal(matchesWatchFilter('waiting', { kind: 'status', id: 'waiting' }, catalog), true);
  assert.equal(matchesWatchFilter('viewed', { kind: 'status', id: 'applied' }, catalog), true);
});

test('labels fall back to i18n and relative time formats', () => {
  assert.equal(resolveStatusLabel({ id: 'waiting', label: '', group: 'active', builtin: true }, 'zh'), '等面');
  assert.equal(resolveStatusLabel({ id: 'waiting', label: '等面试', group: 'active', builtin: true }, 'zh'), '等面试');
  const now = Date.parse('2026-08-29T12:00:00Z');
  assert.equal(formatRelativeTime('2026-08-29T11:59:30Z', 'zh', now), '刚刚');
  assert.equal(formatRelativeTime('2026-08-29T11:50:00Z', 'zh', now), '10分钟前');
  assert.equal(formatRelativeTime('2026-08-29T09:00:00Z', 'zh', now), '3小时前');
  assert.equal(formatRelativeTime('2026-08-27T12:00:00Z', 'zh', now), '2天前');
  const old = '2026-08-01T12:00:00Z';
  const date = new Date(Date.parse(old));
  const expected = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  assert.equal(formatRelativeTime(old, 'zh', now), expected);
});

test('021 migration widens status ids and adds updated_at', () => {
  const sql = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations', '021_application_pipeline.sql'),
    'utf8',
  );
  assert.match(sql, /char_length\(status\) BETWEEN 1 AND 32/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS updated_at/);
  assert.match(sql, /status = 'applied'\s+WHERE status = 'viewed'/);
  assert.match(sql, /applications_user_updated_idx/);
});
