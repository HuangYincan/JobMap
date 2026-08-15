// ============================================================
// 模式配置注册表 — Phase 2 多模式系统
//
// 设计遵循 tech/08-multi-mode-system.md：
// - 每个模式有专属主题色、图标、筛选器、排序选项
// - 模式切换 → 侧控栏、筛选器、POI 类型联动更新
// ============================================================

import type { FilterConfig, MapMode, POIKind, SortOption } from './types.ts';

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
  type: 'slider',
  min: 0,
  max: 10,
  step: 0.5,
  unit: 'km',
};

const CATEGORY_OPTIONS = [
  { value: 'food', label: '餐饮' },
  { value: 'shopping', label: '购物' },
  { value: 'entertainment', label: '娱乐' },
  { value: 'transport', label: '交通' },
  { value: 'public', label: '公共服务' },
  { value: 'hotel', label: '酒店' },
  { value: 'sport', label: '运动' },
  { value: 'hospital', label: '医疗' },
  { value: 'school', label: '教育' },
  { value: 'company', label: '公司' },
];

const INDUSTRY_OPTIONS = [
  { value: 'internet', label: '互联网' },
  { value: 'finance', label: '金融' },
  { value: 'consulting', label: '咨询' },
  { value: 'hardware', label: '硬件制造' },
  { value: 'ai', label: '人工智能' },
  { value: 'ecommerce', label: '电商' },
  { value: 'game', label: '游戏' },
  { value: 'automotive', label: '汽车' },
  { value: 'biotech', label: '生物医药' },
  { value: 'consumer', label: '消费品' },
];

const SCALE_OPTIONS = [
  { value: 'bigtech', label: '大厂' },
  { value: 'unicorn', label: '独角兽' },
  { value: 'startup', label: '创业公司' },
  { value: 'enterprise', label: '大型企业' },
];

const POSITION_TYPE_OPTIONS = [
  { value: 'intern', label: '实习岗' },
  { value: 'campus', label: '校招岗' },
  { value: 'social', label: '社招岗' },
];

// ---- 模式定义 ----

