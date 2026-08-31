"use client";

// ============================================================
// useModeCacheRestore — 会话缓存还原 Hook
//
// 刷新页面后仍恢复本模式累计池,不重打高德。只在首屏读一次缓存
// (deps 恒空,与挂载时 mode 绑定,同 map-shell 原语义)。
// ============================================================

import { useEffect, useRef, type MutableRefObject } from "react";
import type { FilterState, MapMode, POI } from "@/lib/types";
import { readModeCache } from "@/lib/mode-cache";
import { canonicalMode } from "@/lib/modes";

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

  // 只跑一次守卫(poi-click-vanish,2026-08-26):[]-effect 的语义是「首屏读
  // 一次缓存」,但 dev StrictMode / dynamic 面板挂载触发 MapShell fiber
  // disconnect→reconnect(use-map-engine keepalive 链)时,React 会把
  // mount-only effects 当作未执行**重放**——restore 分支二次执行会把
  // sessionStorage 快照盖回活目录:若快照是全量加载中途的残缺批次(onBatch
  // 曾逐页写缓存),work 池塌缩 → visiblePOIIds 清空 → 屏上全部 marker 隐藏
  // + 列表归零,且因主加载缓存早退永久不恢复(用户实测:深圳点快手 → 全部
  // POI 消失)。ref 守卫让重放短路,活目录不被覆盖。
  const didRestoreRef = useRef(false);

  // 会话缓存：刷新页面后仍恢复本模式累计池，不重打高德
  useEffect(() => {
    if (didRestoreRef.current) return; // fiber reconnect 重放短路(poi-click-vanish)
    didRestoreRef.current = true;
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
    // noMore 复位:work 全量池恢复即取尽(2026-08-20 修订)——缓存 = 上次全量
    // 加载结果,没有「更多」可分页,置真避免「加载更多」死按钮;domain 保持
    // 复位(视口对齐后由加载结果判定)。
    if (canonicalMode(mode) === "work") {
      noMoreRef.current = true;
      setNoMoreData(true);
    } else {
      noMoreRef.current = false;
      setNoMoreData(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在首屏读一次
  }, []);
}
