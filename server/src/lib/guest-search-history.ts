// ============================================================
// Guest Recent — browser localStorage only
//
// Signed-in history stays on /api/me/search-history.
// Do not reuse the stale tech/10 key `search_history`.
// ============================================================

import type { SearchHistoryEntry, SearchHistoryEntityRef } from './account.ts';
import { sanitizeEntityRef } from './account.ts';
import type { MapMode } from './types.ts';
import { isPersistableMode } from './persistable.ts';

export const GUEST_HISTORY_KEY = 'dm.guest-search-history.v1';
export const GUEST_HISTORY_CAP = 30;
/** Local parser ceiling; oversized values are treated as corrupt storage. */
export const GUEST_HISTORY_RAW_MAX = 256 * 1024;
/** Corrupt or oversized local rows must not enter app state unchanged. */
export const GUEST_QUERY_MAX = 100;
export const GUEST_ID_MAX = 100;

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function parse(raw: string | null): SearchHistoryEntry[] {
  if (!raw || raw.length > GUEST_HISTORY_RAW_MAX) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data
      .slice(0, GUEST_HISTORY_CAP)
      .flatMap((item): SearchHistoryEntry[] => {
        if (!item || typeof item !== 'object') return [];
        const row = item as Partial<SearchHistoryEntry>;
        if (
          typeof row.id !== 'string' || !row.id ||
          typeof row.query !== 'string' ||
          typeof row.mode !== 'string' ||
          typeof row.createdAt !== 'string'
        ) return [];
        if (!isPersistableMode(row.mode)) return [];
        const createdAt = new Date(row.createdAt);
        if (Number.isNaN(createdAt.getTime()) || !row.query.trim()) return [];

        const entity = sanitizeEntityRef(row.entity);
        const normalized: SearchHistoryEntry = {
          id: row.id.slice(0, GUEST_ID_MAX),
          query: row.query.trim().slice(0, GUEST_QUERY_MAX),
          mode: row.mode,
          createdAt: createdAt.toISOString(),
          ...(entity ? { entity } : {}),
        };
        return [normalized];
      });
  } catch {
    return [];
  }
}

export function listGuestHistory(): SearchHistoryEntry[] {
  return parse(storage()?.getItem(GUEST_HISTORY_KEY) ?? null);
}

export function addGuestHistory(
  query: string,
  mode: MapMode,
  entity?: SearchHistoryEntityRef,
): SearchHistoryEntry[] {
  const q = query.trim();
  const current = listGuestHistory();
  if (!q || !isPersistableMode(mode)) return current;
  const sanitized = sanitizeEntityRef(entity);
  const next: SearchHistoryEntry = {
    id: `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    query: q,
    mode,
    createdAt: new Date().toISOString(),
    ...(sanitized ? { entity: sanitized } : {}),
  };
  const rest = current.filter((item) => !(item.query === q && item.mode === mode));
  const items = [next, ...rest].slice(0, GUEST_HISTORY_CAP);
  try {
    storage()?.setItem(GUEST_HISTORY_KEY, JSON.stringify(items));
  } catch {
    // quota / private mode
  }
  return items;
}

export function clearGuestHistory(): void {
  try {
    storage()?.removeItem(GUEST_HISTORY_KEY);
  } catch {
    // ignore
  }
}

export interface GuestMergeOptions {
  /** Fetch implementation (browser fetch by default; injectable for tests). */
  fetchImpl?: typeof fetch;
  /** Cloud history rows already on the account; merge skips these. */
  cloud?: SearchHistoryEntry[];
  /** Load cloud rows when `cloud` is not supplied. */
  loadCloud?: () => Promise<SearchHistoryEntry[]>;
  /** Called once per successfully uploaded row. */
  onUploaded?: (item: SearchHistoryEntry) => void;
}

/**
 * Upload persistable guest rows the account does not already have.
 * Keeps the local copy as a browser mirror: failed rows stay local for a later
 * merge, and already-uploaded rows are skipped, so re-logins never duplicate.
 * Returns the rows uploaded (empty when nothing was needed).
 */
export async function mergeGuestHistoryIntoAccount(
  options: GuestMergeOptions = {},
): Promise<SearchHistoryEntry[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const local = listGuestHistory().filter((item) => isPersistableMode(item.mode));
  if (!local.length) return [];

  let cloud = options.cloud;
  if (!cloud) {
    if (!options.loadCloud) return [];
    try {
      cloud = await options.loadCloud();
    } catch {
      return []; // offline — keep local rows for a later merge
    }
  }

  const inCloud = new Set(cloud.map((item) => `${item.mode}:${item.query}`));
  const uploaded: SearchHistoryEntry[] = [];
  for (const item of local) {
    if (inCloud.has(`${item.mode}:${item.query}`)) continue;
    try {
      const res = await fetchImpl('/api/me/search-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: item.query,
          mode: item.mode,
          ...(item.entity ? { entity: item.entity } : {}),
        }),
      });
      if (!res.ok) continue;
      uploaded.push(item);
      options.onUploaded?.(item);
    } catch {
      // keep going; failed rows stay local for a later merge
    }
  }
  return uploaded;
}
