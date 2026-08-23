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

// ---- 输入上限（quality-scan #12，2026-08-23；与 POST /api/search 对齐）----
/** q 上限：超长关键词直接 400（防超长 q 进全 catalog 匹配循环 + 缓存 key 膨胀）。 */
const MAX_Q_LENGTH = 100;
/** filters 原始 JSON 上限：先拦长度，再做 JSON.parse。 */
const MAX_FILTERS_JSON_LENGTH = 4000;
/** bounds 是四个十进制坐标；sort/mode 是短枚举值，超长必非合法输入。 */
const MAX_BOUNDS_LENGTH = 128;
const MAX_SORT_LENGTH = 50;
const MAX_MODE_LENGTH = 32;
/** page 上限：超过即视为越界请求（正常分页恒远小于此）。 */
const MAX_PAGE = 10_000;
/** pageSize 上限：无 bounds 全量搜索时防单次大响应（客户端语义不变，正常请求恒 ≤50）。 */
const MAX_PAGE_SIZE = 100;

/** 分页参数：缺失/空串 → fallback；非整数或越出 1..max → null（调用方回 400）。 */
function pagedParam(raw: string | null, fallback: number, max: number): number | null {
  if (raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) return null;
  return n;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = (url.searchParams.get('mode') || 'work') as MapMode;
  const q = url.searchParams.get('q') || undefined;
  const sort = url.searchParams.get('sort') || undefined;
  const bounds = url.searchParams.get('bounds');

  const filtersRaw = url.searchParams.get('filters');
  if (
    mode.length > MAX_MODE_LENGTH ||
    (q && q.length > MAX_Q_LENGTH) ||
    (sort && sort.length > MAX_SORT_LENGTH) ||
    (filtersRaw && filtersRaw.length > MAX_FILTERS_JSON_LENGTH) ||
    (bounds && bounds.length > MAX_BOUNDS_LENGTH)
  ) {
    return NextResponse.json(
      { code: 'PARAM_TOO_LARGE', message: 'one or more query parameters exceed their length limit' },
      { status: 400 }
    );
  }
  const filters = parseFilters(filtersRaw);

  // #12：q 长度与 page/pageSize 校验（均先于缓存 key 构造，与 POST /api/search
  // 的 MAX_Q_LENGTH=100 / pageSize 1..100 规则对齐；page 额外要求整数 1..MAX_PAGE）。
  const page = pagedParam(url.searchParams.get('page'), 1, MAX_PAGE);
  if (page === null) {
    return NextResponse.json(
      { code: 'INVALID_PAGE', message: `page must be an integer in 1..${MAX_PAGE}` },
      { status: 400 }
    );
  }
  const pageSize = pagedParam(url.searchParams.get('pageSize'), 20, MAX_PAGE_SIZE);
  if (pageSize === null) {
    return NextResponse.json(
      { code: 'INVALID_PAGE_SIZE', message: `pageSize must be an integer in 1..${MAX_PAGE_SIZE}` },
      { status: 400 }
    );
  }

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
