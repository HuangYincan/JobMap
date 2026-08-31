// ============================================================
// POI 类型系统 — Phase 2 多模式数据契约
//
// 设计遵循 tech/08-multi-mode-system.md：
// - BasePOI 是所有模式共享的最小结构
// - 每个模式通过 discriminated union 扩展
// - 数据源: amap（高德）/ seed（内置精选数据）/ api（后端）
// ============================================================

/** 地图模式标识。Phase 2：domain + work；internship 是 work 的兼容别名。 */
export type MapMode =
  | 'domain'
  | 'work'
  | 'internship'
  | 'college'
  | 'overseas';

/** 招聘一级分类：实习 / 校招 / 社招（插件可再挂行业维度） */
export type JobFamily = 'intern' | 'campus' | 'social';

/** 实习细分 */
export type InternKind = 'summer' | 'daily';
export type InternConversion = 'conversion' | 'no-conversion';

/** 校招细分 */
export type CampusSeason = 'autumn' | 'spring';

/** 社招经验 */
export type SocialExperience = '0-1' | '1-3' | '3-5' | '5+';

/** 岗位上挂的招聘分类标签（筛选用，插件可扩展） */
export interface JobTaxonomy {
  family: JobFamily;
  internKind?: InternKind;
  conversion?: InternConversion;
  campusSeason?: CampusSeason;
  experience?: SocialExperience;
  /** 聚合行标记：多岗位压成一行的快照数据（导入时写入 taxonomy jsonb） */
  aggregate?: boolean;
}

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
  /** 数据源:seed=导入种子 / api=各模式 API 检索 / amap=高德引擎(会话) /
   *  tencent=腾讯引擎归一化 / baidu=百度引擎归一化 */
  source: 'amap' | 'seed' | 'api' | 'tencent' | 'baidu';
  /**
   * 距排序/筛选圆心的距离（米）。客户端管线按视野中心写入；
   * 岗位卡片展示距离见 cardDisplayMeters（用户定位，缺则视野中心）。
   */
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
  /** 人均消费（元）。hz 本地 / AMap 有真实值时带上，价格筛选优先用它 */
  cost?: number;
  /** 营业时间 */
  openHours?: string;
  /** 电话 */
  tel?: string;
  /** 图片 URL 列表 */
  photos?: string[];
  /** 评论数 */
  reviewCount?: number;
  /** 用户评价（高德详情有则用，没有就不编造） */
  reviews?: PlaceReview[];
}

export interface PlaceReview {
  id: string;
  author: string;
  rating?: number;
  excerpt: string;
  postedAt?: string;
}

/** 公司办公点。一家公司多个职场，一个岗位只挂一个 site。 */
export interface CompanySite {
  id: string;
  name: string;
  location?: POILocation;
  careerUrl?: string;
  logoUrl?: string;
  /** Source code that supplied this site record (record-level provenance). */
  source?: string;
  /** 城市名（'北京'），来自 drop site.city 或地址解析；城市过滤用 */
  city?: string;
  /** 省份（'北京市'） */
  province?: string;
  /** 行政区划码（'110000'） */
  cityCode?: string;
}

/** 招聘岗位（实习/秋招/社招模式的 items） */
export interface Position {
  id: string;
  /** 所属办公点（006_recruitment_sites.site_id） */
  siteId?: string;
  /** 岗位名称 */
  title: string;
  /** 部门 */
  department?: string;
  /** 岗位类型：实习/校招/社招 */
  type: JobFamily;
  /** 招聘分类细分（插件筛选树） */
  taxonomy?: JobTaxonomy;
  /** 薪资范围（元/月） */
  salary?: { min: number; max: number };
  /** 学历要求 */
  education?: string;
  /** 专业要求 */
  majors?: string[];
  /** 技能要求 */
  skills?: string[];
  /** 岗位职责 / JD 正文（可空，UI 会回退到摘要） */
  description?: string;
  /** 投递截止日期 */
  deadline?: string;
  /** 投递入口：官网 / Boss / 实习僧 / 牛客等 */
  apply?: ApplyLink;
  /** 是否在招 */
  status: 'open' | 'closed' | 'paused';
  /** 聚合行：多个相似岗位压成一行的快照数据（UI 诚实展示用） */
  aggregate?: boolean;
}

/** 岗位投递渠道 */
export type ApplySource =
  | 'official'
  | 'boss'
  | 'shixiseng'
  | 'nowcoder'
  | 'liepin'
  | 'other';

export interface ApplyLink {
  source: ApplySource;
  url: string;
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
    /** Logo 或 emoji（fallback） */
    logo?: string;
    /** 真实 logo 图片 URL（favicon.im 等服务），加载失败回退 logo emoji */
    logoUrl?: string;
    /** 一句话简介 */
    summary?: string;
    /** 公司招聘门户（岗位未单独给链接时回退） */
    careerUrl?: string;
    /** 可见最小 zoom：0..21，zoom >= tier 时显示；0=永显，21=永隐，缺省 12（tech/19） */
    tier?: number;
    /** 企业类型：国标 GB/T 4754-2017 大类 code（如 64=互联网，39=电子；'other'=未标） */
    category?: string;
  };
  /** 办公点（可选；未填时位置用 POI.location） */
  sites?: CompanySite[];
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
  | 'date'
  | 'taxonomy';

export interface FilterOption {
  value: string;
  label: string;
  /** 英文标签：英文 UI 优先使用,缺失时回退中文 label(见 uiLabel) */
  labelEn?: string;
  children?: FilterOption[];
}

export interface FilterConfig {
  key: string;
  label: string;
  /** 英文标签：筛选标题,英文 UI 优先使用,缺失时回退中文 label(见 uiLabel) */
  labelEn?: string;
  type: FilterType;
  options?: FilterOption[];
  /** range/slider 专用 */
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** 英文单位后缀：range/slider 专用,英文 UI 优先使用,缺失时回退 unit */
  unitEn?: string;
}

/** 排序选项 */
export interface SortOption {
  key: string;
  label: string;
  /** 英文标签：英文 UI 优先使用,缺失时回退中文 label(见 uiLabel) */
  labelEn?: string;
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

/** 判断是否属于招聘类模式（work；internship 为兼容别名） */
export function isRecruitmentMode(mode: MapMode): boolean {
  return mode === 'work' || mode === 'internship';
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

/**
 * 岗位卡片展示距离的圆心：有用户定位用定位，否则回落视野中心。
 * 排序 / 距离筛选 / 距离圈仍用视野中心，不走这里。
 */
export function cardDisplayOrigin(
  userLocation: { lng: number; lat: number } | null | undefined,
  viewCenter: { lng: number; lat: number },
): { lng: number; lat: number } {
  return userLocation ?? viewCenter;
}

/**
 * 卡片上显示的直线距离（米）。传入 origin 时按该点重算；
 * 否则回落 poi.distance（排序字段）。
 */
export function cardDisplayMeters(
  poi: Pick<BasePOI, 'location' | 'distance'>,
  origin?: { lng: number; lat: number } | null,
): number | undefined {
  if (origin) return haversineDistance(poi.location, origin);
  return poi.distance;
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

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 岗位优先，其次公司招聘门户。非法 URL 视为没有入口。 */
export function resolveApplyLink(
  company: RecruitmentPOI,
  position: Position
): ApplyLink | null {
  const direct = position.apply;
  if (direct?.url && isHttpUrl(direct.url)) {
    return { source: direct.source, url: direct.url };
  }
  const career = company.company.careerUrl;
  if (career && isHttpUrl(career)) {
    return { source: 'official', url: career };
  }
  return null;
}
