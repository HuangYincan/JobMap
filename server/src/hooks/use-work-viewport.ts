"use client";

// ============================================================
// useWorkViewport — 视口加载器 Hook(2026-08-20 修订)
//
// 抽取自 map-shell(QA scan #6):视口加载器创建/调度 + 挂载对齐加载。
// - work:全量加载后无需视口请求——marker 池(catalog)首载一次取尽,
//   侧栏列表按视野的裁剪移到 map-shell 客户端(pois memo 按 mapBounds 过滤);
// - domain:随视角变化刷新(替换+淡入),无分类选择 → 视口移动不拉取;
// - moveend/zoomend 防抖调度,主加载在飞时置 pending 由主加载 finally 补跑;
// - 程序化相机移动(toggle 收藏图层)在抑制窗口内跳过刷新。
// 共享 ref/state 全部由调用方(map-shell)传入,本 hook 不拥有数据,
// 保证与主加载 effect 的读写顺序、行为完全一致。
// ============================================================

import { useEffect, useRef, type MutableRefObject } from "react";
import type { FilterState, MapMode, POI } from "@/lib/types";
import { canonicalMode } from "@/lib/modes";
import { fetchPOIsForMode } from "@/lib/poi-service";
import {
  batchMatchesCurrentMode,
  catalogCoversView,
  createViewportLoader,
  DOMAIN_BATCH_SIZE,
  needsViewportAlign,
  VIEWPORT_DEBOUNCE_MS,
  type ViewportBounds,
  type ViewportLoader,
  type ViewportSnapshot,
} from "@/lib/viewport-search";
import { readModeCache, writeModeCache } from "@/lib/mode-cache";

/** 程序化相机移动(toggle 收藏图层 setBounds/setCenter)后抑制视口刷新的窗口(ms)。
 *  setBounds 会连续触发 moveend + zoomend,两事件都落在该窗口内被吞掉(w5 saved-overlay-wipe)。 */
export const VIEWPORT_SUPPRESS_MS = 500;

/** 当前地图视野快照(center+zoom+bounds);地图未就绪返回 null。写缓存/对齐判定共用 */
export function readMapViewSnapshot(map: any): ViewportSnapshot | null {
  if (!map) return null;
  const centerObj = typeof map.getCenter === "function" ? map.getCenter() : null;
  const center =
    centerObj && typeof centerObj.getLng === "function"
      ? { lng: centerObj.getLng(), lat: centerObj.getLat() }
      : null;
  if (!center) return null;
  const zoom = typeof map.getZoom === "function" ? Math.round(map.getZoom()) : 0;
  let bounds: ViewportBounds | null = null;
  const b = typeof map.getBounds === "function" ? map.getBounds() : null;
  if (b) {
    const sw = b.getSouthWest?.() ?? b.southwest;
    const ne = b.getNorthEast?.() ?? b.northeast;
    const west = sw?.getLng?.() ?? sw?.lng;
    const south = sw?.getLat?.() ?? sw?.lat;
    const east = ne?.getLng?.() ?? ne?.lng;
    const north = ne?.getLat?.() ?? ne?.lat;
    if ([west, south, east, north].every((n) => typeof n === "number")) {
      bounds = { west, south, east, north };
    }
  }
  return { center, zoom, bounds };
}

/** viewStateRef 的内容形态(主加载/视口加载共享,避免闭包过期)。 */
export interface WorkViewportState {
  mode: MapMode;
  query: string;
  filters: FilterState;
  sort: string;
  searchOrigin: { lng: number; lat: number } | null;
  userLocation: { lng: number; lat: number } | null;
  pageOffset: number;
  geoSettled: boolean;
}

