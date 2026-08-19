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
  /** 列表池(wsv):还原时与 catalog 同源(全量池),挂载对齐的视口加载随后只换列表 */
  listCatalogRef: MutableRefObject<POI[]>;
  noMoreRef: MutableRefObject<boolean>;
  setCatalog: (catalog: POI[]) => void;
  setListCatalog: (catalog: POI[]) => void;
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
    listCatalogRef,
    noMoreRef,
    setCatalog,
    setListCatalog,
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
    // 还原即列表池 = 全量 marker 池(还原后 marker 不少于还原前);
    // 挂载对齐的视口加载随后把列表换成当前视野内容
    listCatalogRef.current = cached.catalog;
    setListCatalog(cached.catalog);
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
