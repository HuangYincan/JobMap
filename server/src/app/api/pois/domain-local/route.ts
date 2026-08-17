// ============================================================
// GET /api/pois/domain-local — 杭州本地 POI(按 bbox + zoom 分层)
//
// Domain 模式杭州内走本地库,替代浏览器直连高德 PlaceSearch(一次刷新最多
// 36 次 API → 本地 1 次 HTTP)。杭州外由前端回退高德(省调用)。
//
//   ?bounds=west,south,east,north&zoom=13&q=肯德基&categories=餐饮服务,购物服务
//    &limit=300&offset=0
//
// - bounds:GCJ-02 bbox(逗号分隔),与 geom(gcj 生成列)直 && 匹配
// - zoom:当前地图缩放,floor 后 tier <= zoom 过滤(LOD 分层)
// - q:name ILIKE(配合 trgm gin)
// - categories:big_type 过滤(逗号分隔)
// - limit:1..300(默认 300);offset:0..1000(默认 0)
// 返回 { total, offset, limit, source:'local', results: DomainPOI[] }。
// 无库/表缺失 → { total:0, results:[] }(前端再回退高德)。
// ============================================================

import { NextResponse } from 'next/server';
import { PUBLIC_CACHE_CONTROL, publicCacheKey, readPublicCache, writePublicCache } from '@/lib/public-cache';
import { loadHangzhouPoisFromDb, parseBoundsParam } from '@/lib/hz-poi-store';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const boundsRaw = url.searchParams.get('bounds');
  const zoomRaw = url.searchParams.get('zoom');
  const q = url.searchParams.get('q') || undefined;
  const categoriesRaw = url.searchParams.get('categories');
  const limitRaw = url.searchParams.get('limit');
  const offsetRaw = url.searchParams.get('offset');

  const bounds = parseBoundsParam(boundsRaw);
  const zoom = zoomRaw !== null ? Math.floor(Number(zoomRaw)) : undefined;
  const categories = categoriesRaw
    ? categoriesRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;

  const cacheKey = publicCacheKey([
    'domain-local',
    boundsRaw,
    zoomRaw,
    q,
    categoriesRaw,
    limitRaw,
    offsetRaw,
  ]);
  const cached = readPublicCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
  }

  const result = await loadHangzhouPoisFromDb({
    bounds,
    zoom,
    q,
    categories,
    limit: limitRaw !== null ? Number(limitRaw) : 300,
    offset: offsetRaw !== null ? Number(offsetRaw) : 0,
  });

  const payload = {
    total: result?.total ?? 0,
    offset: result?.offset ?? 0,
    limit: result?.limit ?? 300,
    source: 'local' as const,
    results: result?.results ?? [],
  };
  writePublicCache(cacheKey, payload);
  return NextResponse.json(payload, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
}
