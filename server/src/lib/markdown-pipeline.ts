// Markdown → 安全 HTML 纯逻辑(可单测)。
//
// 管线:marked.parse(GFM,自定义 link renderer)→ 调用方注入的消毒器
// (生产 = DOMPurify.sanitize,测试 = spy)。消毒器抽成参数避免 Node 无 DOM
// 环境执行 DOMPurify,同时保证「不消毒绝不注入」的红线在组件侧强制。
//
// 链接安全:renderer 统一输出 target="_blank" + rel="noopener noreferrer"
// (rel 在 DOMPurify 默认属性白名单内;target 不在,需组件侧 ADD_ATTR——
// 见 markdown-text.tsx 的 PURIFY_CONFIG)。
//
// 导航链接(2026-08-22 ws-navi):LLM 输出 amapuri://navi?lon=..&lat=.. 时,DOMPurify
// URI 白名单不认 amapuri: scheme → href 被剥 → 链接变纯文本且被浏览器音译。方案:
// 解析参数后改写为高德 Web 导航 URL(https,天然过 URI 白名单,无需改 DOMPurify 配置),
// 输出带 data-navi(保留原生 URI,data-* 默认允许)的按钮型链接;移动端组件侧事件委托
// 用 data-navi 唤起原生 App,桌面端放行 https href。解析失败 → 不强行渲染,回落普通链接。
//
// 裸 URL 预扫描(2026-08-22 ws-navi2):LLM 实测常以纯文本输出 amapuri://navi?... 裸露在
// 句子里,而 marked 的裸 URL 自动链接规则只认 https?/ftp/www 前缀 → link renderer 不触发
// → 按钮不渲染。renderMarkdown 在 marked 解析前先经 preprocessNaviUrls 把裸 URL 替换为
// 与 renderer 同构的按钮锚;链接语法形态(含 <a>/autolink)由 lookbehind 排除,仍走 renderer,
// 两条路径不重叠。

import { Marked, type Tokens } from "marked";

export const LINK_TARGET = "_blank";
export const LINK_REL = "noopener noreferrer";
/** 导航按钮缺省文案(组件侧经 i18n 传入,见 markdown-text.tsx)。 */
export const NAVI_DEFAULT_LABEL = "打开高德导航";

