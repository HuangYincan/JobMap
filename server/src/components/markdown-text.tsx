"use client";

// Markdown 渲染:marked.parse → DOMPurify.sanitize → dangerouslySetInnerHTML。
//
// 安全红线:不消毒绝不注入——LLM 输出视为不可信数据,先消毒后注入。
// 只在客户端消毒(useEffect 挂载后):SSR 首渲染输出纯文本,避免 Node 无 DOM
// 环境执行 DOMPurify,也杜绝未消毒 HTML 进入首屏/被浏览器预解析。
//
// 库审查结论(marked@18.0.10 / dompurify@3.4.14,2026-08-21,详见 tech/24 §9.10):
// - marked 是纯解析器无内置消毒,原始 HTML 会被透传 → 必须过 DOMPurify;
// - DOMPurify 默认允许 html+svg+mathML → USE_PROFILES {html:true} 收窄到 HTML;
// - target 属性不在默认白名单(已核对源码)→ ADD_ATTR ['target'](rel 默认在);
// - URI 过滤(IS_ALLOWED_URI)拒绝 javascript:/data: 等危险协议;
// - 配置对象每次调用克隆,不跨调用泄漏。

import { useEffect, useState, type MouseEvent } from "react";
import DOMPurify from "dompurify";
import { buildNaviWebUrl, renderMarkdown } from "@/lib/markdown-pipeline";
import { t, type Language } from "@/lib/i18n";
import styles from "./markdown-text.module.css";

const PURIFY_CONFIG = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ["target"],
};

export function MarkdownText({ text, lang = "zh" }: { text: string; lang?: Language }) {
  const [html, setHtml] = useState<string | null>(null);
  const naviLabel = t("agentOpenNavi", lang);

  useEffect(() => {
    // renderMarkdown = marked.parse → DOMPurify.sanitize(不消毒绝不注入)
    setHtml(renderMarkdown(text, (raw) => DOMPurify.sanitize(raw, PURIFY_CONFIG), { naviLabel }));
  }, [text, naviLabel]);

  // 导航按钮事件委托:命中 .dm-navi → 移动端经 data-navi(amapuri)唤起原生 App
  // (preventDefault 阻止 https href 覆盖),桌面端放行默认 href(Web 导航,任何浏览器可用)
  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest("a.dm-navi");
    if (!el) return;
    const naviRaw = el.getAttribute("data-navi");
    if (!naviRaw) return;
    if (/Mobi|Android/i.test(navigator.userAgent)) {
      // DOMPurify preserves data-* attributes; revalidate before navigation so
      // a corrupted or future markup path cannot hand an arbitrary URI to the OS.
      if (!buildNaviWebUrl(naviRaw)) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      window.location.href = naviRaw;
    }
  };

  if (html === null) return <span className={styles.raw}>{text}</span>;
  return <div className={styles.md} onClick={handleClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