export const MODES: Record<MapMode, ModeConfig> = {
  domain: {
    id: 'domain',
    name: '地图',
    nameEn: 'Domain',
    icon: 'map',
    color: '#007AFF',
    kind: 'domain',
    searchPlaceholder: '搜索地点、美食、商场…',
    filters: [
      {
        key: 'category',
        label: '分类',
        type: 'select',
        options: [{ value: 'all', label: '全部' }, ...CATEGORY_OPTIONS],
      },
      {
        key: 'price',
        label: '人均消费',
        type: 'range',
        min: 0,
        max: 500,
        step: 10,
        unit: '元',
      },
      DISTANCE_FILTER,
      {
        key: 'openNow',
        label: '仅看营业中',
        type: 'toggle',
      },
    ],
    sortOptions: [
      { key: 'distance', label: '距离最近' },
      { key: 'rating', label: '评分最高' },
      { key: 'popularity', label: '人气最高' },
    ],
    defaultSort: 'distance',
    description: '探索身边的餐厅、商场、娱乐和公共服务',
    actions: ['导航', '收藏'],
  },

  internship: {
    id: 'internship',
    name: '实习',
    nameEn: 'Internship',
    icon: 'briefcase',
    color: '#34C759',
    kind: 'recruitment',
    searchPlaceholder: '搜索公司、岗位…',
    filters: [
      {
        key: 'industry',
        label: '行业',
        type: 'multi-select',
        options: INDUSTRY_OPTIONS,
      },
      {
        key: 'scale',
        label: '公司规模',
        type: 'multi-select',
        options: SCALE_OPTIONS,
      },
      {
        key: 'positionType',
        label: '岗位类型',
        type: 'multi-select',
        options: POSITION_TYPE_OPTIONS,
      },
      {
        key: 'salary',
        label: '薪资范围',
        type: 'range',
        min: 0,
        max: 50,
        step: 1,
        unit: 'K/月',
      },
      DISTANCE_FILTER,
      {
        key: 'providesHousing',
        label: '提供住宿',
        type: 'toggle',
      },
      {
        key: 'providesShuttle',
        label: '提供班车',
        type: 'toggle',
      },
    ],
    sortOptions: [
      { key: 'distance', label: '距离最近' },
      { key: 'salaryDesc', label: '薪资最高' },
      { key: 'rating', label: '公司评分' },
      { key: 'positionCount', label: '岗位数量' },
    ],
    defaultSort: 'distance',
    description: '寻找身边的实习机会，一键查看在招岗位',
    actions: ['查看岗位', '投递', '收藏'],
  },

  // ---- Phase 3+ 预留模式（数据与 UI 未实现，仅配置占位）----

  'autumn-recruit': {
    id: 'autumn-recruit',
    name: '秋招',
    nameEn: 'Autumn',
    icon: 'leaf',
    color: '#FF9500',
    kind: 'recruitment',
    searchPlaceholder: '搜索公司、岗位…',
    filters: [
      {
        key: 'industry',
        label: '行业',
        type: 'multi-select',
        options: INDUSTRY_OPTIONS,
      },
      {
        key: 'positionType',
        label: '岗位类型',
        type: 'multi-select',
        options: POSITION_TYPE_OPTIONS,
      },
      DISTANCE_FILTER,
    ],
    sortOptions: [
      { key: 'distance', label: '距离最近' },
      { key: 'salaryDesc', label: '薪资最高' },
    ],
    defaultSort: 'distance',
    description: '秋季校园招聘，大厂宣讲会与校招岗位',
    actions: ['查看岗位', '投递', '收藏'],
  },

  'spring-recruit': {
    id: 'spring-recruit',
    name: '春招',
    nameEn: 'Spring',
    icon: 'flower',
    color: '#FF2D55',
    kind: 'recruitment',
    searchPlaceholder: '搜索公司、岗位…',
    filters: [
      {
        key: 'industry',
        label: '行业',
        type: 'multi-select',
        options: INDUSTRY_OPTIONS,
      },
      {
        key: 'positionType',
        label: '岗位类型',
        type: 'multi-select',
        options: POSITION_TYPE_OPTIONS,
      },
      DISTANCE_FILTER,
    ],
    sortOptions: [
      { key: 'distance', label: '距离最近' },
      { key: 'salaryDesc', label: '薪资最高' },
    ],
    defaultSort: 'distance',
    description: '春季补招与实习转正机会',
    actions: ['查看岗位', '投递', '收藏'],
  },

  'social-recruit': {
    id: 'social-recruit',
    name: '社招',
    nameEn: 'Social',
    icon: 'briefcase',
    color: '#AF52DE',
    kind: 'recruitment',
    searchPlaceholder: '搜索公司、岗位…',
    filters: [
      {
        key: 'industry',
        label: '行业',
        type: 'multi-select',
        options: INDUSTRY_OPTIONS,
      },
      {
        key: 'positionType',
        label: '岗位类型',
        type: 'multi-select',
        options: POSITION_TYPE_OPTIONS,
      },
      DISTANCE_FILTER,
    ],
    sortOptions: [
      { key: 'distance', label: '距离最近' },
      { key: 'salaryDesc', label: '薪资最高' },
    ],
    defaultSort: 'distance',
    description: '社会招聘，成熟岗位机会',
    actions: ['查看岗位', '投递', '收藏'],
  },

  college: {
    id: 'college',
    name: '高考',
    nameEn: 'College',
    icon: 'graduation',
    color: '#FF3B30',
    kind: 'recruitment',
    searchPlaceholder: '搜索院校、专业…',
    filters: [
      {
        key: 'level',
        label: '院校层级',
        type: 'multi-select',
        options: [
          { value: 'c9', label: 'C9' },
          { value: '985', label: '985' },
          { value: '211', label: '211' },
          { value: 'double-first', label: '双一流' },
        ],
      },
      DISTANCE_FILTER,
    ],
    sortOptions: [
      { key: 'distance', label: '距离最近' },
      { key: 'qsRank', label: 'QS 排名' },
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
    color: '#5AC8FA',
    kind: 'recruitment',
    searchPlaceholder: '搜索院校、项目…',
    filters: [
      {
        key: 'country',
        label: '国家/地区',
        type: 'multi-select',
        options: [
          { value: 'us', label: '美国' },
          { value: 'uk', label: '英国' },
          { value: 'ca', label: '加拿大' },
          { value: 'au', label: '澳大利亚' },
          { value: 'sg', label: '新加坡' },
          { value: 'hk', label: '中国香港' },
        ],
      },
      DISTANCE_FILTER,
    ],
    sortOptions: [
      { key: 'distance', label: '距离最近' },
      { key: 'qsRank', label: 'QS 排名' },
    ],
    defaultSort: 'distance',
    description: '海外留学项目与院校申请',
    actions: ['查看项目', '收藏'],
  },
};

/** 当前已实现、可在 UI 中切换的模式（Phase 2: domain + internship） */
export const ACTIVE_MODES: MapMode[] = ['domain', 'internship'];

/** 所有模式列表（含预留），用于完整模式选择器 */
export const ALL_MODES: MapMode[] = [
  'domain',
  'internship',
  'autumn-recruit',
  'spring-recruit',
  'social-recruit',
  'college',
  'overseas',
];

/** 按 id 取模式配置 */
export function getMode(mode: MapMode): ModeConfig {
  return MODES[mode];
}