/** 属性值最小转义(href/title 的引号注入由 DOMPurify 二次清洗兜底)。 */
function escapeAttr(value: string): string {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 纯函数:解析 amapuri://navi 导航 URI → 高德 Web 导航 URL。
 * 接受 `amapuri://navi?lon=<lng>&lat=<lat>[&name=<名称>]`(键名大小写/顺序任意、
 * 值为 URL 编码);lon/lng 均可作经度键。坐标必须为有限数且在合法范围,
 * 任一解析失败(缺参/编码损坏/非数字/越界)→ null,不强行渲染。
 */
export function buildNaviWebUrl(raw: string): string | null {
  if (!raw || !raw.toLowerCase().startsWith("amapuri://")) return null;
  const rest = raw.slice("amapuri://".length);
  const qIdx = rest.indexOf("?");
  if (qIdx < 0) return null;
  if (rest.slice(0, qIdx).toLowerCase() !== "navi") return null;

  const params = new Map<string, string>();
  for (const pair of rest.slice(qIdx + 1).split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const key = pair.slice(0, eq).trim().toLowerCase();
    if (!key || params.has(key)) continue;
    params.set(key, pair.slice(eq + 1));
  }

  const decode = (v: string | undefined): string | null => {
    if (v === undefined) return null;
    try {
      return decodeURIComponent(v);
    } catch {
      return null; // 编码损坏
    }
  };

  const lonRaw = decode(params.get("lon") ?? params.get("lng"));
  const latRaw = decode(params.get("lat"));
  if (lonRaw === null || latRaw === null || lonRaw === "" || latRaw === "") return null;
  const lng = Number(lonRaw);
  const lat = Number(latRaw);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;

  let name = "";
  const nameParam = params.get("name");
  if (nameParam !== undefined) {
    const decoded = decode(nameParam);
    if (decoded === null) return null;
    name = decoded;
  }

  return `https://uri.amap.com/navigation?to=${lng},${lat},${encodeURIComponent(name)}&mode=car&coordinate=gaode`;
}

/**
 * 导航按钮锚(renderer 与裸 URL 预扫描共用,保证两路径输出同构):
 * href 为 https Web 导航(过 DOMPurify URI 白名单),data-navi 保留原生 amapuri URI
 * (data-* 默认允许,移动端事件委托据此唤起原生 App),label 经 escapeAttr。
 */
function naviAnchorHtml(webUrl: string, rawUri: string, label: string): string {
  return `<a class="dm-navi" href="${escapeAttr(webUrl)}" data-navi="${escapeAttr(rawUri)}" target="${LINK_TARGET}" rel="${LINK_REL}">${escapeAttr(label)}</a>`;
}

/**
 * 裸 amapuri://navi URL(marked 裸链接自动链接规则只认 https?/ftp/www 前缀,此类纯文本
 * URL 不被识别 → link renderer 不触发 → 需在 parse 前预扫描)。
 * lookbehind 排除(保守优先,不误伤 renderer 路径):
 * - `\w`:URL 与词字符粘连(如英文文字直接紧贴);
 * - `(`:链接语法 `](url)` / 括号紧贴;
 * - `<` `"` `'`:autolink `<url>` / 已有 HTML 锚 href/data-navi 一部分;
 * - `` ` ``:代码 span 起点。
 * URL 主体终止于空白/引号/尖括号/括号/反引号。
 */
const BARE_NAVI_URL_RE = /(?<![\w(<"'`])amapuri:\/\/navi\?[^\s<>"'()`]+/gi;
/** 尾部多余闭合括号/标点(句子标点紧贴 URL 时,剥离一次再尝试解析)。 */
const TRAILING_NAVI_PUNCT_RE = /[),.;:!?。，；：！？、》〉」』】）…]+$/;

/**
 * 纯函数:裸 amapuri://navi URL 预扫描 → 按钮锚(renderMarkdown 在 marked 解析前调用)。
 * 每处命中:先原文直解;失败则剔除尾部多余闭合括号/标点(如 `...style=2.` → `style=2`)
 * 再试一次;仍失败 → 保持原文不替换(不做反复标点剥离猜断,保守优先)。
 * @param text  原始 markdown(LLM 输出,视为不可信数据)
 * @param label 按钮文案(缺省 NAVI_DEFAULT_LABEL)
 */
export function preprocessNaviUrls(text: string, label?: string): string {
  const naviLabel = label ?? NAVI_DEFAULT_LABEL;
  return text.replace(BARE_NAVI_URL_RE, (match) => {
    const direct = buildNaviWebUrl(match);
    if (direct !== null) return naviAnchorHtml(direct, match, naviLabel);
    const stripped = match.replace(TRAILING_NAVI_PUNCT_RE, "");
    if (stripped !== match) {
      const webUrl = buildNaviWebUrl(stripped);
      if (webUrl !== null) return naviAnchorHtml(webUrl, stripped, naviLabel);
    }
    return match;
  });
}

/** renderMarkdown 可选参数。 */
export interface MarkdownRenderOptions {
  /** 导航按钮文案(i18n);缺省 NAVI_DEFAULT_LABEL。 */
  naviLabel?: string;
}

/**
 * 创建带安全链接 renderer 的 marked 实例(GFM 默认开)。
 * 复用单例配置不跨调用泄漏:每次创建独立实例。
 */
export function createMarkdownParser(opts: MarkdownRenderOptions = {}): Marked {
  const naviLabel = opts.naviLabel ?? NAVI_DEFAULT_LABEL;
  return new Marked({
    gfm: true,
    renderer: {
      link({ href, title, tokens }: Tokens.Link): string {
        if (href.toLowerCase().startsWith("amapuri://")) {
          const webUrl = buildNaviWebUrl(href);
          if (webUrl !== null) {
            // 导航按钮(与裸 URL 预扫描 naviAnchorHtml 同构)
            return naviAnchorHtml(webUrl, href, naviLabel);
          }
        }
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
 * @param opts   渲染选项(导航按钮文案)
 */
export function renderMarkdown(
  text: string,
  sanitize: (html: string) => string,
  opts: MarkdownRenderOptions = {},
): string {
  const parser = createMarkdownParser(opts);
  // 裸 amapuri://navi URL 预扫描(marked 裸链接规则不认 amapuri: scheme → renderer 不触发;
  // 链接语法形态由 lookbehind 排除,仍走 renderer,两路径不重叠)。
  const preprocessed = preprocessNaviUrls(text, opts.naviLabel);
  // 同步解析(默认 async:false);marked 类型为 string | Promise<string>,此处按同步断言
  const html = parser.parse(preprocessed) as string;
  return sanitize(html);
}
