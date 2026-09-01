"use client";

// ============================================================
// useWorkViewport — 视口加载器 Hook(2026-08-22 no-fly 修订)
//
// 抽取自 map-shell(QA scan #6):视口加载器创建/调度 + 挂载对齐加载。
// - work:全量加载后无需视口请求——marker 池(catalog)首载一次取尽,
//   侧栏列表按视野的裁剪移到 map-shell 客户端(pois memo 按 mapBounds 过滤);
// - domain:随视角变化刷新(新视野并入累计池,视野外 POI 保留到 cap),无分类选择 → 视口移动不拉取;
// - moveend/zoomend 防抖调度,主加载在飞时置 pending 由主加载 finally 补跑;
// - 收藏 toggle 不移动相机(2026-08-22):moveend/zoomend 只来自用户操作,
//   直接防抖调度,无需任何程序化相机抑制(「收藏相机同步」状态机已随
//   saved-overlay-wipe 的触发源 setBounds 移除,ws1 saved-layer-nofly)。
// 共享 ref/state 全部由调用方(map-shell)传入,本 hook 不拥有数据,
// 保证与主加载 effect 的读写顺序、行为完全一致。
// ============================================================

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { FilterState, MapMode, POI } from "@/lib/types";
import type { MapView } from "@/lib/map-engine/types";
import { canonicalMode } from "@/lib/modes";
import { fetchPOIsForMode } from "@/lib/poi-service";
import { subscribeEngineBus } from "@/hooks/use-map-engine";
import {
  batchMatchesCurrentMode,
  createViewportLoader,
  DOMAIN_BATCH_SIZE,
  DOMAIN_POI_HARD_CAP,
  mergePreferringViewport,
  needsViewportAlign,
  VIEWPORT_DEBOUNCE_MS,
  type ViewportBounds,
  type ViewportLoader,
  type ViewportSnapshot,
} from "@/lib/viewport-search";
import { readModeCache, writeModeCache } from "@/lib/mode-cache";

/**
 * 当前地图视野快照(center+zoom+bounds);地图未就绪返回 null。写缓存/对齐判定共用。
 * 兼容两种形态(ws-c):
 * - MapView/厂商 map 对象:getCenter()/getZoom()/getBounds()(厂商 LngLat/Bounds 方法形态);
 * - 已归一化的 plain object:{ center: {lng,lat}, zoom, bounds: {west,south,east,north} }。
 */
