// Catalog adapter: read the same public work list the server serves.
// MapShell stays off the raw SQL tables; this hits GET /api/pois.

import { poiToSourceCompany, type RecruitmentAdapter } from '../recruitment-source.ts';
import type { RecruitmentPOI } from '../types.ts';
import { workCatalogSqlWindowDone } from '../viewport-search.ts';

/** Align with GET /api/pois MAX_PAGE_SIZE / WORK_VIEWPORT_PAGE_SIZE. */
const PAGE_SIZE = 100;
/** 防呆上限。有 total 时按候选行翻页,不再把水合短页当成整库到底。 */
const MAX_PAGES = 10_000;

function isRecruitmentPoi(value: unknown): value is RecruitmentPOI {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<RecruitmentPOI>;
  return row.kind === 'recruitment' && typeof row.id === 'string' && !!row.company;
}

export async function fetchWorkCatalogFromApi(): Promise<RecruitmentPOI[]> {
  if (typeof fetch !== 'function') return [];
  const collected: RecruitmentPOI[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `/api/pois?mode=work&page=${page}&pageSize=${PAGE_SIZE}`;
    let payload: { results?: unknown[]; total?: number };
    try {
      const res = await fetch(url);
      if (!res.ok) return collected;
      payload = (await res.json()) as { results?: unknown[]; total?: number };
    } catch {
      return collected;
    }
    const batch = (payload.results ?? []).filter(isRecruitmentPoi);
    collected.push(...batch);
    const total = typeof payload.total === 'number' ? payload.total : -1;
    if (total >= 0) {
      if (workCatalogSqlWindowDone(page, PAGE_SIZE, total)) break;
      continue;
    }
    if (batch.length < PAGE_SIZE) break;
  }
  return collected;
}

export const apiRecruitmentAdapter: RecruitmentAdapter = {
  kind: 'catalog',
  async list() {
    const pois = await fetchWorkCatalogFromApi();
    return pois.map((poi) => poiToSourceCompany(poi));
  },
};
