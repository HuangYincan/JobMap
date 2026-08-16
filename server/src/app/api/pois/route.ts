// ============================================================
// GET /api/pois — POI 列表（支持模式、搜索、筛选、排序）
//
// 遵循 tech/10-search-filter.md API 设计：
//   ?mode=work&q=算法&filters={"industry":["ai"]}&sort=salaryDesc
//
// Phase 2 数据策略：
// - 实习模式：内置精选 seed 数据（DB 就绪后切换 PostGIS 查询）
// - Domain 模式：服务端无 AMap JS key 时返回有限示例数据；
//   浏览器端直连 AMap JS API（见 lib/amap-api.ts）
// ============================================================

import { NextResponse } from 'next/server';
import { runPOIPipeline } from '@/lib/search';
import { loadServerCatalog } from '@/lib/server-catalog';
import { withDistance } from '@/lib/types';
import type { MapMode } from '@/lib/types';
import { PUBLIC_CACHE_CONTROL, publicCacheKey, readPublicCache, writePublicCache } from '@/lib/public-cache';
import { boundsCenter, inBounds, parseBoundsParam } from '@/lib/viewport-search';

/** 解析筛选 JSON，非法时返回空对象（宽容处理） */
function parseFilters(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}


export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = (url.searchParams.get('mode') || 'work') as MapMode;
  const q = url.searchParams.get('q') || undefined;
  const sort = url.searchParams.get('sort') || undefined;
  const filters = parseFilters(url.searchParams.get('filters'));
  const bounds = parseBoundsParam(url.searchParams.get('bounds'));
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get('pageSize')) || 20));
  const cacheKey = publicCacheKey(['pois', mode, q, sort, url.searchParams.get('filters'), url.searchParams.get('bounds'), page, pageSize]);
  const cached = readPublicCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
  }

  const pois = await loadServerCatalog(mode);
  if (pois.length === 0) {
    const empty = { total: 0, page, pageSize, results: [] };
    writePublicCache(cacheKey, empty);
    return NextResponse.json(empty, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
  }

  const scoped = bounds ? pois.filter((poi) => inBounds(poi.location, bounds)) : pois;
  const center = bounds ? boundsCenter(bounds) : { lng: 120.15, lat: 30.27 };

  // ---- 管线处理：搜索 → 筛选 → 距离 → 排序 ----
  const processed = runPOIPipeline(scoped as never, {
    query: q,
    filters: filters as never,
    sort,
    center,
  });

  // ---- 分页 ----
  const start = (page - 1) * pageSize;
  const results = processed.slice(start, start + pageSize);

  const payload = {
    total: processed.length,
    page,
    pageSize,
    results: withDistance(results, center),
  };
  writePublicCache(cacheKey, payload);
  return NextResponse.json(payload, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
}
