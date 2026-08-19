// company-logo 解析链单测 (2026-08-19 Bug2: 公司无 icon)。
// 链: 站点 logo → 站点域名映射 → 站点 favicon → 公司 logo → 公司域名映射 →
//     公司 favicon → emoji(兜底 🏢)。
// 2026-08-20 (ws3): 裸 IP host 不直连 favicon 服务;DOMAIN_LOGO_MAP 映射
// IP → 官方域名;favicon 候选链 [favicon.im, icon.horse]。
// 离线 seed 路径 (logoForSite) 与 DB 读路径 (resolveDbCompanyLogo) 共用。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOMAIN_LOGO_MAP,
  faviconCandidatesFromUrl,
  faviconFromUrl,
  resolveCompanyLogo,
} from '../src/lib/company-logo.ts';
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

test('faviconCandidatesFromUrl returns the favicon.im → icon.horse chain (ADR-007 backup)', () => {
  assert.deepEqual(faviconCandidatesFromUrl('https://alibaba.com/'), [
    'https://favicon.im/alibaba.com?size=128',
    'https://icon.horse/icon/alibaba.com',
  ]);
  assert.equal(faviconCandidatesFromUrl('https://alibaba.com/', 64)[0], 'https://favicon.im/alibaba.com?size=64');
  assert.deepEqual(faviconCandidatesFromUrl(undefined), []);
  assert.deepEqual(faviconCandidatesFromUrl('not-a-url'), []);
});

test('bare IPv4 hosts never hit favicon services (favicon.im 实测 404)', () => {
  // 未映射的裸 IP → 空候选,不产生任何 favicon 服务请求
  assert.equal(faviconFromUrl('http://192.168.1.1/'), undefined);
  assert.equal(faviconFromUrl('http://203.0.113.5/zhaopin.php'), undefined);
  assert.deepEqual(faviconCandidatesFromUrl('http://203.0.113.5/'), []);
});

test('DOMAIN_LOGO_MAP covers the bare IP hosts actually present in data (2026-08-20 grep)', () => {
  // 全库 grep(crawler/ + server/data + seed)唯一的裸 IP:浙江省发展规划研究院 radar drop
  assert.deepEqual(Object.keys(DOMAIN_LOGO_MAP), ['47.96.146.209']);
});

test('mapped bare IP resolves via the official domain (chain layer, source=company)', () => {
  const r = resolveCompanyLogo({
    siteCareerUrl: 'http://47.96.146.209:8111/zhaopin_sx.php',
    fallbackEmoji: '🏢',
  });
  assert.equal(r.source, 'company');
  assert.equal(r.url, 'https://favicon.im/zdpi.org.cn?size=128');
  // 消费组件 onerror 的候选链同样走映射
  assert.deepEqual(faviconCandidatesFromUrl('http://47.96.146.209:8111/zhaopin_sx.php'), [
    'https://favicon.im/zdpi.org.cn?size=128',
    'https://icon.horse/icon/zdpi.org.cn',
  ]);
});

test('unmapped bare IP falls back to emoji (no favicon service request)', () => {
  const r = resolveCompanyLogo({ siteCareerUrl: 'http://203.0.113.5/zhaopin.php' });
  assert.equal(r.source, 'emoji');
  assert.equal(r.url, undefined);
  assert.equal(r.emoji, '🏢');
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

test('company with no careerUrl/logoUrl keeps its emoji logo (曦曦AI pattern)', () => {
  // seed 全量 50 家 seed 公司中仅曦曦AI 无 careerUrl/logoUrl(2026-08-20 核对) →
  // 直接 emoji,不产生任何 favicon 请求
  const r = resolveCompanyLogo({ fallbackEmoji: '✨' });
  assert.equal(r.source, 'emoji');
  assert.equal(r.emoji, '✨');
  assert.equal(r.url, undefined);
});

test('resolveDbCompanyLogo maps a bare-IP career_url through DOMAIN_LOGO_MAP', () => {
  // DB 读路径(导入 radar drop 后 career_url 即裸 IP)与离线链共用映射
  const r = resolveDbCompanyLogo(
    { logo_url: null, logo_emoji: null, career_url: 'http://47.96.146.209:8111/zhaopin_sx.php' },
    { career_url: null, logo_url: null },
  );
  assert.equal(r.source, 'company');
  assert.equal(r.url, 'https://favicon.im/zdpi.org.cn?size=128');
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
