// ============================================================
// 前端 API 客户端 — 当前后端契约
//
// 路由遵循 tech/11-phase2-plan.md + tech/10-search-filter.md：
// - GET /api/suggest        搜索建议（客户端直连，带 LRU）
// - GET /api/pois/[id]      POI 详情（客户端直连）
// - GET /api/modes          模式列表（备用；前端 MODES 注册表是权威）
// - GET /api/pois           POI 列表（服务端 poi-service 查询用，客户端不直连）
// - POST /api/search        搜索（服务端用，客户端不直连）
// - GET /api/filter-options 筛选器选项（服务端用）
//
// 现状：work/domain 读路径走 Postgres 查询；POI 列表改由 poi-service 服务端聚合，
// 客户端不再直连 GET /api/pois（原列表拉取函数已删，测试断言其不再导出）。
// ============================================================

import type { MapMode, POI } from './types.ts';
import { readSuggestCache, suggestCacheKey, writeSuggestCache } from './public-cache.ts';

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

export interface SearchSuggestion {
  type: 'poi' | 'position' | 'tag' | 'area';
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  /** Company / catalog id. Positions need this so a job pick still opens the office. */
  poiId?: string;
  /** 建议 POI 坐标(domain-hz 行来自 hz_pois,公司行来自 site)。选中后可直接飞行。 */
  location?: { lng: number; lat: number };
  /** 到参考点的距离(米)。服务端在带 center 时算好;客户端无 center 时按自身位置算。 */
  distance?: number;
}

export interface SuggestResponse {
  suggestions: SearchSuggestion[];
  recentSearches: string[];
}

// ---- 公开 API ----

/** 获取 POI 详情 */
export function fetchPOIDetail(id: string, mode: MapMode): Promise<POI> {
  return request<POI>(`/api/pois/${encodeURIComponent(id)}?mode=${mode}`);
}

/** 搜索（含建议）。同一 mode+q+origin bucket 五分钟内走客户端 LRU,最多 100 条。
 *  空结果不写缓存——首次空「死」5 分钟会挡住 domain 本地优先→高德回退。 */
export async function fetchSearchSuggest(
  q: string,
  mode: MapMode,
  center?: { lng: number; lat: number } | null
): Promise<SuggestResponse> {
  const key = suggestCacheKey(mode, q, center);
  const cached = readSuggestCache<SuggestResponse>(key);
  if (cached) return cached;
  const params = new URLSearchParams({ q, mode });
  if (center) params.set('center', `${center.lng},${center.lat}`);
  const result = await request<SuggestResponse>(`/api/suggest?${params.toString()}`);
  if (result.suggestions.length > 0) writeSuggestCache(key, result);
  return result;
}
