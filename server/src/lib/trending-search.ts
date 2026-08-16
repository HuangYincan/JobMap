// ============================================================
// 热门搜索插件
//
// 每种地图模式一组推荐查询。后续可换成接口 / 统计，
// 调用方只认 trendingForMode。
// ============================================================

import { canonicalMode } from './modes.ts';
import type { MapMode } from './types.ts';

export interface TrendingQuery {
  query: string;
  /** 展示用短标签，缺省用 query */
  label?: string;
}

const TRENDING: Record<'domain' | 'work', TrendingQuery[]> = {
  domain: [
    { query: '咖啡' },
    { query: '西湖' },
    { query: '商场' },
    { query: '地铁站' },
  ],
  work: [
    { query: '#大厂', label: '大厂' },
    { query: '#实习', label: '实习' },
    { query: '#秋招', label: '秋招' },
    { query: 'Java' },
    { query: '算法' },
    { query: '#互联网', label: '互联网' },
  ],
};

export function trendingForMode(mode: MapMode): TrendingQuery[] {
  const id = canonicalMode(mode);
  if (id === 'domain') return TRENDING.domain;
  return TRENDING.work;
}
