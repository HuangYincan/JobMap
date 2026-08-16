import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_PREFERENCES, emptyPreferences, initialsFromName, mergePreferences, resolvePreferences } from '../src/lib/account.ts';
import {
  addHistory as storeAddHistory,
  listHistory as storeListHistory,
  upsertIdentity as storeUpsert,
} from '../src/lib/account-store.ts';
import {
  addHistory,
  consumeOtp,
  createSession,
  DEMO_OTP_CODE,
  destroySession,
  getSessionUser,
  issueOtp,
  listHistory,
  enqueueNotification,
  listApplications,
  listNotifications,
  listSaved,
  recordApplication,
  removeSaved,
  savePlace,
  updateUser,
  upsertIdentity,
} from '../src/lib/session-store.ts';
import { faviconFromUrl, resolveCompanyLogo } from '../src/lib/company-logo.ts';
import { poiToSourceCompany, sourceCompanyToPois } from '../src/lib/recruitment-source.ts';
import { seedRecruitmentAdapter } from '../src/lib/recruitment-adapters/seed.ts';

test('guest preferences default to work mode and browser language', () => {
  assert.equal(DEFAULT_PREFERENCES.defaultMode, 'work');
  assert.deepEqual(resolvePreferences(null, 'en'), emptyPreferences('en'));
});

test('mergePreferences deep-merges career and notifications', () => {
  const next = mergePreferences(
    { language: 'zh', defaultMode: 'work' },
    { career: { status: 'open', strengths: ['frontend'] }, notifications: { emailJobs: true } },
  );
  assert.equal(next.career.status, 'open');
  assert.deepEqual(next.career.strengths, ['frontend']);
  assert.deepEqual(next.career.families, ['intern', 'campus']);
  assert.equal(next.notifications.emailJobs, true);
  assert.equal(next.notifications.smsJobs, false);
});

test('initialsFromName uses two letters when possible', () => {
  assert.equal(initialsFromName('Alex Kim'), 'AK');
  assert.equal(initialsFromName('李雷'), '李雷');
});

test('otp login creates a session and search history is per user', () => {
  issueOtp('phone', '13800138000');
  assert.equal(consumeOtp('phone', '13800138000', '999999'), false);
  issueOtp('phone', '13800138000');
  assert.equal(consumeOtp('phone', '13800138000', DEMO_OTP_CODE), true);

  const user = upsertIdentity({ provider: 'phone', subject: '13800138000', phone: '13800138000' });
  assert.equal(user.accountLabel, '13800138000');
  assert.equal(user.preferences.defaultMode, 'work');

  const { token } = createSession(user.id);
  assert.equal(getSessionUser(token)?.id, user.id);

  assert.ok(addHistory(user.id, '算法', 'work'));
  assert.ok(addHistory(user.id, '算法', 'work')); // same query collapses
  assert.equal(listHistory(user.id).length, 1);
  assert.ok(addHistory(user.id, '阿里', 'work'));
  assert.equal(listHistory(user.id)[0].query, '阿里');

  const renamed = updateUser(user.id, { displayName: 'Alex Kim', preferences: { language: 'en' } });
  assert.equal(renamed?.displayName, 'Alex Kim');
  assert.equal(renamed?.preferences.language, 'en');
  assert.equal(renamed?.preferences.career.status, 'casually');
  assert.equal(renamed?.preferences.notifications.emailJobs, false);

  const career = updateUser(user.id, {
    preferences: { career: { status: 'open', strengths: ['algorithm'] }, notifications: { smsJobs: true } },
  });
  assert.equal(career?.preferences.career.status, 'open');
  assert.deepEqual(career?.preferences.career.strengths, ['algorithm']);
  assert.equal(career?.preferences.language, 'en');
  assert.equal(career?.preferences.notifications.smsJobs, true);
  assert.equal(career?.preferences.notifications.emailJobs, false);

  destroySession(token);
  assert.equal(getSessionUser(token), null);
});

test('saved places are per user and idempotent', () => {
  const user = upsertIdentity({ provider: 'email', subject: 'save@example.com', email: 'save@example.com' });
  const first = savePlace(user.id, {
    poiId: 'alibaba-xixi',
    name: '阿里巴巴西溪',
    mode: 'work',
    kind: 'recruitment',
    address: '余杭区',
    lng: 120.01,
    lat: 30.28,
  });
  const again = savePlace(user.id, {
    poiId: 'alibaba-xixi',
    name: '阿里巴巴西溪园区',
    mode: 'work',
    kind: 'recruitment',
  });
  assert.equal(first.id, again.id);
  assert.equal(listSaved(user.id).length, 1);
  assert.equal(removeSaved(user.id, 'alibaba-xixi'), true);
  assert.equal(listSaved(user.id).length, 0);
});

