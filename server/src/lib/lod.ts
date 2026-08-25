// ============================================================
// LOD — 工作模式公司档位(数据标注,tech/18 §2.2,tech/19)
//
// 模型(2026-08-17):公司 tier = 「可见最小 zoom」。
//   zoom >= tier 时该公司显示,即过滤条件 `tier <= zoom`。
//   tier 0  = 一直可见(国际化名企,如字节跳动);
//   tier 21 = 永不显示(zoom 最大 20,作为隐藏标记);
//   缺省 12 = 未打标公司按小厂可见性处理。
//
// 2026-08-25 修订(用户裁定):工作地图客户端已**取消**按 zoom 过滤公司
// (map-shell visiblePOIIds 不再用 maxTier,所有公司全量展示;zoom ≤ 8
// 城市聚合保留)——tier 降级为数据标注字段(名企/大厂/独角兽标记)。
// 本模块导出仍保留:tier 语义/`maxTierForZoom`/`TIER_DEFAULT` 供服务端
// /api/pois 的 maxTier 参数(API 契约,其它消费者/测试在用)与数据管线
// 引用;lod.test.mjs 锁定行为不随客户端退役而删除。
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