export function readMapViewSnapshot(map: any): ViewportSnapshot | null {
  if (!map) return null;
  // plain-object 分支(MapView 归一化视图/测试 mock):center.lng 为 number 即命中
  if (
    map.center &&
    typeof map.center.lng === 'number' &&
    typeof map.center.lat === 'number' &&
    typeof map.zoom === 'number'
  ) {
    let bounds: ViewportBounds | null = null;
    const b = map.bounds;
    if (b && [b.west, b.south, b.east, b.north].every((n) => typeof n === 'number')) {
      bounds = { west: b.west, south: b.south, east: b.east, north: b.north };
    }
    return { center: { lng: map.center.lng, lat: map.center.lat }, zoom: map.zoom, bounds };
  }
  // 厂商对象形态(向后兼容):getCenter()/getZoom()/getBounds()
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
    catalogRef,
    viewStateRef,
    setCatalog,
    setNoMoreData,
    setPageOffset,
  } = deps;

  const viewportLoaderRef = useRef<ViewportLoader | null>(null);

  // ---- 引擎视图订阅(2026-08-22 ws-b,bug 4「切回 POI 消失」修复)----
  // 视口加载器的 moveend/zoomend 监听原本只随 mapReady 绑定一次 → 引擎切换后
  // 新 view 永远拿不到视口监听(旧 view 已销毁,mapReady 恒 true 不触发重绑),
  // domain 视口刷新 / 挂载对齐在切换后静默失效。经引擎总线(use-map-engine
  // publishEngineBus)订阅活跃 view 实例,作为重绑的 effect 依赖:引擎切换
  // setView → 总线重发 → 本 hook 重渲染 → 监听在**新 view** 上重建
  // (mapInstance.current 在 map-shell 视图接线 effect 中已同步为同一实例)。
  const [engineView, setEngineView] = useState<MapView | null>(null);
  useEffect(() => subscribeEngineBus((value) => setEngineView(value?.view ?? null)), []);

  // ---- 工作模式视口按需加载(仅 work;Domain 保持刷新才更新)----
  useEffect(() => {
    if (!mapReady) return;
    const map = mapInstance.current;
    if (!map) return;

    const loader = createViewportLoader({
      delayMs: VIEWPORT_DEBOUNCE_MS,
      load: async (signal) => {
        const v = viewStateRef.current;
        if (!v.geoSettled) return;
        if (loadingRef.current) {
          // 主加载(首屏/刷新/加载更多)在飞时,不静默丢弃视口刷新:
          // 置 pending 标记,主加载 finally 会补跑本次刷新(Bug 7 次要问题)。
          viewportRefreshPendingRef.current = true;
          return;
        }
        const mapInst = mapInstance.current;
        // 与 readMapViewSnapshot 同源(兼容 MapView 归一化 / 厂商对象两种形态)
        const snap = readMapViewSnapshot(mapInst);
        const bounds = snap?.bounds ?? null;
        const center = snap?.center ?? null;
        const zoom = snap?.zoom ?? 0;
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
        // Domain:随视角变化刷新——按 live bounds 取新视野批次,再并入累计池
        // (mergePreferringViewport:新视野优先,视野外旧点保留到 cap)。
        // 旧 existing:[] + setCatalog(batch) 会把外地/外区 POI 整表换成当前框,
        // 人在杭州缩放时外地点「总是消失」。
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
          // 本世代捕获(必须取递增后的值):后续任何新刷新再 +1 → 本世代在飞
          // 批次的 onBatch 与 noMore 落地都因 epoch 不匹配被丢弃(见 onBatch)。
          const epoch = viewportEpochRef.current;
          // pageOffset 状态归零,并跳过其触发的重复主加载
          // (skipFetch 由 load() 先消费;offset 已为 0 时 setPageOffset 是
          // 同值 no-op,不 arm skipFetch,避免吞掉下一次合法的滚动加载)
          if (v.pageOffset !== 0) skipFetchRef.current = true;
          setPageOffset(0);
          let acceptedNonEmptyBatch = false;
          try {
            const result = await fetchPOIsForMode({
              mode,
              query: v.query || undefined,
              filters: v.filters, // 分类驱动加载(poi-category-loading)
              center: center ?? v.searchOrigin ?? undefined,
              zoom,
              bounds,
              existing: [], // 本轮只要新视野批次;与旧池的合并在 onBatch
              addCap: DOMAIN_BATCH_SIZE,
              pageOffset: 0,
              // loader 的协作取消信号透传:dispose(卸载/重绑)后在飞请求
              // 的批次经 onBatch 的 signal 自查丢弃(poi-service 已检查部分
              // 路径,这里兜底闭环——本地库路径 fetchLocalPois 不查 signal)
              signal,
              onBatch: (batch) => {
                // 模式守卫:同上——域名刷新批次不得落进切换后的工作模式
                if (!batchMatchesCurrentMode(viewStateRef.current.mode, mode)) return;
                // 过期世代丢弃(epoch guard):本批次所属视野加载开始后,又有新
                // 视野刷新(+1)→ 旧请求后到只能覆盖新视野 → 直接丢弃,
                // 不 setCatalog、不写 mode cache、不置 noMore。
                if (epoch !== viewportEpochRef.current) return;
                // dispose 让路:loader 已销毁(卸载/引擎重绑)时不落地任何副作用
                if (signal?.cancelled) return;
                // 空批次 ≠ 无数据(ws1 saved-layer-wipe 结构性修复,替代时间窗兜底):
                // 不把 catalog 置空——保留旧目录 = 保留 marker 池实例(b2「只增不删、
                // 跨视口保留」),收藏图层 toggle 的程序化相机移动即使有 settle 事件
                // 漏出,空批次也不会清空目录、销毁全部 pin(controller.clear 只删不建);
                // 目录只在真正搜索/非空批次(新视野新数据)时重建,空视野列表仍显示
                // 旧结果,由下一次非空刷新替换。
                if (batch.length === 0) return;
                // 并入累计池:新视野优先,外地/外区旧点保留(cap 满才淘汰视野外)。
                const next = mergePreferringViewport(
                  catalogRef.current,
                  batch,
                  bounds,
                  DOMAIN_POI_HARD_CAP,
                );
                catalogRef.current = next;
                setCatalog(next);
                acceptedNonEmptyBatch = true;
              },
            });
            // 完整请求成功后才提交视口缓存:分页中间批次可能在后续页失败/取消,
            // 不得把部分 catalog 当作完整快照;提交前重新检查当前世代、模式和 dispose。
            if (signal?.cancelled || epoch !== viewportEpochRef.current) return;
            if (!batchMatchesCurrentMode(viewStateRef.current.mode, mode)) return;
            if (acceptedNonEmptyBatch && result.cacheable !== false) {
              const latest = viewStateRef.current;
              writeModeCache({
                mode,
                catalog: catalogRef.current,
                pageOffset: 0,
                searchOrigin: latest.searchOrigin,
                query: latest.query,
                filters: latest.filters,
                sort: latest.sort,
                viewport: snapshot ?? undefined,
              });
            }
            // 过期世代/dispose 后 noMore 同样不得落地(旧视野结果污染新刷新状态)
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
      // 直接防抖调度:收藏 toggle 不再移动相机(ws1 saved-layer-nofly),
      // moveend/zoomend 只来自用户操作/其他程序化移动,无需抑制。
      loader.schedule();
    };
    viewportLoaderRef.current = loader;
    // MapView.on 返回解绑函数(旧 AMap map.off 直调已不适用)
    const offMoveEnd = map.on("moveend", onViewChange);
    const offZoomEnd = map.on("zoomend", onViewChange);
    return () => {
      loader.dispose();
      viewportLoaderRef.current = null;
      offMoveEnd?.();
      offZoomEnd?.();
    };
    // engineView(引擎总线活跃视图):引擎切换后重绑视口监听(见上订阅注释);
    // 无总线(useMapEngine 未挂载)时恒 null,退化为原 mapReady 一次性绑定
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖见注释
  }, [mapReady, engineView]);

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
    // engineView:引擎切换后重跑对齐判定(切换重建 view 后相机可能被 createView
    // 吸附,缓存视野与当前视野的关系需重新评估;平时 mapReady/geoSettled/mode
    // 不变 → 零重跑)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载/定位就绪/切模式/切引擎时检查
  }, [mapReady, geoSettled, mode, engineView]);

  return { viewportLoaderRef };
}
