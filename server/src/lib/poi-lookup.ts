// 按公司目录 id 或岗位 id 找回招聘 POI。Agent select/openDetail 常把岗位 ID
// 当成地图实体 id,而 marker 池的主键是公司 catalog id。

import { isRecruitmentPOI, type POI, type Position } from './types.ts';

export interface PoiLookupHit {
  poi: POI;
  position?: Position;
}

function uniquePois(pools: Array<readonly POI[] | undefined>): POI[] {
  const byId = new Map<string, POI>();
  for (const pool of pools) {
    if (!pool) continue;
    for (const poi of pool) {
      if (!byId.has(poi.id)) byId.set(poi.id, poi);
    }
  }
  return [...byId.values()];
}

export function findPoiByCatalogOrPositionId(
  id: string,
  ...pools: Array<readonly POI[] | undefined>
): PoiLookupHit | undefined {
  const trimmed = id.trim();
  if (!trimmed) return undefined;
  const list = uniquePois(pools);
  const byCatalog = list.find((poi) => poi.id === trimmed);
  if (byCatalog) return { poi: byCatalog };
  for (const poi of list) {
    if (!isRecruitmentPOI(poi)) continue;
    const position = poi.positions.find((item) => item.id === trimmed);
    if (position) return { poi, position };
  }
  return undefined;
}
