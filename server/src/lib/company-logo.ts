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

export function faviconFromUrl(url?: string, size = 128): string | undefined {
  const host = hostFromUrl(url);
  if (!host) return undefined;
  return `https://www.google.com/s2/favicons?sz=${size}&domain=${encodeURIComponent(host)}`;
}

/** 岗位/职场优先，再公司官网，再 emoji。 */
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
