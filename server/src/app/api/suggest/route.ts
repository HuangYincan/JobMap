// ============================================================
// GET /api/suggest — 搜索建议（Autocomplete）
//
// 遵循 tech/10-search-filter.md：
//   匹配公司名、岗位标题、行业标签；返回建议 + 热门搜索
// ============================================================

import { NextResponse } from 'next/server';
import { DOMAIN_SEED, INTERNSHIP_SEED } from '@/lib/seed-data';
import { matchKeyword } from '@/lib/search';
import { isRecruitmentMode } from '@/lib/types';
import type { MapMode } from '@/lib/types';
import { PUBLIC_CACHE_CONTROL, publicCacheKey, readPublicCache, writePublicCache } from '@/lib/public-cache';
import { trendingForMode } from '@/lib/trending-search';

export function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const mode = (url.searchParams.get('mode') || 'work') as MapMode;
  const cacheKey = publicCacheKey(['suggest', mode, q]);
  const cached = readPublicCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
  }

  const suggestions = [];

  if (q && isRecruitmentMode(mode)) {
    for (const poi of INTERNSHIP_SEED) {
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
          });
        }
      }
    }
    // 行业标签匹配
    const industries = [
      { code: 'internet', label: '互联网' },
      { code: 'ai', label: '人工智能' },
      { code: 'finance', label: '金融' },
      { code: 'game', label: '游戏' },
      { code: 'hardware', label: '硬件' },
    ];
    for (const ind of industries) {
      if (matchKeyword(ind.label, q)) {
        suggestions.push({
          type: 'tag',
          id: `tag-${ind.code}`,
          title: `#${ind.label}`,
          subtitle: `${INTERNSHIP_SEED.filter((p) => p.company.industries.includes(ind.code)).length} 个公司`,
          icon: '🏷️',
        });
      }
    }
  } else if (q && mode === 'domain') {
    for (const poi of DOMAIN_SEED) {
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
