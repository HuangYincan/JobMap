// ============================================================
// 收藏公司并排对比（纯函数）
//
// 对比发生在 Saved 二级卡内部，不新开一层。
// 勾选最多两家招聘点；现场 catalog / seed 有则用活数据，
// 否则回退 SavedPlace 快照（名字、地址、坐标）。
// ============================================================

import type { SavedPlace } from './account.ts';
import { formatDistance, haversineDistance, isRecruitmentPOI, type POI } from './types.ts';

export const COMPARE_MAX = 2;

export interface CompareColumn {
  poiId: string;
  name: string;
  kind: SavedPlace['kind'];
  scale: string;
  industries: string;
  rating: string;
  openJobs: string;
  families: string;
  salary: string;
  distance: string;
  address: string;
  benefits: string;
}

export interface CompareRow {
  key: keyof Omit<CompareColumn, 'poiId' | 'name' | 'kind'>;
}

export const COMPARE_ROWS: CompareRow[] = [
  { key: 'scale' },
  { key: 'industries' },
  { key: 'rating' },
  { key: 'openJobs' },
  { key: 'families' },
  { key: 'salary' },
  { key: 'distance' },
  { key: 'address' },
  { key: 'benefits' },
];

const SCALE_LABEL: Record<string, string> = {
  bigtech: '大厂',
  unicorn: '独角兽',
  startup: '创业公司',
  enterprise: '大型企业',
};

const INDUSTRY_LABEL: Record<string, string> = {
  internet: '互联网',
  finance: '金融',
  consulting: '咨询',
  hardware: '硬件',
  ai: '人工智能',
  ecommerce: '电商',
  game: '游戏',
  automotive: '汽车',
  biotech: '生物医药',
  consumer: '消费品',
  transport: '出行',
  content: '内容',
};

const FAMILY_LABEL: Record<string, string> = {
  intern: '实习',
  campus: '校招',
  social: '社招',
};

/** 勾选对比：同一项再点取消；超过上限时挤掉最早勾的那家。 */
export function toggleCompareSelection(current: string[], poiId: string, max = COMPARE_MAX): string[] {
  if (!poiId) return current.slice();
  const next = current.filter((id) => id !== poiId);
  if (next.length !== current.length) return next;
  const added = [...current, poiId];
  return added.length > max ? added.slice(added.length - max) : added;
}

/** catalog 优先，seed 兜底。 */
export function resolveSavedPoi(place: SavedPlace, catalog: POI[]): POI | undefined {
  return catalog.find((poi) => poi.id === place.poiId);
}

export function buildCompareColumn(
  place: SavedPlace,
  live: POI | undefined,
  origin?: { lng: number; lat: number } | null,
): CompareColumn {
  const loc = live?.location ?? (
    typeof place.lng === 'number' && typeof place.lat === 'number'
      ? { lng: place.lng, lat: place.lat, address: place.address }
      : undefined
  );
  const meters =
    origin && loc ? haversineDistance({ lng: loc.lng, lat: loc.lat }, origin) : live?.distance;
  const address = live?.location.address || place.address || '—';

  if (!live || !isRecruitmentPOI(live)) {
    return {
      poiId: place.poiId,
      name: live?.name ?? place.name,
      kind: place.kind,
      scale: '—',
      industries: '—',
      rating: '—',
      openJobs: '—',
      families: '—',
      salary: '—',
      distance: formatDistance(meters),
      address,
      benefits: '—',
    };
  }

  const open = live.positions.filter((p) => p.status === 'open');
  const familyCounts = new Map<string, number>();
  let salMin = Infinity;
  let salMax = -Infinity;
  for (const pos of open) {
    const family = pos.taxonomy?.family ?? pos.type;
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    if (pos.salary) {
      salMin = Math.min(salMin, pos.salary.min);
      salMax = Math.max(salMax, pos.salary.max);
    }
  }

  const families = ['intern', 'campus', 'social']
    .filter((key) => familyCounts.has(key))
    .map((key) => `${FAMILY_LABEL[key]} ${familyCounts.get(key)}`)
    .join(' · ');

  return {
    poiId: place.poiId,
    name: live.name,
    kind: 'recruitment',
    scale: SCALE_LABEL[live.company.scale] ?? live.company.scale,
    industries: live.company.industries.map((id) => INDUSTRY_LABEL[id] ?? id).join(' · ') || '—',
    rating: live.company.rating != null ? String(live.company.rating) : '—',
    openJobs: String(open.length),
    families: families || '—',
    salary: salMin !== Infinity ? `${salMin}–${salMax}k` : '—',
    distance: formatDistance(meters),
    address,
    benefits: live.benefits?.length ? live.benefits.join(' · ') : '—',
  };
}

export function buildCompareColumns(
  pickedIds: string[],
  items: SavedPlace[],
  catalog: POI[],
  origin?: { lng: number; lat: number } | null,
): CompareColumn[] {
  return pickedIds.flatMap((id) => {
    const place = items.find((item) => item.poiId === id);
    if (!place) return [];
    return [buildCompareColumn(place, resolveSavedPoi(place, catalog), origin)];
  });
}
