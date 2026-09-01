// ============================================================
// GET /api/pois/[id] — POI 详情
//
// 遵循 tech/08-multi-mode-system.md：
//   ?mode=work 指定模式，跨模式 id 冲突时避免歧义
// ============================================================

import { NextResponse } from 'next/server';
import { loadServerCatalogByIdStrict } from '@/lib/server-catalog';
import { parseKnownMode } from '@/lib/modes';
import { PUBLIC_CACHE_CONTROL, publicCacheKey, readPublicCache, writePublicCache } from '@/lib/public-cache';

// Next 动态段参数在 router 层已解码，二次解码遇裸 `%`（如 /api/pois/100%25 → "100%"）
// 会抛 URIError → 500（scan #7）。此处不再二次解码，只做长度防御。
const MAX_ID_LENGTH = 256;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const url = new URL(request.url);
  const rawMode = url.searchParams.get('mode');
  const mode = parseKnownMode(rawMode);
  if (!mode) {
    return NextResponse.json(
      { code: 'INVALID_MODE', message: `unknown mode: ${rawMode}` },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const { id } = await params;
  if (id.length > MAX_ID_LENGTH) {
    return NextResponse.json(
      { code: 'ID_TOO_LONG', message: `POI id exceeds ${MAX_ID_LENGTH} chars` },
      { status: 400 }
    );
  }
  const cacheKey = publicCacheKey(['poi', mode, id]);
  const cached = readPublicCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
  }

  const poi = await loadServerCatalogByIdStrict(mode, id);
  if (poi === null) {
    return NextResponse.json(
      { code: 'DB_UNAVAILABLE', message: 'database unavailable, try again later' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (!poi) {
    return NextResponse.json(
      { code: 'NOT_FOUND', message: `POI ${id} not found` },
      { status: 404 }
    );
  }
  writePublicCache(cacheKey, poi);
  return NextResponse.json(poi, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
}
