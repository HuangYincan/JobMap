import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_PREFERENCES, initialsFromName, resolvePreferences } from '../src/lib/account.ts';
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
  updateUser,
  upsertIdentity,
} from '../src/lib/session-store.ts';
import { faviconFromUrl, resolveCompanyLogo } from '../src/lib/company-logo.ts';
import { poiToSourceCompany, sourceCompanyToPois } from '../src/lib/recruitment-source.ts';
import { seedRecruitmentAdapter } from '../src/lib/recruitment-adapters/seed.ts';

test('guest preferences default to work mode and browser language', () => {
  assert.equal(DEFAULT_PREFERENCES.defaultMode, 'work');
  assert.deepEqual(resolvePreferences(null, 'en'), { language: 'en', defaultMode: 'work' });
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

  destroySession(token);
  assert.equal(getSessionUser(token), null);
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
