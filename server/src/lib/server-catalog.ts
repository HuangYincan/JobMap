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
import { isCityCenterPin } from './city-centers.ts';
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

/**
 * 可展示判定:有真实坐标且不是城市中心钉(2026-08-25, fix/hide-center-pins)。
 * 中心钉 = 站点无真实办公坐标、由 city-centers 批次钉在行政中心;读路径排除,
 * 避免地图在市中心堆出假办公点(用户反馈「很多 POI 在市中心」)。
 */
function hasShownCoord(poi: POI): boolean {
  const { lng, lat } = poi.location ?? {};
  return hasPlausibleCoord(poi) && !isCityCenterPin(lng as number, lat as number);
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
        .filter((poi) => poi.positions.length > 0 && hasShownCoord(poi));
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
    // null/[] 契约(2026-08-25, fix/server-catalog-semantics):
    //   null = 无 DB / 查询失败 → 唯一需要离线回退的情形;
    //   []   = DB 健康但(裁剪或坐标过滤后)为空 → 带 clip 必须保持空(裁剪未命中
    //          是「当前范围内确实没有结果」, 不是「没数据可回退」);
    //           空表无 clip 仍回退离线目录(导入行不存在 ≠ 查询失败)。
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
