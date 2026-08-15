// ============================================================
// POI 数据服务 — 按模式统一获取
//
// 架构决策（对齐 tech/11-phase2-plan.md Sprint 1-2）：
// - Domain 模式：直连 AMap JS API（key 已在环境变量）
// - 实习模式：使用内置精选 seed 数据，经本地管线处理
//   （DB 就绪后：改为 fetch /api/pois?mode=internship）
// - 统一返回规范化 POI 列表，前端无需感知数据来源
// ============================================================

import { searchPOI } from './amap-api.ts';
import { DOMAIN_SEED, INTERNSHIP_SEED } from './seed-data.ts';
import { runPOIPipeline, type QueryPipeline } from './search.ts';
import type { MapMode, POI } from './types.ts';

export interface FetchPOIOptions extends QueryPipeline {
  mode: MapMode;
  /** 是否只取已实现模式的 POI（domain/internship） */
  onlyActive?: boolean;
}

/** 获取指定模式的 POI（默认加载 20 个） */
export async function fetchPOIsForMode(options: FetchPOIOptions): Promise<POI[]> {
  const { mode, onlyActive = true } = options;

  // 未实现模式：返回空（Phase 3+ 实现）
  if (onlyActive && mode !== 'domain' && mode !== 'internship') {
    return [];
  }

  if (mode === 'domain') {
    const center = options.center ?? { lng: 120.15, lat: 30.27 };
    // Domain 首选真实高德 POI；AMap 不可用时回退到内置杭州示例，
    // 保证首屏始终有数据（AMap 就绪后自动升级为真实搜索）。
    try {
      const result = await searchPOI({
        keyword: '美食',
        center,
        radius: 5000,
        pageSize: 20,
      });
      if (result.pois.length > 0) {
        return runPOIPipeline(result.pois, options);
      }
    } catch (err) {
      console.warn('[poi-service] AMap search failed, fallback to DOMAIN_SEED:', err);
    }
    return runPOIPipeline(DOMAIN_SEED, options);
  }

  // 实习：seed 数据
  const seeded = INTERNSHIP_SEED.filter((p) => p.mode === mode) as POI[];
  return runPOIPipeline(seeded, options);
}
