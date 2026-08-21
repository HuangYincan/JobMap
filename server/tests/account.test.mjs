import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_PREFERENCES, emptyPreferences, entityRefFromSelection, initialsFromName, mergePreferences, resolvePreferences, sanitizeEntityRef } from '../src/lib/account.ts';
import {
  addHistory as storeAddHistory,
  listHistory as storeListHistory,
  updateAvatar as storeUpdateAvatar,
  getAvatarData as storeGetAvatarData,
  upsertIdentity as storeUpsert,
} from '../src/lib/account-store.ts';
import {
  addHistory,
  consumeOtp,
  createSession,
  destroySession,
  getAvatarData,
  getSessionUser,
  issueOtp,
  listHistory,
  enqueueNotification,
  listApplications,
  listNotifications,
  listSaved,
  recordApplication,
  removeSaved,
  registerWithPassword,
  savePlace,
  updateAvatar,
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

test('entityRefFromSelection records company refs only when a poiId exists', () => {
  assert.deepEqual(
    entityRefFromSelection({ poiId: 'bytedance-hz', name: '字节跳动', location: { lng: 120.1, lat: 30.2 } }, 'work'),
    { kind: 'company', id: 'bytedance-hz', name: '字节跳动', lng: 120.1, lat: 30.2 },
  );
  assert.deepEqual(
    entityRefFromSelection({ poiId: 'area-hz', name: '杭州' }, 'work'),
    { kind: 'company', id: 'area-hz', name: '杭州' },
  );
  // 无 poiId（纯关键词/标签）→ 不记实体
  assert.equal(entityRefFromSelection({ name: '前端工程师' }, 'work'), undefined);
  assert.equal(entityRefFromSelection({ name: '#五险一金' }, 'work'), undefined);
  // domain 模式（虽不落库）kind 为 poi
  assert.deepEqual(
    entityRefFromSelection({ poiId: 'hz-poi-1', name: '西湖', location: { lng: 120.15, lat: 30.27 } }, 'domain'),
    { kind: 'poi', id: 'hz-poi-1', name: '西湖', lng: 120.15, lat: 30.27 },
  );
});

test('sanitizeEntityRef rejects corrupt refs and normalizes valid ones', () => {
  assert.equal(sanitizeEntityRef(undefined), undefined);
  assert.equal(sanitizeEntityRef(null), undefined);
  assert.equal(sanitizeEntityRef('string'), undefined);
  assert.equal(sanitizeEntityRef({ nope: true }), undefined);
  assert.equal(sanitizeEntityRef({ id: '', name: 'x' }), undefined);
  assert.equal(sanitizeEntityRef({ id: 'c1', name: 42 }), undefined);
  assert.deepEqual(sanitizeEntityRef({ kind: 'company', id: 'c1', name: '公司' }), {
    kind: 'company',
    id: 'c1',
    name: '公司',
  });
  // 未知 kind 归一为 company；坏坐标丢弃
  assert.deepEqual(sanitizeEntityRef({ kind: 'weird', id: 'c2', name: 'x', lng: 'bad', lat: NaN }), {
    kind: 'company',
    id: 'c2',
    name: 'x',
  });
});

test('otp login creates a session and search history is per user', () => {
  // phone OTP 与 email 同为随机码(真发由 aliyun-sms-client 单测覆盖,这里只对齐存储契约)
  issueOtp('phone', '13800138000');
  assert.equal(consumeOtp('phone', '13800138000', '999999'), false);
  const { code } = issueOtp('phone', '13800138000');
  assert.equal(consumeOtp('phone', '13800138000', code), true);

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

test('search history entries carry optional entity refs through the store', async () => {
  // 强制走内存实现（确定性断言；DB 有/无 entity 列的路径已在 account-store
  // 以 42703 回落设计覆盖，无库不可测）
  delete process.env.DATABASE_URL;
  const user = upsertIdentity({ provider: 'email', subject: 'entity@example.com', email: 'entity@example.com' });

  const withEntity = await storeAddHistory(user.id, '字节跳动', 'work', {
    kind: 'company',
    id: 'bytedance-hz',
    name: '字节跳动',
    lng: 120.1,
    lat: 30.2,
  });
  assert.ok(withEntity);
  assert.deepEqual(withEntity.entity, {
    kind: 'company',
    id: 'bytedance-hz',
    name: '字节跳动',
    lng: 120.1,
    lat: 30.2,
  });

  // 同 query+mode 连续提交 → 折叠（dedupe 只对最近一条）；带实体则刷新实体
  const again = await storeAddHistory(user.id, '字节跳动', 'work', { kind: 'company', id: 'bytedance-new', name: '字节跳动' });
  assert.equal(again.id, withEntity.id);
  assert.equal(again.entity.id, 'bytedance-new');

  // 无实体的同 query 折叠不清掉已存实体
  await storeAddHistory(user.id, '字节跳动', 'work');
  assert.equal(listHistory(user.id)[0].entity.id, 'bytedance-new');
  assert.equal((await storeListHistory(user.id))[0].entity.id, 'bytedance-new');
  assert.equal(listHistory(user.id).length, 1);

  // 纯关键词条目不携带 entity 键
  const plain = await storeAddHistory(user.id, '纯关键词', 'work');
  assert.ok(plain);
  assert.equal('entity' in plain, false);
  assert.equal(listHistory(user.id).length, 2);
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

test('avatar upload persists bytes and clears them on remove (memory store)', () => {
  delete process.env.DATABASE_URL;
  const user = upsertIdentity({ provider: 'email', subject: 'avatar@example.com', email: 'avatar@example.com' });
  assert.equal(getAvatarData(user.id), null);

  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]);
  const updated = updateAvatar(user.id, { data: jpeg, url: '/api/me/avatar?v=1' });
  assert.equal(updated?.avatarUrl, '/api/me/avatar?v=1');
  const raw = getAvatarData(user.id);
  assert.deepEqual(raw && Array.from(raw), Array.from(jpeg));
  // avatarData 只服务 GET /api/me/avatar,绝不随 publicUser 出网
  assert.ok(updated && !('avatarData' in updated));

  // PATCH avatarUrl='' 清头像 → avatar_data 一并清空
  const cleared = updateUser(user.id, { avatarUrl: '' });
  assert.equal(cleared?.avatarUrl, '');
  assert.equal(getAvatarData(user.id), null);

  // updateAvatar(data:null) 整头像清空
  updateAvatar(user.id, { data: jpeg, url: '/api/me/avatar?v=2' });
  updateAvatar(user.id, { data: null });
  assert.equal(getAvatarData(user.id), null);

  // 改名不碰头像
  const jpeg2 = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]);
  updateAvatar(user.id, { data: jpeg2, url: '/api/me/avatar?v=3' });
  updateUser(user.id, { displayName: '小名' });
  assert.equal(getAvatarData(user.id)?.length, jpeg2.length);
});

test('account-store avatar round-trips without DATABASE_URL (memory)', async () => {
  delete process.env.DATABASE_URL;
  const user = await storeUpsert({ provider: 'email', subject: 'mem-avatar@example.com', email: 'mem-avatar@example.com' });
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]);
  const updated = await storeUpdateAvatar(user.id, { data: jpeg, url: '/api/me/avatar?v=1' });
  assert.equal(updated?.avatarUrl, '/api/me/avatar?v=1');
  const raw = await storeGetAvatarData(user.id);
  assert.deepEqual(raw && Array.from(raw), Array.from(jpeg));
  await storeUpdateAvatar(user.id, { data: null });
  assert.equal(await storeGetAvatarData(user.id), null);
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
  assert.ok(companies.length >= 50);
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

test('updateUser/updateAvatar RETURNING 必须带回 username(密码账号 PATCH 后 accountLabel 不丢)', () => {
  const store = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'account-store.ts'),
    'utf8',
  );
  // 所有 UPDATE...RETURNING 都要带 username;注册/登录/getSessionUser 已各自覆盖。
  // (hasPassword 上线后 RETURNING 列序为 username, password_hash, preferences;
  //  setPassword / bindPhone / bindEmail 三个新写路径同样带回 username。)
  const matches = store.match(/RETURNING id::text, display_name, avatar_url, phone, email, username, password_hash, preferences,/g) ?? [];
  assert.equal(matches.length, 5, `expected 5 RETURNING-with-username (updateUser + updateAvatar + setPassword + bindPhone + bindEmail), got ${matches.length}`);
});

test('memory updateUser/updateAvatar 保留密码账号的 accountLabel(账户不消失)', () => {
  delete process.env.DATABASE_URL;
  const user = registerWithPassword('alice-fix', 'password123');
  assert.equal(user.accountLabel, 'alice-fix');
  const renamed = updateUser(user.id, { displayName: '爱丽丝' });
  assert.equal(renamed?.displayName, '爱丽丝');
  assert.equal(renamed?.accountLabel, 'alice-fix', '改用户名后账户仍应在');
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]);
  const withAvatar = updateAvatar(user.id, { data: jpeg, url: '/api/me/avatar?v=1' });
  assert.equal(withAvatar?.accountLabel, 'alice-fix', '上传头像后账户仍应在');
});
