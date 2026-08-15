// ============================================================
// 搜索 / 筛选 / 排序纯逻辑
//
// 设计遵循 tech/10-search-filter.md：
// - 纯函数、无副作用，便于单元测试
// - 组合搜索：关键词 + 标签 + 筛选器 + 空间范围
// ============================================================

import type { FilterConfig, FilterState, POI, SortOption } from './types.ts';
import { isRecruitmentPOI } from './types.ts';
import { MODES } from './modes.ts';

// ---- 关键词匹配 ----

/** 行业 code → 中文标签（用于搜索匹配） */
const INDUSTRY_LABELS: Record<string, string> = {
  internet: '互联网',
  finance: '金融',
  consulting: '咨询',
  hardware: '硬件制造 硬件',
  ai: '人工智能 AI',
  ecommerce: '电商 电子商务',
  game: '游戏',
  automotive: '汽车',
  biotech: '生物医药',
  consumer: '消费品',
  transport: '出行 交通',
  content: '内容 内容平台',
};

/** 判断文本是否包含关键词（大小写不敏感，支持多关键词 AND） */
export function matchKeyword(text: string, query: string): boolean {
  const t = text.toLowerCase();
  return query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .every((kw) => t.includes(kw));
}

/** 把行业 code 扩展为可搜索文本（code + 中文标签） */
function industrySearchText(codes: string[]): string {
  return codes
    .map((c) => `${c} ${INDUSTRY_LABELS[c] || ''}`)
    .join(' ');
}

/** 在 POI 的可搜索字段上匹配关键词 */
export function poiMatchesQuery(poi: POI, query: string): boolean {
  if (!query || !query.trim()) return true;

  if (isRecruitmentPOI(poi)) {
    // 公司名 / 行业 / 岗位标题 都参与匹配
    const companyText = [
      poi.company.name,
      industrySearchText(poi.company.industries),
      poi.company.summary || '',
    ].join(' ');
    if (matchKeyword(companyText, query)) return true;
    return poi.positions.some((p) =>
      matchKeyword([p.title, p.department || '', ...(p.skills || [])].join(' '), query)
    );
  }

  // Domain POI：名称 / 分类 / 地址
  return matchKeyword(
    [poi.name, poi.category, poi.subcategory || '', poi.location.address || ''].join(' '),
    query
  );
}

// ---- 筛选 ----

/**
 * 判断单个筛选值是否匹配。
 * 未设置（undefined / 空串 / 空数组）视为不限制。
 */
export function matchFilter(poi: POI, key: string, value: any): boolean {
  if (value === undefined || value === null) return true;

  switch (key) {
    case 'category': {
      if (!isRecruitmentPOI(poi)) {
        return value === 'all' || poi.category === value;
      }
      return true;
    }
    case 'price': {
      if (isRecruitmentPOI(poi)) return true;
      if (poi.priceLevel === undefined) return true;
      const range = value as [number, number];
      const mid = poi.priceLevel * 50; // 价格等级 → 估算人均
      return mid >= range[0] && mid <= range[1];
    }
    case 'distance': {
      if (poi.distance === undefined) return true;
      return poi.distance <= (value as number) * 1000;
    }
    case 'openNow': {
      // Domain 模式的"营业中"依赖实时数据，seed 数据无营业状态则忽略
      if (isRecruitmentPOI(poi)) return true;
      return true; // 高德返回 open_time 但无实时状态，Phase 2 放宽
    }
    case 'industry': {
      if (!isRecruitmentPOI(poi)) return true;
      const sel = value as string[];
      if (!sel.length) return true;
      return sel.every((ind) => poi.company.industries.includes(ind));
    }
    case 'scale': {
      if (!isRecruitmentPOI(poi)) return true;
      const sel = value as string[];
      if (!sel.length) return true;
      return sel.includes(poi.company.scale);
    }
    case 'positionType': {
      if (!isRecruitmentPOI(poi)) return true;
      const sel = value as string[];
      if (!sel.length) return true;
      return poi.positions.some((p) => sel.includes(p.type));
    }
    case 'salary': {
      if (!isRecruitmentPOI(poi)) return true;
      const [min, max] = value as [number, number];
      // 公司有任一岗位薪资落在范围内
      return poi.positions.some((p) => {
        if (!p.salary) return false;
        const sal = (p.salary.min + p.salary.max) / 2;
        return sal >= min && sal <= max;
      });
    }
    case 'providesHousing':
    case 'providesShuttle': {
      if (!isRecruitmentPOI(poi)) return true;
      if (!value) return true;
      const keyword = key === 'providesHousing' ? '住宿' : '班车';
      return (poi.benefits || []).some((b) => b.includes(keyword));
    }
    default:
      return true;
  }
}

