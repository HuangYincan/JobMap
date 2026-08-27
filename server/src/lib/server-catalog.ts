// Server-side catalog for public read APIs — 严格 DB-only(2026-08-26)。
// 工作模式读 Postgres(companies / company_sites / positions);domain 模式由前端走
// /api/pois/domain-local(hz_pois)+ 高德实时兜底,本 catalog 不返回示例数据。
// 无 DATABASE_URL / DB 故障 → 返回 [] 而非本地示例数据(seed 已归档 tech/backup/seed-data)。

import { loadWorkCatalogByIdFromDb, loadWorkCatalogFromDb } from './recruitment-store.ts';
import type { SpatialClip } from './spatial-query.ts';
import { isRecruitmentMode, type MapMode, type POI } from './types.ts';

/**
 * 严格 DB-only:DB 行优先;无 DB / 查询失败 / 空 → []。
 * null/[] 契约(2026-08-25, fix/server-catalog-semantics,2026-08-26 收紧):
 *   null = 无 DB / 查询失败;[] = DB 健康但(裁剪或坐标过滤后)为空。
 *   两者都按「没有数据」处理 —— 不再回退离线 seed 目录(示例数据已归档)。
 */
export async function loadServerCatalog(mode: MapMode, clip?: SpatialClip): Promise<POI[]> {
  if (!isRecruitmentMode(mode)) return []; // domain 走 /api/pois/domain-local + 高德兜底
  return (await loadWorkCatalogFromDb(clip)) ?? [];
}

export async function loadServerCatalogById(mode: MapMode, id: string): Promise<POI | undefined> {
  if (!isRecruitmentMode(mode)) return undefined;
  return (await loadWorkCatalogByIdFromDb(id)) ?? undefined;
}
