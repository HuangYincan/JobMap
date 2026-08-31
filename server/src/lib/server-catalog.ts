// Server-side catalog for public read APIs — 严格 DB-only(2026-08-26)。
// 工作模式读 Postgres(companies / company_sites / positions);domain 模式由前端走
// /api/pois/domain-local(hz_pois)+ 高德实时兜底,本 catalog 不返回示例数据。
// 无 DATABASE_URL / DB 故障 → 返回 null(路由 502,不写公开缓存),不得伪装成 []。

import { loadWorkCatalogByIdFromDb, loadWorkCatalogFromDb } from './recruitment-store.ts';
import type { SpatialClip } from './spatial-query.ts';
import { isRecruitmentMode, type MapMode, type POI } from './types.ts';

/**
 * 严格 DB-only:DB 行优先。
 * null/[] 契约(2026-08-25, fix/server-catalog-semantics;2026-08-29 路由层对齐 domain-local):
 *   null = 无 DB / 查询失败 —— HTTP 必须 502 且不写公开缓存,不得伪装成 200 空目录;
 *   [] = DB 健康但(裁剪或坐标过滤后)为空。
 * 不再回退离线 seed 目录(示例数据已归档)。
 */
export async function loadServerCatalog(mode: MapMode, clip?: SpatialClip): Promise<POI[] | null> {
  if (!isRecruitmentMode(mode)) return []; // domain 走 /api/pois/domain-local + 高德兜底
  return loadWorkCatalogFromDb(clip);
}

export async function loadServerCatalogById(mode: MapMode, id: string): Promise<POI | undefined> {
  if (!isRecruitmentMode(mode)) return undefined;
  return (await loadWorkCatalogByIdFromDb(id)) ?? undefined;
}
