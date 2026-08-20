import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bareCity,
  cityTextContains,
  familyForRecruitType,
  familyForText,
  feishuJobCity,
  feishuJobToPosition,
  normalizeAtsCity,
  parseDeadline,
  parseFeishuJobPage,
  parseHtmlJobRows,
  parseRobotsDisallows,
  robotsAllowsPath,
  siteIdForJobCity,
  splitCityText,
} from '../src/lib/recruitment-adapters/qqdoc-jobs-parse.ts';

// ---------------------------------------------------------------------------
// robots.txt (RFC 9309)
// ---------------------------------------------------------------------------

test('parseRobotsDisallows: only our UA group rules apply', () => {
  const rules = parseRobotsDisallows(
    [
      'User-agent: googlebot',
      'Disallow: /private-google',
      '',
      'User-agent: *',
      'Disallow: /private',
      'Disallow: /api/',
      '',
      'User-agent: domain-map-etl',
      'Allow: /public',
      'Disallow: /etl-only',
    ].join('\n'),
  );
  assert.deepEqual(rules, ['/private', '/api/', '/etl-only']);
});

test('parseRobotsDisallows: empty Disallow list means fully allowed', () => {
  assert.deepEqual(parseRobotsDisallows('User-agent: *\nDisallow:\n'), []);
  assert.deepEqual(parseRobotsDisallows('# just a comment\n'), []);
  assert.deepEqual(parseRobotsDisallows('User-agent: other\nDisallow: /x\n'), []);
});

test('robotsAllowsPath: prefix rules and wildcards', () => {
  assert.equal(robotsAllowsPath(['/'], '/anything'), false);
  assert.equal(robotsAllowsPath(['/api/'], '/api/v1/search'), false);
  assert.equal(robotsAllowsPath(['/api/'], '/campus/jobs'), true);
  assert.equal(robotsAllowsPath(['/s/*'], '/s/abc123'), false);
  assert.equal(robotsAllowsPath(['/s/*'], '/jobs/list'), true);
  assert.equal(robotsAllowsPath([], '/anything'), true);
});

// ---------------------------------------------------------------------------
// 城市辅助
// ---------------------------------------------------------------------------

test('splitCityText: 多城市文本拆裸城市名', () => {
  assert.deepEqual(splitCityText('北京、杭州、上海'), ['北京', '杭州', '上海']);
  assert.deepEqual(splitCityText('西安 咸阳'), ['西安', '咸阳']);
  assert.deepEqual(splitCityText('北京、杭州、上海\n、深圳等'), ['北京', '杭州', '上海', '深圳']);
  assert.deepEqual(splitCityText(undefined), []);
});

test('cityTextContains: 多城市文本包含判定', () => {
  assert.equal(cityTextContains('北京、杭州、上海', '北京'), true);
  assert.equal(cityTextContains('西安 咸阳', '咸阳'), true);
  assert.equal(cityTextContains('北京市', '北京'), true);
  assert.equal(cityTextContains('北京、杭州', '上海'), false);
  assert.equal(cityTextContains(undefined, '上海'), false);
});

test('bareCity: 全称去后缀', () => {
  assert.equal(bareCity('北京市'), '北京');
  assert.equal(bareCity('杭州'), '杭州');
  assert.equal(bareCity(''), '');
  assert.equal(bareCity(undefined), '');
});

test('siteIdForJobCity: 岗位城市复用现有 site id, 否则首站', () => {
  const company = {
    slug: 'demo',
    sites: [
      { id: 'demo-site-beijing', city: '北京市' },
      { id: 'demo-site-shanghai', city: '上海、杭州' },
    ],
  };
  assert.equal(siteIdForJobCity(company, '北京'), 'demo-site-beijing');
  assert.equal(siteIdForJobCity(company, '杭州'), 'demo-site-shanghai');
  assert.equal(siteIdForJobCity(company, '广州'), 'demo-site-beijing'); // 未匹配 → 首站
  assert.equal(siteIdForJobCity({ slug: 'x', sites: [] }, '北京'), 'x-site');
});

// ---------------------------------------------------------------------------
// 飞书 ATS (ats_feishu.py 契约)
// ---------------------------------------------------------------------------

test('normalizeAtsCity: 笔误别名与空值', () => {
  assert.equal(normalizeAtsCity('北揽'), '北京');
  assert.equal(normalizeAtsCity('上海'), '上海');
  assert.equal(normalizeAtsCity(null), '');
  assert.equal(normalizeAtsCity(undefined), '');
});

test('feishuJobCity: 取 city_list 第一项', () => {
  const job = { city_list: [{ name: '北京' }, { name: '上海' }] };
  assert.equal(feishuJobCity(job), '北京');
  assert.equal(feishuJobCity({}), '');
});

test('familyForRecruitType: 校招/实习/社招识别', () => {
  assert.equal(familyForRecruitType({ id: '201', name: '正式', parent: { name: '校招' } }, '算法工程师'), 'campus');
  assert.equal(familyForRecruitType({ name: '实习' }, '产品实习生'), 'intern');
  assert.equal(familyForRecruitType({ name: '全职' }, '测试工程师'), 'social');
  assert.equal(familyForRecruitType({ name: '外包' }, '客服'), 'social');
  assert.equal(familyForRecruitType('campus', '工程师'), 'campus');
  assert.equal(familyForRecruitType('social', '工程师'), 'social');
  assert.equal(familyForRecruitType(null, '2026届校招-前端开发'), 'campus'); // 文本兜底
  assert.equal(familyForRecruitType(null, '实习-数据分析'), 'intern');
});

