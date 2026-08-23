// ============================================================
// POST /api/search — 组合搜索（关键词 + 筛选 + 排序 + 分页）
//
// 遵循 tech/10-search-filter.md API 设计：
//   body: { mode, q, filters, sort, bounds, page, pageSize }
//   返回聚合信息（用于筛选器动态选项）
// filters 透传同 /api/pois：maxTier（LOD 层级上限）/ city（城市名或行政区划码）/ alive（只在招）。
// 加固（quality-scan #7/#10）：输入上限 + 缓存 key 卫生 + pageSize 上限。
// ============================================================

import { NextResponse } from 'next/server';
import { RequestBodyTooLargeError, readJsonBody } from '@/lib/request-body';
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

// ---- 输入上限（quality-scan #10 / #7）----
/** q 上限：超长关键词直接 400（防超长 q 进全 catalog 匹配循环 + 缓存 key 膨胀）。 */
const MAX_Q_LENGTH = 100;
/** body 总大小上限（UTF-16 长度近似 64KB；防超大 payload 进 JSON.parse）。 */
const MAX_BODY_CHARS = 64 * 1024;
/** filters 序列化长度上限：超限 400，且序列化结果直接复用为缓存 key 组件（key 卫生）。 */
const MAX_FILTERS_JSON_LENGTH = 4000;
/** pageSize 上限：无 bounds 全量搜索时防单次大响应（客户端语义不变，正常请求恒 ≤50）。 */
const MAX_PAGE_SIZE = 100;

export async function POST(request: Request) {
  let body: SearchBody;
  try {
    body = await readJsonBody<SearchBody>(request, MAX_BODY_CHARS);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { code: 'BODY_TOO_LARGE', message: 'request body too large' },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { code: 'BAD_REQUEST', message: 'invalid JSON body' },
      { status: 400 }
    );
  }

  // #10：q 必须是字符串且 ≤ MAX_Q_LENGTH（超限 400，不做静默截断——截断会改匹配语义）。
  if (body.q != null && (typeof body.q !== 'string' || body.q.length > MAX_Q_LENGTH)) {
    return NextResponse.json(
      { code: 'Q_TOO_LONG', message: `q must be a string of at most ${MAX_Q_LENGTH} chars` },
      { status: 400 }
    );
  }
  // #10：filters 必须是普通对象，且序列化长度受限（防缓存 key 无上限膨胀）。
  if (body.filters != null && (typeof body.filters !== 'object' || Array.isArray(body.filters))) {
    return NextResponse.json(
      { code: 'BAD_REQUEST', message: 'filters must be an object' },
      { status: 400 }
    );
  }
  const filtersJson = JSON.stringify(body.filters ?? {});
  if (filtersJson.length > MAX_FILTERS_JSON_LENGTH) {
    return NextResponse.json(
      { code: 'FILTERS_TOO_LARGE', message: `filters exceed ${MAX_FILTERS_JSON_LENGTH} chars` },
      { status: 400 }
    );
  }
  // #7：pageSize 上限（1..MAX_PAGE_SIZE，超限 400）。
  if (
    body.pageSize != null &&
    (typeof body.pageSize !== 'number' ||
      !Number.isFinite(body.pageSize) ||
      body.pageSize < 1 ||
      body.pageSize > MAX_PAGE_SIZE)
  ) {
    return NextResponse.json(
      { code: 'INVALID_PAGE_SIZE', message: `pageSize must be an integer in 1..${MAX_PAGE_SIZE}` },
      { status: 400 }
    );
  }

  const mode = body.mode || 'work';
  const cacheKey = publicCacheKey([
    'search',
    mode,
    body.q,
    filtersJson,
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
