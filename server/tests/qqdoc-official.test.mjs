import test from 'node:test';
import assert from 'node:assert/strict';

import {
  listQqdocOfficialFiles,
  parseQqdocOfficialPayload,
  qqdocOfficialAdapter,
  qqdocOfficialToSourceCompany,
} from '../src/lib/recruitment-adapters/qqdoc-official.ts';
import {
  companyNameCity,
  extractCityAndAddress,
  normalizeCityName,
} from '../src/lib/recruitment-adapters/official-site-parse.ts';
import { planSeedImport, validateSourceCompany } from '../src/lib/recruitment-import.ts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const QQDOC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'recruitment', 'qqdoc-official');

function dropFile(name) {
  return JSON.parse(readFileSync(join(QQDOC_DIR, name), 'utf8'));
}

test('qqdoc-official adapter reads all 142 drops into SourceCompany', async () => {
  const companies = await qqdocOfficialAdapter().list();
  assert.equal(companies.length, 142, `expected 142 qqdoc companies, got ${companies.length}`);
  for (const company of companies) {
    assert.ok(company.slug.startsWith('qq-'), `slug prefixed ${company.slug}`);
    assert.equal(company.source, 'qqdoc-official');
    assert.equal(company.scale, 'enterprise');
    assert.ok(company.industries.length >= 1, `${company.name} needs an industry tag`);
    assert.ok(/^https?:\/\//.test(company.careerUrl), `${company.name} careerUrl = official_url`);
    assert.ok(company.sites.length >= 1, `${company.name} needs a site`);
    assert.equal(company.positions.length, 0);
  }
});

test('qqdoc drops pass import validation (142 companies, zero issues)', async () => {
  const companies = await listQqdocOfficialFiles();
  const allIssues = companies.flatMap((company) => validateSourceCompany(company));
  assert.deepEqual(allIssues, []);
});

test('planSeedImport includes qqdoc-official companies ahead of seed', async () => {
  const plan = await planSeedImport();
  const qqdoc = plan.companies.filter((company) => company.source === 'qqdoc-official');
  assert.equal(qqdoc.length, 142, `plan should carry 142 qqdoc companies, got ${qqdoc.length}`);
  assert.ok(plan.companies.findIndex((c) => c.slug === 'qq-中国农业银行') < plan.companies.findIndex((c) => c.slug === 'tencent-hangzhou'));
});

test('empty site location {} is preserved, not dropped', () => {
  const company = qqdocOfficialToSourceCompany({
    slug: 'qq-测试公司',
    name: '测试公司',
    official_url: 'https://example.com/',
    sources: ['qqdoc-official'],
    sites: [{ id: 'qq-测试公司-site-hq', name: '测试公司', city: '测试公司总部', province: '', location: {} }],
  });
  assert.ok(company);
  assert.deepEqual(company.sites[0].location, {});
  assert.equal(company.sites[0].city, '测试公司总部');
});

test('site location with coordinates and address passes through untouched', () => {
  const company = qqdocOfficialToSourceCompany({
    slug: 'qq-测试公司',
    name: '测试公司',
    sites: [
      {
        id: 'qq-测试公司-site-hq',
        name: '测试公司',
        city: '北京市',
        province: '北京市',
        location: { lng: 116.4, lat: 39.9, address: '西城区复兴门内大街55号' },
      },
    ],
  });
  assert.ok(company);
  assert.deepEqual(company.sites[0].location, { lng: 116.4, lat: 39.9, address: '西城区复兴门内大街55号' });
});

test('parseQqdocOfficialPayload handles array / single / garbage', () => {
  const one = parseQqdocOfficialPayload({
    slug: 'qq-a',
    name: 'A',
    sites: [{ id: 'a-site', name: 'A' }],
  });
  assert.equal(one.length, 1);
  const many = parseQqdocOfficialPayload([
    { slug: 'qq-a', name: 'A', sites: [{ id: 'a-site', name: 'A' }] },
    { slug: 'qq-b', name: 'B', sites: [{ id: 'b-site', name: 'B' }] },
  ]);
  assert.equal(many.length, 2);
  assert.deepEqual(parseQqdocOfficialPayload(null), []);
  assert.deepEqual(parseQqdocOfficialPayload({ name: 'no-slug' }), []);
  assert.deepEqual(parseQqdocOfficialPayload({ slug: 'qq-x', name: 'X', sites: [] }), []);
  assert.deepEqual(parseQqdocOfficialPayload({ slug: 'qq-y', name: 'Y' }), []);
});

test('qqdoc industries: name-based tag with other fallback', () => {
  const bank = qqdocOfficialToSourceCompany({
    slug: 'qq-bank',
    name: '中国农业银行',
    sites: [{ id: 's', name: '中国农业银行' }],
  });
  assert.deepEqual(bank.industries, ['finance']);
  const shipping = qqdocOfficialToSourceCompany({
    slug: 'qq-ship',
    name: '中国远洋海运集团',
    sites: [{ id: 's', name: '中国远洋海运集团' }],
  });
  assert.deepEqual(shipping.industries, ['transport']);
  const auto = qqdocOfficialToSourceCompany({
    slug: 'qq-auto',
    name: '中国一汽',
    sites: [{ id: 's', name: '中国一汽' }],
  });
  assert.deepEqual(auto.industries, ['automotive']);
  const steel = qqdocOfficialToSourceCompany({
    slug: 'qq-steel',
    name: '中国钢研科技集团',
    sites: [{ id: 's', name: '中国钢研科技集团' }],
  });
  assert.deepEqual(steel.industries, ['other']);
});

test('companyNameCity: city-named banks resolve to their namesake city', () => {
  assert.deepEqual(companyNameCity('广州银行'), { city: '广州市', province: '广东省' });
  assert.deepEqual(companyNameCity('台州银行'), { city: '台州市', province: '浙江省' });
  assert.deepEqual(companyNameCity('桂林银行'), { city: '桂林市', province: '广西壮族自治区' });
  assert.deepEqual(companyNameCity('北京农商行'), { city: '北京市', province: '北京市' });
  assert.deepEqual(companyNameCity('上海农商行'), { city: '上海市', province: '上海市' });
  assert.deepEqual(companyNameCity('珠海华润银行'), { city: '珠海市', province: '广东省' });
  // 特例：吉林银行总部在长春；区名行归属地级市。
  assert.deepEqual(companyNameCity('吉林银行'), { city: '长春市', province: '吉林省' });
  assert.deepEqual(companyNameCity('南海农商行'), { city: '佛山市', province: '广东省' });
  assert.deepEqual(companyNameCity('顺德农商行'), { city: '佛山市', province: '广东省' });
  // 省名/品牌名不误判。
  assert.equal(companyNameCity('中国宝武钢铁集团'), null);
  assert.equal(companyNameCity('河北银行'), null);
  assert.equal(companyNameCity('晋商银行'), null);
  assert.equal(companyNameCity('恒丰银行'), null);
  assert.equal(companyNameCity(''), null);
});

test('extractCityAndAddress: labeled HQ address line', () => {
  assert.deepEqual(extractCityAndAddress('总部地址：北京市朝阳区建国路88号'), {
    city: '北京市',
    province: '北京市',
    address: '北京市朝阳区建国路88号',
  });
  assert.deepEqual(extractCityAndAddress('公司地址：湖南省长沙市岳麓区梅溪湖路1号'), {
    city: '长沙市',
    province: '湖南省',
    address: '湖南省长沙市岳麓区梅溪湖路1号',
  });
  assert.deepEqual(extractCityAndAddress('联系地址：广东省深圳市南山区科技园南路A栋'), {
    city: '深圳市',
    province: '广东省',
    address: '广东省深圳市南山区科技园南路A栋',
  });
});

test('extractCityAndAddress: unlabeled footer scan finds 省市区+路', () => {
  const hit = extractCityAndAddress(
    'Copyright © 2024 中国工商银行 北京市西城区复兴门内大街55号 京ICP备XXXX号',
  );
  assert.equal(hit.city, '北京市');
  assert.ok(hit.address.includes('复兴门内大街55号'), `address ${hit.address}`);
});

test('extractCityAndAddress: leading whitespace before the city must not eat the district first char', () => {
  // 回归: m[0] 的 \s* 前缀空格使 indexOf/slice 错位, 区名首字被吞
  // (北京市朝阳区 → 北京市阳区; 西城区 → 城区; 河西区 → 西区)。
  const a = extractCityAndAddress('页脚 联系我们 地址: 北京市朝阳区和平街13区煤炭大厦 电话 010-87986202');
  assert.equal(a.address, '北京市朝阳区和平街13区煤炭大厦');
  const b = extractCityAndAddress('首页 北京市西城区月坛南街1号院 邮编 100045');
  assert.equal(b.address, '北京市西城区月坛南街1号院');
  const c = extractCityAndAddress('主页 天津市河西区友谊路32号 电话 022-1234');
  assert.equal(c.address, '天津市河西区友谊路32号');
});

test('extractCityAndAddress: district-only address still yields the city', () => {
  const hit = extractCityAndAddress('联系地址：杭州市西湖区文三路90号');
  assert.equal(hit.city, '杭州市');
  assert.ok(hit.address.includes('文三路90号'));
});

test('extractCityAndAddress: strips script/style/tags before scanning', () => {
  const html =
    '<html><head><script>var x="北京市朝阳区";</script><style>.a{}</style></head>' +
    '<body><div class="footer">总部地址：上海市浦东新区世纪大道100号</div></body></html>';
  const hit = extractCityAndAddress(html);
  assert.equal(hit.city, '上海市');
  assert.ok(hit.address.includes('世纪大道100号'));
  assert.ok(!hit.address.includes('<'));
});

test('extractCityAndAddress: distrusts pages whose scripts cannot be cleanly stripped', () => {
  // 蜜罐/挑战页: JS 字符串里的假 </script> 骗过剥离, 残留地址文本 (可能被转义
  // 损坏, 如 阳区 缺「朝」)。剥离不净 → 整页不采信, 返回 null。
  const honeypot =
    '<script>var s="</script>";var addr="北京市阳区太阳宫中路16号院";</script>' +
    '<p>公司地址：北京市朝阳区建国路88号</p>';
  assert.equal(extractCityAndAddress(honeypot), null);
  // 未闭合的 <script> 同样不采信。
  assert.equal(extractCityAndAddress('<script>try { var x = 1; } catch'), null);
  assert.equal(extractCityAndAddress('总地址：北京市朝阳区建国路88号<script'), null);
});

test('extractCityAndAddress: phone/mail-only lines are rejected', () => {
  const hit = extractCityAndAddress('联系地址：电话 010-12345678，邮箱 hr@example.com');
  assert.equal(hit, null);
});

test('extractCityAndAddress: no address text returns null (keep as-is)', () => {
  assert.equal(extractCityAndAddress(''), null);
  assert.equal(extractCityAndAddress('<p>中国农业银行欢迎您</p>'), null);
  assert.equal(extractCityAndAddress('热招岗位 数据工程师 算法工程师'), null);
});

test('normalizeCityName maps bare/full names to the table full name', () => {
  assert.equal(normalizeCityName('北京市'), '北京市');
  assert.equal(normalizeCityName('北京'), '北京市');
  assert.equal(normalizeCityName('长沙市'), '长沙市');
  assert.equal(normalizeCityName('不存在的城市'), null);
  assert.equal(normalizeCityName(''), null);
});

test('qqdoc drops are idempotent input for the extraction script', () => {
  // city 保持现状的语义：没有真实城市（公司名占位）的公司会被脚本重抓，
  // 已带真实城市（市/省/自治区结尾）的公司跳过 —— 与脚本 needsExtraction 一致。
  const needs = (city, name) => !city || city.includes(name) || !/市$|省$|自治区/.test(city);
  assert.equal(needs('中国远洋海运集团总部', '中国远洋海运集团'), true);
  assert.equal(needs('北京市', '中国移动'), false);
  assert.equal(needs('', '某公司'), true);
});

test('qqdoc drops data integrity: every city is a known full name, pending is explicit', async () => {
  // 提取脚本更新后: 城市必须是已知城市全称 (市/自治区后缀, 可被 geocode 使用);
  // 无法确定的公司必须带显式 city_pending 标记, 不得残留公司名占位城市。
  const companies = await listQqdocOfficialFiles();
  let checked = 0;
  for (const company of companies) {
    const raw = JSON.parse(readFileSync(join(QQDOC_DIR, `${company.slug}.json`), 'utf8'));
    const site = raw.sites[0];
    const city = site?.city?.trim() || '';
    if (!city || city.includes(raw.name)) {
      assert.equal(raw.city_pending, true, `${raw.name} must be marked city_pending`);
      continue;
    }
    assert.equal(normalizeCityName(city), city, `${raw.name} city ${city} must be a known full name`);
    checked += 1;
  }
  assert.ok(checked >= 56, `at least the 56 pre-filled cities must be known, got ${checked}`);
});
