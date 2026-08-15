// ============================================================
// GET /api/suggest — 搜索建议（Autocomplete）
//
// 遵循 tech/10-search-filter.md：
//   匹配公司名、岗位标题、行业标签；返回建议 + 热门搜索
// ============================================================

import { NextResponse } from 'next/server';
import { INTERNSHIP_SEED } from '@/lib/seed-data';
import { matchKeyword } from '@/lib/search';

/** 热门搜索（静态种子，Phase 3 改为统计） */
const HOT_SEARCHES = ['算法', '前端', 'Java', '人工智能', '大厂', '产品'];

export function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const mode = url.searchParams.get('mode') || 'internship';

  const suggestions = [];

  if (q && mode === 'internship') {
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
  }

  return NextResponse.json({
    suggestions: suggestions.slice(0, 10),
    recentSearches: [], // Phase 3: localStorage/DB
    hotSearches: q ? [] : HOT_SEARCHES,
  });
}
