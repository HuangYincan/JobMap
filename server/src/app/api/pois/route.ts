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
import { serverCatalog } from '@/lib/server-catalog';
import { withDistance } from '@/lib/types';
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

/** 解析 bounds "minLng,minLat,maxLng,maxLat"，非法返回 null */
function parseBounds(raw: string | null): [number, number, number, number] | null {
  if (!raw) return null;
  const parts = raw.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => isNaN(n))) return null;
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLng >= maxLng || minLat >= maxLat) return null;
  return [minLng, minLat, maxLng, maxLat];
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const mode = (url.searchParams.get('mode') || 'work') as MapMode;
  const q = url.searchParams.get('q') || undefined;
  const sort = url.searchParams.get('sort') || undefined;
  const filters = parseFilters(url.searchParams.get('filters'));
  const bounds = parseBounds(url.searchParams.get('bounds'));
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get('pageSize')) || 20));
  const cacheKey = publicCacheKey(['pois', mode, q, sort, url.searchParams.get('filters'), url.searchParams.get('bounds'), page, pageSize]);
  const cached = readPublicCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
  }

  const pois = serverCatalog(mode);
  if (pois.length === 0) {
    const empty = { total: 0, page, pageSize, results: [] };
    writePublicCache(cacheKey, empty);
    return NextResponse.json(empty, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
  }

  // ---- 空间范围过滤（bounds 中心）----
  let center;
  if (bounds) {
    const [minLng, minLat, maxLng, maxLat] = bounds;
    center = { lng: (minLng + maxLng) / 2, lat: (minLat + maxLat) / 2 };
  } else {
    center = { lng: 120.15, lat: 30.27 }; // 杭州中心
  }

  // ---- 管线处理：搜索 → 筛选 → 距离 → 排序 ----
  const processed = runPOIPipeline(pois as never, {
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
