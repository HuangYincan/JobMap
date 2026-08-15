// ============================================================
// POI 数据服务 — 按模式统一获取（插件化数据源）
//
// 设计遵循"一切皆插件"原则（agent.md + tech/03-plugin-system.md）：
// 每种模式是一个插件，声明自己的数据源与展示方式。本服务是插件的
// 调度入口：给定模式 + 查询参数 → 返回统一规范的 POI 列表。
//
// 数据源现状（Phase 2）：
// - domain 插件：AMap JS API（实时周边搜索，按 zoom 自适应）→ seed 回退
// - internship 插件：内置精选 seed → AMap 实时搜索回退
// DB 就绪后，各插件可无缝切换到 sources/import_runs 的规范数据。
// ============================================================

import { searchPOI, searchViewportPOIs } from './amap-api.ts';
import { DOMAIN_SEED, INTERNSHIP_SEED } from './seed-data.ts';
import { runPOIPipeline, type QueryPipeline } from './search.ts';
import type { MapMode, POI } from './types.ts';

export interface FetchPOIOptions extends QueryPipeline {
  mode: MapMode;
  /** 是否只取已实现模式的 POI（domain/internship） */
  onlyActive?: boolean;
  /** 当前地图缩放级别（Domain 模式用于自适应半径） */
  zoom?: number;
}

/** 获取指定模式的 POI */
export async function fetchPOIsForMode(options: FetchPOIOptions): Promise<POI[]> {
  const { mode, onlyActive = true } = options;

  // 未实现模式：返回空（Phase 3+ 实现）
  if (onlyActive && mode !== 'domain' && mode !== 'internship') {
    return [];
  }

  if (mode === 'domain') {
    return fetchDomainPOIs(options);
  }

  // 实习：seed 数据（真实公开坐标）
  let seeded = INTERNSHIP_SEED.filter((p) => p.mode === mode) as POI[];
  let results = runPOIPipeline(seeded, options);

  // 复用高德搜索 API：当 seed 无匹配时，回退到高德实时搜索该关键词，
  // 返回真实地点（任意公司名/地点都可在地图定位，如"小红书"）。
  if (results.length === 0 && options.query) {
    const center = options.center ?? { lng: 120.15, lat: 30.27 };
    try {
      const { pois } = await searchPOI(
        { keyword: options.query, center, radius: 10000, city: '杭州', pageSize: 10 },
        1
      );
      results = runPOIPipeline(pois as POI[], { ...options, query: undefined });
    } catch (err) {
      console.warn('[poi-service] internship AMap fallback search failed:', err);
    }
  }

  return results;
}

/** Domain 插件：AMap 视口搜索（制图学：按 zoom 自适应半径，全分类均匀铺满） */
async function fetchDomainPOIs(options: FetchPOIOptions): Promise<POI[]> {
  const center = options.center ?? { lng: 120.15, lat: 30.27 };
  const zoom = options.zoom ?? 13;

  // 有明确查询词 → 精准搜索（用户想找特定地点）
  if (options.query) {
    try {
      const result = await searchPOI(
        { keyword: options.query, center, radius: Math.max(800, 50000 / Math.pow(2, zoom - 10)), pageSize: 25 },
        zoom <= 13 ? 1 : 2
      );
      if (result.pois.length > 0) {
        return runPOIPipeline(result.pois, { ...options, query: undefined });
      }
    } catch (err) {
      console.warn('[poi-service] domain keyword search failed:', err);
    }
  }

  // 无查询词 → 视口搜索：按 zoom 铺满全分类、重要性优先
  try {
    const pois = await searchViewportPOIs(center, zoom);
    if (pois.length > 0) {
      return runPOIPipeline(pois, { ...options, query: undefined });
    }
  } catch (err) {
    console.warn('[poi-service] AMap viewport search failed, fallback to DOMAIN_SEED:', err);
  }

  // AMap 不可用 → 回退内置杭州示例（保证首屏始终有数据）
  return runPOIPipeline(DOMAIN_SEED, options);
}
