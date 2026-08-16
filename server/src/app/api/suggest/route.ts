// ============================================================
// GET /api/suggest — 搜索建议（Autocomplete）
//
// 遵循 tech/10-search-filter.md：
//   匹配公司名、岗位标题、行业标签；返回建议 + 热门搜索
// ============================================================

import { NextResponse } from 'next/server';
import { matchKeyword, suggestSearchTags } from '@/lib/search';
import { positionMatchesTaxonomySelection } from '@/lib/job-taxonomy';
import { loadServerCatalog } from '@/lib/server-catalog';
import { isRecruitmentMode } from '@/lib/types';
import type { MapMode, RecruitmentPOI } from '@/lib/types';
import { PUBLIC_CACHE_CONTROL, publicCacheKey, readPublicCache, writePublicCache } from '@/lib/public-cache';
import { trendingForMode } from '@/lib/trending-search';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const mode = (url.searchParams.get('mode') || 'work') as MapMode;
  const cacheKey = publicCacheKey(['suggest', mode, q]);
  const cached = readPublicCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
  }

  const catalog = await loadServerCatalog(mode);
  const suggestions = [];

  if (q && isRecruitmentMode(mode)) {
    const work = catalog.filter((poi): poi is RecruitmentPOI => poi.kind === 'recruitment');
    for (const poi of work) {
      // 公司名匹配
      if (matchKeyword(poi.company.name, q)) {
        suggestions.push({
          type: 'poi',
          id: poi.id,
          title: poi.company.name,
          subtitle: poi.company.summary || poi.company.industries.join(' · '),
          icon: poi.company.logo || '🏢',
        });
        continue; // 公司已匹配，避免重复推岗位
      }
      // 岗位标题匹配
      for (const pos of poi.positions) {
        if (matchKeyword(pos.title, q)) {
          suggestions.push({
            type: 'position',
            id: pos.id,
            title: `${poi.company.name} · ${pos.title}`,
            subtitle: pos.department ? `${pos.department} · ${pos.education || ''}` : undefined,
            icon: '💼',
            poiId: poi.id,
          });
        }
      }
    }
    for (const tag of suggestSearchTags(q, 6)) {
      const count = work.filter((poi) => {
        if (tag.key === 'industry') return poi.company.industries.includes(tag.value);
        if (tag.key === 'scale') return poi.company.scale === tag.value;
        if (tag.key === 'jobTaxonomy') {
          return poi.positions.some((pos) => positionMatchesTaxonomySelection(pos, [tag.value]));
        }
        return false;
      }).length;
      suggestions.push({
        type: 'tag',
        id: tag.id,
        title: tag.title,
        subtitle: `${count} 个公司`,
        icon: '🏷️',
      });
    }
  } else if (q && mode === 'domain') {
    for (const poi of catalog) {
      if (poi.kind !== 'domain') continue;
      if (matchKeyword(poi.name, q) || matchKeyword(poi.category, q) || matchKeyword(poi.subcategory || '', q)) {
        suggestions.push({
          type: 'poi',
          id: poi.id,
          title: poi.name,
          subtitle: poi.location.address || poi.category,
          icon: '📍',
        });
      }
    }
  }

  const payload = {
    suggestions: suggestions.slice(0, 10),
    // Recent is account-scoped (`/api/me/search-history`). Do not invent a guest cloud list here.
    recentSearches: [],
    hotSearches: q ? [] : trendingForMode(mode).map((item) => item.query),
  };
  writePublicCache(cacheKey, payload);
  return NextResponse.json(payload, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
}
