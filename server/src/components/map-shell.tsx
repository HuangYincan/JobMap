"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styles from "./map-shell.module.css";
import { getBrowserLanguage, t, type Language } from "@/lib/i18n";
import type { FilterState, MapMode, POI } from "@/lib/types";
import { canonicalMode, getMode, replayRecentSearch } from "@/lib/modes";
import { fetchPOIsForMode } from "@/lib/poi-service";
import { getCurrentPosition, suggestionToDomainPoi } from "@/lib/amap-api";
import { INTERNSHIP_SEED } from "@/lib/seed-data";
import { applyTagSuggestion, distanceFilterMeters, metersToDistanceKm, pointAtDistanceEast, runPOIPipeline, widenSearchScope } from "@/lib/search";
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, isNearDefaultCenter } from "@/lib/camera-center";
import { suggestKeyAction } from "@/lib/suggest-nav";
import { fetchPOIDetail } from "@/lib/api";
import { haversineDistance, isRecruitmentMode, isRecruitmentPOI, formatDistance, type Position } from "@/lib/types";
import { batchMatchesCurrentMode, catalogCoversView, inBounds, mergePoisById, MORE_PAGE_SIZE, POI_SOFT_CAP, DOMAIN_POI_HARD_CAP, DOMAIN_BATCH_SIZE, type ViewportBounds } from "@/lib/viewport-search";
import { loadWorkViewport, WORK_FULL_LOAD_MAX_PAGES } from "@/lib/viewport-search";
import { maxTierForZoom, TIER_DEFAULT } from "@/lib/lod";
import { clearModeCache, readModeCache, writeModeCache } from "@/lib/mode-cache";
import type { AccountUser, ApplicationRecord, NotificationRecord, SavedPlace, SearchHistoryEntry, SearchHistoryEntityRef, UserPreferences } from "@/lib/account";
import { entityRefFromSelection, initialsFromName } from "@/lib/account";
import { isPersistableMode, isPersistablePoi } from "@/lib/persistable";
import { addGuestHistory, clearGuestHistory, listGuestHistory, mergeGuestHistoryIntoAccount } from "@/lib/guest-search-history";
import {
  MAP_STYLE_KEY,
  mergeMapPois,
  parseMapStyle,
  readMapStylePref,
  resolveSavedForFly,
  writeMapStylePref,
  type BasemapStyle,
} from "@/lib/saved-overlay";
import { usePOIMap } from "@/hooks/use-poi-map";
import { useModeCacheRestore } from "@/hooks/use-mode-cache-restore";
import { useSavedLayer } from "@/hooks/use-saved-layer";
import { useSearchState } from "@/hooks/use-search-state";
import { useWorkViewport, readMapViewSnapshot, type WorkViewportState } from "@/hooks/use-work-viewport";
import { useMapEngine } from "@/hooks/use-map-engine";
import type { MapMarkerOptions, MapView } from "@/lib/map-engine/types";
import { CLUSTER_DRILL_ZOOM, clusterCities, poiCity } from "@/lib/city-cluster";
import { clusterZoomForZoom, createCityClusterMarker } from "@/lib/map-markers";
import { SecondarySidebar, suggestionDisplayIcon, candidateCategoriesFor, pickCategoryFilter, type SearchSuggestion } from "./secondary-sidebar";
import { POIList } from "./poi-list";
import { ModeSwitcher } from "./mode-switcher";
import { FilterPanel } from "./filter-panel";
import { SortSelector } from "./sort-selector";
import { createAgentBridge, type MapBridge } from "@/lib/agent-map-bridge";
import AgentBall from "./agent-ball";

const POIDetailView = dynamic(() => import("./poi-detail").then((mod) => mod.POIDetailView));
const JdPanel = dynamic(() => import("./jd-panel").then((mod) => mod.JdPanel));
const AuthModal = dynamic(() => import("./auth-modal").then((mod) => mod.AuthModal));
const ProfilePanel = dynamic(() => import("./account-panel").then((mod) => mod.ProfilePanel));
const RecentPanel = dynamic(() => import("./recent-panel").then((mod) => mod.RecentPanel));
const SavedList = dynamic(() => import("./saved-panel").then((mod) => mod.SavedList));
const SavedPanel = dynamic(() => import("./saved-panel").then((mod) => mod.SavedPanel));
const LayersPanel = dynamic(() => import("./layers-panel").then((mod) => mod.LayersPanel));

/**
 * Rail 面板懒加载模块清单:与上方 dynamic() 声明同源路径(SavedList/SavedPanel 同文件去重)。
 * MapShell 挂载时用 prefetchAllRail() 一次性预载全部,把 dev 冷启动的「首点按需编译」
 * 提前到页面加载时,消除 Turbopack dev 下首点触发的整页刷新(next dev 客户端
 * performFullReload)。生产构建预编译不受影响;重复预载幂等。
 */
const RAIL_PANEL_MODULES = {
  "poi-detail": () => import("./poi-detail"),
  "jd-panel": () => import("./jd-panel"),
  "auth-modal": () => import("./auth-modal"),
  "account-panel": () => import("./account-panel"),
  "recent-panel": () => import("./recent-panel"),
  "saved-panel": () => import("./saved-panel"),
  "layers-panel": () => import("./layers-panel"),
} as const satisfies Record<string, () => Promise<unknown>>;

/** 悬停/聚焦兜底:按面板名预载对应模块子集 */
function prefetchRail(panel: "layers" | "saved" | "recent" | "profile" | "auth" | "detail") {
  if (panel === "layers") void RAIL_PANEL_MODULES["layers-panel"]();
  else if (panel === "saved") void RAIL_PANEL_MODULES["saved-panel"]();
  else if (panel === "recent") void RAIL_PANEL_MODULES["recent-panel"]();
  else if (panel === "profile") void RAIL_PANEL_MODULES["account-panel"]();
  else if (panel === "auth") void RAIL_PANEL_MODULES["auth-modal"]();
  else {
    void RAIL_PANEL_MODULES["poi-detail"]();
    void RAIL_PANEL_MODULES["jd-panel"]();
  }
}

/** 挂载时预载全部 rail 面板 chunk(消除 dev 冷启动首点整页刷新) */
function prefetchAllRail() {
  for (const load of Object.values(RAIL_PANEL_MODULES)) void load();
}

type DrawerState = "mini" | "half" | "full";
type RailPanel = "explore" | "recent" | "saved" | "layers" | "profile" | null;

/** 移动抽屉手势(跟手拖动):三态高度(mini px / half·full 按 vh 计算) */
const DRAWER_MINI_H = 96;
const DRAWER_HALF_RATIO = 0.42;
/** 快滑判定阈值(px/s):超过则直接吸附到 full(上)/mini(下) */
const DRAWER_FLING_V = 900;

/** 移动端 topTools 工具按钮(指南针/定位)尺寸与顶部偏移 */
const DRAWER_TOOL_BUTTON_H = 40;
const DRAWER_TOP_MIN = 12;

/** 运行时读取 env(safe-area-inset-top)(探测元素实测 padding-top);无安全区返回 0 */
function readSafeAreaTop(): number {
  if (typeof window === "undefined" || typeof document === "undefined") return 0;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;top:0;left:-9999px;width:0;height:0;padding-top:env(safe-area-inset-top);pointer-events:none;visibility:hidden;";
  document.documentElement.appendChild(probe);
  const px = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return px > 0 ? px : 0;
}

/** 指南针中心 Y(移动端 topTools 组):top 偏移 + 按钮高度一半 */
function compassCenterY(safeTop: number): number {
  return Math.max(DRAWER_TOP_MIN, safeTop) + DRAWER_TOOL_BUTTON_H / 2;
}

/** 全开抽屉高度:顶边 = 指南针中心 Y(对齐 CSS calc(100svh - max(12px, env(safe-area-inset-top)) - 20px)) */
function drawerFullHeight(vh: number, safeTop: number): number {
  return vh - compassCenterY(safeTop);
}

/** 慢拖松手:按当前位置取最近的三态 */
function nearestDrawerState(h: number, half: number, full: number): DrawerState {
  const d = (a: number) => Math.abs(h - a);
  return d(DRAWER_MINI_H) <= d(half) && d(DRAWER_MINI_H) <= d(full)
    ? "mini"
    : d(half) <= d(full)
      ? "half"
      : "full";
}

function readLngLat(
  value?: { lng?: number; lat?: number; getLng?: () => number; getLat?: () => number } | null,
): { lng: number; lat: number } | null {
  if (!value) return null;
  const lng = typeof value.getLng === "function" ? value.getLng() : value.lng;
  const lat = typeof value.getLat === "function" ? value.getLat() : value.lat;
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  return { lng, lat };
}

/** 飞行到位置(引擎契约 view.flyTo;AMap 内部 setZoomAndCenter 600ms 动画,与旧实现同语义) */
function flyToLocation(view: MapView | null, lng: number, lat: number, zoom = 16) {
  if (!view) return;
  view.flyTo({ center: { lng, lat }, zoom });
}

/** MapViewEvent 闭合联合之外的事件(rotatechange/dragstart/zoomstart/mousemove/mouseup 等)
 *  经 view.on 运行时转发(契约扩展后收口类型,TODO 限期迁移)。返回解绑函数。
 *  事件载荷是厂商形态,回调参数用 any(与 map-shell 既有事件回调同风格)。 */
function onViewEvent(view: MapView | null, event: string, cb: (e: any) => void): () => void {
  if (!view) return () => {};
  const on = view.on as unknown as (e: string, cb: (e: any) => void) => () => void;
  return on(event, cb);
}

/** 初始底图样式:系统深色偏好 + 用户显式 pref(与旧 createMap 内 readMapStylePref 同口径) */
function readInitialMapStyle(): BasemapStyle {
  const system: BasemapStyle =
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "whitesmoke"
      : "normal";
  return readMapStylePref(system);
}

