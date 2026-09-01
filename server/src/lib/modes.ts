// ============================================================
// 模式配置注册表 — Phase 2 多模式系统
//
// 设计遵循 tech/08-multi-mode-system.md：
// - 每个模式有专属主题色、图标、筛选器、排序选项
// - 模式切换 → 侧控栏、筛选器、POI 类型联动更新
// ============================================================

import type { FilterConfig, MapMode, POIKind, SortOption } from './types.ts';
import { workFilterConfigs } from './job-taxonomy.ts';

export interface ModeConfig {
  id: MapMode;
  /** 显示名称（中文） */
  name: string;
  /** 英文名 */
  nameEn: string;
  /** 图标（内联 SVG path 或 emoji） */
  icon: string;
  /** 主题色（POI marker、卡片强调） */
  color: string;
  /** POI 形态 */
  kind: POIKind;
  /** 搜索框占位符 */
  searchPlaceholder: string;
  /** 英文搜索框占位符(英文 UI 优先,缺失回退 searchPlaceholder) */
  searchPlaceholderEn?: string;
  /** 筛选器配置 */
  filters: FilterConfig[];
  /** 排序选项 */
  sortOptions: SortOption[];
  /** 默认排序 */
  defaultSort: string;
  /** 模式说明（空状态展示） */
  description: string;
  /** 详情页底栏操作 */
  actions: string[];
}

// ---- 共享筛选选项 ----

const DISTANCE_FILTER: FilterConfig = {
  key: 'distance',
  label: '距离',
  labelEn: 'Distance',
  type: 'slider',
  min: 0,
  max: 50,
  step: 1,
  unit: 'km',
};

const CATEGORY_OPTIONS = [
  { value: '餐饮服务', label: '餐饮', labelEn: 'Food & drink' },
  { value: '购物服务', label: '购物', labelEn: 'Shopping' },
  { value: '风景名胜', label: '景点', labelEn: 'Sights' },
  { value: '体育休闲服务', label: '休闲娱乐', labelEn: 'Leisure' },
  { value: '交通设施服务', label: '交通', labelEn: 'Transport' },
  { value: '住宿服务', label: '酒店', labelEn: 'Hotels' },
  { value: '医疗保健服务', label: '医疗', labelEn: 'Medical' },
  { value: '科教文化服务', label: '教育', labelEn: 'Education' },
  { value: '公司企业', label: '公司', labelEn: 'Companies' },
];

export const INDUSTRY_OPTIONS = [
  { value: 'internet', label: '互联网', labelEn: 'Internet' },
  { value: 'finance', label: '金融', labelEn: 'Finance' },
  { value: 'consulting', label: '咨询', labelEn: 'Consulting' },
  { value: 'hardware', label: '硬件制造', labelEn: 'Hardware' },
  { value: 'ai', label: '人工智能', labelEn: 'AI' },
  { value: 'ecommerce', label: '电商', labelEn: 'E-commerce' },
  { value: 'game', label: '游戏', labelEn: 'Gaming' },
  { value: 'automotive', label: '汽车', labelEn: 'Automotive' },
  { value: 'biotech', label: '生物医药', labelEn: 'Biotech' },
  { value: 'consumer', label: '消费品', labelEn: 'Consumer' },
];

const SCALE_OPTIONS = [
  { value: 'bigtech', label: '大厂', labelEn: 'Big tech' },
  { value: 'unicorn', label: '独角兽', labelEn: 'Unicorn' },
  { value: 'startup', label: '创业公司', labelEn: 'Startup' },
  { value: 'enterprise', label: '大型企业', labelEn: 'Large enterprise' },
];

const EDUCATION_OPTIONS = [
  { value: '本科', label: '本科', labelEn: 'Bachelor' },
  { value: '硕士', label: '硕士', labelEn: 'Master' },
  { value: '博士', label: '博士', labelEn: 'PhD' },
];

