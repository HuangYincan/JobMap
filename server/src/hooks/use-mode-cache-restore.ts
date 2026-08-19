"use client";

// ============================================================
// useModeCacheRestore — 会话缓存还原 Hook
//
// 刷新页面后仍恢复本模式累计池,不重打高德。只在首屏读一次缓存
// (deps 恒空,与挂载时 mode 绑定,同 map-shell 原语义)。
// ============================================================

import { useEffect, type MutableRefObject } from "react";
import type { FilterState, MapMode, POI } from "@/lib/types";
import { readModeCache } from "@/lib/mode-cache";

export interface ModeCacheRestoreDeps {
  mode: MapMode;
  skipFetchRef: MutableRefObject<boolean>;
  catalogRef: MutableRefObject<POI[]>;
  noMoreRef: MutableRefObject<boolean>;
  setCatalog: (catalog: POI[]) => void;
  setPageOffset: (offset: number) => void;
  setSearchOrigin: (origin: { lng: number; lat: number } | null) => void;
  setQuery: (query: string) => void;
  setFilters: (filters: FilterState) => void;
  setSort: (sort: string) => void;
  setNoMoreData: (noMore: boolean) => void;
}

export function useModeCacheRestore(deps: ModeCacheRestoreDeps) {
  const {
    mode,
    skipFetchRef,
    catalogRef,
    noMoreRef,
    setCatalog,
    setPageOffset,
    setSearchOrigin,
    setQuery,
    setFilters,
    setSort,
    setNoMoreData,
  } = deps;

  // 会话缓存：刷新页面后仍恢复本模式累计池，不重打高德
  useEffect(() => {
    const cached = readModeCache(mode);
    if (!cached) return;
    skipFetchRef.current = true;
    catalogRef.current = cached.catalog;
    setCatalog(cached.catalog);
    setPageOffset(cached.pageOffset);
    setSearchOrigin(cached.searchOrigin);
    setQuery(cached.query);
    setFilters(cached.filters);
    if (cached.sort) setSort(cached.sort);
    // 恢复缓存不经主 load,这里复位 noMore,避免上一会话的「没有更多结果」粘住
    noMoreRef.current = false;
    setNoMoreData(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在首屏读一次
  }, []);
}
