// ============================================================
// GET /api/pois — POI 列表（支持模式、搜索、筛选、排序）
//
// 遵循 tech/10-search-filter.md API 设计：
//   ?mode=internship&q=算法&filters={"industry":["ai"]}&sort=salaryDesc
//
// Phase 2 数据策略：
// - 实习模式：内置精选 seed 数据（DB 就绪后切换 PostGIS 查询）
// - Domain 模式：服务端无 AMap JS key 时返回有限示例数据；
//   浏览器端直连 AMap JS API（见 lib/amap-api.ts）
// ============================================================

import { NextResponse } from 'next/server';
import { INTERNSHIP_SEED } from '@/lib/seed-data';
import { runPOIPipeline } from '@/lib/search';
import { withDistance } from '@/lib/types';
import type { MapMode } from '@/lib/types';

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
  const mode = (url.searchParams.get('mode') || 'internship') as MapMode;
  const q = url.searchParams.get('q') || undefined;
  const sort = url.searchParams.get('sort') || undefined;
  const filters = parseFilters(url.searchParams.get('filters'));
  const bounds = parseBounds(url.searchParams.get('bounds'));
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get('pageSize')) || 20));

  // ---- 数据源选择 ----
  let pois;
  if (mode === 'internship') {
    pois = INTERNSHIP_SEED;
  } else if (mode === 'domain') {
    // Domain 模式服务端示例（浏览器端走 AMap JS API）
    pois = [
      {
        id: 'hz-westlake',
        kind: 'domain',
        name: '西湖',
        mode: 'domain',
        source: 'seed',
        location: { lng: 120.15, lat: 30.242, address: '西湖区龙井路1号' },
        category: '景点',
        subcategory: '自然风光',
        rating: 4.9,
        photos: [],
      },
      {
        id: 'hz-lakeside-gourmet',
        kind: 'domain',
        name: '湖滨银泰in77',
        mode: 'domain',
        source: 'seed',
        location: { lng: 120.163, lat: 30.256, address: '上城区延安路' },
        category: '购物',
        subcategory: '购物中心',
        rating: 4.6,
        priceLevel: 3,
        photos: [],
      },
      {
        id: 'hz-louwlai',
        kind: 'domain',
        name: '楼外楼菜馆',
        mode: 'domain',
        source: 'seed',
        location: { lng: 120.141, lat: 30.237, address: '西湖区孤山路30号' },
        category: '餐饮',
        subcategory: '杭帮菜',
        rating: 4.3,
        priceLevel: 3,
        openHours: '10:30-21:00',
        photos: [],
      },
      {
        id: 'hz-lingyin',
        kind: 'domain',
        name: '灵隐寺',
        mode: 'domain',
        source: 'seed',
        location: { lng: 120.105, lat: 30.24, address: '西湖区法云弄1号' },
        category: '景点',
        subcategory: '佛教文化',
        rating: 4.8,
        photos: [],
      },
    ];
  } else {
    // 未实现模式：空结果
    return NextResponse.json({ total: 0, page, pageSize, results: [] });
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

  return NextResponse.json({
    total: processed.length,
    page,
    pageSize,
    results: withDistance(results, center),
  });
}
