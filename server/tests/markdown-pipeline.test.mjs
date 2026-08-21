import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNaviWebUrl,
  createMarkdownParser,
  renderMarkdown,
  LINK_REL,
  LINK_TARGET,
} from '../src/lib/markdown-pipeline.ts';

test('renderMarkdown: 纯文本/强调/代码等基础语法渲染为 HTML', () => {
  const spy = (html) => `[sanitized:${html}]`;
  const out = renderMarkdown('**加粗** 和 `代码`', spy);
  assert.equal(out, '[sanitized:<p><strong>加粗</strong> 和 <code>代码</code></p>\n]');
});

test('renderMarkdown: GFM 默认开(表格/删除线/任务列表)', () => {
  const spy = (html) => html;
  const table = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |', spy);
  assert.match(table, /<table>/);
  assert.match(table, /<th>a<\/th>/);
  const del = renderMarkdown('~~删掉~~', spy);
  assert.match(del, /<del>删掉<\/del>/);
});

test('renderMarkdown: 链接统一 target=_blank + rel=noopener noreferrer', () => {
  const spy = (html) => html;
  const out = renderMarkdown('[官网](https://example.com)', spy);
  assert.match(out, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">官网<\/a>/);
  assert.equal(LINK_TARGET, '_blank');
  assert.equal(LINK_REL, 'noopener noreferrer');
});

test('renderMarkdown: 链接标题转义 + 引号注入被消毒器拦截(先渲染后消毒)', () => {
  // href/title 含引号 → escapeAttr 转义;即使有残留危险属性,消毒器(此处 spy
  // 透传,生产 DOMPurify)仍是注入前最后一道闸——管线顺序保证 sanitize 在返回之前。
  const out = renderMarkdown('[x](https://a.com "ti\\"tle")', (html) => html);
  assert.match(out, /title="ti&quot;tle"/);
  assert.doesNotMatch(out, /onmouseover/);
});

test('renderMarkdown: 消毒器必须被调用(不消毒绝不注入的管线契约)', () => {
  let called = 0;
  let received = '';
  const out = renderMarkdown('# 标题', (html) => {
    called++;
    received = html;
    return '<div data-clean="1">净化后</div>';
  });
  assert.equal(called, 1, 'sanitize 必须被调用一次');
  assert.match(received, /<h1>标题<\/h1>/);
  assert.equal(out, '<div data-clean="1">净化后</div>');
});

test('createMarkdownParser: 独立实例不共享配置(链接 renderer 各自生效)', () => {
  const p1 = createMarkdownParser();
  const p2 = createMarkdownParser();
  const h1 = p1.parse('[a](https://x.com)');
  const h2 = p2.parse('[b](https://y.com)');
  assert.match(h1, /target="_blank"/);
  assert.match(h2, /target="_blank"/);
  assert.match(h1, />a<\/a>/);
  assert.match(h2, />b<\/a>/);
});

test('renderMarkdown: 空文本/纯文本兜底', () => {
  const out = renderMarkdown('', (html) => html);
  assert.equal(typeof out, 'string');
  const plain = renderMarkdown('你好,世界', (html) => html);
  assert.match(plain, /你好,世界/);
});

// ---------- 导航链接(amapuri://navi → 高德 Web 导航,2026-08-22 ws-navi) ----------

test('buildNaviWebUrl: 标准 amapuri navi → 高德 Web 导航 URL', () => {
  assert.equal(
    buildNaviWebUrl('amapuri://navi?lon=113.9491&lat=22.5458&name=%E6%B7%B1%E5%9C%B3%E8%85%BE%E8%AE%AF'),
    'https://uri.amap.com/navigation?to=113.9491,22.5458,%E6%B7%B1%E5%9C%B3%E8%85%BE%E8%AE%AF&mode=car&coordinate=gaode',
  );
});

test('buildNaviWebUrl: 键名大小写/顺序任意 + lng 别名 + 未编码值', () => {
  assert.equal(
    buildNaviWebUrl('amapuri://navi?LAT=30.25&LNG=120.15&NAME=hangzhou'),
    'https://uri.amap.com/navigation?to=120.15,30.25,hangzhou&mode=car&coordinate=gaode',
  );
  assert.equal(
    buildNaviWebUrl('AMAPURI://NAVI?name=%E4%B8%AD&lon=120&lat=30'),
    'https://uri.amap.com/navigation?to=120,30,%E4%B8%AD&mode=car&coordinate=gaode',
  );
});

test('buildNaviWebUrl: 无 name → to 末尾空名称段', () => {
  assert.equal(
    buildNaviWebUrl('amapuri://navi?lon=120.15&lat=30.25'),
    'https://uri.amap.com/navigation?to=120.15,30.25,&mode=car&coordinate=gaode',
  );
});

test('buildNaviWebUrl: 解析失败 → null(不强行渲染)', () => {
  assert.equal(buildNaviWebUrl('https://example.com/navi?lon=120&lat=30'), null, '非 amapuri scheme');
  assert.equal(buildNaviWebUrl('amapuri://other?lon=120&lat=30'), null, '非 navi 主机');
  assert.equal(buildNaviWebUrl('amapuri://navi'), null, '无 query');
  assert.equal(buildNaviWebUrl('amapuri://navi?lon=abc&lat=30'), null, 'lon 非数字');
  assert.equal(buildNaviWebUrl('amapuri://navi?lon=120'), null, '缺 lat');
  assert.equal(buildNaviWebUrl('amapuri://navi?lat=30'), null, '缺 lon');
  assert.equal(buildNaviWebUrl('amapuri://navi?lon=120&lat=91'), null, 'lat 越界');
  assert.equal(buildNaviWebUrl('amapuri://navi?lon=181&lat=0'), null, 'lon 越界');
  assert.equal(buildNaviWebUrl('amapuri://navi?lon=120&lat=30&name=%zz'), null, 'name 编码损坏');
  assert.equal(buildNaviWebUrl(''), null, '空串');
  assert.equal(buildNaviWebUrl(null), null, 'null');
});

test('renderMarkdown: amapuri navi 链接 → dm-navi 按钮(https href + data-navi 原生 URI)', () => {
  const out = renderMarkdown('[导航](amapuri://navi?lon=120.15&lat=30.25&name=%E6%9D%AD%E5%B7%9E)', (html) => html);
  assert.match(out, /<a class="dm-navi"/);
  assert.ok(
    out.includes('href="https://uri.amap.com/navigation?to=120.15,30.25,%E6%9D%AD%E5%B7%9E&amp;mode=car&amp;coordinate=gaode"'),
    'href 为 https Web 导航 URL(属性内 & 实体转义)',
  );
  assert.ok(
    out.includes('data-navi="amapuri://navi?lon=120.15&amp;lat=30.25&amp;name=%E6%9D%AD%E5%B7%9E"'),
    'data-navi 保留原生 amapuri URI',
  );
  assert.match(out, /target="_blank" rel="noopener noreferrer">打开高德导航<\/a>/);
});

test('renderMarkdown: naviLabel 可经 opts 注入(i18n 按钮文案)', () => {
  const out = renderMarkdown('[x](amapuri://navi?lon=120&lat=30)', (html) => html, { naviLabel: 'Open in AMap' });
  assert.match(out, />Open in AMap<\/a>/);
});

test('renderMarkdown: 解析失败的 amapuri 回落普通链接;普通 http 链接行为不变', () => {
  const bad = renderMarkdown('[x](amapuri://navi?lon=abc&lat=30)', (html) => html);
  assert.doesNotMatch(bad, /class="dm-navi"/);
  assert.match(bad, /<a href="amapuri:\/\/navi\?lon=abc&amp;lat=30" target="_blank" rel="noopener noreferrer">x<\/a>/);
  const http = renderMarkdown('[官网](https://example.com)', (html) => html);
  assert.match(http, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">官网<\/a>/);
});
