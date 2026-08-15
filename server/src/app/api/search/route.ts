// ============================================================
// POST /api/search — 组合搜索（关键词 + 筛选 + 排序 + 分页）
//
// 遵循 tech/10-search-filter.md API 设计：
//   body: { mode, q, filters, sort, bounds, page, pageSize }
//   返回聚合信息（用于筛选器动态选项）
// ============================================================

import { NextResponse } from 'next/server';
import { INTERNSHIP_SEED } from '@/lib/seed-data';
import { runPOIPipeline } from '@/lib/search';
import { withDistance } from '@/lib/types';
import type { FilterState, MapMode, POI } from '@/lib/types';

interface SearchBody {
  mode?: MapMode;
  q?: string;
  filters?: Record<string, unknown>;
  sort?: string;
  bounds?: string;
  page?: number;
  pageSize?: number;
}

export async function POST(request: Request) {
  let body: SearchBody;
  try {
    body = (await request.json()) as SearchBody;
  } catch {
    return NextResponse.json(
      { code: 'BAD_REQUEST', message: 'invalid JSON body' },
      { status: 400 }
    );
  }

  const mode = body.mode || 'internship';
  const page = Math.max(1, Math.floor(body.page || 1));
  const pageSize = Math.min(50, Math.max(1, Math.floor(body.pageSize || 20)));

  // 数据源
  let pois: POI[] = [];
  if (mode === 'internship') {
    pois = INTERNSHIP_SEED;
  } else if (mode === 'domain') {
    // 浏览器端走 AMap JS API；服务端无 domain 数据时空结果
    pois = [];
  } else {
    pois = [];
  }

  // bounds 中心
  let center = { lng: 120.15, lat: 30.27 };
  if (body.bounds) {
    const parts = body.bounds.split(',').map(Number);
    if (parts.length === 4 && !parts.some(isNaN)) {
      center = {
        lng: (parts[0] + parts[2]) / 2,
        lat: (parts[1] + parts[3]) / 2,
      };
    }
  }

  const processed = runPOIPipeline(pois, {
    query: body.q,
    filters: body.filters as FilterState | undefined,
    sort: body.sort,
    center,
  });

  const start = (page - 1) * pageSize;
  const results = processed.slice(start, start + pageSize);

  // 聚合：行业计数（筛选器动态选项）
  const industries: Record<string, number> = {};
  if (mode === 'internship') {
    for (const poi of processed) {
      if (poi.kind !== 'recruitment') continue;
      for (const ind of poi.company.industries) {
        industries[ind] = (industries[ind] || 0) + 1;
      }
    }
  }

  return NextResponse.json({
    total: processed.length,
    page,
    pageSize,
    results: withDistance(results, center),
    aggregations: { industries },
  });
}