/** Shared work-mode sorts. internship is a work alias, not a second list. */
const WORK_SORT_OPTIONS: SortOption[] = [
  { key: 'relevance', label: '综合排序', labelEn: 'Top match' },
  { key: 'distance', label: '距离最近', labelEn: 'Nearest' },
  { key: 'salaryDesc', label: '薪资最高', labelEn: 'Highest salary' },
  { key: 'rating', label: '公司评分', labelEn: 'Rating' },
  { key: 'positionCount', label: '岗位数量', labelEn: 'Openings' },
  { key: 'deadline', label: '截止时间', labelEn: 'Deadline' },
];

/** Shared work-mode filters. internship is a work alias, not a second list. */
const WORK_FILTERS: FilterConfig[] = [
  ...workFilterConfigs(),
  {
    key: 'scale',
    label: '公司规模',
    labelEn: 'Company size',
    type: 'multi-select',
    options: SCALE_OPTIONS,
  },
  {
    key: 'education',
    label: '学历要求',
    labelEn: 'Education',
    type: 'multi-select',
    options: EDUCATION_OPTIONS,
  },
  {
    key: 'salary',
    label: '薪资范围',
    labelEn: 'Salary range',
    type: 'range',
    min: 0,
    max: 50,
    step: 1,
    unit: 'K/月',
    unitEn: 'K/mo',
  },
  DISTANCE_FILTER,
  {
    key: 'onlyOpen',
    label: '仅看在招岗位',
    labelEn: 'Open roles only',
    type: 'toggle',
  },
  {
    key: 'providesHousing',
    label: '提供住宿',
    labelEn: 'Provides housing',
    type: 'toggle',
  },
  {
    key: 'deadline',
    label: '申请截止日期',
    labelEn: 'Deadline',
    type: 'date',
  },
];

// ---- 模式定义 ----

// internship 是 work 的历史别名(canonicalMode 统一映射),不再登记独立条目。
// 类型上保留 internship: never 守卫：允许 MapMode 索引编译(MODES[mode] 恒为
// ModeConfig),而直接读取 MODES.internship 得到 never——类型层面同样禁止访问。
// 对象字面量经双重断言省略该键,运行时无此条目(canonicalMode 保证永不读到)。
export const MODES = {
  domain: {
    id: 'domain',
    name: '地图',
    nameEn: 'Domain',
    icon: 'map',
    color: '#007AFF',
    kind: 'domain',
    searchPlaceholder: '搜索地点或地址',
    searchPlaceholderEn: 'Search places or addresses',
    filters: [
      {
        key: 'category',
        label: '分类',
        labelEn: 'Category',
        type: 'select',
        options: CATEGORY_OPTIONS,
      },
      {
        key: 'minRating',
        label: '评分区间',
        labelEn: 'Rating',
        type: 'range',
        min: 0,
        max: 5,
        step: 0.5,
        unit: '分',
        unitEn: 'pts',
      },
      {
        key: 'price',
        label: '人均消费',
        labelEn: 'Price per person',
        type: 'range',
        min: 0,
        max: 5000,
        step: 100,
        unit: '元',
        unitEn: '¥',
      },
    ],
    sortOptions: [
      { key: 'distance', label: '距离最近', labelEn: 'Nearest' },
      { key: 'relevance', label: '相关性', labelEn: 'Relevance' },
      { key: 'rating', label: '评分最高', labelEn: 'Top rated' },
      { key: 'popularity', label: '人气最高', labelEn: 'Most popular' },
      { key: 'priceAsc', label: '价格从低到高', labelEn: 'Price: low to high' },
      { key: 'priceDesc', label: '价格从高到低', labelEn: 'Price: high to low' },
    ],
    defaultSort: 'distance',
    description: '探索身边的餐厅、商场、娱乐和公共服务',
    actions: ['导航', '收藏'],
  },

  work: {
    id: 'work',
    name: '工作',
    nameEn: 'Work',
    icon: 'briefcase',
    color: '#007AFF',
    kind: 'recruitment',
    searchPlaceholder: '搜索公司或岗位',
    searchPlaceholderEn: 'Search companies or jobs',
    filters: WORK_FILTERS,
    sortOptions: WORK_SORT_OPTIONS,
    defaultSort: 'distance',
    description: '寻找身边的工作机会：实习、校招、社招',
    actions: ['查看岗位', '投递', '收藏'],
  },

  college: {
    id: 'college',
    name: '高考',
    nameEn: 'College',
    icon: 'graduation',
    color: '#007AFF',
    kind: 'recruitment',
    searchPlaceholder: '搜索院校、专业…',
    searchPlaceholderEn: 'Search schools and majors…',
    filters: [
      {
        key: 'level',
        label: '院校层级',
        labelEn: 'Level',
        type: 'multi-select',
        options: [
          { value: 'c9', label: 'C9' },
          { value: '985', label: '985' },
          { value: '211', label: '211' },
          { value: 'double-first', label: '双一流', labelEn: 'Double First-Class' },
        ],
      },
      DISTANCE_FILTER,
    ],
    sortOptions: [
      { key: 'distance', label: '距离最近', labelEn: 'Nearest' },
      { key: 'qsRank', label: 'QS 排名', labelEn: 'QS rank' },
    ],
    defaultSort: 'distance',
    description: '高考志愿填报，院校与专业选择',
    actions: ['查看专业', '对比', '收藏'],
  },

  overseas: {
    id: 'overseas',
    name: '留学',
    nameEn: 'Overseas',
    icon: 'globe',
    color: '#007AFF',
    kind: 'recruitment',
    searchPlaceholder: '搜索院校、项目…',
    searchPlaceholderEn: 'Search schools and programs…',
    filters: [
      {
        key: 'country',
        label: '国家/地区',
        labelEn: 'Country / region',
        type: 'multi-select',
        options: [
          { value: 'us', label: '美国', labelEn: 'United States' },
          { value: 'uk', label: '英国', labelEn: 'United Kingdom' },
          { value: 'ca', label: '加拿大', labelEn: 'Canada' },
          { value: 'au', label: '澳大利亚', labelEn: 'Australia' },
          { value: 'sg', label: '新加坡', labelEn: 'Singapore' },
          { value: 'hk', label: '中国香港', labelEn: 'Hong Kong' },
        ],
      },
      DISTANCE_FILTER,
    ],
    sortOptions: [
      { key: 'distance', label: '距离最近', labelEn: 'Nearest' },
      { key: 'qsRank', label: 'QS 排名', labelEn: 'QS rank' },
    ],
    defaultSort: 'distance',
    description: '海外留学项目与院校申请',
    actions: ['查看项目', '收藏'],
  },
} as unknown as Record<Exclude<MapMode, 'internship'>, ModeConfig> & {
  internship: never;
};

