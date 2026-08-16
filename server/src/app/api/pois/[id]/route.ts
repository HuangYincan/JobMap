// ============================================================
// GET /api/pois/[id] — POI 详情
//
// 遵循 tech/08-multi-mode-system.md：
//   ?mode=work 指定模式，跨模式 id 冲突时避免歧义
// ============================================================

import { NextResponse } from 'next/server';
import { serverCatalogById } from '@/lib/server-catalog';
import type { MapMode } from '@/lib/types';
import { PUBLIC_CACHE_CONTROL, publicCacheKey, readPublicCache, writePublicCache } from '@/lib/public-cache';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const url = new URL(request.url);
  const mode = (url.searchParams.get('mode') || 'work') as MapMode;
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const cacheKey = publicCacheKey(['poi', mode, id]);
  const cached = readPublicCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
  }

  const poi = serverCatalogById(mode, id);
  if (!poi) {
    return NextResponse.json(
      { code: 'NOT_FOUND', message: `POI ${id} not found` },
      { status: 404 }
    );
  }
  writePublicCache(cacheKey, poi);
  return NextResponse.json(poi, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
}
