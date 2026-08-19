// company-logo 解析链单测 (2026-08-19 Bug2: 公司无 icon)。
// 链: 站点 logo → 站点 favicon → 公司 logo → 公司 favicon → emoji(兜底 🏢)。
// 离线 seed 路径 (logoForSite) 与 DB 读路径 (resolveDbCompanyLogo) 共用。
import test from 'node:test';
import assert from 'node:assert/strict';

import { faviconFromUrl, resolveCompanyLogo } from '../src/lib/company-logo.ts';
import { resolveDbCompanyLogo } from '../src/lib/recruitment-store.ts';

test('faviconFromUrl builds a favicon.im URL from any http(s) url', () => {
  const url = faviconFromUrl('https://talent.alibaba.com/');
  assert.ok(url, 'host with protocol resolves');
  assert.ok(url?.startsWith('https://favicon.im/'), 'favicon.im, not blocked google s2');
  assert.ok(url?.includes('talent.alibaba.com'), 'subdomain host is preserved');
  assert.ok(url?.includes('size=128'), 'default size param');
  assert.equal(faviconFromUrl('https://x.com'), 'https://favicon.im/x.com?size=128');
  assert.equal(faviconFromUrl('not-a-url'), undefined);
  assert.equal(faviconFromUrl(undefined), undefined);
  assert.equal(faviconFromUrl('ftp://x.com'), undefined, 'non-http(s) scheme rejected');
  assert.equal(faviconFromUrl('https://talent.alibaba.com/', 64), 'https://favicon.im/talent.alibaba.com?size=64');
});

test('chain layer 1: site logo url wins over everything else', () => {
  const r = resolveCompanyLogo({
    siteLogoUrl: 'https://cdn.example.com/site.png',
    siteCareerUrl: 'https://site.example.com/',
    companyLogoUrl: 'https://cdn.example.com/company.png',
    companyCareerUrl: 'https://www.example.com/',
    fallbackEmoji: '🛰️',
  });
  assert.equal(r.source, 'site');
  assert.equal(r.url, 'https://cdn.example.com/site.png');
  assert.equal(r.emoji, '🛰️');
});

test('chain layer 2: site career url falls back to its favicon (before company logo)', () => {
  const r = resolveCompanyLogo({
    siteCareerUrl: 'https://talent.alibaba.com/',
    companyLogoUrl: 'https://cdn.example.com/company.png',
  });
  assert.equal(r.source, 'favicon');
  assert.equal(r.url, 'https://favicon.im/talent.alibaba.com?size=128');
});

test('chain layer 3: company logo url after site-level candidates', () => {
  const r = resolveCompanyLogo({
    companyLogoUrl: 'https://cdn.example.com/company.png',
    companyCareerUrl: 'https://www.example.com/',
  });
  assert.equal(r.source, 'company');
  assert.equal(r.url, 'https://cdn.example.com/company.png');
});

test('chain layer 4: company career url favicon as last url candidate', () => {
  const r = resolveCompanyLogo({ companyCareerUrl: 'https://www.alibaba.com/' });
  assert.equal(r.source, 'favicon');
  assert.equal(r.url, 'https://favicon.im/www.alibaba.com?size=128');
});

test('chain layer 5: no url candidates → emoji fallback (default 🏢)', () => {
  const plain = resolveCompanyLogo({});
  assert.equal(plain.source, 'emoji');
  assert.equal(plain.emoji, '🏢');
  assert.equal(plain.url, undefined);
  const custom = resolveCompanyLogo({ fallbackEmoji: '🐧' });
  assert.equal(custom.source, 'emoji');
  assert.equal(custom.emoji, '🐧');
});

test('resolveDbCompanyLogo keeps stored logo_url/logo_emoji (no favicon override)', () => {
  // 2026-08-19 Bug2 回归: DB 读路径曾直接读列绕过解析链 → 全 🏢;
  // 现在落库值优先, 空才走链。
  const r = resolveDbCompanyLogo(
    { logo_url: 'https://cdn.example.com/db.png', logo_emoji: '🛰️', career_url: 'https://talent.alibaba.com/' },
    { career_url: 'https://site.example.com/', logo_url: null },
  );
  assert.equal(r.url, 'https://cdn.example.com/db.png');
  assert.equal(r.emoji, '🛰️');
  assert.equal(r.source, 'company');
});

test('resolveDbCompanyLogo keeps a stored emoji when only logo_url is empty', () => {
  const r = resolveDbCompanyLogo(
    { logo_url: null, logo_emoji: '🐧', career_url: 'https://careers.tencent.com/' },
    { career_url: null, logo_url: null },
  );
  assert.equal(r.url, undefined);
  assert.equal(r.emoji, '🐧');
});

test('resolveDbCompanyLogo runs the shared chain for empty-logo companies', () => {
  // 672 家 DB 公司 logo_url/logo_emoji 全空 → 按链解析 (careerUrl → favicon 兜底)。
  const siteWins = resolveDbCompanyLogo(
    { logo_url: null, logo_emoji: null, career_url: 'https://talent.alibaba.com/' },
    { career_url: 'https://talent.alibaba.com/hz', logo_url: null },
  );
  assert.equal(siteWins.source, 'favicon');
  assert.equal(siteWins.url, 'https://favicon.im/talent.alibaba.com?size=128');
  assert.equal(siteWins.emoji, '🏢');

  const companyFavicon = resolveDbCompanyLogo(
    { logo_url: null, logo_emoji: null, career_url: 'https://www.alibaba.com/' },
    { career_url: null, logo_url: null },
  );
  assert.equal(companyFavicon.source, 'favicon');
  assert.equal(companyFavicon.url, 'https://favicon.im/www.alibaba.com?size=128');

  // 完全无 careerUrl → emoji 兜底 (672 家中仅 1 家无 careerUrl)。
  const emoji = resolveDbCompanyLogo(
    { logo_url: null, logo_emoji: null, career_url: null },
    { career_url: null, logo_url: null },
  );
  assert.equal(emoji.source, 'emoji');
  assert.equal(emoji.emoji, '🏢');
  assert.equal(emoji.url, undefined);
});
