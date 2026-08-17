// ============================================================
// LOD — 工作模式缩放层级 → 公司档位过滤(tech/18 §2.2)
//
// zoom 越大越靠近街区:只展示名企(tier<=1),避免街道被小店淹没;
// zoom 越小(缩到全国):密度优先,展示全部档位(tier<=3)。
// 阈值做成可配置常量,便于日后按数据规模调整。
//
// 客户端只把 maxTier 随 bounds 一起传给 /api/pois(filters.maxTier);
// 服务端(WS1)merge 前该字段被忽略,前端按现有数据工作。
// ============================================================

/** 单个档位规则:zoom >= minZoom 时,允许 tier <= maxTier 的公司 */
export interface LodRule {
  /** 该档位的最低缩放级别(含) */
  minZoom: number;
  /** 允许的最大公司档位:1=名企 2=大厂 3=中厂/其他 */
  maxTier: number;
}

/** 街道级(放大到街区):只名企 */
export const LOD_STREET_MIN_ZOOM = 14;
/** 城市级(中比例):中厂 + 大厂 */
export const LOD_CITY_MIN_ZOOM = 9;

/**
 * 档位规则表,按 minZoom 升序排列。重叠时取「最靠近街区」的一条
 * (minZoom 最大、maxTier 最小的规则),所以遍历时后匹配者覆盖前者。
 * 调整这些常量即可改变 LOD 行为。
 */
export const LOD_RULES: readonly LodRule[] = [
  { minZoom: 0, maxTier: 3 },                   // 全国:全部
  { minZoom: LOD_CITY_MIN_ZOOM, maxTier: 2 },   // 中比例:中厂 + 大厂
  { minZoom: LOD_STREET_MIN_ZOOM, maxTier: 1 }, // 街区:只名企
];

/** 缩放级别 → 允许的最大公司档位。非法 zoom 回退全量(tier=3)。 */
export function maxTierForZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 3;
  let tier = LOD_RULES[0].maxTier;
  for (const rule of LOD_RULES) {
    if (zoom >= rule.minZoom) tier = rule.maxTier;
  }
  return tier;
}
