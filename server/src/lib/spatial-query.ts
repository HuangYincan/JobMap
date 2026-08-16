// Spatial clip helpers for public work reads.
// SQL uses gist && then optional ST_DWithin. No DATABASE_URL → caller
// keeps the in-memory inBounds / pipeline clip.

import {
  DISTRICT_BOXES,
  HANGZHOU_DISTRICTS,
  type HangzhouDistrict,
} from './spatial-filters.ts';
import type { ViewportBounds } from './viewport-search.ts';

export interface SpatialClip {
  bounds?: ViewportBounds | null;
  /** WGS84 point used with ST_DWithin. */
  origin?: { lng: number; lat: number } | null;
  /** Radius in meters. Ignored unless origin is set and radius > 0. */
  radiusMeters?: number | null;
  /**
   * Hangzhou districts. SQL is a superset (address ILIKE or coarse box).
   * Memory `poiMatchesDistrict` still does the exact address-over-box rule.
   */
  districts?: string[] | null;
}

export function knownHangzhouDistricts(values: unknown): HangzhouDistrict[] {
  if (!Array.isArray(values)) return [];
  const allowed = new Set<string>(HANGZHOU_DISTRICTS.map((d) => d.value));
  return values.filter((value): value is HangzhouDistrict => typeof value === 'string' && allowed.has(value));
}

export function hasSpatialClip(clip?: SpatialClip | null): boolean {
  if (!clip) return false;
  if (clip.bounds) return true;
  if (clip.districts && clip.districts.length > 0) return true;
  return Boolean(clip.origin && clip.radiusMeters && clip.radiusMeters > 0);
}

/** Envelope for ST_MakeEnvelope(west, south, east, north, 4326). */
export function envelopeArgs(bounds: ViewportBounds): [number, number, number, number] {
  return [bounds.west, bounds.south, bounds.east, bounds.north];
}

/**
 * company_sites WHERE fragment. Placeholders start at `start`.
 * Bounding box uses && (gist). Distance uses geography ST_DWithin.
 */
export function companySitesSpatialSql(
  clip: SpatialClip | undefined,
  start = 1,
): { sql: string; params: unknown[] } {
  if (!hasSpatialClip(clip)) return { sql: '', params: [] };

  const clauses: string[] = [];
  const params: unknown[] = [];
  let i = start;

  if (clip?.bounds) {
    const [west, south, east, north] = envelopeArgs(clip.bounds);
    clauses.push(`s.geom && ST_MakeEnvelope($${i}, $${i + 1}, $${i + 2}, $${i + 3}, 4326)`);
    params.push(west, south, east, north);
    i += 4;
  }

  if (clip?.origin && clip.radiusMeters && clip.radiusMeters > 0) {
    clauses.push(
      `ST_DWithin(s.geom::geography, ST_SetSRID(ST_MakePoint($${i}, $${i + 1}), 4326)::geography, $${i + 2})`,
    );
    params.push(clip.origin.lng, clip.origin.lat, clip.radiusMeters);
    i += 3;
  }

  const districts = knownHangzhouDistricts(clip?.districts);
  if (districts.length) {
    const parts: string[] = [];
    for (const district of districts) {
      const short = district.replace(/区$/, '');
      parts.push(`COALESCE(s.address, '') ILIKE $${i}`);
      params.push(`%${district}%`);
      i += 1;
      if (short !== district) {
        parts.push(`COALESCE(s.address, '') ILIKE $${i}`);
        params.push(`%${short}%`);
        i += 1;
      }
      const box = DISTRICT_BOXES[district];
      if (box) {
        parts.push(`s.geom && ST_MakeEnvelope($${i}, $${i + 1}, $${i + 2}, $${i + 3}, 4326)`);
        params.push(box.west, box.south, box.east, box.north);
        i += 4;
      }
    }
    clauses.push(`(${parts.join(' OR ')})`);
  }

  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params };
}

export function parseDistanceKm(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
