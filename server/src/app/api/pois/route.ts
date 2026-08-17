// ============================================================
// GET /api/pois — POI 列表（支持模式、搜索、筛选、排序）
//
// 遵循 tech/10-search-filter.md API 设计：
//   ?mode=work&q=算法&filters={"industry":["ai"]}&sort=salaryDesc
//
// Phase 2 数据策略：
// - 工作模式：导入行优先，否则 seed
// - Domain 模式：服务端 DOMAIN_SEED；浏览器直连 AMap JS API
//
// filters 透传（national scope，2026-08-17）：
// - maxTier: LOD 上限 = 当前 zoom 取整（0..20；公司 tier = 可见最小 zoom，tier<=zoom 显示，tech/19）
// - city: 城市名或行政区划码（city_code 精确 OR city ILIKE）
// - alive: 只在招（DB 读路径恒开；离线 catalog 按旗标内存过滤）
// ============================================================

import { NextResponse } from 'next/server';
import { loadServerCatalog } from '@/lib/server-catalog';
import { searchPublicCatalog, spatialClipFromSearch } from '@/lib/public-search';
import type { MapMode } from '@/lib/types';
import { PUBLIC_CACHE_CONTROL, publicCacheKey, readPublicCache, writePublicCache } from '@/lib/public-cache';

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
  const bounds = url.searchParams.get('bounds');
  const page = Number(url.searchParams.get('page')) || 1;
  const pageSize = Number(url.searchParams.get('pageSize')) || 20;
  const cacheKey = publicCacheKey(['pois', mode, q, sort, url.searchParams.get('filters'), bounds, page, pageSize]);
  const cached = readPublicCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
  }

  const query = { mode, q, filters, sort, bounds, page, pageSize };
  const pois = await loadServerCatalog(mode, spatialClipFromSearch(query));
  const found = searchPublicCatalog(pois, query);
  const payload = {
    total: found.total,
    page: found.page,
    pageSize: found.pageSize,
    results: found.results,
  };
  writePublicCache(cacheKey, payload);
  return NextResponse.json(payload, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
}