export interface WorkViewportDeps {
  mapInstance: MutableRefObject<any>;
  mapReady: boolean;
  geoSettled: boolean;
  mode: MapMode;
  loadingRef: MutableRefObject<boolean>;
  viewportRefreshPendingRef: MutableRefObject<boolean>;
  noMoreRef: MutableRefObject<boolean>;
  viewportEpochRef: MutableRefObject<number>;
  skipFetchRef: MutableRefObject<boolean>;
  suppressViewportRefreshUntilRef: MutableRefObject<number>;
  catalogRef: MutableRefObject<POI[]>;
  viewStateRef: MutableRefObject<WorkViewportState>;
  setCatalog: (catalog: POI[]) => void;
  setNoMoreData: (noMore: boolean) => void;
  setPageOffset: (offset: number) => void;
}

export function useWorkViewport(
  deps: WorkViewportDeps
): { viewportLoaderRef: MutableRefObject<ViewportLoader | null> } {
  const {
    mapInstance,
    mapReady,
    geoSettled,
    mode,
    loadingRef,
    viewportRefreshPendingRef,
    noMoreRef,
    viewportEpochRef,
    skipFetchRef,
    suppressViewportRefreshUntilRef,
    catalogRef,
    viewStateRef,
    setCatalog,
    setNoMoreData,
    setPageOffset,
  } = deps;

  const viewportLoaderRef = useRef<ViewportLoader | null>(null);

  // ---- 工作模式视口按需加载(仅 work;Domain 保持刷新才更新)----
  useEffect(() => {
    if (!mapReady) return;
    const map = mapInstance.current;
    if (!map) return;

    const loader = createViewportLoader({
      delayMs: VIEWPORT_DEBOUNCE_MS,
      load: async () => {
        const v = viewStateRef.current;
        if (!v.geoSettled) return;
        if (loadingRef.current) {
          // 主加载(首屏/刷新/加载更多)在飞时,不静默丢弃视口刷新:
          // 置 pending 标记,主加载 finally 会补跑本次刷新(Bug 7 次要问题)。
          viewportRefreshPendingRef.current = true;
          return;
        }
        const mapInst = mapInstance.current;
        const centerObj = typeof mapInst?.getCenter === "function" ? mapInst.getCenter() : null;
        const center =
          centerObj && typeof centerObj.getLng === "function"
            ? { lng: centerObj.getLng(), lat: centerObj.getLat() }
            : null;
        const zoom =
          typeof mapInst?.getZoom === "function" ? Math.round(mapInst.getZoom()) : 0;
        const b = typeof mapInst?.getBounds === "function" ? mapInst.getBounds() : null;
        let bounds: ViewportBounds | null = null;
        if (b) {
          const sw = b.getSouthWest?.() ?? b.southwest;
          const ne = b.getNorthEast?.() ?? b.northeast;
          const west = sw?.getLng?.() ?? sw?.lng;
          const south = sw?.getLat?.() ?? sw?.lat;
          const east = ne?.getLng?.() ?? ne?.lng;
          const north = ne?.getLat?.() ?? ne?.lat;
          if ([west, south, east, north].every((n) => typeof n === "number")) {
            bounds = { west, south, east, north };
          }
        }
        if (!bounds) return;
        // 本批次数据覆盖的视野快照(与 bounds 同一时刻捕获;写缓存用)
        const snapshot: ViewportSnapshot | null = center ? { center, zoom, bounds } : null;
        const mode = canonicalMode(v.mode);
        if (mode === "work") {
          // 2026-08-20 修复:work 全量加载后无视口请求——marker 池(catalog)
          // 首载一次取尽(主加载),侧栏列表按视野的裁剪移到 map-shell 客户端
          // (pois memo 按 mapBounds 过滤)。moveend/zoomend 只驱动 domain。
          return;
        }
        // Domain:随视角变化刷新(替换+淡入)——按 live bounds 重新取第一批,
        // existing=[] 清空旧列表,offset 归零(新视野 = 新一批)。
        if (mode === "domain") {
          // 分类门控(poi-category-loading):无分类选择 → 视口移动不拉取
          // (目录保持空、无 domain marker);搜索(query)豁免。已选分类 →
          // 按当前选中分类重拉新视图(filters 下行,数据源按类过滤)。
          if (!v.query && !v.filters?.category) {
            return;
          }
          // 新视野重新分页:清除上一视野的「没有更多结果」状态
          noMoreRef.current = false;
          setNoMoreData(false);
          // 视口世代 +1:主加载在飞的对旧视野追加批次将被 epoch 校验丢弃
          viewportEpochRef.current += 1;
          // pageOffset 状态归零,并跳过其触发的重复主加载
          // (skipFetch 由 load() 先消费;offset 已为 0 时 setPageOffset 是
          // 同值 no-op,不 arm skipFetch,避免吞掉下一次合法的滚动加载)
          if (v.pageOffset !== 0) skipFetchRef.current = true;
          setPageOffset(0);
          try {
            const result = await fetchPOIsForMode({
              mode,
              query: v.query || undefined,
              filters: v.filters, // 分类驱动加载(poi-category-loading)
              center: v.searchOrigin ?? undefined,
              zoom,
              bounds,
              existing: [], // 替换:新视野清空旧卡片
              addCap: DOMAIN_BATCH_SIZE,
              pageOffset: 0,
              onBatch: (batch) => {
                // 模式守卫:同上——域名刷新批次不得落进切换后的工作模式
                if (!batchMatchesCurrentMode(viewStateRef.current.mode, mode)) return;
                // 空批次三态(ws1 Bug1):同 work 分支——真空清空,否则保留旧目录
                if (batch.length === 0 && catalogRef.current.length > 0) {
                  if (!catalogCoversView(catalogRef.current, bounds)) {
                    catalogRef.current = [];
                    setCatalog([]);
                  }
                  return;
                }
                catalogRef.current = batch;
                setCatalog(batch);
                writeModeCache({
                  mode,
                  catalog: batch,
                  pageOffset: 0,
                  searchOrigin: v.searchOrigin,
                  query: v.query,
                  filters: v.filters,
                  sort: v.sort,
                  viewport: snapshot ?? undefined,
                });
              },
            });
            // 分类全量加载带 total:新视野是否已到底由循环结果决定
            // (短页/total 取尽;硬顶 1000 时 noMore=false,由 atCap 停止哨兵)
            if (result.noMore !== undefined) {
              noMoreRef.current = result.noMore;
              setNoMoreData(result.noMore);
            }
          } catch (err) {
            console.warn("[map-shell] domain viewport load failed:", err);
          }
          return;
        }
      },
    });

    const onViewChange = () => {
      // w5:程序化相机移动(toggle 收藏图层 setBounds)触发 moveend/zoomend 时,
      // 在抑制窗口内跳过视口刷新,防止空批次整体替换清空目录(收藏图层启停 bug)。
      if (suppressViewportRefreshUntilRef.current > Date.now()) return;
      loader.schedule();
    };
    viewportLoaderRef.current = loader;
    map.on("moveend", onViewChange);
    map.on("zoomend", onViewChange);
    return () => {
      loader.dispose();
      viewportLoaderRef.current = null;
      map.off?.("moveend", onViewChange);
      map.off?.("zoomend", onViewChange);
    };
  }, [mapReady]);

  // ---- 挂载对齐加载(ws1 Bug1 视口)----
  // mode 级会话缓存还原的是「上次会话视野」的目录(可能停在别的城市)。刷新后地图
  // 初始化固定在杭州 zoom 13,geolocation 被拒时不产生任何 moveend——若缓存视野
  // 快照与当前地图视野显著不符(旧缓存无快照一律视为不符),主动调度一次当前视野
  // 的视口加载,不再等用户手动拖动(否则当前视野整城空白直到 moveend)。
  useEffect(() => {
    if (!mapReady || !geoSettled) return;
    if (!viewportLoaderRef.current) return;
    const cached = readModeCache(mode);
    if (!cached || cached.catalog.length === 0) return;
    const snap = readMapViewSnapshot(mapInstance.current);
    if (!snap) return;
    if (!needsViewportAlign(cached.viewport, snap.center, snap.zoom)) return;
    viewportLoaderRef.current.schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载/定位就绪/切模式时检查
  }, [mapReady, geoSettled, mode]);

  return { viewportLoaderRef };
}
