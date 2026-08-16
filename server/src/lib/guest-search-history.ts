// ============================================================
// Guest Recent — browser localStorage only
//
// Signed-in history stays on /api/me/search-history.
// Do not reuse the stale tech/10 key `search_history`.
// ============================================================

import type { SearchHistoryEntry } from './account.ts';
import type { MapMode } from './types.ts';
import { isPersistableMode } from './persistable.ts';

export const GUEST_HISTORY_KEY = 'dm.guest-search-history.v1';
export const GUEST_HISTORY_CAP = 30;

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function parse(raw: string | null): SearchHistoryEntry[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data
      .filter((item): item is SearchHistoryEntry => {
        if (!item || typeof item !== 'object') return false;
        const row = item as SearchHistoryEntry;
        return Boolean(row.id && row.query && row.mode && row.createdAt);
      })
      .filter((item) => isPersistableMode(item.mode));
  } catch {
    return [];
  }
}

export function listGuestHistory(): SearchHistoryEntry[] {
  return parse(storage()?.getItem(GUEST_HISTORY_KEY) ?? null);
}

export function addGuestHistory(query: string, mode: MapMode): SearchHistoryEntry[] {
  const q = query.trim();
  const current = listGuestHistory();
  if (!q || !isPersistableMode(mode)) return current;
  const next: SearchHistoryEntry = {
    id: `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    query: q,
    mode,
    createdAt: new Date().toISOString(),
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
