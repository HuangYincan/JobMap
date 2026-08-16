// ============================================================
// 通勤估算
//
// 高德步行/公交规划还没接。先用直线距离估四种方式，
// 详情页标明是估算。真实规划后替换本文件即可。
// ============================================================

export type CommuteMode = 'walk' | 'bike' | 'transit' | 'drive';

export interface CommuteOption {
  mode: CommuteMode;
  minutes: number;
  meters: number;
}

/** 米/分钟：步行 4.8km/h、骑行 15km/h、公交含等车、驾车含起步 */
const METERS_PER_MINUTE: Record<CommuteMode, number> = {
  walk: 80,
  bike: 250,
  transit: 220,
  drive: 450,
};

const OVERHEAD_MINUTES: Record<CommuteMode, number> = {
  walk: 0,
  bike: 1,
  transit: 6,
  drive: 3,
};

export function estimateMinutes(meters: number, mode: CommuteMode): number {
  const speed = METERS_PER_MINUTE[mode];
  const overhead = OVERHEAD_MINUTES[mode];
  if (!Number.isFinite(meters) || meters < 0 || speed <= 0) return 0;
  return Math.max(1, Math.round(meters / speed) + overhead);
}

export function estimateCommuteOptions(meters?: number): CommuteOption[] {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) return [];
  const options: CommuteOption[] = (['walk', 'bike', 'transit', 'drive'] as const).map((mode) => ({
    mode,
    meters,
    minutes: estimateMinutes(meters, mode),
  }));
  return options.filter((option) => {
    if (option.mode === 'walk') return option.minutes <= 45;
    if (option.mode === 'bike') return option.minutes <= 50;
    return true;
  });
}

export function amapDirectionsUrl(
  destination: { lng: number; lat: number; name?: string },
  mode: CommuteMode = 'drive',
): string {
  const modeMap: Record<CommuteMode, string> = {
    walk: 'walk',
    bike: 'ride',
    transit: 'bus',
    drive: 'car',
  };
  const name = encodeURIComponent(destination.name || '');
  return `https://uri.amap.com/navigation?to=${destination.lng},${destination.lat},${name}&mode=${modeMap[mode]}&src=domain-map`;
}
