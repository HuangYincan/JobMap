// Catalog adapter: read the same public work list the server serves.
// MapShell stays off the raw SQL tables; this hits GET /api/pois.

import { poiToSourceCompany, type RecruitmentAdapter } from '../recruitment-source.ts';
import type { RecruitmentPOI } from '../types.ts';

const PAGE_SIZE = 50;
const MAX_PAGES = 20;

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
    if (batch.length < PAGE_SIZE) break;
    if (typeof payload.total === 'number' && collected.length >= payload.total) break;
  }
  return collected;
}

export const apiRecruitmentAdapter: RecruitmentAdapter = {
  kind: 'official-career',
  async list() {
    const pois = await fetchWorkCatalogFromApi();
    return pois.map((poi) => poiToSourceCompany(poi));
  },
};
