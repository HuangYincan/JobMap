// ============================================================
// POST /api/search — 组合搜索（关键词 + 筛选 + 排序 + 分页）
//
// 遵循 tech/10-search-filter.md API 设计：
//   body: { mode, q, filters, sort, bounds, page, pageSize }
//   返回聚合信息（用于筛选器动态选项）
// ============================================================

import { NextResponse } from 'next/server';
import { loadServerCatalog } from '@/lib/server-catalog';
import { searchPublicCatalog, spatialClipFromSearch } from '@/lib/public-search';
import type { MapMode } from '@/lib/types';
import { PUBLIC_CACHE_CONTROL, publicCacheKey, readPublicCache, writePublicCache } from '@/lib/public-cache';

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

  const mode = body.mode || 'work';
  const cacheKey = publicCacheKey([
    'search',
    mode,
    body.q,
    JSON.stringify(body.filters ?? {}),
    body.sort,
    body.bounds,
    body.page,
    body.pageSize,
  ]);
  const cached = readPublicCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
  }

  const query = {
    mode,
    q: body.q,
    filters: body.filters,
    sort: body.sort,
    bounds: body.bounds,
    page: body.page,
    pageSize: body.pageSize,
  };
  const pois = await loadServerCatalog(mode, spatialClipFromSearch(query));
  const payload = searchPublicCatalog(pois, query);
  writePublicCache(cacheKey, payload);
  return NextResponse.json(payload, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
}
