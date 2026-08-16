// 空间筛选插件
//
// 行政区先按地址文本匹配（杭州主城区）。地址里没有区名时，
// 回落到粗框（点在框内）。PostGIS 多边形接上后同一 key 替换实现。

import type { FilterPlugin } from './job-taxonomy.ts';
import type { FilterConfig, POI } from './types.ts';
import { inBounds, type ViewportBounds } from './viewport-search.ts';

export const HANGZHOU_DISTRICTS = [
  { value: '西湖区', label: '西湖' },
  { value: '余杭区', label: '余杭' },
  { value: '滨江区', label: '滨江' },
  { value: '上城区', label: '上城' },
  { value: '拱墅区', label: '拱墅' },
  { value: '临平区', label: '临平' },
  { value: '钱塘区', label: '钱塘' },
  { value: '萧山区', label: '萧山' },
  { value: '富阳区', label: '富阳' },
  { value: '临安区', label: '临安' },
] as const;

export type HangzhouDistrict = (typeof HANGZHOU_DISTRICTS)[number]['value'];

/** Coarse boxes for Hangzhou urban districts. Not official cadastral polygons. */
export const DISTRICT_BOXES: Record<HangzhouDistrict, ViewportBounds> = {
  西湖区: { west: 120.04, south: 30.18, east: 120.18, north: 30.30 },
  余杭区: { west: 119.92, south: 30.26, east: 120.16, north: 30.46 },
  滨江区: { west: 120.14, south: 30.16, east: 120.26, north: 30.24 },
  上城区: { west: 120.15, south: 30.23, east: 120.23, north: 30.28 },
  拱墅区: { west: 120.12, south: 30.27, east: 120.20, north: 30.36 },
  临平区: { west: 120.24, south: 30.36, east: 120.40, north: 30.48 },
  钱塘区: { west: 120.28, south: 30.24, east: 120.46, north: 30.38 },
  萧山区: { west: 120.20, south: 30.10, east: 120.40, north: 30.22 },
  富阳区: { west: 119.85, south: 29.98, east: 120.06, north: 30.16 },
  临安区: { west: 119.55, south: 30.12, east: 119.90, north: 30.36 },
};

export const DISTRICT_PLUGIN: FilterPlugin = {
  id: 'district',
  label: '行政区',
  filter: {
    key: 'district',
    label: '行政区',
    type: 'multi-select',
    options: HANGZHOU_DISTRICTS.map((d) => ({ value: d.value, label: d.label })),
  },
};

export function districtFilterConfig(): FilterConfig {
  return DISTRICT_PLUGIN.filter;
}

function districtAliases(district: string): string[] {
  const short = district.replace(/区$/, '');
  return short === district ? [district] : [district, short];
}

export function addressMentionsDistrict(address: string, district: string): boolean {
  return districtAliases(district).some((token) => address.includes(token));
}

export function addressMentionsAnyDistrict(address: string): boolean {
  return HANGZHOU_DISTRICTS.some((d) => addressMentionsDistrict(address, d.value));
}

/** Address text wins. If the address names no known district, use the coarse box. */
export function poiMatchesDistrict(poi: POI, selected: string[]): boolean {
  if (!selected.length) return true;
  const address = poi.location.address || '';
  if (selected.some((district) => addressMentionsDistrict(address, district))) return true;
  if (addressMentionsAnyDistrict(address)) return false;
  return selected.some((district) => {
    const box = DISTRICT_BOXES[district as HangzhouDistrict];
    return box ? inBounds(poi.location, box) : false;
  });
}
