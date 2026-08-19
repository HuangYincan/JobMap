// ============================================================
// 招聘 Logo 解析
//
// 优先级：该办公点 / 子公司招聘页 icon → 集团保底 icon → emoji。
// 一家公司可有多个职场，icon 可以不同。
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

/**
 * favicon.im — 国内可达的免费 favicon API(中文文档,CDN a.favicon.im),
 * 替代被墙的 google s2 (`https://www.google.com/s2/favicons` 国内加载失败,
 * 2026-08-19 boss/Explore 实测:672 家公司全无 icon)。
 * 2026-08-19 本机 node fetch 实测(记录见 tech/06-decisions.md ADR-007):
 * - favicon.im/alibaba.com?size=128 → 200 image/x-icon 1406B
 * - favicon.im/talent.alibaba.com?size=128 → 200 image/x-icon 1150B(子域名可用)
 * - favicon.im/careers.tencent.com?size=128 → 200 image/svg+xml(站点自身图标)
 * 备选 icon.horse(实测 200,但为国际 CDN,国内可达性未验证)。
 */
export function faviconFromUrl(url?: string, size = 128): string | undefined {
  const host = hostFromUrl(url);
  if (!host) return undefined;
  return `https://favicon.im/${encodeURIComponent(host)}?size=${size}`;
}

/**
 * 公司级 logo 解析链(离线 seed 路径 recruitment-source.logoForSite 与
 * DB 读路径 recruitment-store.resolveDbCompanyLogo 共用):
 * 站点 logo → 站点 favicon → 公司 logo → 公司 favicon → emoji(兜底 🏢)。
 */
export function resolveCompanyLogo(input: LogoResolveInput): ResolvedLogo {
  const emoji = input.fallbackEmoji || '🏢';
  if (input.siteLogoUrl) {
    return { url: input.siteLogoUrl, emoji, source: 'site' };
  }
  const siteFavicon = faviconFromUrl(input.siteCareerUrl);
  if (siteFavicon) {
    return { url: siteFavicon, emoji, source: 'favicon' };
  }
  if (input.companyLogoUrl) {
    return { url: input.companyLogoUrl, emoji, source: 'company' };
  }
  const companyFavicon = faviconFromUrl(input.companyCareerUrl);
  if (companyFavicon) {
    return { url: companyFavicon, emoji, source: 'favicon' };
  }
  return { emoji, source: 'emoji' };
}
