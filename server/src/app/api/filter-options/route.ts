// ============================================================
// GET /api/filter-options — 模式筛选器选项
//
// 遵循 tech/10-search-filter.md：
//   返回模式特定筛选器配置 + 动态选项（行业、规模等）
// ============================================================

import { NextResponse } from 'next/server';
import { MODES, parseKnownMode } from '@/lib/modes';
import { PUBLIC_CACHE_CONTROL, publicCacheKey, readPublicCache, writePublicCache } from '@/lib/public-cache';

export function GET(request: Request) {
  const url = new URL(request.url);
  const rawMode = url.searchParams.get('mode');
  const mode = rawMode ? parseKnownMode(rawMode) : null;

  if (!mode) {
    return NextResponse.json(
      { code: 'INVALID_MODE', message: `unknown mode: ${rawMode}` },
      { status: 400 }
    );
  }

  const config = MODES[mode];
  const cacheKey = publicCacheKey(['filter-options', mode]);
  const cached = readPublicCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
  }
  const body = {
    mode,
    filters: config.filters,
    sortOptions: config.sortOptions,
    defaultSort: config.defaultSort,
  };
  writePublicCache(cacheKey, body);
  return NextResponse.json(body, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
}
