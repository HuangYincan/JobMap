// ============================================================
// 前端 API 客户端 — Phase 2 后端契约
//
// 路由遵循 tech/11-phase2-plan.md + tech/10-search-filter.md：
// - GET /api/modes         模式列表
// - GET /api/pois          POI 列表（mode + filters + bounds）
// - GET /api/pois/[id]     POI 详情
// - GET /api/search        搜索
// - GET /api/suggest       搜索建议
// - GET /api/filter-options 筛选器选项
//
// 现状：Phase 2 使用 seed/AMap 数据，DB 就绪后无缝切换到 API。
// ============================================================

import type { FilterState, MapMode, POI } from './types.ts';

/** API 基础路径（Next 同源部署时为空） */
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '';

/** 统一错误形状（tech/01-architecture.md） */
export interface ApiError {
  code: string;
  message: string;
  requestId?: string;
}

/** 通用请求封装：错误形状统一、JSON 解析 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

  if (!res.ok) {
    let error: ApiError = { code: 'UNKNOWN', message: res.statusText };
    try {
      const body = await res.json();
      error = { code: body.code || 'UNKNOWN', message: body.message || res.statusText };
    } catch {
      // 非 JSON 响应，保留默认错误
    }
    throw error;
  }

  return res.json() as Promise<T>;
}

// ---- 类型化的查询参数 ----

export interface POIQuery {
  mode: MapMode;
  filters?: FilterState;
  sort?: string;
  bounds?: string; // "minLng,minLat,maxLng,maxLat"
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface POIListResponse {
  total: number;
  page: number;
  pageSize: number;
  results: POI[];
}

export interface SearchSuggestion {
  type: 'poi' | 'position' | 'tag' | 'area';
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  /** Company / catalog id. Positions need this so a job pick still opens the office. */
  poiId?: string;
}

export interface SuggestResponse {
  suggestions: SearchSuggestion[];
  recentSearches: string[];
}

// ---- 公开 API ----

/** 获取 POI 列表 */
export function fetchPOIs(query: POIQuery): Promise<POIListResponse> {
  const params = new URLSearchParams();
  params.set('mode', query.mode);
  if (query.q) params.set('q', query.q);
  if (query.sort) params.set('sort', query.sort);
  if (query.bounds) params.set('bounds', query.bounds);
  if (query.filters) params.set('filters', JSON.stringify(query.filters));
  params.set('page', String(query.page || 1));
  params.set('pageSize', String(query.pageSize || 20));
  return request<POIListResponse>(`/api/pois?${params.toString()}`);
}

/** 获取 POI 详情 */
export function fetchPOIDetail(id: string, mode: MapMode): Promise<POI> {
  return request<POI>(`/api/pois/${encodeURIComponent(id)}?mode=${mode}`);
}

/** 搜索（含建议） */
export function fetchSearchSuggest(
  q: string,
  mode: MapMode
): Promise<SuggestResponse> {
  const params = new URLSearchParams({ q, mode });
  return request<SuggestResponse>(`/api/suggest?${params.toString()}`);
}

/** 获取模式配置列表（备用；前端 MODES 已是权威配置） */
export function fetchModes(): Promise<{ modes: { id: MapMode; name: string }[] }> {
  return request('/api/modes');
}
