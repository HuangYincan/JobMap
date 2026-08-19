// ============================================================
// 城市聚合 — 全国/省级视野(zoom ≤ 8)密度管理(tech/21)
//
// tier 模型落地后,全国/省级视野同城 10–50 家 pin 重叠无法点选。
// 聚合是渲染层第二种模式(与视口增量加载/选中高亮/LOD 过滤零冲突):
// zoom ≤ 8 时按 site.city 分组,每个城市一个圆形徽章「城市名 N」,
// 点击平滑缩放到该城(zoom 11)展开个体 pin。
//
// 纯函数,无 AMap/React 依赖,node 下可单测。
// ============================================================

import type { POI } from './types.ts';
import { isRecruitmentPOI } from './types.ts';
import { cityCenter } from './city-centers.ts';

/** 聚合触发上限:zoom <= 8 启用聚合,zoom > 8 切回个体 pin(用户批准阈值,tech/21)。 */
export const CLUSTER_MAX_ZOOM = 8;
/** 徽章点击下钻目标缩放级别(城市级,个体 pin 出现)。 */
export const CLUSTER_DRILL_ZOOM = 11;

/** 城市聚合组。 */
export interface CityCluster {
  /** 城市名('北京')。 */
  city: string;
  /** 该城 POI 数量。 */
  count: number;
  /** 聚合徽章锚点经度:命中静态城市中心 → 行政中心经度,未命中 → 组内 pin 均值。 */
  lng: number;
  /** 聚合徽章锚点纬度:命中静态城市中心 → 行政中心纬度,未命中 → 组内 pin 均值。 */
  lat: number;
}

/**
 * 取 POI 的城市(work 语义:一 POI 一职场,取 sites[0].city)。
 * 非 recruitment POI / 无 sites / city 空白 → 返回 undefined(该 pin 不聚合)。
 */
export function poiCity(poi: POI): string | undefined {
  if (!isRecruitmentPOI(poi)) return undefined;
  const city = poi.sites?.[0]?.city?.trim();
  return city || undefined;
}

/**
 * 将 POI 列表按城市分组聚合。
 *
 * 规则(tech/21):
 * - zoom > CLUSTER_MAX_ZOOM(8)→ 返回 null,调用方用个体 pin;
 * - 非 work 上下文(列表里一个 recruitment POI 都没有,含空列表)→ 返回 null;
 * - 按 site.city 分组计数(经 poiCity,一 POI 一职场语义);
 * - 无 city 的 POI 不聚合(保持个体,由调用方另行渲染或省略);
 * - 中心点 = 静态城市中心(命中 CITY_CENTERS),未命中 → 组内 pin 坐标均值(有合法
 *   坐标的);组内无合法坐标 → 该组省略。命中静态中心时忽略均值(北京等散落城市
 *   均值可能落在城郊,tech/21 + ws-b)。
 *
 * @returns 聚合组数组(按数量降序,数量相同按城市名升序,输出确定);
 *          不满足聚合条件时 null。
 */
export function clusterCities(pois: POI[], zoom: number): CityCluster[] | null {
  if (!Number.isFinite(zoom) || zoom > CLUSTER_MAX_ZOOM) return null;

  const groups = new Map<string, { count: number; lngs: number[]; lats: number[] }>();
  let recruitmentSeen = false;

  for (const poi of pois) {
    const city = poiCity(poi);
    if (!city) continue; // domain POI / 无 city → 保持个体
    recruitmentSeen = true;
    let group = groups.get(city);
    if (!group) {
      group = { count: 0, lngs: [], lats: [] };
      groups.set(city, group);
    }
    group.count += 1;
    const { lng, lat } = poi.location;
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      group.lngs.push(lng);
      group.lats.push(lat);
    }
  }

  // 非 work 上下文(纯 domain / 空列表):不聚合,调用方用个体 pin
  if (!recruitmentSeen) return null;

  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  return Array.from(groups.entries())
    .filter(([, g]) => g.lngs.length > 0) // 组内无合法坐标 → 无法定位徽章,省略
    .map(([city, g]) => ({
      city,
      count: g.count,
      // 锚点优先取静态行政中心(裸名城归一命中),未命中回退组内均值(确定性不变)
      lng: cityCenter(city)?.lng ?? mean(g.lngs),
      lat: cityCenter(city)?.lat ?? mean(g.lats),
    }))
    .sort(
      (a, b) =>
        b.count - a.count || a.city.localeCompare(b.city, 'zh-Hans-CN')
    );
}
