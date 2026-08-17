// Server-side catalog for public read APIs.
// MapShell still loads Domain from AMap in the browser; these seeds
// keep /api/pois, /api/pois/[id], /api/search, and /api/suggest aligned
// when there is no DATABASE_URL.

import { listSourceCompanyFiles } from './recruitment-adapters/file-drop.ts';
import { BOSS_DIR } from './recruitment-adapters/boss.ts';
import { NOWCODER_DIR } from './recruitment-adapters/nowcoder.ts';
import { OFFICIAL_CAREER_DIR, listOfficialCareerFiles } from './recruitment-adapters/official-career.ts';
import { RADAR_DIR } from './recruitment-adapters/radar.ts';
import { SHIXISENG_DIR } from './recruitment-adapters/shixiseng.ts';
import { isAuthenticPositionId } from './freshness.ts';
import { isAlivePosition } from './position-alive.ts';
import { mergeCompaniesIntoPois } from './recruitment-source.ts';
import { loadWorkCatalogFromDb } from './recruitment-store.ts';
import { DOMAIN_SEED, INTERNSHIP_SEED } from './seed-data.ts';
import type { SpatialClip } from './spatial-query.ts';
import { isRecruitmentMode, type MapMode, type POI } from './types.ts';

let offlineWorkCatalog: Promise<POI[]> | null = null;

function hasPlausibleCoord(poi: POI): boolean {
  const { lng, lat } = poi.location ?? {};
  return Number.isFinite(lng) && Number.isFinite(lat) && !(lng === 0 && lat === 0);
}

export async function loadOfflineWorkCatalog(): Promise<POI[]> {
  if (!offlineWorkCatalog) {
    offlineWorkCatalog = Promise.all([
      listOfficialCareerFiles(OFFICIAL_CAREER_DIR),
      listSourceCompanyFiles(BOSS_DIR),
      listSourceCompanyFiles(NOWCODER_DIR),
      listSourceCompanyFiles(SHIXISENG_DIR),
      listSourceCompanyFiles(RADAR_DIR),
    ]).then(([official, boss, nowcoder, shixiseng, radar]) => {
      // Coordinate skeleton comes from the seed; example positions are dropped.
      // Only authentic positions (radar-* / portal-*) survive — seed /
      // official-career example jobs are development scaffolding (2026-08-17).
      const skeleton = INTERNSHIP_SEED.map((poi) => ({ ...poi, positions: [] }));
      const merged = mergeCompaniesIntoPois(
        skeleton,
        [...official, ...boss, ...nowcoder, ...shixiseng],
      );
      const withRadar = mergeCompaniesIntoPois(merged, radar);
      return withRadar
        .map((poi) => ({
          ...poi,
          // A1（tech/18）：只保留真实 + 在招岗位（DB 读路径在 SQL 里恒开同一条规则）。
          positions: poi.positions.filter(
            (pos) => isAuthenticPositionId(pos.id) && isAlivePosition(pos),
          ),
        }))
        .filter((poi) => poi.positions.length > 0 && hasPlausibleCoord(poi));
    });
  }
  return offlineWorkCatalog;
}

/** Sync seed catalog. Tests and dry helpers use this. */
export function serverCatalog(mode: MapMode): POI[] {
  if (isRecruitmentMode(mode)) return INTERNSHIP_SEED;
  if (mode === 'domain') return DOMAIN_SEED;
  return [];
}

/** Prefer imported work rows when Postgres has them; otherwise seed + official-career drops. */
export async function loadServerCatalog(mode: MapMode, clip?: SpatialClip): Promise<POI[]> {
  if (isRecruitmentMode(mode)) {
    const imported = await loadWorkCatalogFromDb(clip);
    // Clip miss must stay empty. An unclipped empty table still falls back to seed.
    if (imported && (imported.length > 0 || clip)) return imported;
    return loadOfflineWorkCatalog();
  }
  if (mode === 'domain') return DOMAIN_SEED;
  return [];
}

export function serverCatalogById(mode: MapMode, id: string): POI | undefined {
  return serverCatalog(mode).find((poi) => poi.id === id);
}

export async function loadServerCatalogById(mode: MapMode, id: string): Promise<POI | undefined> {
  const catalog = await loadServerCatalog(mode);
  return catalog.find((poi) => poi.id === id);
}
