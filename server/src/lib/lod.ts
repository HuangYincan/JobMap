// ============================================================
// LOD — 工作模式缩放层级 → 公司档位过滤(tech/18 §2.2,tech/19)
//
// 模型(2026-08-17 修订):公司 tier = 「可见最小 zoom」。
//   zoom >= tier 时该公司显示,即过滤条件 `tier <= zoom`。
//   tier 0  = 一直可见(国际化名企,如字节跳动);
//   tier 21 = 永不显示(zoom 最大 20,作为隐藏标记);
//   缺省 12 = 未打标公司按小厂可见性处理。
// 缩放级别连续变化时公司逐步涌现/消退,无档位跳变。
//
// 客户端把当前 zoom 取整作为 filters.maxTier 传给 /api/pois;
// 服务端 SQL 下推 `tier <= maxTier`(WS1 已实现,索引 companies_tier_idx)。
// ============================================================

/** zoom 上限:AMap JSAPI v2.0 最大缩放级别 */
export const MAX_ZOOM = 20;
/** 永不显示的档位(> MAX_ZOOM,等价隐藏标记) */
export const TIER_HIDDEN = 21;
/** 未打标公司缺省档位(小厂可见性,城市细视野出现) */
export const TIER_DEFAULT = 12;

/**
 * 当前缩放级别 → 允许的最大公司档位。
 * 恒等映射:`tier <= floor(zoom)`。非法 zoom 回退 MAX_ZOOM(20)——tier 21(永隐)仍被排除。
 */
export function maxTierForZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MAX_ZOOM;
  return Math.max(0, Math.min(MAX_ZOOM, Math.floor(zoom)));
}