/** 对 POI 列表应用全部筛选条件 */
export function applyFilters(pois: POI[], filters: FilterState): POI[] {
  const entries = Object.entries(filters);
  if (!entries.length) return pois;
  return pois.filter((poi) =>
    entries.every(([key, value]) => matchFilter(poi, key, value))
  );
}

// ---- 排序 ----

/** 获取 POI 的排序分值 */
function sortValue(poi: POI, key: string): number {
  switch (key) {
    case 'distance':
      return poi.distance ?? Number.MAX_SAFE_INTEGER;
    case 'rating':
      if (isRecruitmentPOI(poi)) return poi.company.rating ?? 0;
      return poi.rating ?? 0;
    case 'salaryDesc': {
      if (!isRecruitmentPOI(poi)) return 0;
      const max = poi.positions.reduce((m, p) => Math.max(m, p.salary?.max ?? 0), 0);
      return max;
    }
    case 'positionCount':
      return isRecruitmentPOI(poi) ? poi.positions.length : 0;
    case 'popularity': {
      if (isRecruitmentPOI(poi)) return 0;
      return poi.reviewCount ?? 0;
    }
    case 'qsRank':
      return 0;
    default:
      return 0;
  }
}

/** 排序键 → 方向：true = 降序（大在前） */
const SORT_DESCENDING: Record<string, boolean> = {
  rating: true,
  salaryDesc: true,
  positionCount: true,
  popularity: true,
  qsRank: false,
};

/** 对 POI 列表排序 */
export function sortPOIs(pois: POI[], sortKey: string): POI[] {
  const sorted = [...pois];
  const desc = SORT_DESCENDING[sortKey] ?? false;
  sorted.sort((a, b) => {
    const diff = sortValue(a, sortKey) - sortValue(b, sortKey);
    return desc ? -diff : diff;
  });
  return sorted;
}

// ---- 组合管线 ----

export interface QueryPipeline {
  query?: string;
  filters?: FilterState;
  sort?: string;
  /** 空间范围（米），0 表示不限 */
  maxDistance?: number;
  /** 参考中心点，用于计算距离 */
  center?: { lng: number; lat: number };
}

/** 完整管线：搜索 → 筛选 → 距离计算 → 排序 */
export function runPOIPipeline(pois: POI[], pipe: QueryPipeline): POI[] {
  let result: POI[] = pois;

  // 1. 关键词
  if (pipe.query) {
    result = result.filter((poi) => poiMatchesQuery(poi, pipe.query!));
  }

  // 2. 筛选
  if (pipe.filters) {
    result = applyFilters(result, pipe.filters);
  }

  // 3. 距离计算（附加 distance 字段）
  if (pipe.center) {
    result = result.map((poi) => {
      const d = haversine(poi.location, pipe.center!);
      return { ...poi, distance: d };
    });
  }

  // 4. 空间范围
  if (pipe.maxDistance && pipe.maxDistance > 0) {
    const maxDist = pipe.maxDistance;
    result = result.filter((poi) => (poi.distance ?? Infinity) <= maxDist);
  }

  // 5. 排序
  if (pipe.sort) {
    result = sortPOIs(result, pipe.sort);
  }

  return result;
}

// 本地 Haversine（避免与 types 循环依赖）
function haversine(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number }
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

// ---- 模式特定的筛选/排序配置（便捷导出） ----

export function getModeFilters(mode: keyof typeof MODES): FilterConfig[] {
  return MODES[mode].filters;
}

export function getModeSortOptions(mode: keyof typeof MODES): SortOption[] {
  return MODES[mode].sortOptions;
}
