// ============================================================
// POI 类型系统 — Phase 2 多模式数据契约
//
// 设计遵循 tech/08-multi-mode-system.md：
// - BasePOI 是所有模式共享的最小结构
// - 每个模式通过 discriminated union 扩展
// - 数据源: amap（高德）/ seed（内置精选数据）/ api（后端）
// ============================================================

/** 地图模式标识。Phase 2 实现 domain + internship，其余预留。 */
export type MapMode =
  | 'domain'
  | 'internship'
  | 'autumn-recruit'
  | 'spring-recruit'
  | 'social-recruit'
  | 'college'
  | 'overseas';

/** 模式 POI 形态：domain = 普通地点，recruitment = 公司+岗位 */
export type POIKind = 'domain' | 'recruitment';

/** 空间坐标（WGS84 / GCJ-02，高德返回 GCJ-02） */
export interface POILocation {
  lng: number;
  lat: number;
  address?: string;
}

/** 所有模式共享的基础 POI 结构 */
export interface BasePOI {
  /** 唯一标识（高德用 poiid，seed 用 slug） */
  id: string;
  /** 名称 */
  name: string;
  /** 位置 */
  location: POILocation;
  /** 所属模式 */
  mode: MapMode;
  /** 数据源 */
  source: 'amap' | 'seed' | 'api';
  /** 距当前中心点的距离（米），由客户端计算，可空 */
  distance?: number;
}

/** 普通地点 POI（Domain 模式）— 高德 POI 的映射 */
export interface DomainPOI extends BasePOI {
  kind: 'domain';
  /** 大类：餐饮、购物、娱乐… */
  category: string;
  /** 子类：川菜、火锅… */
  subcategory?: string;
  /** 评分（高德 1-5 星） */
  rating?: number;
  /** 价格等级 1-4 */
  priceLevel?: number;
  /** 营业时间 */
  openHours?: string;
  /** 电话 */
  tel?: string;
  /** 图片 URL 列表 */
  photos?: string[];
  /** 评论数 */
  reviewCount?: number;
}

/** 招聘岗位（实习/秋招/社招模式的 items） */
export interface Position {
  id: string;
  /** 岗位名称 */
  title: string;
  /** 部门 */
  department?: string;
  /** 岗位类型：实习/校招/社招 */
  type: 'intern' | 'campus' | 'social';
  /** 薪资范围（元/月） */
  salary?: { min: number; max: number };
  /** 学历要求 */
  education?: string;
  /** 专业要求 */
  majors?: string[];
  /** 技能要求 */
  skills?: string[];
  /** 投递截止日期 */
  deadline?: string;
  /** 是否在招 */
  status: 'open' | 'closed' | 'paused';
}

/** 公司/招聘 POI（实习模式） */
export interface RecruitmentPOI extends BasePOI {
  kind: 'recruitment';
  /** 公司信息 */
  company: {
    /** 公司名（与 name 一致，冗余便于卡片渲染） */
    name: string;
    /** 行业标签：互联网、金融… */
    industries: string[];
    /** 规模：startup/unicorn/bigtech/enterprise */
    scale: 'startup' | 'unicorn' | 'bigtech' | 'enterprise';
    /** 公司评分 */
    rating?: number;
    /** Logo 或 emoji */
    logo?: string;
    /** 一句话简介 */
    summary?: string;
  };
  /** 在招岗位 */
  positions: Position[];
  /** 福利标签 */
  benefits?: string[];
}

/** 判别联合：所有模式的 POI */
export type POI = DomainPOI | RecruitmentPOI;

/** 筛选器类型定义（tech/10-search-filter.md） */
export type FilterType =
  | 'select'
  | 'multi-select'
  | 'range'
  | 'slider'
  | 'toggle'
  | 'date';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterConfig {
  key: string;
  label: string;
  type: FilterType;
  options?: FilterOption[];
  /** range/slider 专用 */
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

/** 排序选项 */
export interface SortOption {
  key: string;
  label: string;
}

/** 筛选状态（用户选中的值） */
export interface FilterState {
  [key: string]: string | string[] | number | [number, number] | boolean;
}

// ============================================================
// 守卫函数
// ============================================================

/** 判断 POI 是否为 Domain（普通地点） */
export function isDomainPOI(poi: POI): poi is DomainPOI {
  return poi.kind === 'domain';
}

/** 判断 POI 是否为 Recruitment（公司） */
export function isRecruitmentPOI(poi: POI): poi is RecruitmentPOI {
  return poi.kind === 'recruitment';
}

/** 判断是否属于招聘类模式 */
export function isRecruitmentMode(mode: MapMode): boolean {
  return (
    mode === 'internship' ||
    mode === 'autumn-recruit' ||
    mode === 'spring-recruit' ||
    mode === 'social-recruit'
  );
}

/** 判断是否属于院校类模式 */
export function isCollegeMode(mode: MapMode): boolean {
  return mode === 'college' || mode === 'overseas';
}

/** 计算两点间近似距离（米，Haversine） */
export function haversineDistance(
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

/** 为 POI 列表附加到参考点的距离 */
export function withDistance<T extends POI>(
  pois: T[],
  ref: { lng: number; lat: number }
): T[] {
  return pois.map((poi) => ({
    ...poi,
    distance: haversineDistance(poi.location, ref),
  }));
}

/** 格式化距离：<1000m 显示米，否则显示 km */
export function formatDistance(meters?: number): string {
  if (meters === undefined || isNaN(meters)) return '—';
  if (meters < 1000) return `${meters}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

/** 格式化薪资 */
export function formatSalary(salary?: Position['salary']): string {
  if (!salary) return '面议';
  if (salary.min === salary.max) return `${salary.min}K`;
  return `${salary.min}-${salary.max}K`;
}