test('feishuJobToPosition: 完整映射 (externalId/applyUrl/siteId/family)', () => {
  const company = {
    slug: 'demo',
    sites: [{ id: 'demo-site-beijing', city: '北京市' }, { id: 'demo-site-hangzhou', city: '杭州' }],
  };
  const pos = feishuJobToPosition(
    {
      id: '12345',
      title: '算法工程师',
      description: '<p>做算法</p>',
      requirement: '硕士优先',
      recruit_type: { id: '201', name: '正式', parent: { name: '校招' } },
      city_list: [{ name: '杭州' }],
    },
    company,
    { host: 'demo.jobs.feishu.cn', websitePath: 'campus', retrievedAt: '2026-08-21' },
  );
  assert.ok(pos);
  assert.equal(pos.externalId, 'portal-feishu-12345');
  assert.equal(pos.title, '算法工程师');
  assert.equal(pos.siteId, 'demo-site-hangzhou');
  assert.equal(pos.family, 'campus');
  assert.equal(pos.applyUrl, 'https://demo.jobs.feishu.cn/campus/position/12345/detail');
  assert.equal(pos.retrievedAt, '2026-08-21');
  assert.ok(pos.description.includes('做算法'));
  assert.ok(pos.description.includes('岗位要求'));
});

test('feishuJobToPosition: 缺 id/title 的行返回 null (跳过不炸批次)', () => {
  const company = { slug: 'demo', sites: [{ id: 's1', city: '北京' }] };
  assert.equal(feishuJobToPosition({ title: '无 id' }, company), null);
  assert.equal(feishuJobToPosition({ id: '1', title: '' }, company), null);
  assert.equal(feishuJobToPosition({ id: '1', title: '   ' }, company), null);
});

test('parseFeishuJobPage: 契约校验 (code/data/job_post_list)', () => {
  const ok = parseFeishuJobPage({ code: 0, data: { job_post_list: [{ id: '1' }], count: 1 } });
  assert.equal(ok.jobs.length, 1);
  assert.equal(ok.total, 1);
  assert.throws(() => parseFeishuJobPage({ code: -9000003, message: 'site not exist' }), /code=-9000003/);
  assert.throws(() => parseFeishuJobPage({ code: 0 }), /no data object/);
  assert.throws(() => parseFeishuJobPage({ code: 0, data: {} }), /no job_post_list/);
  assert.throws(() => parseFeishuJobPage('x'), /non-object payload/);
});

// ---------------------------------------------------------------------------
// 官网 HTML 解析
// ---------------------------------------------------------------------------

test('parseDeadline: 合法日期 → ISO, 其他 → null', () => {
  assert.equal(parseDeadline('2026-10-31'), '2026-10-31');
  assert.equal(parseDeadline('2026年10月31日'), '2026-10-31');
  assert.equal(parseDeadline('2026/10/31'), '2026-10-31');
  assert.equal(parseDeadline('招满即止'), null);
  assert.equal(parseDeadline(undefined), null);
  assert.equal(parseDeadline('2026-13-99'), null);
});

test('parseHtmlJobRows: 岗位锚点 → position (标题/城市/截止/链接)', () => {
  const html = `
    <html><head><script>var noise = "工程师";</script></head><body>
      <nav><a href="/">首页</a><a href="/login">登录</a></nav>
      <ul>
        <li><a href="/position/campus-101">2026届-后端开发工程师</a><span>城市：北京</span><span>截止至 2026-10-31</span></li>
        <li><a href="/position/campus-102">2026届-产品经理</a><span>城市：杭州</span></li>
      </ul>
      <footer><a href="/about">关于我们</a></footer>
    </body></html>`;
  const company = { name: 'demo', slug: 'demo', sites: [{ id: 'demo-site-beijing', city: '北京市' }] };
  const positions = parseHtmlJobRows(html, company, 'https://join.demo.com/');
  assert.equal(positions.length, 2);
  const backend = positions.find((p) => p.title.includes('后端'));
  assert.ok(backend);
  assert.equal(backend.externalId.startsWith('portal-qqdoc-'), true);
  assert.equal(backend.siteId, 'demo-site-beijing');
  assert.equal(backend.applyUrl, 'https://join.demo.com/position/campus-101');
  assert.equal(backend.deadline, '2026-10-31');
  assert.equal(backend.family, 'campus');
});

test('parseHtmlJobRows: 无岗位关键词/导航噪音被过滤', () => {
  const html = '<body><a href="/a">公司新闻</a><a href="/b">首页</a><a href="/c">联系我们</a></body>';
  const company = { name: 'demo', slug: 'demo', sites: [{ id: 's1', city: '北京' }] };
  assert.deepEqual(parseHtmlJobRows(html, company, 'https://x.com/'), []);
});

test('familyForText: 标题关键词兜底', () => {
  assert.equal(familyForText('2026届校招-前端开发'), 'campus');
  assert.equal(familyForText('实习生-产品'), 'intern');
  assert.equal(familyForText('社招-销售经理'), 'social');
});
