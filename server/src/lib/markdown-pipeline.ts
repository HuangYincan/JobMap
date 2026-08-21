// Markdown → 安全 HTML 纯逻辑(可单测)。
//
// 管线:marked.parse(GFM,自定义 link renderer)→ 调用方注入的消毒器
// (生产 = DOMPurify.sanitize,测试 = spy)。消毒器抽成参数避免 Node 无 DOM
// 环境执行 DOMPurify,同时保证「不消毒绝不注入」的红线在组件侧强制。
//
// 链接安全:renderer 统一输出 target="_blank" + rel="noopener noreferrer"
// (rel 在 DOMPurify 默认属性白名单内;target 不在,需组件侧 ADD_ATTR——
// 见 markdown-text.tsx 的 PURIFY_CONFIG)。

import { Marked, type Tokens } from "marked";

export const LINK_TARGET = "_blank";
export const LINK_REL = "noopener noreferrer";

/** 属性值最小转义(href/title 的引号注入由 DOMPurify 二次清洗兜底)。 */
function escapeAttr(value: string): string {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 创建带安全链接 renderer 的 marked 实例(GFM 默认开)。
 * 复用单例配置不跨调用泄漏:每次创建独立实例。
 */
export function createMarkdownParser(): Marked {
  return new Marked({
    gfm: true,
    renderer: {
      link({ href, title, tokens }: Tokens.Link): string {
        const text = tokens ? this.parser.parseInline(tokens) : "";
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
        return `<a href="${escapeAttr(href)}" target="${LINK_TARGET}" rel="${LINK_REL}"${titleAttr}>${text}</a>`;
      },
    },
  });
}

/**
 * 纯管线:markdown → sanitize → HTML 字符串。
 * @param text  markdown 原文(LLM 输出,视为不可信数据)
 * @param sanitize 消毒器(生产注入 DOMPurify.sanitize;返回值将被注入 DOM)
 */
export function renderMarkdown(text: string, sanitize: (html: string) => string): string {
  const parser = createMarkdownParser();
  // 同步解析(默认 async:false);marked 类型为 string | Promise<string>,此处按同步断言
  const html = parser.parse(text) as string;
  return sanitize(html);
}
