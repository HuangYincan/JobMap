// ============================================================
// 岗位级筛选 — 公司详情内岗位列表的纯本地视图过滤
//
// 与公司级 FilterPanel(全局 FilterState / 地图 marker 联动)不同,
// 这里是 POI Detail 内的局部过滤:职能 ∩ 类型 ∩ 关键词,AND 组合,
// 切换公司 / 关闭详情即重置。纯函数,便于单测。
// ============================================================

import type { JobFamily, Position } from './types.ts';
import { positionMatchesRole } from './job-taxonomy.ts';

export interface PositionFilters {
  /** 职能多选(tech/product/ops/design),组内 OR */
  roles: string[];
  /** 类型多选(intern/campus/social),组内 OR */
  families: JobFamily[];
  /** 关键词(标题 + 部门,大小写不敏感 substring);空串不过滤 */
  query: string;
}

export const EMPTY_POSITION_FILTERS: PositionFilters = {
  roles: [],
  families: [],
  query: '',
};

export function hasActivePositionFilters(filters: PositionFilters): boolean {
  return (
    filters.roles.length > 0 ||
    filters.families.length > 0 ||
    filters.query.trim() !== ''
  );
}

/** 岗位所属类型:优先 taxonomy.family,回退 position.type(旧数据无 taxonomy) */
export function positionFamily(position: Position): JobFamily {
  return position.taxonomy?.family ?? position.type;
}

/** 关键词匹配:对 title + department 做大小写不敏感 substring;空输入不过滤 */
export function positionMatchesQuery(position: Position, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${position.title} ${position.department ?? ''}`.toLowerCase();
  return hay.includes(q);
}

export function positionMatchesFamily(position: Position, family: JobFamily): boolean {
  return positionFamily(position) === family;
}

/**
 * 组合语义:多条件 AND(职能 ∩ 类型 ∩ 关键词);组内(职能多选 / 类型多选)
 * 为 OR。全空 = 原样返回全部岗位。
 */
export function filterPositions(
  positions: Position[],
  filters: PositionFilters,
): Position[] {
  const query = filters.query.trim();
  return positions.filter((position) => {
    if (filters.roles.length > 0) {
      const hit = filters.roles.some((role) => positionMatchesRole(position, role));
      if (!hit) return false;
    }
    if (filters.families.length > 0 && !filters.families.includes(positionFamily(position))) {
      return false;
    }
    if (query && !positionMatchesQuery(position, query)) return false;
    return true;
  });
}
