// ============================================================
// 空间筛选插件
//
// 行政区先按地址文本匹配（杭州主城区）。
// PostGIS 多边形查询接上后，同一 key 切到空间实现，UI 不用改。
// ============================================================

import type { FilterPlugin } from './job-taxonomy.ts';
import type { FilterConfig, POI } from './types.ts';

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

/** 地址包含任一选中区名即通过。空选择不限制。 */
export function poiMatchesDistrict(poi: POI, selected: string[]): boolean {
  if (!selected.length) return true;
  const address = poi.location.address || '';
  return selected.some((district) => address.includes(district) || address.includes(district.replace(/区$/, '')));
}
