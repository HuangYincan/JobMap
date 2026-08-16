// Server-side catalog for public read APIs.
// MapShell still loads Domain from AMap in the browser; these seeds
// keep /api/pois, /api/pois/[id], /api/search, and /api/suggest aligned
// when there is no DATABASE_URL.

import { DOMAIN_SEED, INTERNSHIP_SEED } from './seed-data.ts';
import { isRecruitmentMode, type MapMode, type POI } from './types.ts';

export function serverCatalog(mode: MapMode): POI[] {
  if (isRecruitmentMode(mode)) return INTERNSHIP_SEED;
  if (mode === 'domain') return DOMAIN_SEED;
  return [];
}

export function serverCatalogById(mode: MapMode, id: string): POI | undefined {
  return serverCatalog(mode).find((poi) => poi.id === id);
}
