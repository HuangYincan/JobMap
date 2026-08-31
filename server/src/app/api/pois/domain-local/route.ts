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
// 无库/表缺失(null)= 故障,≠ 空结果 → 502 { error:'local_db_unavailable' }
// (前端回退高德,不伪装成成功空结果)。
// ============================================================

import { NextResponse } from 'next/server';
import { PUBLIC_CACHE_CONTROL, publicCacheKey, readPublicCache, writePublicCache } from '@/lib/public-cache';
import { loadHangzhouPoisFromDb, isAllowedHangzhouBounds, parseBoundsParam } from '@/lib/hz-poi-store';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const boundsRaw = url.searchParams.get('bounds');
  const zoomRaw = url.searchParams.get('zoom');
  const q = url.searchParams.get('q') || undefined;
  const categoriesRaw = url.searchParams.get('categories');
  const limitRaw = url.searchParams.get('limit');
  const offsetRaw = url.searchParams.get('offset');

  // 与 /api/pois 的 API 加固对齐：所有外部字符串先限长，再进入缓存 key / SQL。
  const MAX_Q_LENGTH = 100;
  const MAX_PARAM_LENGTH = 128;
  const MAX_CATEGORIES_LENGTH = 300;
  if (
    (boundsRaw && boundsRaw.length > MAX_PARAM_LENGTH) ||
    (zoomRaw && zoomRaw.length > MAX_PARAM_LENGTH) ||
    (q && q.length > MAX_Q_LENGTH) ||
    (categoriesRaw && categoriesRaw.length > MAX_CATEGORIES_LENGTH) ||
    (limitRaw && limitRaw.length > MAX_PARAM_LENGTH) ||
    (offsetRaw && offsetRaw.length > MAX_PARAM_LENGTH)
  ) {
    return NextResponse.json(
      { code: 'PARAM_TOO_LARGE', message: 'one or more query parameters exceed their length limit' },
      { status: 400 }
    );
  }

  const bounds = parseBoundsParam(boundsRaw);
  // An unbounded hz_pois read can count/sort roughly one million rows. The
  // public endpoint is intentionally a bounded Hangzhou viewport only.
  if (!bounds) {
    return NextResponse.json(
      { code: 'INVALID_BOUNDS', message: 'bounds must be a finite west,south,east,north bbox' },
      { status: 400 },
    );
  }
  if (!isAllowedHangzhouBounds(bounds)) {
    return NextResponse.json(
      { code: 'BOUNDS_OUT_OF_RANGE', message: 'bounds must stay within the Hangzhou data extent' },
      { status: 400 },
    );
  }

  // NaN/Infinity 落回默认值(非法数值经 pg 序列化成 "NaN" 会让 Postgres 报错,
  // 而 catch 会把它伪装成「无数据」的 200 并缓存 30s)
  const zoomNum = zoomRaw !== null ? Number(zoomRaw) : NaN;
  const zoom = Number.isFinite(zoomNum) ? Math.floor(zoomNum) : undefined;
  const limitNum = limitRaw !== null ? Number(limitRaw) : NaN;
  const offsetNum = offsetRaw !== null ? Number(offsetRaw) : NaN;
  const limit = Number.isFinite(limitNum) ? limitNum : 300;
  const offset = Number.isFinite(offsetNum) ? offsetNum : 0;
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
    limit,
    offset,
  });

  // DB 故障/表缺失(null)≠ 空结果:真空(查库成功但 0 行)才是 200 空;
  // null 是失败信号 → 502,前端回退高德。返回 200 空会让
  // mergePoisById(existing, [], cap) ≈ 无操作,高德回退与错误信号全部失效。
  // 502 分支不写缓存(故障兜底响应被缓存会掩盖恢复)。
  if (!result) {
    return NextResponse.json(
      { error: 'local_db_unavailable' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const payload = {
    total: result.total,
    offset: result.offset,
    limit: result.limit,
    source: 'local' as const,
    results: result.results,
  };
  writePublicCache(cacheKey, payload);
  return NextResponse.json(payload, { headers: { 'Cache-Control': PUBLIC_CACHE_CONTROL } });
}
