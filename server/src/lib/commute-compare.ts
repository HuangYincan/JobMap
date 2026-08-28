// 通勤对比事实表(列式)。2–5 列;岗位事实 + 通勤分钟 + quality;禁止 AI 总分。
// 不复用 Saved 两家公司对比(compare-saved.ts)的产品含义。

import { formatSalary, isRecruitmentPOI, type POI } from './types.ts';
import { isAlivePosition } from './position-alive.ts';

export const COMMUTE_COMPARE_ROWS = [
  'commuteMinutes',
  'quality',
  'openJobs',
  'salary',
  'address',
] as const;

export type CommuteCompareRowKey = (typeof COMMUTE_COMPARE_ROWS)[number];

export interface CommuteCompareColumn {
  poiId: string;
  name: string;
  commuteMinutes: string;
  quality: string;
  openJobs: string;
  salary: string;
  address: string;
}

export function buildCommuteCompareColumn(
  poi: POI,
  minutes: number | undefined,
  quality: 'estimate' | 'provider_route',
  labels: { estimate: string; provider: string; minutes: string },
): CommuteCompareColumn {
  const commute =
    typeof minutes === 'number' && Number.isFinite(minutes)
      ? `${minutes} ${labels.minutes}`
      : '—';
  if (!isRecruitmentPOI(poi)) {
    return {
      poiId: poi.id,
      name: poi.name,
      commuteMinutes: commute,
      quality: quality === 'provider_route' ? labels.provider : labels.estimate,
      openJobs: '—',
      salary: '—',
      address: poi.location.address ?? '—',
    };
  }
  const open = poi.positions.filter((p) => isAlivePosition(p));
  const salaries = open
    .map((p) => formatSalary(p.salary))
    .filter((s) => s && s !== '面议')
    .slice(0, 2);
  return {
    poiId: poi.id,
    name: poi.name,
    commuteMinutes: commute,
    quality: quality === 'provider_route' ? labels.provider : labels.estimate,
    openJobs: String(open.length),
    salary: salaries.length > 0 ? salaries.join(' · ') : '—',
    address: poi.location.address ?? '—',
  };
}

export function buildCommuteCompareColumns(
  pois: POI[],
  minutesById: Record<string, number>,
  quality: 'estimate' | 'provider_route',
  labels: { estimate: string; provider: string; minutes: string },
): CommuteCompareColumn[] {
  return pois.map((poi) =>
    buildCommuteCompareColumn(poi, minutesById[poi.id], quality, labels),
  );
}
