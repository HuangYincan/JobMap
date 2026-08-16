// ============================================================
// Persistability registry — Saved / Recent write gate
//
// The account database stores catalog companies (work), not AMap
// domain rows. Add `college` / `overseas` to PERSISTABLE_MODES when
// those catalogs land. Never treat AMap domain POIs as persistable.
// ============================================================

import type { MapMode, POIKind } from './types.ts';
import { canonicalMode } from './modes.ts';

/** Modes whose queries / POIs may be written to account or guest Recent / Saved. */
export const PERSISTABLE_MODES: ReadonlySet<MapMode> = new Set(['work', 'internship']);

export function isPersistableMode(mode: MapMode | string | null | undefined): boolean {
  if (!mode) return false;
  return PERSISTABLE_MODES.has(canonicalMode(mode as MapMode));
}

export function isPersistablePoi(
  poi: {
    mode?: MapMode | string;
    kind?: POIKind | string;
    source?: string;
  } | null | undefined,
): boolean {
  if (!poi) return false;
  return isPersistableMode(poi.mode) && poi.kind === 'recruitment' && poi.source !== 'amap';
}

/** Saved POST body has no `source`; gate on mode + recruitment kind. */
export function isPersistableSavedSnapshot(input: {
  mode?: MapMode | string;
  kind?: string;
} | null | undefined): boolean {
  if (!input) return false;
  return isPersistableMode(input.mode) && input.kind === 'recruitment';
}
