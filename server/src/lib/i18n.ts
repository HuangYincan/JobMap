export type Language = 'zh' | 'en';

export const translations = {
  search: {
    zh: '搜索',
    en: 'Search',
  },
  searchPlaceholder: {
    zh: '搜索地点',
    en: 'Search places',
  },
  layers: {
    zh: '图层',
    en: 'Layers',
  },
  saved: {
    zh: '已保存',
    en: 'Saved',
  },
  explore: {
    zh: '探索',
    en: 'Explore',
  },
  recent: {
    zh: '最近',
    en: 'Recent',
  },
  settings: {
    zh: '设置',
    en: 'Settings',
  },
  profile: {
    zh: '个人资料',
    en: 'Profile',
  },
  mapStyle: {
    zh: '地图样式',
    en: 'Map style',
  },
  chooseView: {
    zh: '选择您的视图',
    en: 'Choose your view',
  },
  standard: {
    zh: '标准',
    en: 'Standard',
  },
  satellite: {
    zh: '卫星',
    en: 'Satellite',
  },
  dark: {
    zh: '深色',
    en: 'Dark',
  },
  locateMe: {
    zh: '定位',
    en: 'Locate me',
  },
  collapsSidebar: {
    zh: '折叠侧边栏',
    en: 'Collapse sidebar',
  },
  expandSidebar: {
    zh: '展开侧边栏',
    en: 'Expand sidebar',
  },
  // ---- Phase 2 模式名称 ----
  modeDomain: {
    zh: '地图',
    en: 'Map',
  },
  modeInternship: {
    zh: '实习',
    en: 'Internship',
  },
  modeAutumn: {
    zh: '秋招',
    en: 'Autumn',
  },
  modeSpring: {
    zh: '春招',
    en: 'Spring',
  },
  modeSocial: {
    zh: '社招',
    en: 'Social',
  },
  modeCollege: {
    zh: '高考',
    en: 'College',
  },
  modeOverseas: {
    zh: '留学',
    en: 'Overseas',
  },
  // ---- Phase 2 侧控栏 ----
  resultsCount: {
    zh: '个结果',
    en: 'results',
  },
  filter: {
    zh: '筛选',
    en: 'Filter',
  },
  sort: {
    zh: '排序',
    en: 'Sort',
  },
  reset: {
    zh: '重置',
    en: 'Reset',
  },
  loading: {
    zh: '加载中…',
    en: 'Loading…',
  },
  noResults: {
    zh: '未找到结果',
    en: 'No results found',
  },
  noResultsHint: {
    zh: '尝试调整关键词或筛选条件',
    en: 'Try adjusting keywords or filters',
  },
  apply: {
    zh: '应用',
    en: 'Apply',
  },
  openNow: {
    zh: '营业中',
    en: 'Open now',
  },
  viewPositions: {
    zh: '在招岗位',
    en: 'Open positions',
  },
  savedMap: {
    zh: '个人地图',
    en: 'Personal map',
  },
} as const;

// 获取浏览器语言偏好
export function getBrowserLanguage(): Language {
  if (typeof window === 'undefined') return 'en';
  const lang = navigator.language.toLowerCase();
  return lang.startsWith('zh') ? 'zh' : 'en';
}

// 获取指定语言的文本
export function t(key: keyof typeof translations, lang: Language): string {
  return translations[key][lang];
}
