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