test('recordApplication is idempotent per position', () => {
  const user = upsertIdentity({ provider: 'email', subject: 'apply@example.com', email: 'apply@example.com' });
  const first = recordApplication(user.id, {
    positionId: 'alibaba-fe',
    companyPoiId: 'alibaba-xixi',
    title: '前端实习',
    companyName: '阿里巴巴',
    applyUrl: 'https://talent.alibaba.com/job/1',
  });
  const again = recordApplication(user.id, {
    positionId: 'alibaba-fe',
    companyPoiId: 'alibaba-xixi',
    title: '前端实习',
    companyName: '阿里巴巴',
  });
  assert.equal(first.id, again.id);
  assert.equal(listApplications(user.id).length, 1);
});

test('enqueueNotification is idempotent per position', () => {
  const user = upsertIdentity({ provider: 'email', subject: 'alert@example.com', email: 'alert@example.com' });
  const first = enqueueNotification(user.id, {
    kind: 'job',
    positionId: 'alibaba-fe',
    companyPoiId: 'alibaba-xixi',
    title: '前端实习',
    companyName: '阿里巴巴',
    channels: ['inbox', 'email'],
  });
  const again = enqueueNotification(user.id, {
    kind: 'job',
    positionId: 'alibaba-fe',
    companyPoiId: 'alibaba-xixi',
    title: '前端实习',
    companyName: '阿里巴巴',
    channels: ['inbox', 'sms'],
  });
  assert.equal(first.id, again.id);
  assert.equal(listNotifications(user.id).length, 1);
  assert.equal(listNotifications(user.id)[0].status, 'queued');
});

test('resolveCompanyLogo prefers site career icon over company fallback', () => {
  const site = resolveCompanyLogo({
    siteCareerUrl: 'https://talent.alibaba.com/',
    companyLogoUrl: 'https://cdn.example.com/alibaba.png',
    fallbackEmoji: '🛰️',
  });
  assert.equal(site.source, 'favicon');
  assert.ok(site.url?.includes('talent.alibaba.com'));

  const company = resolveCompanyLogo({
    companyCareerUrl: 'https://www.alibaba.com/',
    fallbackEmoji: '🛰️',
  });
  assert.equal(company.source, 'favicon');
  assert.equal(faviconFromUrl('not-a-url'), undefined);

  const emoji = resolveCompanyLogo({ fallbackEmoji: '🛰️' });
  assert.equal(emoji.source, 'emoji');
  assert.equal(emoji.emoji, '🛰️');
});

test('account-store without DATABASE_URL stays in memory', async () => {
  delete process.env.DATABASE_URL;
  const user = await storeUpsert({ provider: 'email', subject: 'mem@example.com', email: 'mem@example.com' });
  assert.ok(user.id);
  assert.ok(await storeAddHistory(user.id, '西溪', 'work'));
  assert.equal((await storeListHistory(user.id))[0].query, '西溪');
});

test('sourceCompanyToPois splits one company into one POI per office site', () => {
  const pois = sourceCompanyToPois(
    {
      slug: 'alibaba',
      name: '阿里巴巴',
      industries: ['internet'],
      scale: 'bigtech',
      careerUrl: 'https://talent.alibaba.com/',
      logoEmoji: '🛰️',
      sites: [
        {
          id: 'xixi',
          name: '西溪园区',
          location: { lng: 120.02, lat: 30.28 },
          careerUrl: 'https://talent.alibaba.com/xixi',
        },
        {
          id: 'binjiang',
          name: '滨江园区',
          location: { lng: 120.2, lat: 30.2 },
        },
      ],
      positions: [
        {
          externalId: 'java-xixi',
          title: 'Java',
          siteId: 'xixi',
          family: 'intern',
          status: 'open',
          applyUrl: 'https://talent.alibaba.com/off-campus/position-list?lang=zh&positionId=1',
        },
        {
          externalId: 'fe-binjiang',
          title: 'Frontend',
          siteId: 'binjiang',
          family: 'campus',
          status: 'open',
        },
      ],
    },
    'seed',
  );

  assert.equal(pois.length, 2);
  assert.equal(pois[0].id, 'alibaba:xixi');
  assert.equal(pois[0].positions.length, 1);
  assert.equal(pois[0].positions[0].siteId, 'xixi');
  assert.equal(pois[0].source, 'seed');
  assert.ok(pois[0].company.logoUrl?.includes('talent.alibaba.com'));
  assert.equal(pois[1].positions[0].title, 'Frontend');
});

test('seed adapter round-trips work companies through the plugin contract', async () => {
  const companies = await seedRecruitmentAdapter.list();
  assert.ok(companies.length >= 10);
  for (const company of companies) {
    assert.ok(company.sites.length >= 1);
    assert.ok(company.positions.every((p) => company.sites.some((s) => s.id === p.siteId)));
    const back = sourceCompanyToPois(company, 'seed');
    assert.equal(back.length, company.sites.length);
    assert.equal(poiToSourceCompany(back[0]).slug, company.slug);
  }
});

test('account-store sweeps expired sessions and OTP rows on miss', () => {
  const store = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'account-store.ts'),
    'utf8',
  );
  assert.match(store, /DELETE FROM auth_sessions WHERE expires_at <= now\(\) OR token_hash = \$1/);
  assert.match(store, /DELETE FROM auth_otp_challenges WHERE provider = \$1 AND target = \$2 AND expires_at <= now\(\)/);
});
