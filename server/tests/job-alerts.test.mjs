import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_CAREER, DEFAULT_NOTIFICATIONS } from '../src/lib/account.ts';
import { matchJobAlerts, positionMatchesCareer } from '../src/lib/job-alerts.ts';
import { INTERNSHIP_SEED } from '../src/lib/seed-data.ts';

test('matchJobAlerts stays empty until email or SMS is on', () => {
  const empty = matchJobAlerts(INTERNSHIP_SEED, DEFAULT_CAREER, DEFAULT_NOTIFICATIONS);
  assert.equal(empty.length, 0);
});

test('matchJobAlerts queues frontend intern roles when email is on', () => {
  const matches = matchJobAlerts(
    INTERNSHIP_SEED,
    { ...DEFAULT_CAREER, status: 'open', families: ['intern'], industries: ['internet'], strengths: ['frontend'] },
    { ...DEFAULT_NOTIFICATIONS, emailJobs: true },
  );
  assert.ok(matches.length > 0);
  assert.ok(matches.every((item) => item.channels.includes('email')));
  assert.ok(matches.some((item) => /前端|frontend/i.test(item.title)));
});

test('positionMatchesCareer respects not-looking and family', () => {
  const alibaba = INTERNSHIP_SEED.find((item) => item.id === 'alibaba-xixi');
  assert.ok(alibaba);
  const intern = alibaba.positions.find((item) => item.type === 'intern');
  assert.ok(intern);
  assert.equal(
    positionMatchesCareer(intern, alibaba.company.industries, { ...DEFAULT_CAREER, status: 'not-looking' }),
    false,
  );
  assert.equal(
    positionMatchesCareer(intern, alibaba.company.industries, {
      ...DEFAULT_CAREER,
      families: ['social'],
      industries: ['internet'],
      strengths: [],
    }),
    false,
  );
});
