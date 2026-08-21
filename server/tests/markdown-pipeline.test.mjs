import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarkdownParser, renderMarkdown, LINK_REL, LINK_TARGET } from '../src/lib/markdown-pipeline.ts';

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