/** 当前可在 UI 中切换的模式：地图 + 工作 */
export const ACTIVE_MODES: MapMode[] = ['domain', 'work'];

/** 所有模式列表（含预留），用于完整模式选择器 */
export const ALL_MODES: MapMode[] = [
  'domain',
  'work',
  'college',
  'overseas',
];

/** 兼容旧 id：internship → work */
export function canonicalMode(mode: MapMode): MapMode {
  return mode === 'internship' ? 'work' : mode;
}

/** Runtime guard for values arriving from public query strings or JSON. */
export function isKnownMode(value: unknown): value is MapMode {
  return typeof value === 'string' && (value === 'internship' || (ALL_MODES as readonly string[]).includes(value));
}

/** Parse a public mode, preserving the historical internship alias. */
export function parseKnownMode(value: unknown, fallback: MapMode = 'work'): MapMode | null {
  const candidate = value === null || value === undefined || value === '' ? fallback : value;
  return isKnownMode(candidate) ? canonicalMode(candidate) : null;
}

/** Recent 回放：切到记录当时的模式（internship → work），再带上那次关键词。 */
export function replayRecentSearch(
  currentMode: MapMode,
  entry: { query: string; mode: MapMode },
): { mode: MapMode; query: string; modeChanged: boolean } {
  const mode = canonicalMode(entry.mode);
  return {
    mode,
    query: entry.query,
    modeChanged: mode !== canonicalMode(currentMode),
  };
}

/** 按 id 取模式配置 */
export function getMode(mode: MapMode): ModeConfig {
  return MODES[canonicalMode(mode)] ?? MODES.domain;
}
