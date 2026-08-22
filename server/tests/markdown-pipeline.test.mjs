import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildNaviWebUrl,
  createMarkdownParser,
  renderMarkdown,
  preprocessNaviUrls,
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

test('buildNaviWebUrl: 空 name(缺省或空串)→ to 无尾逗号(2026-08-22 ws-navi3)', () => {
  assert.equal(
    buildNaviWebUrl('amapuri://navi?lon=120.15&lat=30.25'),
    'https://uri.amap.com/navigation?to=120.15,30.25&mode=car&coordinate=gaode',
  );
  assert.equal(
    buildNaviWebUrl('amapuri://navi?lon=120.15&lat=30.25&name='),
    'https://uri.amap.com/navigation?to=120.15,30.25&mode=car&coordinate=gaode',
    'name 参数存在但为空串 → 同样无尾逗号',
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

// ---------- 裸 amapuri://navi URL 预扫描(2026-08-22 ws-navi2) ----------
// marked 裸 URL 自动链接规则只认 https?/ftp/www 前缀 → amapuri:// 纯文本不触发 link
// renderer → renderMarkdown 在 parse 前经 preprocessNaviUrls 替换为同构按钮锚。

test('preprocessNaviUrls: 裸 URL(LLM 真实形态,含 sourceApplication/dev/style 额外参数)→ 按钮锚', () => {
  const out = preprocessNaviUrls('amapuri://navi?sourceApplication=amap_mcp&lon=113.934497&lat=22.540517&dev=1&style=2');
  assert.match(out, /^<a class="dm-navi"/);
  assert.ok(
    out.includes('href="https://uri.amap.com/navigation?to=113.934497,22.540517&amp;mode=car&amp;coordinate=gaode"'),
    'href 为 https Web 导航 URL(属性内 & 实体转义;空 name 无尾逗号)',
  );
  assert.ok(
    out.includes('data-navi="amapuri://navi?sourceApplication=amap_mcp&amp;lon=113.934497&amp;lat=22.540517&amp;dev=1&amp;style=2"'),
    'data-navi 保留裸 URL 原文(含额外参数)',
  );
  assert.match(out, />打开高德导航<\/a>$/);
});

test('renderMarkdown: 裸 URL 出现在句子中间(前后有中文)→ 按钮就位、其余文本原样', () => {
  const out = renderMarkdown('从这里出发:amapuri://navi?lon=120.15&lat=30.25 大约需要15分钟', (html) => html);
  assert.match(out, /从这里出发:/);
  assert.ok(
    out.includes('<a class="dm-navi" href="https://uri.amap.com/navigation?to=120.15,30.25&amp;mode=car&amp;coordinate=gaode"'),
    '按钮锚就位(空 name 无尾逗号)',
  );
  assert.ok(out.includes('data-navi="amapuri://navi?lon=120.15&amp;lat=30.25"'));
  assert.match(out, />打开高德导航<\/a>/);
  assert.match(out, /大约需要15分钟/);
});

test('renderMarkdown: 多个裸 URL → 全部替换', () => {
  const out = renderMarkdown('甲:amapuri://navi?lon=120.15&lat=30.25 乙:amapuri://navi?lon=113.9491&lat=22.5458', (html) => html);
  assert.equal(out.match(/class="dm-navi"/g).length, 2);
  assert.ok(out.includes('to=120.15,30.25&amp;'), '无尾逗号');
  assert.ok(out.includes('to=113.9491,22.5458&amp;'), '无尾逗号');
  assert.doesNotMatch(out, /to=120\.15,30\.25,&/);
  assert.doesNotMatch(out, /to=113\.9491,22\.5458,&/);
});

test('renderMarkdown: 尾部句号/右括号 → 正确剥离并替换(句号被剥离;括号保留为文本)', () => {
  const period = renderMarkdown('导航到:amapuri://navi?lon=113.934497&lat=22.540517.', (html) => html);
  assert.match(period, /<a class="dm-navi"/);
  assert.ok(period.includes('data-navi="amapuri://navi?lon=113.934497&amp;lat=22.540517"'), '尾部句号被剥离,data-navi 干净');
  assert.doesNotMatch(period, /22\.540517\./);
  const paren = renderMarkdown('(导航:amapuri://navi?lon=113.934497&lat=22.540517)', (html) => html);
  assert.match(paren, /\(导航:<a class="dm-navi"/);
  assert.match(paren, />打开高德导航<\/a>\)/);
});

test('renderMarkdown: 坏裸 URL(lon=abc)→ 原样保留,不产出按钮', () => {
  const out = renderMarkdown('地址:amapuri://navi?lon=abc&lat=30', (html) => html);
  assert.doesNotMatch(out, /class="dm-navi"/);
  assert.match(out, /amapuri:\/\/navi\?lon=abc&amp;lat=30/);
});

test('renderMarkdown: 链接语法形态不触发预扫描(renderer 路径保持,回归不破坏)', () => {
  const out = renderMarkdown('[导航](amapuri://navi?lon=120.15&lat=30.25&name=%E6%9D%AD%E5%B7%9E)', (html) => html);
  assert.match(out, /<a class="dm-navi"/);
  assert.ok(out.includes('data-navi="amapuri://navi?lon=120.15&amp;lat=30.25&amp;name=%E6%9D%AD%E5%B7%9E"'));
  assert.doesNotMatch(out, /\[导航\]\(/, '链接语法文本不应泄漏');
});

test('preprocessNaviUrls: naviLabel 注入 + 坏 URL 原样返回', () => {
  assert.match(preprocessNaviUrls('amapuri://navi?lon=120&lat=30', 'Open in AMap'), />Open in AMap<\/a>/);
  assert.equal(preprocessNaviUrls('amapuri://navi?lon=abc&lat=30'), 'amapuri://navi?lon=abc&lat=30');
});

// ---------- 导航按钮样式契约(2026-08-22 ws-navi3) ----------
// 背景:裸 `:global(.dm-navi)` 特异性 (0,1,0) < `.md a`(0,1,1) → 按钮文字被
// `.md a` 的 color 染成 #007AFF,蓝字蓝底不可见(用户反馈 2026-08-22)。

test('契约: dm-navi 选择器带 .md 前缀且定义在 .md a 之后(特异性稳压,防回归)', () => {
  const css = readFileSync(new URL('../src/components/markdown-text.module.css', import.meta.url), 'utf8');
  // 按钮规则必须写成 `.md :global(.dm-navi)`(0,2,0) 形态;hover/active 同样带前缀。
  assert.match(css, /\.md :global\(\.dm-navi\)\s*\{/);
  assert.match(css, /\.md :global\(\.dm-navi:hover\)\s*\{/);
  assert.match(css, /\.md :global\(\.dm-navi:active\)\s*\{/);
  // 不得退回行首裸 `:global(.dm-navi)`(0,1,0,会被 .md a 覆盖)。
  assert.doesNotMatch(css, /^:global\(\.dm-navi/m);
  // 定义顺序:navi 规则必须在 `.md a` 之后(同等条件下靠后覆盖兜底)。
  const mdARule = /\.md a\s*\{/.exec(css);
  const naviRule = /\.md :global\(\.dm-navi\)\s*\{/.exec(css);
  assert.ok(mdARule && naviRule, '`.md a` 与 `.md :global(.dm-navi)` 规则都必须存在');
  assert.ok(naviRule.index > mdARule.index, 'navi 规则必须定义在 `.md a` 之后');
  // 按钮本体:白字 + 无下划线 + 蓝底(`.md a` 的 color/underline 不得侵入)。
  const naviBlock = css.slice(naviRule.index, css.indexOf('.md table'));
  assert.match(naviBlock, /background:\s*#007aff/);
  assert.match(naviBlock, /color:\s*#fff/);
  assert.match(naviBlock, /text-decoration:\s*none/);
});