function Icon({ name }: { name: "search" | "layers" | "bookmark" | "grid" | "history" | "menu" | "sidebar" | "chevronLeft" | "compass" | "locate" | "person" | "login" | "logout" }) {
  const paths: Record<string, string> = {
    search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm6-2 4 4",
    layers: "m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5",
    bookmark: "M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4-6 4V4Z",
    grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
    history: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2",
    menu: "M3 6h18M3 12h18M3 18h18",
    sidebar: "M5 4.5h14A2.5 2.5 0 0 1 21.5 7v10a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 17V7A2.5 2.5 0 0 1 5 4.5ZM9 5v14",
    chevronLeft: "m14.5 5-7 7 7 7",
    compass: "m12 2 3 10-10 3-3-10 10-3Z",
    locate: "M12 2v4m0 12v4M2 12h4m12 0h4m-6 6a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z",
    person: "M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-4.4 0-8 2.1-8 4.7V21h16v-2.3c0-2.6-3.6-4.7-8-4.7Z",
    login: "M10 17l5-5-5-5M15 12H3m12-7h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4",
    logout: "M14 17l5-5-5-5M19 12H9m0-7H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4",
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}

export function MapShell() {  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<MapView | null>(null);
  const distanceCircleRef = useRef<any>(null);
  const distanceHandleRef = useRef<any>(null);
  const draggingDistanceRef = useRef(false);
  const scaleControlRef = useRef<any>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pendingSearchFocus = useRef(false);
  const catalogRef = useRef<POI[]>([]);
  const poisRef = useRef<POI[]>([]);
  const [geoSettled, setGeoSettled] = useState(false);
  const ignoreNextMapClick = useRef(false);
  /** 用户是否已手动移动/缩放过相机(拖拽/滚轮/手势,或 flyTo 等明确相机操作)。
   * 挂载 geolocation 回调晚落地时不再用 setCenter 抢占相机(Bug3)。
   * 仅相机手势/相机操作路径置位:pin 点击/卡片选中/地图空白点击不置位
   * (选择公司 ≠ 放弃定位——ws-poi-vanish 首点修复,settle 仍会飞用户位置)。 */
  const userMovedMapRef = useRef(false);
  /** 用户是否进行过任何交互(pointerdown/keydown/touchstart/wheel 首发置位)。
   * geolocation resolve 可能晚于用户首交互(权限弹窗 / 8s 超时 / 30s maximumAge
   * 缓存):resolve 时相机若仍在默认中心,settle 的 setCenter+setZoom 会瞬间整幅
   * 跳变——首点 rail 的同一帧瓦片重载 + 距离圈重建 + 列表重裁,观感 = 「整页刷
   * 新」。故已交互后不再抢镜头(用户可点「定位」按钮,handleLocate)。
   * 与 userMovedMapRef 独立:首点 rail 不置位后者(刻意的相机语义),但已属交互。 */
  const userInteractedRef = useRef(false);
  /** userInteractedRef 一次性监听注册守卫:挂载 effect 依赖变化重跑时不重复注册 */
  const userInteractListenersRegisteredRef = useRef(false);
  /** Domain 数据耗尽(稀疏视野/回退窗口空/无更多页):哨兵停止 + 「没有更多结果」 */
  const [noMoreData, setNoMoreData] = useState(false);
  const noMoreRef = useRef(false);
  /** 视口替换世代:主加载在 onBatch/落库前校验,丢弃过期的追加批次 */
  const viewportEpochRef = useRef(0);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [drawer, setDrawer] = useState<DrawerState>("mini");
  const [lang, setLang] = useState<Language>('zh');
  const [mapStyle, setMapStyle] = useState<BasemapStyle>('normal');
  const [zoom, setZoom] = useState(DEFAULT_MAP_ZOOM);
  const [mapReady, setMapReady] = useState(false);
  const [rotation, setRotation] = useState(0);

  // ---- Phase 2 多模式状态 ----
  const [mode, setMode] = useState<MapMode>('work');
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<FilterState>({});
  const [sort, setSort] = useState(() => getMode("work").defaultSort);
  const [catalog, setCatalog] = useState<POI[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lng: number; lat: number }>({ ...DEFAULT_MAP_CENTER });
  const [mapBounds, setMapBounds] = useState<ViewportBounds | null>(null);
  // ---- 地图引擎(useMapEngine 创建视图;center/zoom/style 只取首渲染快照)----
  // ws-poi-vanish2:首载 state=默认(行为不变);fast refresh remount 保留 hook state,
  // 新地图以用户上次视野初始化,不再回杭州默认。
  const initialMapViewRef = useRef<{ center: { lng: number; lat: number }; zoom: number; style: BasemapStyle } | null>(null);
  if (!initialMapViewRef.current) {
    initialMapViewRef.current = { center: { ...mapCenter }, zoom, style: readInitialMapStyle() };
  }
  const { engine: mapEngine, view: engineView } = useMapEngine({
    containerRef: mapContainer,
    center: initialMapViewRef.current.center,
    zoom: initialMapViewRef.current.zoom,
    style: initialMapViewRef.current.style,
  });
  const [userLocation, setUserLocation] = useState<{ lng: number; lat: number } | null>(null);
  const [searchOrigin, setSearchOrigin] = useState<{ lng: number; lat: number } | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [pageOffset, setPageOffset] = useState(0);
  const skipFetchRef = useRef(false);
  const loadingRef = useRef(false);
  /** 主加载在飞期间到达的视口刷新:置位后由主加载 finally 补跑,避免被吞(Bug 7) */
  const viewportRefreshPendingRef = useRef(false);
  /** 程序化相机移动(toggle 收藏图层)触发的视口刷新抑制截止时间戳(ms);过期自动失效 */
  const suppressViewportRefreshUntilRef = useRef(0);
  /** 视口加载器实例由 useWorkViewport 创建并返回(主加载 finally 用它补跑) */
  // 供一次性创建的地图监听/视口加载器读取最新状态(避免闭包过期)
  const viewStateRef = useRef<WorkViewportState>({
    mode, query, filters, sort, searchOrigin, userLocation, pageOffset, geoSettled,
  });
  viewStateRef.current = { mode, query, filters, sort, searchOrigin, userLocation, pageOffset, geoSettled };
  // suggest effect 只依赖 [query, mode]：zoom/catalog 经 ref 读取，避免平移/分页重置防抖
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [error, setError] = useState<string | null>(null);
  // 左侧结果面板显隐（点击导航"探索"展开）
  const [railPanel, setRailPanel] = useState<RailPanel>(null);
  const exploreOpen = railPanel === "explore";
  // 搜索建议（AutoComplete）——状态与获取/清理逻辑在 useSearchState hook 内
  const [detailPoi, setDetailPoi] = useState<POI | null>(null);
  const [user, setUser] = useState<AccountUser | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>([]);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [inbox, setInbox] = useState<NotificationRecord[]>([]);

  // ---- AI Agent 悬浮球 seam(boss 红线豁免,只追加,不动任何现有逻辑)----
  // agentBridge 惰性初始化:活跃视图可用后建一次;视图实例变更(引擎重建)时重建。
  const agentBridgeViewRef = useRef<MapView | null>(null);
  const agentBridgeRef = useRef<MapBridge | null>(null);
  if (engineView && agentBridgeViewRef.current !== engineView) {
    agentBridgeViewRef.current = engineView;
    agentBridgeRef.current = createAgentBridge(engineView, {
      onSelect: (id) => setSelectedId(id),
      onOpenDetail: (id) => {
        const poi =
          catalogRef.current.find((p) => p.id === id) ??
          poisRef.current.find((p) => p.id === id);
        setSelectedId(id);
        if (poi) setDetailPoi(poi);
        setRailPanel("explore");
        if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
          setDrawer("full");
        }
      },
    });
  }

  useEffect(() => {
    const system: BasemapStyle = window.matchMedia("(prefers-color-scheme: dark)").matches ? "whitesmoke" : "normal";
    setMapStyle(readMapStylePref(system));
  }, []);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [mobileSheet, setMobileSheet] = useState<"explore" | "saved" | "layers" | "account" | "recent">("explore");
  const [mobileJd, setMobileJd] = useState<Position | null>(null);
  const [openPositionId, setOpenPositionId] = useState<string | null>(null);
  const [mobileSuggestIndex, setMobileSuggestIndex] = useState(-1);
  const [online, setOnline] = useState(true);
  /** 移动抽屉跟手手势状态 */
  const [drawerDragging, setDrawerDragging] = useState(false);
  const drawerRef = useRef<HTMLElement | null>(null);
  const drawerDraggingRef = useRef(false);
  const drawerSuppressClickRef = useRef(false);
  const drawerStateRef = useRef<DrawerState>(drawer);
  const drawerFullishRef = useRef(false);
  const drawerGestureRef = useRef<{
    startY: number;
    baseH: number;
    lastY: number;
    lastTime: number;
    vel: number;
    safeTop: number;
  } | null>(null);
  /** 移动端抽屉列表滚动容器（.drawerContent）与滚动位置保存（交互 1） */
  const drawerContentRef = useRef<HTMLDivElement>(null);
  const drawerScrollRef = useRef(0);

  const modeConfig = getMode(mode);
  // F2 候选类别(work/domain 未选类别):移动抽屉 POIList 空态槽位渲染 chips(桌面在 secondary-sidebar)
  const mobileCandidateChips = candidateCategoriesFor(mode, query, filters);

  useEffect(() => {
    setLang(getBrowserLanguage());
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const refreshAccount = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      const body = await res.json();
      const next = (body.user ?? null) as AccountUser | null;
      setUser(next);
      if (next) setLang(next.preferences.language);
      return next;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  const refreshHistory = useCallback(async (signedIn: boolean) => {
    if (!signedIn) {
      setSearchHistory(listGuestHistory());
      return;
    }
    try {
      const res = await fetch("/api/me/search-history");
      const body = await res.json();
      setSearchHistory(Array.isArray(body.items) ? body.items : []);
    } catch {
      setSearchHistory([]);
    }
  }, []);

  const refreshSaved = useCallback(async () => {
    try {
      const res = await fetch("/api/me/saved");
      const body = await res.json();
      setSavedPlaces(Array.isArray(body.items) ? body.items : []);
    } catch {
      setSavedPlaces([]);
    }
  }, []);

  const refreshApplications = useCallback(async () => {
    try {
      const res = await fetch("/api/me/applications");
      const body = await res.json();
      setApplications(Array.isArray(body.items) ? body.items : []);
    } catch {
      setApplications([]);
    }
  }, []);

  const refreshInbox = useCallback(async () => {
    try {
      const res = await fetch("/api/me/notifications");
      const body = await res.json();
      setInbox(Array.isArray(body.items) ? body.items : []);
    } catch {
      setInbox([]);
    }
  }, []);

  const scanJobAlerts = useCallback(async () => {
    try {
      await fetch("/api/me/notifications", { method: "POST" });
      await refreshInbox();
    } catch {
      // guest / network
    }
  }, [refreshInbox]);

  useEffect(() => {
    if (!user) return;
    if (!user.preferences.notifications.emailJobs && !user.preferences.notifications.smsJobs) return;
    void scanJobAlerts();
  }, [user, scanJobAlerts]);

  /**
   * Upload persistable guest rows that are not already in the account, then keep
   * the local copy as a browser mirror (sign-out restores it; a later upload
   * only sends rows the account does not have, so no duplicates).
   */
  const mergeGuestHistoryOnSignIn = useCallback(async () => {
    const uploaded = await mergeGuestHistoryIntoAccount({
      loadCloud: async () => {
        const res = await fetch('/api/me/search-history');
        const body = await res.json();
        return Array.isArray(body.items) ? body.items : [];
      },
    });
    if (uploaded.length) await refreshHistory(true);
  }, [refreshHistory]);

  useEffect(() => {
    prefetchAllRail();
    // 一次性 document 级首交互监听(为何需要见 userInteractedRef 注释):pointerdown /
    // keydown / touchstart / wheel 任一命中即置位并移除全部监听;wheel passive:true
    // 不阻塞滚动。注册守卫 + { once: true } + 手动移除三保险,effect 依赖变化重跑
    // (refreshAccount 等)也不会重复注册。
    if (!userInteractListenersRegisteredRef.current) {
      userInteractListenersRegisteredRef.current = true;
      const markInteracted = () => {
        userInteractedRef.current = true;
        document.removeEventListener("pointerdown", markInteracted);
        document.removeEventListener("keydown", markInteracted);
        document.removeEventListener("touchstart", markInteracted);
        document.removeEventListener("wheel", markInteracted);
      };
      document.addEventListener("pointerdown", markInteracted, { once: true });
      document.addEventListener("keydown", markInteracted, { once: true });
      document.addEventListener("touchstart", markInteracted, { once: true });
      document.addEventListener("wheel", markInteracted, { once: true, passive: true });
    }
    refreshAccount().then((next) => {
      if (next?.preferences.defaultMode) setMode(next.preferences.defaultMode);
      void refreshHistory(Boolean(next));
      if (next) void mergeGuestHistoryOnSignIn();
    });
    refreshSaved();
    refreshApplications();
    refreshInbox();
  }, [refreshAccount, refreshHistory, refreshSaved, refreshApplications, refreshInbox, mergeGuestHistoryOnSignIn]);

  const recordSearch = useCallback(async (raw: string, searchMode: MapMode, entity?: SearchHistoryEntityRef) => {
    const q = raw.trim();
    if (!q || !isPersistableMode(searchMode)) return;
    if (!user) {
      setSearchHistory(addGuestHistory(q, searchMode, entity));
      return;
    }
    try {
      await fetch("/api/me/search-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, mode: searchMode, ...(entity ? { entity } : {}) }),
      });
      await refreshHistory(true);
    } catch {
      // 网络失败时忽略
    }
  }, [refreshHistory, user]);

  const handleClearRecent = useCallback(() => {
    if (user) {
      void fetch("/api/me/search-history", { method: "DELETE" }).then(() => refreshHistory(true));
      return;
    }
    clearGuestHistory();
    setSearchHistory([]);
  }, [user, refreshHistory]);

  const openRail = useCallback((panel: RailPanel) => {
    setRailPanel((current) => (current === panel ? null : panel));
    if (panel !== "explore") {
      setSelectedId(null);
      setHighlightedId(null);
      setDetailPoi(null);
    }
  }, []);

  // 会话缓存：刷新页面后仍恢复本模式累计池，不重打高德（抽到 hook 保持原语义）
  useModeCacheRestore({
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
  });

  // ---- 地图视图接线(useMapEngine 负责引擎加载 + createView;本 effect 只做事件/控件/定位绑定)----
  useEffect(() => {
    mapInstance.current = engineView;
    if (!engineView) return;

    let mapCleanup: (() => void) | null | undefined = null;
    mapCleanup = createMap(engineView);

    return () => {
      // 先执行 createMap 返回的 cleanup(移除 resize/主题/鼠标监听);
      // 视图销毁由 useMapEngine 卸载时负责(本 effect 不销毁,避免双销毁)
      mapCleanup?.();
      mapCleanup = null;
      if (mapInstance.current === engineView) mapInstance.current = null;
      try {
        distanceHandleRef.current?.setMap?.(null);
      } catch {
        // 视图已销毁等场景:忽略
      }
      distanceHandleRef.current = null;
      try {
        distanceCircleRef.current?.setMap?.(null);
      } catch {
        // 视图已销毁等场景:忽略
      }
      distanceCircleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 视图接线只随 view 实例变化
  }, [engineView]);

  function createMap(view: MapView) {
    setMapReady(true);

    // 首点不再被 geolocation 门控(2026-08-20 修复):初始加载以 mapReady 为门
    // (下方 load() 同步去掉 geoSettled 依赖),geolocation 只提供用户位置
    // 数据原点(userLocation/searchOrigin/蓝点)与未移图时的相机定位;
    // 相机与距离圆心(mapCenter)只在用户未手动移动过相机时更新——geolocation
    // 真异步可能数秒才 resolve,期间用户拖图/缩放(userMovedMapRef=true)
    // → 不再 setCenter/userPosition 抢占、不把距离圆心甩去用户位置;
    // 用户自己点「定位」按钮(handleLocate)仍会移过去(原义)。
    const settleGeolocation = () => {
      setGeoSettled(true);
    };

    // Geolocation 蓝点需绑定到原始 AMap 实例(amap-api 专属能力,经逃生舱 view.raw)
    getCurrentPosition(view.raw)
      .then((loc) => {
        if (!loc) {
          settleGeolocation();
          return;
        }
        const { lng, lat } = loc.position;
        setUserLocation({ lng, lat });
        setSearchOrigin((prev) => prev ?? { lng, lat });
        // 相机 + mapCenter(距离圆心,ws-b 语义跟随镜头)只在用户未手动移图且相机
        // 仍处默认中心时一起更新:已移图 → 两者都保持当前镜头状态,不把圆心甩去
        // 用户位置;remount 恢复的用户视野(非默认)同样不抢镜头(ws-poi-vanish2:
        // 门控以实时相机中心为准,距默认 [120.15,30.27] 阈值 0.1°≈11km)。
        // 用户已交互(首点/按键/滚动,userInteractedRef)同样不再抢镜头:geolocation
        // resolve 可能晚于首交互,此时 setCenter+setZoom 整幅跳变 = 「整页刷新」观感。
        if (!userMovedMapRef.current && !userInteractedRef.current && isNearDefaultCenter(view.getState().center)) {
          view.setCenter({ lng, lat });
          view.setZoom(15);
          setMapCenter({ lng, lat });
        }
        settleGeolocation();
      })
      .catch(() => {
        settleGeolocation();
      });

    // 自定义中键旋转逻辑
    let isMiddleButtonDown = false;
    let startRotation = 0;
    let startPitch = 0;
    let startX = 0;
    let startY = 0;

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 1) {  // 中键
        e.preventDefault();
        isMiddleButtonDown = true;
        const state = view.getState();
        startRotation = state.rotation;
        startPitch = state.pitch;
        startX = e.clientX;
        startY = e.clientY;
        document.body.style.cursor = 'grab';
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isMiddleButtonDown) {
        e.preventDefault();
        // X 轴：旋转角度
        const deltaX = e.clientX - startX;
        const rotationChange = deltaX * 0.13;  // 降低旋转灵敏度
        const newRotation = (startRotation + rotationChange) % 360;

        // Y 轴：俯仰角度（向上拖动增加俯仰，向下拖动减少俯仰）
        const deltaY = e.clientY - startY;
        const pitchChange = -deltaY * 0.15;  // 降低俯仰灵敏度
        const newPitch = Math.max(0, Math.min(83, startPitch + pitchChange));  // 限制在 0-83 度

        view.setRotation(newRotation);
        view.setPitch(newPitch);
        document.body.style.cursor = 'grabbing';
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 1) {
        isMiddleButtonDown = false;
        document.body.style.cursor = '';
      }
    };

    const handleAuxClick = (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
      }
    };

    const container = mapContainer.current;
    if (!container) return;
    container.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('auxclick', handleAuxClick);

    // 清理函数
    const cleanup = () => {
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('auxclick', handleAuxClick);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      darkModeQuery.removeEventListener('change', handleThemeChange);
      window.removeEventListener('resize', handleResize);
      scaleControlRef.current = null;
    };

    // 用户没写过底图偏好时才跟系统主题；选过卫星/浅色后不再被系统覆盖
    const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleThemeChange = (e: MediaQueryListEvent) => {
      if (parseMapStyle(window.sessionStorage.getItem(MAP_STYLE_KEY))) return;
      const next: BasemapStyle = e.matches ? "whitesmoke" : "normal";
      setMapStyle(next);
      view.setStyle(next);
    };
    darkModeQuery.addEventListener("change", handleThemeChange);

    // Add AMap's built-in scale control (real, auto-updating)
    // 移动端放左上角（避开底部抽屉），桌面端放左下角
    // 统一创建函数:resize 与就绪回调都走这里;位置/偏移是 AMap 专属选项,
    // 经 duck-type 传给 view.addControl(契约只保证 kind 'scale')
    const scaledView = view as MapView & {
      addControl?: (
        kind: 'scale',
        opts?: { position?: string; offset?: [number, number] },
      ) => Promise<{ hide: () => void; show: () => void } | null> | null;
    };
    const addScaleControl = () => {
      const isMobile = window.innerWidth <= 767;
      const pending = scaledView.addControl?.('scale', {
        position: isMobile ? 'LT' : 'LB', // 移动端左上角，桌面端左下角
        offset: isMobile ? [12, 22] : [90, 25], // 移动端避开顶部工具栏，桌面端避开侧边栏
      });
      if (!pending) return;
      pending.then((control) => {
        if (!control) return;
        scaleControlRef.current = control;
        // 同步初始显隐:抽屉全开/详情打开时比例尺隐藏(仅移动端)
        if (drawerFullishRef.current && isMobile) control.hide();
      });
    };
    // Scale 插件就绪由引擎 addControl 内部保证(AMap.plugin);重复创建防双控件
    addScaleControl();

    // 监听窗口大小变化，在桌面/移动端切换时更新比例尺位置
    const handleResize = () => {
      if (!mapInstance.current || view.isDestroyed?.()) return; // 地图已销毁,不操作
      if (!scaleControlRef.current) return; // 插件未就绪,由就绪回调创建
      scaleControlRef.current = null;
      addScaleControl(); // 引擎适配器内部摘除旧控件并按新断点重建
    };
    window.addEventListener('resize', handleResize);

    // Sync zoom state
    view.on("zoomchange", () => {
      const currentZoom = view.getState().zoom;
      setZoom(Math.round(currentZoom));
    });

    // 监听地图旋转变化(rotatechange 不在 MapViewEvent 联合,经 onViewEvent 转发)
    onViewEvent(view, "rotatechange", () => {
      setRotation(view.getState().rotation);
    });

    const syncView = () => {
      const state = view.getState();
      setMapCenter({ lng: state.center.lng, lat: state.center.lat });
      const b = view.getBounds();
      if (b) {
        setMapBounds({ west: b.west, south: b.south, east: b.east, north: b.north });
      }
    };
    view.on("moveend", syncView);
    view.on("complete", syncView);
    // 首帧立即同步一次视野:mapBounds 在第一批数据到达前就绪,
    // work 列表客户端裁剪(全量池按视野过滤)从第一次渲染起就有 bounds 可用
    syncView();
    // 相机接管标记:只有用户手动移动/缩放相机(拖/缩)才置位;
    // pin/卡片/空白点击不置位——选择公司 ≠ 放弃定位,geolocation settle
    // 仍会飞用户位置(ws-poi-vanish 首点修复)。
    onViewEvent(view, "dragstart", () => {
      userMovedMapRef.current = true;
    });
    onViewEvent(view, "zoomstart", () => {
      userMovedMapRef.current = true;
    });
    view.on("click", () => {
      if (ignoreNextMapClick.current) {
        ignoreNextMapClick.current = false;
        return;
      }
      setSelectedId(null);
      setHighlightedId(null);
      setDetailPoi(null);
    });

    return cleanup;
  }

  // ---- Phase 2: 累计池 + 钉死原点；移动地图不重搜 ----

  /** 分类门控(poi-category-loading):domain 上次已加载的分类(浏览态)。 */
  const prevDomainCategoryRef = useRef<string | undefined>(undefined);
  // 分类从「过滤已加载目录」变为「驱动加载」:domain 浏览(无关键词)时
  // 切分类 → 立即清空目录 + 清缓存 + offset 归零(不等防抖);load effect
  // 依赖 filters.category,下一步按新分类全量重拉当前视图。minRating/price
  // 仍纯客户端过滤,不触发重拉。搜索(query)豁免,不受分类门控。
  useEffect(() => {
    if (canonicalMode(mode) !== 'domain' || query) return;
    const category = typeof filters.category === 'string' ? filters.category : undefined;
    if (prevDomainCategoryRef.current === category) return;
    prevDomainCategoryRef.current = category;
    catalogRef.current = [];
    setCatalog([]);
    clearModeCache(mode);
    setPageOffset(0); // 分类全量循环忽略 offset;归零避免旧 offset 触发多余加载
  }, [mode, query, filters.category, pageOffset]);

  useEffect(() => {
    const signal = { cancelled: false };

    function liveView() {
      // 与 use-work-viewport.readMapViewSnapshot 同源:live 相机快照,
      // 地图未就绪回退 React 状态(首帧 mapBounds 由 createMap 内 syncView() 同步)
      return (
        readMapViewSnapshot(mapInstance.current) ?? {
          center: mapCenter,
          zoom,
          bounds: mapBounds,
        }
      );
    }

    async function load() {
      // 初始加载以 mapReady 为唯一门(2026-08-20 修复):不再等 geolocation
      // settle——首点门控/首帧空白/定位竞态的根因。geolocation 只提供数据
      // 原点,不决定数据何时可用。
      if (!mapReady) {
        return;
      }
      // skipFetch 先消费:它由缓存还原/模式切换/视口替换置位,即使上一轮
      // 加载仍在飞也必须立即消费,否则会残留到下一轮合法加载被吞掉。
      if (skipFetchRef.current) {
        skipFetchRef.current = false;
        setLoadingMore(false); // 被跳过的加载没有 finally,手动释放
        // 视口刷新 pending 在 skipFetch 提前返回时同样补跑(skipFetch 不经过
        // finally,否则叠加模式切换缓存恢复会吞掉待重放的视口刷新,poi-loading C)
        if (viewportRefreshPendingRef.current) {
          viewportRefreshPendingRef.current = false;
          viewportLoaderRef.current?.schedule();
        }
        return;
      }
      if (loadingRef.current) {
        return; // 防止初始化期间多次setState触发并发加载
      }
      const cached = catalogRef.current.length > 0 ? readModeCache(mode) : null;
      // 会话缓存只在参数完全一致时复用：换了关键词(query)或页偏移都须重搜。
      // 之前漏了 query——杭州库里搜外地词/新词会因缓存早退而永远不发请求。
      if (
        cached &&
        cached.catalog.length > 0 &&
        pageOffset === cached.pageOffset &&
        query === cached.query &&
        refreshToken === 0
      ) {
        return;
      }
      const epoch = viewportEpochRef.current; // 视口替换后过期批次将被丢弃
      loadingRef.current = true;
      if (!loadingMore) setLoading(true); // 追加加载不闪骨架屏(保留滚动位置)
      setError(null);
      const beforeLen = catalogRef.current.length;
      // 空批次三态信号(ws1 Bug1 视口):vacant = 本次请求成功但 0 条(未并入
      // 新行);lastBatchLen 供 domain 分支推断(合并池末长度 ≤ 加载前即 0 新增)。
      let vacant = false;
      let lastBatchLen = -1;
      try {
        const view = liveView();
        const origin = searchOrigin ?? userLocation ?? view.center;
        const onBatch = (batch: POI[]) => {
          if (signal.cancelled) return;
          if (viewportEpochRef.current !== epoch) return; // 视口已刷新,丢弃过期批次
          if (!batchMatchesCurrentMode(viewStateRef.current.mode, mode)) return; // 模式已切换,丢弃过期批次
          lastBatchLen = batch.length;
          catalogRef.current = batch;
          setCatalog(batch);
          writeModeCache({
            mode,
            catalog: batch,
            pageOffset,
            searchOrigin: origin,
            query,
            filters,
            sort,
            viewport: view,
          });
          if (batch.length > 0) setLoading(false);
        };
        // 工作模式:全量加载(2026-08-20 修复)——不传 bounds/maxTier,服务端
        // 无 clip 返回整库(672 公司 / ~1843 站点 POI,ORDER BY slug 稳定分页),
        // 一次取尽。此后 pool 与 zoom 无关:聚合徽章计数稳定(bug 1)、缩放/
        // 平移不再触发任何重拉(首点刷新 bug 的根因之一)。列表按视野的裁剪
        // 移到客户端(pois memo 按 mapBounds 过滤,不再发视口请求)。
        // distance 筛选不下行服务端:无 bounds 时服务端以杭州为中心裁剪,
        // 与客户端 distanceOrigin(当前视野中心)口径不一致——全量池 + 客户端
        // 按 distanceOrigin 过滤,结果等价且中心正确。
        // Domain 模式:保持刷新才更新(高德 API 负载/余额),视野变化不重搜。
        let noMore = false;
        let data: POI[];
        if (isRecruitmentMode(mode)) {
          const serverFilters = { ...filters };
          delete serverFilters.distance;
          const result = await loadWorkViewport({
            page: 1,
            maxPages: WORK_FULL_LOAD_MAX_PAGES,
            filters: serverFilters,
            q: query || undefined,
            sort: sort || undefined,
            existing: catalogRef.current,
            signal,
            onBatch,
          });
          data = result.pois;
          // work 数据到底由 loadWorkViewport 上报(短页 break):
          // 「没有更多」= 数据源到底,不是 3000 封顶。
          noMore = result.noMore;
          vacant = result.vacant;
          // 全量加载后 work 无「加载更多」分页;pageOffset 归零(旧会话缓存
          // 可能残留 >0,否则下一次 load 会从第 N 页起取、漏掉前 N 页)。
          if (pageOffset !== 0) setPageOffset(0);
        } else {
          // 分类门控(poi-category-loading):domain 无分类选择 → 默认不加载,
          // 目录保持空(地图无 domain marker、列表空态);搜索(query)豁免。
          if (!query && !filters.category) {
            data = [];
            noMore = true;
          } else {
            const result = await fetchPOIsForMode({
              mode,
              query: query || undefined,
              filters, // 分类驱动加载(poi-category-loading):filters 下行到数据源
              center: origin,
              zoom: view.zoom,
              bounds: view.bounds ?? undefined,
              existing: mode === "domain" ? catalogRef.current : undefined,
              addCap: mode === "domain" ? DOMAIN_BATCH_SIZE : MORE_PAGE_SIZE,
              pageOffset,
              signal,
              onBatch,
            });
            data = result.pois;
            // domain 无 vacant 信号,用合并池推断:onBatch 末池 ≤ 加载前目录
            // 长度即「本轮 0 新增」(请求成功但 0 条并入,ws1 Bug1 三态)。
            vacant = beforeLen > 0 && lastBatchLen <= beforeLen;
            // 数据耗尽判定(仅 domain):优先用服务端 total(domain-local 带 total,
            // 「过滤导致可见列表不变」不再误判 noMore,poi-loading D);
            // 无 total 的降级路径(高德回退/关键词)回退本地长度比较:本轮零新增
            // 且此前有数据 → 哨兵停止。覆盖:稀疏视野(<1000)、高德回退窗口耗尽、
            // 关键词无更多页。否则哨兵会无限空转(每轮发请求但 0 新增)。
            noMore =
              result.noMore ??
              (canonicalMode(mode) === "domain" && beforeLen > 0 && data.length <= beforeLen);
          }
        }
        // ---- 空批次三态(ws1 Bug1 视口)----
        // 请求成功但 0 条(未并入新行):旧目录若仍有 POI 落在当前视野 bounds
        // 内 → 保留旧目录(收藏 fitToPins 退化视野,由视口刷新抑制窗口
        // 兜底,tech/16 方案 A);否则视为真空 → 清空走空态(整城空白不再被
        // 旧城市 pin 占住,列表显示现有空态文案)。请求失败不走到这里(上方
        // catch 保留旧目录)。保留时跳过缓存写入:旧目录顶着「当前视野」快照
        // 会污染挂载对齐判定(下次刷新不再触发对齐加载)。
        if (vacant && beforeLen > 0) {
          if (catalogCoversView(catalogRef.current, view.bounds)) {
            noMoreRef.current = noMore;
            setNoMoreData(noMore);
            return;
          }
          data = [];
          noMore = false; // 真空 ≠ 到底:当前视野仍可能有数据,不闩锁
        }
        if (signal.cancelled) return;
        if (viewportEpochRef.current !== epoch) return; // 视口已刷新,丢弃过期结果
        if (!batchMatchesCurrentMode(viewStateRef.current.mode, mode)) return; // 模式已切换,丢弃过期结果
        catalogRef.current = data;
        setCatalog(data);
        writeModeCache({
          mode,
          catalog: data,
          pageOffset,
          searchOrigin: origin,
          query,
          filters,
          sort,
          viewport: view,
        });
        noMoreRef.current = noMore;
        setNoMoreData(noMore);
      } catch (err) {
        if (!signal.cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load POIs");
        }
      } finally {
        // loadingRef/loadingMore 属于本轮加载，即使被取消(用户输入/状态变更)
        // 也必须释放；否则后续所有 load() 会卡死、哨兵被 loadingMore 永久门控。
        loadingRef.current = false;
        setLoadingMore(false);
        // 主加载在飞期间的视口刷新(pending 标记)在主加载结束后补跑,
        // 避免平移/缩放的刷新请求被静默丢弃(Bug 7 次要问题)。
        if (viewportRefreshPendingRef.current) {
          viewportRefreshPendingRef.current = false;
          viewportLoaderRef.current?.schedule();
        }
        if (!signal.cancelled) {
          setLoading(false);
        }
      }
    }

    const timer = setTimeout(load, query ? 300 : 80);
    return () => {
      signal.cancelled = true;
      clearTimeout(timer);
    };
    // 刻意不依赖 mapCenter / zoom / mapBounds / filters：平移、缩放、minRating/price
    // 筛选都不重搜。唯一例外 filters.category(分类门控,poi-category-loading):
    // domain 选类/换类必须触发按类全量加载;minRating/price 仍纯客户端过滤。
    // 2026-08-20 修复:geoSettled / userLocation / searchOrigin 也不在依赖内——
    // 初始加载以 mapReady 为门(work 全量加载一次取尽),geolocation settle 触发
    // 的依赖变化不再取消在飞加载(否则全量循环在第 1 页后即被 signal.cancelled
    // 中止,pool 只剩首页 50 条)。定位落地后的数据刷新由相机 moveend → 视口
    // loader(domain)承担。
    // 使用原始值而非对象引用，避免 React 误判依赖变化
  }, [mode, query, mapReady, refreshToken, pageOffset, filters.category]);

  // ---- 工作模式视口按需加载 + 挂载对齐加载(ws1 Bug1)----
  // 视口加载器创建/调度(moveend/zoomend 防抖 + 抑制窗口)与挂载对齐判定抽到
  // useWorkViewport;共享 ref 全部传入,与主加载 effect 的读写顺序保持一致。
  // loader 实例经返回的 viewportLoaderRef 暴露,主加载 finally 用它补跑 pending
  // 视口刷新(skipFetch 消费与 Bug 7 补跑路径不变)。
  const { viewportLoaderRef } = useWorkViewport({
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
  });

  // 距离圆心实时化(ws-b 工作 POI 不随视角改变):圆心跟随地图当前中心 mapCenter
  // (moveend 实时更新),而非挂载时一次性的 userLocation——否则 distance filter
  // 持久化跨会话还原后,pipeline 用陈旧圆心(挂载定位点)裁剪,把视口内公司整批裁空。
  // 语义从「离我最近」→「离当前视野中心最近」(与服务端 boundsCenter 口径一致)。
  // userLocation 保留用于初次定位/其他用途,distance 圆心不再钉在挂载点。
  //
  // ws-poi-vanish 生效时机:定位成功(userLocation)前 mapCenter 仍是杭州默认值
  // [120.15,30.27],带 distance 的缓存恢复若以杭州为圆心过滤,会把用户区域 POI
  // 整池裁掉(visiblePOIIds 清空 → 全部 pin 消失)。→ 定位落地前 distance 筛选
  // 不生效(视同无 distance,pool 全量可见);settle 后圆心跟随真实视野中心
  // (未手动移图时 settle 已把 mapCenter 设成用户位置)。定位失败时 userLocation
  // 恒 null → 筛选持续不生效,不打扰(与 handleLocate 失败保持视野同义)。
  const distanceOrigin = mapCenter;
  const distanceRadius = userLocation ? distanceFilterMeters(filters) : 0;
  // pipeline 入参:定位前剥离 distance 键,防止以杭州默认中心过滤导致 POI 池消失
  const effectiveFilters: FilterState | undefined =
    userLocation || !filters || !("distance" in filters)
      ? filters
      : Object.fromEntries(Object.entries(filters).filter(([key]) => key !== "distance"));
  const distanceOriginRef = useRef(distanceOrigin);
  const distanceRadiusRef = useRef(distanceRadius);
  distanceOriginRef.current = distanceOrigin;
  distanceRadiusRef.current = distanceRadius;

  useEffect(() => {
    const view = mapInstance.current;
    if (!view) return;

    const clearDistanceOverlay = () => {
      if (distanceHandleRef.current) {
        distanceHandleRef.current.setMap(null);
        distanceHandleRef.current = null;
      }
      if (distanceCircleRef.current) {
        distanceCircleRef.current.setMap(null);
        distanceCircleRef.current = null;
      }
    };

    if (distanceRadius <= 0) {
      clearDistanceOverlay();
      return;
    }

    const origin = distanceOrigin;
    const handlePos = pointAtDistanceEast(origin, distanceRadius);

    if (!distanceCircleRef.current) {
      // 距离圈经引擎 createCircle(L1067 同款参数由适配器承载:stroke/fill/opacity/bubble/zIndex)
      distanceCircleRef.current = view.createCircle({
        center: origin,
        radius: distanceRadius,
        color: "#007AFF",
      }).raw;
    } else if (!draggingDistanceRef.current) {
      distanceCircleRef.current.setCenter([origin.lng, origin.lat]);
      distanceCircleRef.current.setRadius(distanceRadius);
      if (!distanceCircleRef.current.getMap()) (view.raw as { add?: (o: unknown) => void }).add?.(distanceCircleRef.current);
    }

    if (!distanceHandleRef.current) {
      // 距离手柄 marker:cursor/bubble 是 AMap 专属选项(契约 MapMarkerOptions 未含),
      // duck-type 透传;构造即绑定到地图(适配器 map: 选项,与旧 map.add 等价)
      distanceHandleRef.current = view.createMarker({
        position: handlePos,
        offset: [-9, -9],
        zIndex: 130,
        content:
          '<div style="width:18px;height:18px;border-radius:50%;background:#007AFF;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,122,255,0.35)"></div>',
        cursor: "ew-resize",
        bubble: false,
      } as MapMarkerOptions).raw;
    } else if (!draggingDistanceRef.current) {
      distanceHandleRef.current.setPosition([handlePos.lng, handlePos.lat]);
      if (!distanceHandleRef.current.getMap()) (view.raw as { add?: (o: unknown) => void }).add?.(distanceHandleRef.current);
    }

    const applyRadius = (meters: number) => {
      const snapped = metersToDistanceKm(meters);
      if (snapped <= 0) {
        setFilters((current) => {
          if (!("distance" in current)) return current;
          const next = { ...current };
          delete next.distance;
          return next;
        });
        return;
      }
      setFilters((current) => (
        current.distance === snapped ? current : { ...current, distance: snapped }
      ));
    };

    const startDrag = () => {
      draggingDistanceRef.current = true;
      ignoreNextMapClick.current = true;
      (view.raw as { setStatus?: (s: { dragEnable: boolean }) => void }).setStatus?.({ dragEnable: false });
    };
    const moveTo = (lnglat: { lng: number; lat: number }) => {
      if (!draggingDistanceRef.current) return;
      const meters = Math.max(80, haversineDistance(distanceOriginRef.current, lnglat));
      distanceCircleRef.current?.setRadius(meters);
      const edge = pointAtDistanceEast(distanceOriginRef.current, meters);
      distanceHandleRef.current?.setPosition([edge.lng, edge.lat]);
    };
    const endDrag = (lnglat?: { lng: number; lat: number } | null) => {
      if (!draggingDistanceRef.current) return;
      draggingDistanceRef.current = false;
      (view.raw as { setStatus?: (s: { dragEnable: boolean }) => void }).setStatus?.({ dragEnable: true });
      const raw = lnglat
        ? haversineDistance(distanceOriginRef.current, lnglat)
        : Number(distanceCircleRef.current?.getRadius?.() ?? distanceRadiusRef.current);
      applyRadius(raw);
    };

    const handle = distanceHandleRef.current;
    const onHandleDown = (e: { originEvent?: { stopPropagation?: () => void } }) => {
      e.originEvent?.stopPropagation?.();
      startDrag();
    };
    const onMapMove = (e: { lnglat?: { lng?: number; lat?: number; getLng?: () => number; getLat?: () => number } }) => {
      const ll = readLngLat(e.lnglat);
      if (ll) moveTo(ll);
    };
    const onMapUp = (e: { lnglat?: { lng?: number; lat?: number; getLng?: () => number; getLat?: () => number } }) => {
      endDrag(readLngLat(e.lnglat));
    };

    handle.on("mousedown", onHandleDown);
    const offMapMove = onViewEvent(view, "mousemove", onMapMove);
    const offMapUp = onViewEvent(view, "mouseup", onMapUp);
    const onDocUp = () => endDrag(null);
    document.addEventListener("mouseup", onDocUp);

    return () => {
      handle.off("mousedown", onHandleDown);
      offMapMove();
      offMapUp();
      document.removeEventListener("mouseup", onDocUp);
      if (draggingDistanceRef.current) {
        draggingDistanceRef.current = false;
        (view.raw as { setStatus?: (s: { dragEnable: boolean }) => void }).setStatus?.({ dragEnable: true });
      }
    };
  }, [distanceOrigin, distanceRadius, mapReady]);

  const pois = useMemo(
    () =>
      runPOIPipeline(
        // work 列表 = 全量池按当前视野 bounds 客户端裁剪(2026-08-20 修复:
        // 全量加载后无增量可取,「侧栏二级卡片展示当前视角」改为本地过滤,
        // 不再发视口请求;mapBounds 由 syncView(moveend)驱动);bounds 未就绪
        // (首帧前)回退全量;domain 无列表池概念,恒用 catalog。
        canonicalMode(mode) === "work" && mapBounds
          ? catalog.filter((p) => inBounds(p.location, mapBounds))
          : catalog,
        {
          query: query || undefined,
          filters: effectiveFilters && Object.keys(effectiveFilters).length ? effectiveFilters : undefined,
          sort: sort || undefined,
          center: distanceOrigin,
        },
      ),
    [mode, mapBounds, catalog, query, effectiveFilters, sort, distanceOrigin]
  );
  catalogRef.current = catalog;
  poisRef.current = pois;

  const compareCatalog = useMemo(() => {
    const byId = new Map<string, POI>();
    // Live catalog first; seed only fills ids the current list has not loaded yet.
    for (const poi of INTERNSHIP_SEED) byId.set(poi.id, poi);
    for (const poi of catalog) byId.set(poi.id, poi);
    return Array.from(byId.values());
  }, [catalog]);

  // ---- 收藏图层(useSavedLayer,QA scan #6 抽取):开关状态 + overlay POI 派生 + toggle ----
  const {
    savedOverlay,
    overlayPois,
    toggle: handleToggleSavedOverlay,
    hide: hideSavedOverlay,
  } = useSavedLayer({
    user,
    savedPlaces,
    compareCatalog,
    mode,
    mapInstance,
    suppressViewportRefreshUntilRef,
    onRequireAuth: () => setAuthOpen(true),
  });
  // ---- marker 池(b2):marker 源与列表分离 ----
  // work 的 marker 源 = catalog(全量池,2026-08-20 起一次取尽,跨视口/跨 zoom
  // 保留实例)+ 同一客户端管线(查询/筛选/排序,与列表同口径)。
  // workMarkerPois 不依赖 pois(列表按视野裁剪):列表变化不触碰 marker 池引用
  // → usePOIMap 不触发 setPOIs(零 marker 触碰)。
  const workMarkerPois = useMemo(
    () =>
      canonicalMode(mode) === "work"
        ? mergeMapPois(
            runPOIPipeline(catalog, {
              query: query || undefined,
              filters: effectiveFilters && Object.keys(effectiveFilters).length ? effectiveFilters : undefined,
              sort: sort || undefined,
              center: distanceOrigin,
            }),
            overlayPois,
            savedOverlay && Boolean(user),
          )
        : null,
    [
      mode,
      catalog,
      overlayPois,
      savedOverlay,
      user,
      query,
      effectiveFilters,
      sort,
      distanceOrigin,
    ],
  );
  // domain 无列表池概念,pois(=pipeline(catalog))即 marker 源。
  // 注意:工作分支返回 workMarkerPois 同引用——即使列表(pois)按视野裁剪变化,
  // 下游 marker 源引用不变,零 setPOIs。
  const markerPois = useMemo(
    () =>
      canonicalMode(mode) === "work"
        ? (workMarkerPois ?? [])
        : mergeMapPois(pois, overlayPois, savedOverlay && Boolean(user)),
    [mode, workMarkerPois, pois, overlayPois, savedOverlay, user],
  );

  // ---- 城市聚合(tech/21,zoom ≤ 8)----
  // 渲染层第二种模式,与视口增量加载/选中高亮/LOD 过滤零冲突:
  // work 模式 zoom ≤ 8 时按 site.city 分组渲染圆形徽章(点击下钻 zoom 11);
  // zoom > 8 自动切回个体 pin。无 city 的 pin 保持个体(规则 2)。
  // 分桶记忆化(b2):LOD 只依赖 floor(zoom),clusterZoom 在分桶内恒定(聚合区间
  // 按整数 zoom 分桶,个体区间恒 9)→ zoom 微调(8.1→8.4、5.2→5.9)不重建徽章;
  // 只有跨整数分桶(7→8,徽章计数变化)或聚合↔个体切换(8.0→8.1)才重建。
  const clusterZoom = clusterZoomForZoom(zoom);
  const clusterState = useMemo(() => {
    if (!isRecruitmentMode(mode)) return null; // 非 work 上下文 → 个体 pin
    const groups = clusterCities(markerPois, clusterZoom);
    if (groups === null) return null; // zoom > 8 → 个体 pin
    return {
      groups,
      individual: markerPois.filter((p) => !poiCity(p)), // 无 city 的 pin 保持个体
    };
  }, [mode, markerPois, clusterZoom]);

  // 聚合徽章渲染:每城一个 Marker(content 徽章),effect 清理时整批摘除。
  // 与个体 marker 模式互斥——聚合激活时个体 pin 实例保留(由 visiblePOIIds 隐藏),
  // 出聚合直接 show,不重建。clusterState 已按 clusterZoom 分桶:zoom 微调不触发
  // 本 effect(b2),只有跨整数分桶 / 池增长 / 模式切换才整批重建徽章。
  useEffect(() => {
    const view = mapInstance.current;
    if (!view || !clusterState) return;

    const created: any[] = [];
    for (const group of clusterState.groups) {
      const marker = createCityClusterMarker(view, group, {
        color: modeConfig.color,
        onClick: () => {
          // AMap 常在 marker click 后再打一次 map click;吞掉同一次手势
          ignoreNextMapClick.current = true;
          window.setTimeout(() => {
            ignoreNextMapClick.current = false;
          }, 80);
          // 徽章点击仅下钻、不弹卡片:平滑缩放到该城,
          // zoom 11 > 8 自动切回个体 marker 模式,个体 pin 出现
          view.flyTo({ center: { lng: group.lng, lat: group.lat }, zoom: CLUSTER_DRILL_ZOOM });
        },
      });
      if (marker) created.push(marker);
    }
    return () => {
      for (const marker of created) {
        try {
          if (typeof marker.setMap === "function") marker.setMap(null);
        } catch {
          // 地图已销毁等场景:忽略,与 controller 的 detachFromMap 同语义
        }
      }
    };
  }, [clusterState, mapReady, modeConfig.color]);

  // ---- marker 可见性(b2)----
  // 控制器始终持有全量 markerPois 池,此处只算「当前该显示谁」,实例保留:
  // - 聚合激活(zoom ≤ 8):城市公司由徽章代表,只显示无 city 的个体 pin;
  // - 个体模式:按 LOD(maxTierForZoom)过滤,overlay 与 domain pin 恒显示;
  // 离开 marker 池的 id(刷新/筛选变窄/domain 换视野)不在集合内 → 隐藏,不销毁。
  // 依赖已分桶(clusterZoom / maxTier 均只随整数 zoom 变化):zoom 微调零重算。
  const maxTier = maxTierForZoom(zoom);
  const visiblePOIIds = useMemo(() => {
    if (clusterState) {
      const ids = new Set(clusterState.individual.map((p) => p.id));
      return markerPois.filter((p) => ids.has(p.id)).map((p) => p.id);
    }
    const overlayIds = new Set(overlayPois.map((p) => p.id));
    return markerPois
      .filter((p) => {
        if (overlayIds.has(p.id)) return true; // 收藏 overlay 恒显示(不随 LOD)
        if (!isRecruitmentPOI(p)) return true; // domain pin 无 tier,恒显示
        return (p.company?.tier ?? TIER_DEFAULT) <= maxTier;
      })
      .map((p) => p.id);
  }, [clusterState, markerPois, overlayPois, maxTier]);

  const handleRefreshHere = useCallback(() => {
    const view = mapInstance.current;
    const state = view?.getState?.();
    const next = state ? { lng: state.center.lng, lat: state.center.lat } : mapCenter;
    setSearchOrigin(next);
    catalogRef.current = [];
    setCatalog([]);
    setPageOffset(0);
    clearModeCache(mode);
    // 刷新即换列表:旧列表滚动位置不再有意义
    drawerScrollRef.current = 0;
    setRefreshToken((n) => n + 1);
  }, [mapCenter, mode]);

  const handleNeedMore = useCallback(() => {
    // work 模式全量加载后无「更多」可分页:哨兵直接停止,不再递增 pageOffset
    // (递增会让下一次 load 从第 N 页起取,漏掉前 N 页)。
    if (isRecruitmentMode(mode)) return;
    // 无限滚动:Domain 模式到 DOMAIN_POI_HARD_CAP(1000)封顶。
    // noMore 短路:数据已耗尽(稀疏视野无更多页),哨兵停止触发。
    if (noMoreRef.current) return; // 数据已耗尽,哨兵停止触发
    if (catalogRef.current.length >= DOMAIN_POI_HARD_CAP) return;
    if (loadingRef.current) return; // 防重入:上一批加载中不重复触发
    setLoadingMore(true);
    setPageOffset((n) => n + 1);
  }, [mode]);

  // 重试失败批次:清缓存(防缓存早退吞掉重试)+ 重新加载同一 pageOffset
  // (失败不递增偏移,避免跳过失败的那一批数据,poi-loading A)
  const handleRetry = useCallback(() => {
    clearModeCache(mode);
    setLoadingMore(true);
    setRefreshToken((n) => n + 1);
  }, [mode]);

  const handleWidenSearch = useCallback(() => {
    const next = widenSearchScope({ query, filters });
    if (!next.changed) {
      handleNeedMore();
      return;
    }
    setQuery(next.query);
    setFilters(next.filters);
  }, [query, filters, handleNeedMore]);

  const handleToggleSave = useCallback(async (poi: POI) => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    if (!isPersistablePoi(poi)) return;
    const already = savedPlaces.some((item) => item.poiId === poi.id);
    try {
      if (already) {
        await fetch(`/api/me/saved?poiId=${encodeURIComponent(poi.id)}`, { method: "DELETE" });
      } else {
        await fetch("/api/me/saved", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            poiId: poi.id,
            name: poi.name,
            mode: poi.mode,
            kind: poi.kind,
            address: poi.location.address,
            lng: poi.location.lng,
            lat: poi.location.lat,
          }),
        });
      }
      await refreshSaved();
    } catch {
      // network / guest race
    }
  }, [user, savedPlaces, refreshSaved]);

  const handlePickSaved = useCallback((place: SavedPlace) => {
    // 落地已保存位置即「用户已接管相机」(会 flyTo):与地图手势同口径(Bug1)
    userMovedMapRef.current = true;
    const live = [...overlayPois, ...compareCatalog, ...catalogRef.current, ...poisRef.current];
    const match = resolveSavedForFly(place, live);
    if (match) {
      setSelectedId(match.id);
      setDetailPoi(match);
      setMobileJd(null);
      setRailPanel("explore");
      setMobileSheet("explore");
      setDrawer("full");
      if (match.location) flyToLocation(mapInstance.current, match.location.lng, match.location.lat);
      return;
    }
    if (typeof place.lng === "number" && typeof place.lat === "number") {
      flyToLocation(mapInstance.current, place.lng, place.lat);
    }
    setRailPanel("explore");
    setMobileSheet("explore");
    setDrawer("half");
  }, [overlayPois, compareCatalog]);

  /** 已投递/通知行点击 → 打开对应岗位:本地命中直接开,否则按 companyPoiId
   *  拉 work 详情(mode=work),positions 匹配 positionId → 桌面详情高亮 +
   *  移动 JD。岗位已下线 / 拉取失败 → 不崩溃,console.warn + 保持面板原样。 */
  const handleOpenApplication = useCallback((ref: { positionId: string; companyPoiId: string }) => {
    const openCompany = (company: POI) => {
      // 用户主动打开岗位即「已接管相机」(会 flyTo)(Bug1)
      userMovedMapRef.current = true;
      setSelectedId(company.id);
      setDetailPoi(company);
      setRailPanel("explore");
      setMobileSheet("explore");
      setDrawer("full");
      drawerScrollRef.current = 0;
      if (ref.positionId && isRecruitmentPOI(company)) {
        const pos = company.positions.find((item) => item.id === ref.positionId);
        setOpenPositionId(ref.positionId);
        setMobileJd(pos ?? null);
      } else {
        setOpenPositionId(null);
        setMobileJd(null);
      }
      const loc = company.location;
      if (loc && typeof loc.lng === "number" && typeof loc.lat === "number") {
        flyToLocation(mapInstance.current, loc.lng, loc.lat);
      }
    };
    const local =
      catalog.find((p) => p.id === ref.companyPoiId) ??
      pois.find((p) => p.id === ref.companyPoiId) ??
      INTERNSHIP_SEED.find((p) => p.id === ref.companyPoiId);
    if (local) {
      openCompany(local);
      return;
    }
    void fetchPOIDetail(ref.companyPoiId, "work")
      .then((detail) => openCompany(detail))
      .catch(() => {
        // 岗位已下线 / 网络失败 → 不崩溃,保持面板原样
        console.warn("[profile] failed to open application", ref.companyPoiId, ref.positionId);
      });
  }, [catalog, pois]);

  const handleRemoveSaved = useCallback((poiId: string) => {
    void fetch(`/api/me/saved?poiId=${encodeURIComponent(poiId)}`, { method: "DELETE" }).then(refreshSaved);
  }, [refreshSaved]);

  const handleApply = useCallback(async (input: { position: { id: string; title: string }; company: { id: string; name: string }; url?: string }) => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    try {
      await fetch("/api/me/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positionId: input.position.id,
          companyPoiId: input.company.id,
          title: input.position.title,
          companyName: input.company.name,
          applyUrl: input.url,
        }),
      });
      await refreshApplications();
    } catch {
      // ignore
    }
  }, [user, refreshApplications]);

  // ---- 地图联动 ----
  usePOIMap(mapInstance.current, {
    pois: markerPois,
    visiblePOIs: visiblePOIIds,
    selectedId,
    highlightedId,
    accentColor: modeConfig.color,
    onMarkerClick: (id) => {
      // 点 marker 只选中不动相机:不置 userMovedMapRef(ws-poi-vanish 首点修复
      // ——选择公司 ≠ 放弃定位,geolocation settle 仍会飞用户位置)。
      // AMap 常在 marker click 后再打一次 map click；吞掉同一次手势，超时后恢复点空白取消。
      ignoreNextMapClick.current = true;
      window.setTimeout(() => {
        ignoreNextMapClick.current = false;
      }, 80);
      const poi =
        poisRef.current.find((p) => p.id === id) ??
        overlayPois.find((p) => p.id === id) ??
        compareCatalog.find((p) => p.id === id);
      setSelectedId(id);
      if (poi) {
        setRailPanel("explore");
        setDetailPoi(poi);
        setMobileJd(null);
        if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
          setDrawer("full");
        }
      }
    },
  });

  // 卡片点击 → 选中（地图 marker 高亮由 usePOIMap 同步）
  const handleSelect = useCallback((poi: POI) => {
    // 点卡片/列表选中不动相机:不置 userMovedMapRef(ws-poi-vanish 首点修复
    // ——选择公司 ≠ 放弃定位,geolocation 晚 settle 仍会飞用户位置)。
    // 2026-08-20 修复:不再被 geolocation 门控——初始加载以 mapReady 为门,
    // 数据在 geolocation 落地前就绪,首点选中直接落地(与后续点击一致)。
    setSelectedId(poi.id);
  }, []);

  // 卡片 hover → 高亮 marker
  const handleHover = useCallback((id: string | null) => {
    setHighlightedId(id);
  }, []);

  // 模式切换：当前模式写入会话缓存；目标模式有缓存则还原，不重搜
  const handleModeChange = useCallback((nextMode: MapMode) => {
    const target = canonicalMode(nextMode);
    if (target === mode) return;
    writeModeCache({
      mode,
      catalog: catalogRef.current,
      pageOffset,
      searchOrigin,
      query,
      filters,
      sort,
      viewport: readMapViewSnapshot(mapInstance.current) ?? undefined,
    });

    setMode(target);
    setSelectedId(null);
    setHighlightedId(null);
    setSuggestions([]);
    setDetailPoi(null);
    setOpenPositionId(null);
    setMobileJd(null);
    setMobileFiltersOpen(false);
    // 切模式即换数据上下文:旧列表的滚动位置不再有意义
    drawerScrollRef.current = 0;
    // 切模式即换数据上下文:复位 noMore(缓存还原路径不经主 load)
    noMoreRef.current = false;
    setNoMoreData(false);

    const cached = readModeCache(target);
    if (cached) {
      skipFetchRef.current = true;
      catalogRef.current = cached.catalog;
      setCatalog(cached.catalog);
      setPageOffset(cached.pageOffset);
      setSearchOrigin(cached.searchOrigin ?? userLocation);
      setQuery(cached.query);
      setFilters(cached.filters);
      setSort(cached.sort || getMode(target).defaultSort);
      // work 全量池恢复即取尽(2026-08-20):缓存 = 上次全量加载结果,
      // 无「更多」可分页(与 useModeCacheRestore 同口径);domain 保持复位
      if (canonicalMode(target) === "work") {
        noMoreRef.current = true;
        setNoMoreData(true);
      }
      setLoading(false);
      return;
    }

    catalogRef.current = [];
    setCatalog([]);
    setPageOffset(0);
    setQuery("");
    setFilters({});
    setSort(getMode(target).defaultSort);
    setSearchOrigin(userLocation);
  }, [mode, pageOffset, searchOrigin, query, filters, sort, userLocation]);

  // ---- 搜索建议 ----
  // 建议获取/清理逻辑抽到 useSearchState(work:/api/suggest 服务端目录 + 本地回退;
  // domain:本地优先 + 高德 AutoComplete 兜底(经活跃引擎 use-map-engine 注入);
  // 依赖只留 [query, mode])。
  // 选择建议后的落地逻辑在 handleSelectSuggestion(下方)。
  const { suggestions, setSuggestions } = useSearchState({
    query,
    mode,
    distanceOriginRef,
    zoomRef,
    catalogRef,
    engine: mapEngine,
  });

  useEffect(() => {
    setMobileSuggestIndex(-1);
  }, [query, suggestions.length]);

  // 选择建议 → 定位；招聘建议打开对应公司（服务端目录未加载的公司经
  // /api/pois/[id] 拉详情）；domain 建议本地已加载打开富卡，否则用 location
  // upsert 会话卡（不再依赖客户端 catalog 里有没有——之前 /api/suggest 匹配
  // 全量服务端目录，指向未加载公司时点击无任何反应）；#标签写入筛选插件。
  const handleSelectSuggestion = useCallback((s: SearchSuggestion) => {
    // 选择建议即「用户已接管相机」(会 flyTo):与地图手势同口径,
    // 否则 geolocation 晚 resolve 会抢占相机(Bug1 竞态盲区)
    userMovedMapRef.current = true;
    if (s.location) {
      flyToLocation(mapInstance.current, s.location.lng, s.location.lat);
      setMapCenter({ lng: s.location.lng, lat: s.location.lat });
    }
    if (s.kind === "place" && (s.name.startsWith("#") || s.id?.startsWith("tag-"))) {
      const tagged = applyTagSuggestion({ query, filters }, s.name);
      if (tagged.applied) {
        setQuery(tagged.query);
        setFilters(tagged.filters);
        setSuggestions([]);
        setRailPanel("explore");
        setMobileSheet("explore");
        void recordSearch(s.name, mode);
        return;
      }
    }
    const openCompany = (company: POI, positionId?: string) => {
      setSelectedId(company.id);
      setDetailPoi(company);
      setDrawer("full");
      if (positionId && isRecruitmentPOI(company)) {
        const pos = company.positions.find((item) => item.id === positionId);
        setOpenPositionId(positionId);
        setMobileJd(pos ?? null);
      } else {
        setOpenPositionId(null);
        setMobileJd(null);
      }
    };
    if (!isRecruitmentMode(mode) && s.kind === "place") {
      // domain：优先打开已加载的本地 POI（保留评分/照片富数据）
      const known = s.poiId
        ? catalog.find((p) => p.id === s.poiId) ?? pois.find((p) => p.id === s.poiId)
        : undefined;
      if (known) {
        openCompany(known);
      } else {
        const tipPoi = suggestionToDomainPoi(s);
        if (tipPoi) {
          const next = mergePoisById(catalogRef.current, [tipPoi], POI_SOFT_CAP);
          catalogRef.current = next;
          setCatalog(next);
          setSelectedId(tipPoi.id);
          setDetailPoi(tipPoi);
          setDrawer("full");
        }
        setOpenPositionId(null);
        setMobileJd(null);
      }
    } else if (s.poiId) {
      const company =
        catalog.find((p) => p.id === s.poiId) ??
        pois.find((p) => p.id === s.poiId) ??
        INTERNSHIP_SEED.find((p) => p.id === s.poiId);
      if (company) {
        openCompany(company, s.positionId);
      } else if (isRecruitmentMode(mode)) {
        // 服务端目录命中但客户端尚未加载（视口分页外的公司）→ 拉详情再打开
        void fetchPOIDetail(s.poiId, mode)
          .then((detail) => {
            if (detail) openCompany(detail, s.positionId);
          })
          .catch(() => {});
      } else {
        setOpenPositionId(null);
      }
    } else {
      setOpenPositionId(null);
    }
    setQuery(s.name);
    setSuggestions([]);
    setRailPanel("explore");
    setMobileSheet("explore");
    // 确定落在实体（公司/岗位）的建议才记实体引用；标签/区域/纯关键词不记
    const entity =
      (s.kind === "company" || s.kind === "job") ? entityRefFromSelection(s, mode) : undefined;
    void recordSearch(s.name, mode, entity);
  }, [catalog, pois, mode, recordSearch, query, filters]);

  const handleZoomIn = () => {
    // zoomIn/zoomOut 不在 MapView 契约:经逃生舱 raw 直连(TODO 限期迁移)
    (mapInstance.current?.raw as { zoomIn?: () => void } | null)?.zoomIn?.();
  };

  const handleZoomOut = () => {
    (mapInstance.current?.raw as { zoomOut?: () => void } | null)?.zoomOut?.();
  };

  const handleResetCompass = () => {
    if (!mapInstance.current) return;
    // 使用动画平滑过渡到正北，同时重置俯仰角。
    // AMap 专属参数(immediate/duration)不在契约:经逃生舱 raw 直连(TODO 限期迁移)
    const raw = mapInstance.current.raw as {
      setRotation?: (r: number, immediate?: boolean, duration?: number) => void;
      setPitch?: (p: number, immediate?: boolean, duration?: number) => void;
    };
    raw.setRotation?.(0, true, 300);  // 300ms 动画
    raw.setPitch?.(0, true, 300);
  };

  const handleLocate = () => {
    if (!mapInstance.current) return;

    // 用 AMap.Geolocation 定位(addControl 绑定到 map,蓝点 + 精度圈渲染在地图上);
    // Geolocation 是 amap-api 专属能力,需原始 AMap 实例(逃生舱 view.raw)
    getCurrentPosition(mapInstance.current.raw)
      .then((loc) => {
        if (!loc) {
          // 定位失败/被拒:保持当前视野,不跳回杭州默认中心(ws-poi-vanish)。
          // 失败 = 不打扰;用户仍可手动拖图。后续可接 toast 提示(不新增 UI)。
          console.warn("Geolocation failed, keeping current view");
          return;
        }
        const { lng, lat } = loc.position;
        mapInstance.current?.setCenter({ lng, lat });
        mapInstance.current?.setZoom(15);
        setMapCenter({ lng, lat });
      })
      .catch((err) => {
        // 定位异常同失败:保持当前视野(ws-poi-vanish),不跳回杭州默认中心
        console.warn("Geolocation error, keeping current view:", err);
      });
  };

  const handleMapStyleChange = (style: BasemapStyle) => {
    writeMapStylePref(style);
    setMapStyle(style);
    // 引擎视图承载底图样式 + 卫星瓦片层(engine.setStyle 内部处理 show/hide)
    mapInstance.current?.setStyle(style);
  };

  useEffect(() => {
    if (!sidebarOpen || !pendingSearchFocus.current) return;
    pendingSearchFocus.current = false;
    const input = searchInputRef.current;
    if (!input) return;
    const focus = () => input.focus();
    const id = window.setTimeout(focus, 220);
    return () => window.clearTimeout(id);
  }, [sidebarOpen]);

  const openSidebarSearch = () => {
    setRailPanel("explore");
    if (sidebarOpen) {
      searchInputRef.current?.focus();
      return;
    }
    pendingSearchFocus.current = true;
    setSidebarOpen(true);
  };

  const openMobileAccount = () => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    if (mobileSheet === "account") {
      setMobileSheet("explore");
      return;
    }
    setMobileSheet("account");
    setDrawer("full");
    setDetailPoi(null);
    setMobileJd(null);
    // 移动端:抽屉滚动容器常驻挂载,切到 account 面板前重置滚动,避免继承列表滚动位置
    if (drawerContentRef.current) drawerContentRef.current.scrollTop = 0;
  };

  const handleProfileClick = () => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    openRail("profile");
  };

  const handleAuthAction = () => {
    if (user) {
      void fetch("/api/auth/me", { method: "DELETE" }).then(() => {
        setUser(null);
        setSearchHistory(listGuestHistory());
        setSavedPlaces([]);
        hideSavedOverlay();
        setApplications([]);
        setInbox([]);
        setRailPanel((current) =>
          current === "profile" || current === "saved" ? null : current,
        );
      });
      return;
    }
    setAuthOpen(true);
  };

  const handleSaveProfile = async (patch: {
    displayName?: string;
    avatarUrl?: string;
    preferences?: Partial<UserPreferences>;
  }) => {
    const res = await fetch("/api/auth/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await res.json();
    if (body.user) {
      setUser(body.user as AccountUser);
      if (body.user.preferences?.language) setLang(body.user.preferences.language);
      void scanJobAlerts();
    }
  };

  /** 头像上传成功(ProfilePanel 内即时完成)→ 只同步 user 状态,不再走 PATCH。 */
  const handleAvatarUrlChange = (avatarUrl: string) => {
    setUser((current) => (current ? { ...current, avatarUrl } : current));
  };

  const openExploreSearch = useCallback((nextQuery: string) => {
    const tagged = applyTagSuggestion({ query, filters }, nextQuery);
    if (tagged.applied) {
      setQuery(tagged.query);
      setFilters(tagged.filters);
    } else {
      setQuery(nextQuery);
    }
    setRailPanel("explore");
    setMobileSheet("explore");
    // 新搜索 → 新列表,旧列表滚动位置不再有意义
    drawerScrollRef.current = 0;
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
      setDrawer((current) => (current === "mini" ? "half" : current));
    }
  }, [query, filters]);

  // 最近点击：有条目实体引用 → 回到那个实体（飞行 + 详情，跨城市可用，不依赖当前视口）；
  // 无实体引用（旧数据/纯关键词）→ 维持搜索回放；实体拉取失败 → 优雅降级回回放。
  const handlePickRecent = useCallback((entry: SearchHistoryEntry) => {
    const replay = replayRecentSearch(mode, entry);
    if (replay.modeChanged) handleModeChange(replay.mode);
    openExploreSearch(replay.query);
    const ent = entry.entity;
    if (!ent?.id) return;
    const targetMode = replay.modeChanged ? replay.mode : mode;
    const local =
      catalog.find((p) => p.id === ent.id) ??
      pois.find((p) => p.id === ent.id) ??
      INTERNSHIP_SEED.find((p) => p.id === ent.id);
    const openDetail = (poi: POI) => {
      // 用户主动选择最近条目即「已接管相机」(会 flyTo)(Bug1)
      userMovedMapRef.current = true;
      setSelectedId(poi.id);
      setDetailPoi(poi);
      setOpenPositionId(null);
      setMobileJd(null);
      setDrawer("full");
      const loc = poi.location;
      if (loc && typeof loc.lng === "number" && typeof loc.lat === "number") {
        flyToLocation(mapInstance.current, loc.lng, loc.lat);
      } else if (typeof ent.lng === "number" && typeof ent.lat === "number") {
        flyToLocation(mapInstance.current, ent.lng, ent.lat);
      }
    };
    if (local) {
      openDetail(local);
    } else {
      // 服务端目录命中但客户端尚未加载（视口分页外 / 跨城市）→ 拉详情再打开
      void fetchPOIDetail(ent.id, targetMode)
        .then((detail) => {
          if (detail) openDetail(detail);
        })
        .catch(() => {
          // 拉取失败 → 已回放搜索，不白屏
        });
    }
  }, [mode, handleModeChange, openExploreSearch, catalog, pois]);

  const cycleDrawer = () => setDrawer((current) => current === "mini" ? "half" : current === "half" ? "full" : "mini");

  useEffect(() => {
    drawerStateRef.current = drawer;
  }, [drawer]);

  /** 抽屉全开或详情打开:隐藏 topTools(指南针+定位)与比例尺;half/mini 恢复 */
  const drawerFullish = drawer === "full" || !!detailPoi;

  useEffect(() => {
    drawerFullishRef.current = drawerFullish;
    const ctl = scaleControlRef.current;
    if (!ctl) return;
    // 仅移动端隐藏比例尺:桌面端抽屉不可见、detail 在左侧栏打开,不隐藏
    if (window.innerWidth > 767) return;
    if (drawerFullish) ctl.hide();
    else ctl.show();
  }, [drawerFullish]);

  // 交互 1:详情返回后恢复抽屉列表滚动位置。
  // 进详情时 .drawerContent + POIList 整体卸载,返回时重挂载 scrollTop=0;
  // layout effect 在重挂载 DOM 更新后、绘制前执行,保证 .drawerContent 已存在。
  // key 为 detailPoi:任意 detailPoi→null 的返回路径(把手 2159 / onBack 2204 /
  // 手势 1801)都会触发恢复。
  useLayoutEffect(() => {
    if (detailPoi === null && drawerContentRef.current) {
      drawerContentRef.current.scrollTop = drawerScrollRef.current;
    }
  }, [detailPoi]);

  /** 手势状态机 —— 跟手拖动:pointerdown 记录起点,pointermove 直接写 height(px),pointerup 按位置+速度决定三态 */
  const handleDrawerPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const el = drawerRef.current;
    if (!el) return;
    drawerGestureRef.current = {
      startY: event.clientY,
      baseH: el.getBoundingClientRect().height,
      lastY: event.clientY,
      lastTime: performance.now(),
      vel: 0,
      safeTop: readSafeAreaTop(),
    };
    drawerDraggingRef.current = true;
    setDrawerDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* 指针捕获失败时退化为按下事件上的位移判定 */
    }
  };

  const handleDrawerPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const g = drawerGestureRef.current;
    if (!g || !drawerDraggingRef.current) return;
    const now = performance.now();
    const dt = now - g.lastTime;
    const instant = dt > 0 ? ((event.clientY - g.lastY) / dt) * 1000 : 0;
    g.vel = Number.isFinite(instant) ? g.vel * 0.4 + instant * 0.6 : g.vel;
    g.lastY = event.clientY;
    g.lastTime = now;

    // 跟手核心:拖拽中直接用 transform 系的 height 写 px,拖拽态 CSS 为 transition:none,不做缓动
    const h = g.baseH - (event.clientY - g.startY);
    const el = drawerRef.current;
    if (el) el.style.height = `${h}px`;

    // 内容可见性随手指所在档位切换(mini 只露搜索,越过档位即显示内容)
    // 全开阈值 = 抽屉顶边到指南针中心(vh - max(12px, safe-area-top) - 20px),与 CSS drawerFull 对齐
    const vh = window.innerHeight;
    const fullH = drawerFullHeight(vh, g.safeTop);
    const halfH = vh * DRAWER_HALF_RATIO;
    const eff: DrawerState = h >= fullH ? "full" : h >= halfH ? "half" : "mini";
    if (eff !== drawerStateRef.current) setDrawer(eff);
  };

  const finishDrawerGesture = (clientY: number) => {
    const g = drawerGestureRef.current;
    drawerGestureRef.current = null;
    if (!g || !drawerDraggingRef.current) return;
    drawerDraggingRef.current = false;
    setDrawerDragging(false);

    // 手势已提交:清空拖拽期 inline height,交给 CSS class(svh)过渡从当前位置吸附到档位。
    // rAF 在 React 离散事件同步提交之后、绘制之前执行,确保 transition 从手指位置平滑收尾。
    requestAnimationFrame(() => {
      if (drawerDraggingRef.current) return; // 新手势已开始,不打断
      const el = drawerRef.current;
      if (el) el.style.height = "";
    });

    // 真拖动(超过 8px)抑制随后的 onClick 循环切换;点按保留原有 cycle 逻辑
    if (Math.abs(clientY - g.startY) > 8) drawerSuppressClickRef.current = true;

    const currentH = drawerRef.current?.getBoundingClientRect().height ?? g.baseH;
    const vh = window.innerHeight;
    const fullH = drawerFullHeight(vh, g.safeTop);
    const halfH = vh * DRAWER_HALF_RATIO;
    const vel = g.vel;

    // 内容栈优先:详情/JD 被下拉到过半(或快滑)→ 收到各自上一层;否则回弹 full
    if (detailPoi || mobileJd) {
      const popContent =
        vel > DRAWER_FLING_V || currentH < (fullH + halfH) / 2;
      if (popContent) {
        if (mobileJd) {
          setMobileJd(null);
          setDrawer("full");
        } else {
          setDetailPoi(null);
          setMobileJd(null);
          setDrawer("half");
        }
      } else {
        setDrawer("full");
      }
      return;
    }
    if (mobileSheet !== "explore") {
      if (vel > DRAWER_FLING_V) setMobileSheet("explore");
      else setDrawer(nearestDrawerState(currentH, halfH, fullH));
      return;
    }
    // 三态判定:向上快滑→full,向下快滑→mini,慢拖→就近档位
    if (vel < -DRAWER_FLING_V) setDrawer("full");
    else if (vel > DRAWER_FLING_V) setDrawer("mini");
    else setDrawer(nearestDrawerState(currentH, halfH, fullH));
  };

  return (
    <main className={styles.shell}>
      <a className={styles.skipLink} href="#explore-results">{t("skipToResults", lang)}</a>
      <a className={styles.skipLink} href="#map-canvas">{t("skipToMap", lang)}</a>
      <div className={styles.srOnly} aria-live="polite" aria-atomic="true">
        {loading ? t("loading", lang) : `${pois.length} ${t("resultsCount", lang)}`}
      </div>
      <section id="map-canvas" className={styles.mapCanvas} aria-label="Interactive map preview">
        <div ref={mapContainer} style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }} />
        {!mapReady && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 14 }}>
            {process.env.NEXT_PUBLIC_AMAP_KEY && process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE
              ? "Loading map..."
              : "Set NEXT_PUBLIC_AMAP_KEY and NEXT_PUBLIC_AMAP_SECURITY_CODE in .env.local"}
          </div>
        )}
      </section>

      {/* 左侧主导航栏（保留） */}
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`} aria-label="Map navigation">
        <div className={styles.menuWrap}>
          <div className={styles.brandRow}>
            <span className={styles.brandLogo} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 21s-6-5.1-6-10a6 6 0 1 1 12 0c0 4.9-6 10-6 10Z" />
                <circle cx="12" cy="11" r="2.2" />
              </svg>
            </span>
            <span className={styles.brandName}>{t("mapLabel", lang)}</span>
            <svg className={styles.betaPill} viewBox="0 0 42 19" aria-hidden="true">
              <rect width="42" height="19" rx="9.5" />
              <text x="21" y="13" textAnchor="middle" fontSize="9.5" fontWeight="800" letterSpacing="0.6">BETA</text>
            </svg>
          </div>
          <button
            className={styles.menuButton}
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label={sidebarOpen ? t('collapsSidebar', lang) : t('expandSidebar', lang)}
            aria-expanded={sidebarOpen}
          >
            <span className={styles.menuGlyph} aria-hidden="true">
              <span className={styles.menuIconExpand}><Icon name="sidebar" /></span>
              <span className={styles.menuIconCollapse}><Icon name="chevronLeft" /></span>
            </span>
          </button>
        </div>
        <div className={styles.railDivider} aria-hidden="true" />
        <div
          className={styles.searchBox}
          data-tooltip={t('search', lang)}
          onClick={openSidebarSearch}
        >
          <Icon name="search" />
          {!query && <span className={styles.searchLabel}>{t('search', lang)}</span>}
          <input
            ref={searchInputRef}
            type="search"
            placeholder={modeConfig.searchPlaceholder}
            value={query}
            tabIndex={sidebarOpen ? 0 : -1}
            onChange={(e) => {
              setQuery(e.target.value);
              setRailPanel("explore");
            }}
            onFocus={() => {
              if (!sidebarOpen) openSidebarSearch();
              else setRailPanel("explore");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void recordSearch(query, mode);
              }
            }}
          />
        </div>
        <nav className={styles.navList}>
          <button
            className={`${styles.navItem} ${railPanel === "layers" ? styles.navItemActive : ""}`}
            data-tooltip={t("layers", lang)}
            aria-pressed={railPanel === "layers"}
            onClick={() => openRail("layers")}
            onMouseEnter={() => prefetchRail("layers")}
            onFocus={() => prefetchRail("layers")}
          >
            <Icon name="layers" />
            <span>{t("layers", lang)}</span>
          </button>
          <button
            className={`${styles.navItem} ${railPanel === "saved" ? styles.navItemActive : ""}`}
            data-tooltip={t('saved', lang)}
            aria-pressed={railPanel === "saved"}
            onClick={() => {
              if (!user) {
                setAuthOpen(true);
                return;
              }
              openRail("saved");
            }}
            onMouseEnter={() => prefetchRail(user ? "saved" : "auth")}
            onFocus={() => prefetchRail(user ? "saved" : "auth")}
          >
            <Icon name="bookmark" />
            <span>{t('saved', lang)}</span>
          </button>
          <button
            className={`${styles.navItem} ${exploreOpen ? styles.navItemActive : ""}`}
            data-tooltip={t('explore', lang)}
            aria-expanded={exploreOpen}
            aria-pressed={exploreOpen}
            onClick={() => openRail("explore")}
            onMouseEnter={() => prefetchRail("detail")}
            onFocus={() => prefetchRail("detail")}
          >
            <Icon name="grid" />
            <span>{t('explore', lang)}</span>
          </button>
          <button
            className={`${styles.navItem} ${railPanel === "recent" ? styles.navItemActive : ""}`}
            data-tooltip={t('recent', lang)}
            aria-pressed={railPanel === "recent"}
            onClick={() => openRail("recent")}
            onMouseEnter={() => prefetchRail("recent")}
            onFocus={() => prefetchRail("recent")}
          >
            <Icon name="history" />
            <span>{t('recent', lang)}</span>
          </button>
        </nav>
        <div className={styles.profileRow}>
          <button
            className={styles.profile}
            aria-label={user ? `${user.displayName} ${user.accountLabel}` : t("notSignedIn", lang)}
            data-tooltip={t('profile', lang)}
            onClick={handleProfileClick}
            onMouseEnter={() => prefetchRail(user ? "profile" : "auth")}
            onFocus={() => prefetchRail(user ? "profile" : "auth")}
          >
            {user?.avatarUrl ? (
              <img className={styles.avatar} src={user.avatarUrl} alt="" />
            ) : user ? (
              <div className={styles.avatar}>{initialsFromName(user.displayName)}</div>
            ) : (
              <div className={`${styles.avatar} ${styles.avatarGuest}`}><Icon name="person" /></div>
            )}
            {sidebarOpen && (
              <div className={styles.profileCopy}>
                <strong>{user ? user.displayName : t("notSignedIn", lang)}</strong>
                <small>{user ? user.accountLabel : t("signInHint", lang)}</small>
              </div>
            )}
          </button>
          {sidebarOpen && (
            <button
              type="button"
              className={styles.authGlyph}
              onClick={handleAuthAction}
              aria-label={user ? t("signOut", lang) : t("signIn", lang)}
              title={user ? t("signOut", lang) : t("signIn", lang)}
            >
              <Icon name={user ? "logout" : "login"} />
            </button>
          )}
        </div>
      </aside>

      {/* Phase 2: 二级侧控栏（从左侧导航展开） */}
      {exploreOpen && (
      <SecondarySidebar
        mode={mode}
        onModeChange={handleModeChange}
        query={query}
        onQueryChange={setQuery}
        filters={filters}
        onFiltersChange={setFilters}
        onFiltersReset={() => setFilters({})}
        sort={sort}
        onSortChange={setSort}
        pois={pois}
        loading={loading}
        selectedId={selectedId}
        highlightedId={highlightedId}
        onSelect={handleSelect}
        onHover={handleHover}
        onRefreshHere={handleRefreshHere}
        onNeedMore={handleNeedMore}
        onLoadMore={handleNeedMore}
        loadError={error}
        onRetry={handleRetry}
        loadingMore={loadingMore}
        atCap={canonicalMode(mode) === "domain" && pois.length >= DOMAIN_POI_HARD_CAP}
        noMore={noMoreData}
        onWidenSearch={handleWidenSearch}
        saved={Boolean(detailPoi && savedPlaces.some((item) => item.poiId === detailPoi.id))}
        onToggleSave={detailPoi && isPersistablePoi(detailPoi) ? handleToggleSave : undefined}
        onApply={handleApply}
        totalCount={pois.length}
        lang={lang}
        onClose={() => {
          setRailPanel(null);
          setSelectedId(null);
          setHighlightedId(null);
          setDetailPoi(null);
          setOpenPositionId(null);
          setMobileJd(null);
        }}
        suggestions={suggestions}
        onSelectSuggestion={handleSelectSuggestion}
        onCommitSearch={(q) => { void recordSearch(q, mode); }}
        shifted={sidebarOpen}
        detailPoi={detailPoi}
        openPositionId={openPositionId}
        onCloseDetail={() => {
          setDetailPoi(null);
          setOpenPositionId(null);
          setMobileJd(null);
          setSelectedId(null);
          setHighlightedId(null);
        }}
        onOpenDetail={(poi) => {
          // 用户主动打开详情即「已接管相机」(会 flyTo)(Bug1)
          userMovedMapRef.current = true;
          // 2026-08-20 修复:不再被 geolocation 门控——首点打开详情立即飞,
          // 与后续点击行为一致。
          // 桌面详情不保存移动抽屉滚动(保存只发生在移动卡片点击链),清零避免把旧值带回移动端
          drawerScrollRef.current = 0;
          setDetailPoi(poi);
          if (poi.location) flyToLocation(mapInstance.current, poi.location.lng, poi.location.lat);
        }}
      />
      )}

      {railPanel === "recent" && (
        <RecentPanel
          items={searchHistory}
          signedIn={Boolean(user)}
          lang={lang}
          mode={mode}
          shifted={sidebarOpen}
          onClose={() => setRailPanel(null)}
          onPick={handlePickRecent}
          onPickTrending={(item) => openExploreSearch(item.query)}
          onClear={handleClearRecent}
        />
      )}

      {railPanel === "layers" && (
        <LayersPanel
          lang={lang}
          savedOverlay={savedOverlay}
          overlayCount={overlayPois.length}
          signedIn={Boolean(user)}
          mapStyle={mapStyle}
          shifted={sidebarOpen}
          onToggleOverlay={handleToggleSavedOverlay}
          onMapStyle={handleMapStyleChange}
          onClose={() => setRailPanel(null)}
        />
      )}

      {railPanel === "saved" && (
        <SavedPanel
          items={savedPlaces}
          signedIn={Boolean(user)}
          lang={lang}
          catalog={compareCatalog}
          origin={distanceOrigin}
          shifted={sidebarOpen}
          onClose={() => setRailPanel(null)}
          onPick={handlePickSaved}
          onHover={handleHover}
          onRemove={user ? handleRemoveSaved : undefined}
        />
      )}

      {railPanel === "profile" && user && (
        <ProfilePanel
          user={user}
          lang={lang}
          shifted={sidebarOpen}
          onClose={() => setRailPanel(null)}
          onSave={handleSaveProfile}
          onAvatarUrlChange={handleAvatarUrlChange}
          onSignOut={handleAuthAction}
          applications={applications}
          notifications={inbox}
          onOpenApplication={handleOpenApplication}
        />
      )}

      <AuthModal
        open={authOpen}
        lang={lang}
        onClose={() => setAuthOpen(false)}
        onSignedIn={() => {
          void refreshAccount().then((next) => {
            if (next?.preferences.defaultMode) setMode(next.preferences.defaultMode);
            void mergeGuestHistoryOnSignIn();
          });
          void refreshSaved();
          void refreshApplications();
          void refreshInbox();
        }}
      />

      {!online && (
        <div className={styles.offlineBanner} role="status">
          {t("offline", lang)}
        </div>
      )}

      <div className={`${styles.topTools} ${drawerFullish ? styles.topToolsHidden : ""}`}>
        <button className={`${styles.toolButton} ${styles.compassButton}`} onClick={handleResetCompass} aria-label="Reset compass">
          <svg className={styles.compassNeedle} viewBox="0 0 20 20" width="28" height="28" style={{ transform: `rotate(${rotation}deg)` }}>
            <path d="M10 1 L12 10 L10 8.5 L8 10 Z" fill="#ff3b30" />
            <path d="M10 19 L8 10 L10 11.5 L12 10 Z" fill="#e5e5ea" />
          </svg>
        </button>
        <button className={`${styles.toolButton} ${styles.locateButton}`} onClick={handleLocate} aria-label={t("locateMe", lang)}>
          <Icon name="locate" />
        </button>
      </div>

      <div className={styles.mapControls}>
        <div className={styles.zoomControls}>
          <button onClick={handleZoomIn} aria-label="Zoom in">+</button>
          <span>{zoom}</span>
          <button onClick={handleZoomOut} aria-label="Zoom out">−</button>
        </div>
        <button className={`${styles.toolButton} ${styles.locateButton}`} onClick={handleLocate} aria-label={t('locateMe', lang)}>
          <Icon name="locate" />
        </button>
      </div>

      {/* AI Agent 悬浮球(seam:agent-map-bridge 挂载点) */}
      <AgentBall bridge={agentBridgeRef.current} lang={lang} />

      <section
        ref={drawerRef}
        className={`${styles.mobileDrawer} ${drawerDragging ? styles.drawerDragging : ""} ${detailPoi || drawer === "full" ? styles.drawerFull : drawer === "half" ? styles.drawerHalf : styles.drawerMini}`}
        aria-label={t("explore", lang)}
      >
        <button
          className={styles.drawerHandle}
          onClick={() => {
            if (drawerSuppressClickRef.current) {
              drawerSuppressClickRef.current = false;
              return;
            }
            if (mobileJd) {
              setMobileJd(null);
              setDrawer("full");
              return;
            }
            if (detailPoi) {
              setDetailPoi(null);
              setDrawer("half");
              return;
            }
            if (mobileSheet !== "explore") {
              setMobileSheet("explore");
              return;
            }
            cycleDrawer();
          }}
          onPointerDown={(event) => handleDrawerPointerDown(event)}
          onPointerMove={(event) => handleDrawerPointerMove(event)}
          onPointerUp={(event) => finishDrawerGesture(event.clientY)}
          onPointerCancel={(event) => finishDrawerGesture(event.clientY)}
          aria-label={mobileJd ? t("closeJd", lang) : detailPoi ? t("backToList", lang) : t("expandDrawer", lang)}
        >
          <span />
        </button>
        {detailPoi && mobileJd && isRecruitmentPOI(detailPoi) ? (
          <div className={styles.mobileDetail}>
            <JdPanel
              company={detailPoi}
              position={mobileJd}
              lang={lang}
              accentColor={modeConfig.color}
              onClose={() => setMobileJd(null)}
              onApply={handleApply}
            />
          </div>
        ) : detailPoi ? (
          <div className={styles.mobileDetail}>
            <POIDetailView
              poi={detailPoi}
              lang={lang}
              accentColor={modeConfig.color}
              selectedPositionId={mobileJd?.id}
              onSelectPosition={(position) => {
                setMobileJd(position);
                setDrawer("full");
              }}
              saved={savedPlaces.some((item) => item.poiId === detailPoi.id)}
              onToggleSave={isPersistablePoi(detailPoi) ? () => {
                void handleToggleSave(detailPoi);
              } : undefined}
              onBack={() => {
                setDetailPoi(null);
                setMobileJd(null);
                setDrawer("half");
              }}
            />
          </div>
        ) : (
          <>
            <div className={styles.mobileToolbar}>
              <ModeSwitcher activeMode={mode} onModeChange={handleModeChange} />
              <button
                type="button"
                className={styles.mobileAvatarBtn}
                onClick={openMobileAccount}
                aria-label={user ? t("profile", lang) : t("notSignedIn", lang)}
              >
                {user?.avatarUrl ? (
                  <img className={styles.avatar} src={user.avatarUrl} alt="" />
                ) : user ? (
                  <div className={styles.avatar}>{initialsFromName(user.displayName)}</div>
                ) : (
                  <div className={`${styles.avatar} ${styles.avatarGuest}`}><Icon name="person" /></div>
                )}
              </button>
            </div>
            {mobileSheet === "explore" && (
            <div className={styles.mobileSearchStack}>
            <div className={styles.mobileSearchRow}>
              <div className={styles.mobileSearch}>
                <Icon name="search" />
                <input
                  type="search"
                  placeholder={modeConfig.searchPlaceholder}
                  value={query}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-controls="mobile-suggest"
                  aria-expanded={drawer !== "mini" && suggestions.length > 0}
                  aria-activedescendant={mobileSuggestIndex >= 0 ? `mobile-suggest-${mobileSuggestIndex}` : undefined}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    if (drawer === "mini") setDrawer("half");
                  }}
                  onFocus={() => {
                    if (drawer === "mini") setDrawer("half");
                  }}
                  onKeyDown={(e) => {
                    const action = suggestKeyAction(e.key, mobileSuggestIndex, suggestions.length);
                    if (action.type === "move") {
                      e.preventDefault();
                      setMobileSuggestIndex(action.index);
                      return;
                    }
                    if (action.type === "pick") {
                      e.preventDefault();
                      handleSelectSuggestion(suggestions[action.index]);
                      setMobileSuggestIndex(-1);
                      return;
                    }
                    if (action.type === "close") {
                      setMobileSuggestIndex(-1);
                      return;
                    }
                    if (action.type === "commit") void recordSearch(query, mode);
                  }}
                  aria-label={t("search", lang)}
                />
              </div>
              <button
                type="button"
                className={`${styles.mobileAvatarBtn} ${styles.mobileSearchAvatar}`}
                onClick={openMobileAccount}
                aria-label={user ? t("profile", lang) : t("notSignedIn", lang)}
              >
                {user?.avatarUrl ? (
                  <img className={styles.avatar} src={user.avatarUrl} alt="" />
                ) : user ? (
                  <div className={styles.avatar}>{initialsFromName(user.displayName)}</div>
                ) : (
                  <div className={`${styles.avatar} ${styles.avatarGuest}`}><Icon name="person" /></div>
                )}
              </button>
            </div>
            {drawer !== "mini" && suggestions.length > 0 && (
              <ul id="mobile-suggest" className={styles.mobileSuggestions} role="listbox" aria-label="Search suggestions">
                {suggestions.map((s, i) => (
                  <li key={`${s.id || s.name}-${i}`} id={`mobile-suggest-${i}`} role="option" aria-selected={i === mobileSuggestIndex}>
                    <button
                      type="button"
                      className={i === mobileSuggestIndex ? styles.mobileSuggestActive : undefined}
                      onMouseEnter={() => setMobileSuggestIndex(i)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectSuggestion(s);
                        setMobileSuggestIndex(-1);
                      }}
                    >
                      <span className={styles.mobileSuggestRow}>
                        <span className={styles.mobileSuggestIcon} aria-hidden="true">
                          {suggestionDisplayIcon(s)}
                        </span>
                        <strong>{s.name}</strong>
                        {s.distance != null && (
                          <span className={styles.mobileSuggestDist}>{formatDistance(s.distance)}</span>
                        )}
                      </span>
                      {s.subtitle && <small>{s.subtitle}</small>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            </div>
            )}
            <div ref={drawerContentRef} className={styles.drawerContent}>
              {mobileSheet === "account" ? (
                <div className={styles.mobileAccount}>
                  <div className={styles.mobileSheetBar}>
                    <button
                      type="button"
                      className={styles.mobileBackBtn}
                      onClick={() => setMobileSheet("explore")}
                    >
                      {t("backToExplore", lang)}
                    </button>
                  </div>
                  <div className={styles.mobileAccountNav} role="navigation" aria-label={t("profile", lang)}>
                    <button
                      type="button"
                      className={styles.mobileFilterBtn}
                      onClick={() => {
                        if (!user) {
                          setAuthOpen(true);
                          return;
                        }
                        setMobileSheet("saved");
                      }}
                    >
                      {t("saved", lang)}
                    </button>
                    <button
                      type="button"
                      className={styles.mobileFilterBtn}
                      onClick={() => setMobileSheet("layers")}
                    >
                      {t("layers", lang)}
                    </button>
                    <button
                      type="button"
                      className={styles.mobileFilterBtn}
                      onClick={() => setMobileSheet("recent")}
                    >
                      {t("recent", lang)}
                    </button>
                    <button
                      type="button"
                      className={styles.mobileFilterBtn}
                      onClick={() => setMobileSheet("explore")}
                    >
                      {t("explore", lang)}
                    </button>
                  </div>
                  {user ? (
                    <ProfilePanel
                      user={user}
                      lang={lang}
                      embedded
                      applications={applications}
                      notifications={inbox}
                      onClose={() => setMobileSheet("explore")}
                      onSave={handleSaveProfile}
                      onAvatarUrlChange={handleAvatarUrlChange}
                      onSignOut={handleAuthAction}
                      onOpenApplication={handleOpenApplication}
                    />
                  ) : (
                    <p className={styles.mobileAccountHint}>{t("signInHint", lang)}</p>
                  )}
                </div>
              ) : mobileSheet === "recent" ? (
                <RecentPanel
                  items={searchHistory}
                  signedIn={Boolean(user)}
                  lang={lang}
                  mode={mode}
                  embedded
                  onClose={() => setMobileSheet("account")}
                  onPick={(entry) => {
                    handlePickRecent(entry);
                    setMobileSheet("explore");
                  }}
                  onPickTrending={(item) => {
                    openExploreSearch(item.query);
                    setMobileSheet("explore");
                  }}
                  onClear={handleClearRecent}
                />
              ) : mobileSheet === "saved" ? (
                <div className={styles.mobileAccount}>
                  <div className={styles.mobileSheetBar}>
                    <button
                      type="button"
                      className={styles.mobileBackBtn}
                      onClick={() => setMobileSheet("account")}
                    >
                      {t("back", lang)}
                    </button>
                  </div>
                  <SavedList
                    items={savedPlaces}
                    signedIn={Boolean(user)}
                    lang={lang}
                    catalog={compareCatalog}
                    origin={distanceOrigin}
                    onPick={handlePickSaved}
                    onHover={handleHover}
                    onRemove={user ? handleRemoveSaved : undefined}
                  />
                </div>
              ) : mobileSheet === "layers" ? (
                <div className={styles.mobileLayers}>
                  <div className={styles.mobileSheetBar}>
                    <button
                      type="button"
                      className={styles.mobileBackBtn}
                      onClick={() => setMobileSheet("account")}
                    >
                      {t("back", lang)}
                    </button>
                  </div>
                  <button
                    type="button"
                    className={`${styles.mobileFilterBtn} ${savedOverlay ? styles.mobileFilterBtnActive : ""}`}
                    onClick={handleToggleSavedOverlay}
                    aria-pressed={savedOverlay}
                  >
                    {overlayPois.length ? `${t("savedOverlay", lang)} ${overlayPois.length}` : t("savedOverlay", lang)}
                  </button>
                  <div className={styles.mobileStyleRow} role="listbox" aria-label={t("mapStyle", lang)}>
                    {(
                      [
                        ["normal", "standard"],
                        ["satellite", "satellite"],
                        ["whitesmoke", "dark"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        role="option"
                        aria-selected={mapStyle === value}
                        className={`${styles.mobileFilterBtn} ${mapStyle === value ? styles.mobileFilterBtnActive : ""}`}
                        onClick={() => handleMapStyleChange(value)}
                      >
                        {t(label, lang)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
              <>
              <div className={styles.mobileActions}>
                <button
                  type="button"
                  className={`${styles.mobileFilterBtn} ${mobileFiltersOpen ? styles.mobileFilterBtnActive : ""}`}
                  onClick={() => {
                    setMobileFiltersOpen((open) => !open);
                    if (drawer === "mini") setDrawer("half");
                  }}
                  aria-expanded={mobileFiltersOpen}
                  aria-pressed={mobileFiltersOpen}
                >
                  {t("filter", lang)}
                  {Object.keys(filters).length > 0 && <span className={styles.mobileFilterDot} />}
                </button>
                <SortSelector
                  options={modeConfig.sortOptions}
                  value={sort}
                  onChange={setSort}
                  lang={lang}
                />
              </div>
              {mobileFiltersOpen && (
                <div className={styles.mobileFilters}>
                  <FilterPanel
                    filters={modeConfig.filters}
                    values={filters}
                    onChange={(key, value) => setFilters({ ...filters, [key]: value })}
                    onReset={() => setFilters({})}
                    resultCount={pois.length}
                    lang={lang}
                  />
                </div>
              )}
              <div className={styles.mobileMeta}>
                <span>{loading ? t("loading", lang) : `${pois.length} ${t("resultsCount", lang)}`}</span>
                <div className={styles.mobileMetaActions}>
                  {pois.length === 0 && !loading && (
                    <button
                      type="button"
                      className={styles.mobileIconBtn}
                      onClick={handleRefreshHere}
                      aria-label={t("refreshHere", lang)}
                    >
                      {t("refreshHere", lang)}
                    </button>
                  )}
                </div>
              </div>
              <POIList
                pois={pois}
                selectedId={selectedId}
                highlightedId={highlightedId}
                onSelect={(poi) => {
                  handleSelect(poi);
                  // 交互 1:进详情前保存抽屉列表滚动位置,返回时恢复
                  drawerScrollRef.current = drawerContentRef.current?.scrollTop ?? 0;
                  setDetailPoi(poi);
                  setMobileJd(null);
                  setDrawer("full");
                  if (poi.location) flyToLocation(mapInstance.current, poi.location.lng, poi.location.lat);
                }}
                onDeselect={() => {
                  // 交互 2:点卡片边缘空隙取消选中(与桌面点地图取消口径一致)
                  setSelectedId(null);
                  setHighlightedId(null);
                }}
                onHover={handleHover}
                loading={loading}
                lang={lang}
                accentColor={modeConfig.color}
                emptyTitle={mobileCandidateChips.length > 0 ? t("pickCategory", lang) : undefined}
                candidateCategories={mobileCandidateChips.length > 0 ? mobileCandidateChips : undefined}
                onPickCategory={(key, value) => setFilters(pickCategoryFilter(filters, mode, key, value))}
                onWidenSearch={handleWidenSearch}
                onNeedMore={handleNeedMore}
                loadingMore={loadingMore}
                error={error}
                onRetry={handleRetry}
                atCap={canonicalMode(mode) === "domain" && pois.length >= DOMAIN_POI_HARD_CAP}
                noMore={noMoreData}
              />
              </>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
