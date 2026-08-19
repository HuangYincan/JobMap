// ============================================================
// 招聘 Logo 解析
//
// 优先级：该办公点 / 子公司招聘页 icon → 集团保底 icon → emoji。
// 一家公司可有多个职场，icon 可以不同。
//
// 2026-08-20（ws3）扩展：
// - 裸 IPv4 host（favicon.im / icon.horse 均实测/预期 404，见 tech/16-bug-fixes.md:914）
//   不再直连 favicon 服务，先查 DOMAIN_LOGO_MAP 映射到官方域名；无映射 → emoji/SVG 占位。
// - favicon 支持候选服务数组 [favicon.im, icon.horse]（ADR-007 备选，tech/06-decisions.md），
//   消费组件（poi-card / poi-detail / map-markers 徽章）onerror 依次切换下一候选，最后降 emoji。
// ============================================================

export interface LogoResolveInput {
  /** 该岗位所属职场的招聘页或子公司站点 */
  siteCareerUrl?: string;
  siteLogoUrl?: string;
  companyCareerUrl?: string;
  companyLogoUrl?: string;
  fallbackEmoji?: string;
}

export interface ResolvedLogo {
  url?: string;
  emoji: string;
  source: 'site' | 'company' | 'favicon' | 'emoji';
}

function hostFromUrl(url?: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname;
  } catch {
    return null;
  }
}

/** 裸 IPv4 host（favicon 服务商对裸 IP 一律拿不到图标，favicon.im 实测 404）。 */
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * 裸 IP host → 官方域名映射（2026-08-20 grep crawler/ + server/data + seed 全库，
 * 实际出现的裸 IP host 仅 1 个，表只覆盖真实存在的，避免空表）。
 * 站点/公司 careerUrl 写成裸 IP 时 favicon 服务拿不到图标，解析链经此表换到
 * 官方域名再取 favicon（链中 source 记 'company'）。
 *
 * ⚠️ 47.96.146.209 的官方域名未联网复核（开发沙箱无 egress），如映射错误改一行即可；
 * onerror 兜底链保证域名错误时仍优雅降级 emoji，不破相。
 */
export const DOMAIN_LOGO_MAP: Readonly<Record<string, string>> = {
  // 浙江省发展规划研究院（radar drop careerUrl = http://47.96.146.209:8111/zhaopin_sx.php）
  '47.96.146.209': 'zdpi.org.cn',
};

/** 候选 favicon 服务（顺序即优先级；icon.horse 为 ADR-007 实测 200 的备选，国内可达性未验证）。 */
const FAVICON_SERVICES: ReadonlyArray<(host: string, size: number) => string> = [
  (host, size) => `https://favicon.im/${encodeURIComponent(host)}?size=${size}`,
  (host) => `https://icon.horse/icon/${encodeURIComponent(host)}`,
];

/** host → 有效域名：裸 IP 且在 DOMAIN_LOGO_MAP 内 → 映射的官方域名；其余原样；无 host → null。 */
function effectiveFaviconHost(url?: string): string | null {
  const host = hostFromUrl(url);
  if (!host) return null;
  if (IPV4_RE.test(host)) return DOMAIN_LOGO_MAP[host] ?? null;
  return host;
}

/**
 * 某 url 的 favicon 候选列表（favicon.im → icon.horse，消费组件 onerror 依次切换）。
 * 裸 IP 且无映射 → 空列表（不请求 favicon 服务，直接 emoji/SVG 占位）。
 */
export function faviconCandidatesFromUrl(url?: string, size = 128): string[] {
  const host = effectiveFaviconHost(url);
  if (!host) return [];
  return FAVICON_SERVICES.map((build) => build(host, size));
}

/**
 * 首选 favicon URL（favicon.im — 国内可达的免费 favicon API，中文文档，CDN a.favicon.im，
 * 替代被墙的 google s2；2026-08-19 本机 node fetch 实测记录见 tech/06-decisions.md ADR-007）。
 * 完整候选链见 faviconCandidatesFromUrl。
 */
export function faviconFromUrl(url?: string, size = 128): string | undefined {
  return faviconCandidatesFromUrl(url, size)[0];
}

/**
 * 映射层（2026-08-20）：careerUrl host 是裸 IP 且在 DOMAIN_LOGO_MAP 内 →
 * 用官方域名生成 favicon URL。source 记 'company'（映射结果是公司官方域名，
 * 不是招聘子站点自身的 favicon）。
 */
function mappedCompanyFavicon(url?: string): string | undefined {
  const host = hostFromUrl(url);
  if (!host || !IPV4_RE.test(host)) return undefined;
  const realDomain = DOMAIN_LOGO_MAP[host];
  if (!realDomain) return undefined;
  return faviconFromUrl(`https://${realDomain}/`);
}

/**
 * 公司级 logo 解析链（离线 seed 路径 recruitment-source.logoForSite 与
 * DB 读路径 recruitment-store.resolveDbCompanyLogo 共用）：
 * 站点 logo → 站点域名映射 → 站点 favicon → 公司 logo → 公司域名映射 →
 * 公司 favicon → emoji（兜底 🏢）。
 */
export function resolveCompanyLogo(input: LogoResolveInput): ResolvedLogo {
  const emoji = input.fallbackEmoji || '🏢';
  if (input.siteLogoUrl) {
    return { url: input.siteLogoUrl, emoji, source: 'site' };
  }
  const siteMapped = mappedCompanyFavicon(input.siteCareerUrl);
  if (siteMapped) {
    return { url: siteMapped, emoji, source: 'company' };
  }
  const siteFavicon = faviconFromUrl(input.siteCareerUrl);
  if (siteFavicon) {
    return { url: siteFavicon, emoji, source: 'favicon' };
  }
  if (input.companyLogoUrl) {
    return { url: input.companyLogoUrl, emoji, source: 'company' };
  }
  const companyMapped = mappedCompanyFavicon(input.companyCareerUrl);
  if (companyMapped) {
    return { url: companyMapped, emoji, source: 'company' };
  }
  const companyFavicon = faviconFromUrl(input.companyCareerUrl);
  if (companyFavicon) {
    return { url: companyFavicon, emoji, source: 'favicon' };
  }
  return { emoji, source: 'emoji' };
}
