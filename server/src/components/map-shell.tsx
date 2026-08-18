"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styles from "./map-shell.module.css";
import { getBrowserLanguage, t, type Language } from "@/lib/i18n";
import type { FilterState, MapMode, POI } from "@/lib/types";
import { canonicalMode, getMode, replayRecentSearch } from "@/lib/modes";
import { fetchPOIsForMode } from "@/lib/poi-service";
import { getCurrentPosition, fetchSuggestions, loadAMap, suggestionToDomainPoi } from "@/lib/amap-api";
import { INTERNSHIP_SEED } from "@/lib/seed-data";
import { applyTagSuggestion, distanceFilterMeters, metersToDistanceKm, pointAtDistanceEast, runPOIPipeline, suggestRecruitment, suggestSearchTags, widenSearchScope } from "@/lib/search";
import { suggestKeyAction } from "@/lib/suggest-nav";
import { fetchPOIDetail, fetchSearchSuggest } from "@/lib/api";
import type { SearchSuggestion as ApiSearchSuggestion } from "@/lib/api";
import { haversineDistance, isRecruitmentMode, isRecruitmentPOI, formatDistance, type Position } from "@/lib/types";
import { batchMatchesCurrentMode, mergePoisById, MORE_PAGE_SIZE, POI_SOFT_CAP, DOMAIN_POI_HARD_CAP, DOMAIN_BATCH_SIZE, type ViewportBounds } from "@/lib/viewport-search";
import { createViewportLoader, loadWorkViewport, VIEWPORT_DEBOUNCE_MS, WORK_INITIAL_MAX_PAGES, type ViewportLoader } from "@/lib/viewport-search";
import { maxTierForZoom } from "@/lib/lod";
import { clearModeCache, readModeCache, writeModeCache } from "@/lib/mode-cache";
import type { AccountUser, ApplicationRecord, NotificationRecord, SavedPlace, SearchHistoryEntry, UserPreferences } from "@/lib/account";
import { initialsFromName } from "@/lib/account";
import { isPersistableMode, isPersistablePoi } from "@/lib/persistable";
import { addGuestHistory, clearGuestHistory, listGuestHistory, mergeGuestHistoryIntoAccount } from "@/lib/guest-search-history";
import {
  amapStyleUrl,
  MAP_STYLE_KEY,
  mergeMapPois,
  overlayBounds,
  parseMapStyle,
  readMapStylePref,
  readSavedOverlayPref,
  resolveSavedForFly,
  savedPlacesToOverlay,
  writeMapStylePref,
  writeSavedOverlayPref,
  type BasemapStyle,
} from "@/lib/saved-overlay";
import { usePOIMap } from "@/hooks/use-poi-map";
import { SecondarySidebar, suggestionDisplayIcon, type SearchSuggestion } from "./secondary-sidebar";
import { POIList } from "./poi-list";
import { ModeSwitcher } from "./mode-switcher";
import { FilterPanel } from "./filter-panel";
import { SortSelector } from "./sort-selector";

const POIDetailView = dynamic(() => import("./poi-detail").then((mod) => mod.POIDetailView));
const JdPanel = dynamic(() => import("./jd-panel").then((mod) => mod.JdPanel));
const AuthModal = dynamic(() => import("./auth-modal").then((mod) => mod.AuthModal));
const ProfilePanel = dynamic(() => import("./account-panel").then((mod) => mod.ProfilePanel));
const RecentPanel = dynamic(() => import("./recent-panel").then((mod) => mod.RecentPanel));
const SavedList = dynamic(() => import("./saved-panel").then((mod) => mod.SavedList));
const SavedPanel = dynamic(() => import("./saved-panel").then((mod) => mod.SavedPanel));
const LayersPanel = dynamic(() => import("./layers-panel").then((mod) => mod.LayersPanel));

function prefetchRail(panel: "layers" | "saved" | "recent" | "profile" | "auth" | "detail") {
  if (panel === "layers") void import("./layers-panel");
  else if (panel === "saved") void import("./saved-panel");
  else if (panel === "recent") void import("./recent-panel");
  else if (panel === "profile") void import("./account-panel");
  else if (panel === "auth") void import("./auth-modal");
  else {
    void import("./poi-detail");
    void import("./jd-panel");
  }
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

function flyToLocation(map: { setZoomAndCenter?: (zoom: number, center: [number, number], immediately?: boolean, duration?: number) => void; setZoom?: (zoom: number) => void; setCenter?: (center: [number, number]) => void } | null, lng: number, lat: number, zoom = 16) {
  if (!map) return;
  try {
    if (typeof map.setZoomAndCenter === "function") {
      map.setZoomAndCenter(zoom, [lng, lat], false, 600);
      return;
    }
  } catch {
    // fall through
  }
  map.setZoom?.(zoom);
  map.setCenter?.([lng, lat]);
}

/** /api/suggest 服务端建议 → 客户端 UI 形态。
 *  距离优先用客户端实时 origin 重算（地图平移/定位后仍新鲜），服务端 center
 *  算好的 distance 兜底；无 location 不显示距离。domain 行 kind 一律 place。 */
function mapApiSuggestion(
  tip: ApiSearchSuggestion,
  mode: MapMode,
  origin: { lng: number; lat: number } | null
): SearchSuggestion {
  const kind: SearchSuggestion["kind"] =
    tip.type === "position" ? "job" : tip.type === "tag" ? "place" : isRecruitmentMode(mode) ? "company" : "place";
  return {
    id: tip.id,
    name: tip.title,
    subtitle: tip.subtitle,
    location: tip.location,
    poiId: tip.poiId ?? (tip.type === "position" || tip.type === "tag" ? undefined : tip.id),
    positionId: tip.type === "position" ? tip.id : undefined,
    kind,
    icon: tip.icon,
    distance: tip.location && origin ? haversineDistance(tip.location, origin) : tip.distance,
  };
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

export function MapShell() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const userMarkerRef = useRef<any>(null);
  const accuracyCircleRef = useRef<any>(null);
  const distanceCircleRef = useRef<any>(null);
  const distanceHandleRef = useRef<any>(null);
  const draggingDistanceRef = useRef(false);
  const satelliteLayerRef = useRef<any>(null);
  const scaleControlRef = useRef<any>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pendingSearchFocus = useRef(false);
  const catalogRef = useRef<POI[]>([]);
  const poisRef = useRef<POI[]>([]);
  const [geoSettled, setGeoSettled] = useState(false);
  const ignoreNextMapClick = useRef(false);
  /** Domain 数据耗尽(稀疏视野/回退窗口空/无更多页):哨兵停止 + 「没有更多结果」 */
  const [noMoreData, setNoMoreData] = useState(false);
  const noMoreRef = useRef(false);
  /** 视口替换世代:主加载在 onBatch/落库前校验,丢弃过期的追加批次 */
  const viewportEpochRef = useRef(0);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [drawer, setDrawer] = useState<DrawerState>("mini");
  const [lang, setLang] = useState<Language>('zh');
  const [mapStyle, setMapStyle] = useState<BasemapStyle>('normal');
  const [zoom, setZoom] = useState(13);
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
  const [mapCenter, setMapCenter] = useState<{ lng: number; lat: number }>({ lng: 120.15, lat: 30.27 });
  const [mapBounds, setMapBounds] = useState<ViewportBounds | null>(null);
  const [userLocation, setUserLocation] = useState<{ lng: number; lat: number } | null>(null);
  const [searchOrigin, setSearchOrigin] = useState<{ lng: number; lat: number } | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [pageOffset, setPageOffset] = useState(0);
  const skipFetchRef = useRef(false);
  const loadingRef = useRef(false);
  /** 主加载在飞期间到达的视口刷新:置位后由主加载 finally 补跑,避免被吞(Bug 7) */
  const viewportRefreshPendingRef = useRef(false);
  /** 视口加载器实例(主加载 finally 需要触发补跑) */
  const viewportLoaderRef = useRef<ViewportLoader | null>(null);
  // 供一次性创建的地图监听/视口加载器读取最新状态(避免闭包过期)
  const viewStateRef = useRef({
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
  // 搜索建议（AutoComplete）
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [detailPoi, setDetailPoi] = useState<POI | null>(null);
  const [user, setUser] = useState<AccountUser | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>([]);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [inbox, setInbox] = useState<NotificationRecord[]>([]);
  const [savedOverlay, setSavedOverlay] = useState(true);

  useEffect(() => {
    setSavedOverlay(readSavedOverlayPref(true));
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
    refreshAccount().then((next) => {
      if (next?.preferences.defaultMode) setMode(next.preferences.defaultMode);
      void refreshHistory(Boolean(next));
      if (next) void mergeGuestHistoryOnSignIn();
    });
    refreshSaved();
    refreshApplications();
    refreshInbox();
  }, [refreshAccount, refreshHistory, refreshSaved, refreshApplications, refreshInbox, mergeGuestHistoryOnSignIn]);

  const recordSearch = useCallback(async (raw: string, searchMode: MapMode) => {
    const q = raw.trim();
    if (!q || !isPersistableMode(searchMode)) return;
    if (!user) {
      setSearchHistory(addGuestHistory(q, searchMode));
      return;
    }
    try {
      await fetch("/api/me/search-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, mode: searchMode }),
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

  // 地图初始化（保留原有全部逻辑）
  useEffect(() => {
    if (!mapContainer.current) return;

    const apiKey = process.env.NEXT_PUBLIC_AMAP_KEY;
    const securityCode = process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE;

    if (!apiKey || !securityCode) {
      console.warn("NEXT_PUBLIC_AMAP_KEY and NEXT_PUBLIC_AMAP_SECURITY_CODE are required");
      return;
    }

    // 单一 AMap 加载入口（复用 lib/amap-api.ts 的 loadAMap，避免双脚本冲突）
    loadAMap()
      .then(() => initMap())
      .catch((err) => {
        console.warn("[map-shell] AMap load failed:", err);
      });

    function initMap() {
      if (!mapContainer.current || mapInstance.current) return;
      // 先创建地图（Geolocation 蓝点需绑定到已存在的 map），创建后立即定位移动中心
      createMap([120.15, 30.27], 13);
    }

    function createMap(center: [number, number], zoom: number) {
      const systemFallback: BasemapStyle = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "whitesmoke"
        : "normal";
      const initialStyle = readMapStylePref(systemFallback);
      const initialMapStyle = amapStyleUrl(initialStyle === "satellite" ? "normal" : initialStyle);

      const map = new window.AMap.Map(mapContainer.current, {
        zoom: zoom,
        center: center,
        viewMode: "3D",
        pitch: 0,
        showLabel: true,
        mapStyle: initialMapStyle,
        rotateEnable: false,  // 禁用默认的右键旋转
      });

      mapInstance.current = map;
      setMapReady(true);

      // 初始定位：成功则移动地图中心 + 显示蓝点/精度圈（Geolocation 已 addControl 绑定 map）
      getCurrentPosition(map)
        .then((loc) => {
          if (!loc) {
            setGeoSettled(true);
            return;
          }
          const { lng, lat } = loc.position;
          map.setCenter([lng, lat]);
          map.setZoom(15);
          setMapCenter({ lng, lat });
          setUserLocation({ lng, lat });
          setSearchOrigin((prev) => prev ?? { lng, lat });
          setGeoSettled(true);
        })
        .catch(() => {
          setGeoSettled(true);
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
          startRotation = map.getRotation();
          startPitch = map.getPitch();
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

          map.setRotation(newRotation);
          map.setPitch(newPitch);
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

      setMapStyle(initialStyle);
      if (initialStyle === "satellite" && window.AMap?.TileLayer?.Satellite) {
        satelliteLayerRef.current = new window.AMap.TileLayer.Satellite({ map });
      }

      // 用户没写过底图偏好时才跟系统主题；选过卫星/浅色后不再被系统覆盖
      const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleThemeChange = (e: MediaQueryListEvent) => {
        if (parseMapStyle(window.sessionStorage.getItem(MAP_STYLE_KEY))) return;
        const next: BasemapStyle = e.matches ? "whitesmoke" : "normal";
        setMapStyle(next);
        map.setMapStyle(amapStyleUrl(next));
        if (satelliteLayerRef.current) satelliteLayerRef.current.hide();
      };
      darkModeQuery.addEventListener("change", handleThemeChange);

      // Add AMap's built-in scale control (real, auto-updating)
      // 移动端放左上角（避开底部抽屉），桌面端放左下角
      let scaleControl: any = null;
      window.AMap.plugin(['AMap.Scale'], () => {
        const isMobile = window.innerWidth <= 767;
        scaleControl = new window.AMap.Scale({
          position: isMobile ? 'LT' : 'LB', // 移动端左上角，桌面端左下角
          offset: isMobile ? [12, 22] : [90, 25], // 移动端避开顶部工具栏，桌面端避开侧边栏
        });
        map.addControl(scaleControl);
        scaleControlRef.current = scaleControl;
        // 同步初始显隐:抽屉全开/详情打开时比例尺隐藏(仅移动端)
        if (drawerFullishRef.current && window.innerWidth <= 767) scaleControl.hide();
      });

      // 监听窗口大小变化，在桌面/移动端切换时更新比例尺位置
      const handleResize = () => {
        if (!scaleControl) return;
        const isMobile = window.innerWidth <= 767;
        // 移除旧控件并创建新位置的控件
        map.removeControl(scaleControl);
        scaleControl = new window.AMap.Scale({
          position: isMobile ? 'LT' : 'LB',
          offset: isMobile ? [12, 22] : [90, 25],
        });
        map.addControl(scaleControl);
        scaleControlRef.current = scaleControl;
        if (drawerFullishRef.current && window.innerWidth <= 767) scaleControl.hide();
      };
      window.addEventListener('resize', handleResize);

      // Sync zoom state
      map.on("zoomchange", () => {
        const currentZoom = map.getZoom();
        setZoom(Math.round(currentZoom));
      });

      // 监听地图旋转变化
      map.on("rotatechange", () => {
        const currentRotation = map.getRotation();
        setRotation(currentRotation);
      });

      const syncView = () => {
        const center = map.getCenter();
        if (center) {
          setMapCenter({ lng: center.getLng(), lat: center.getLat() });
        }
        const b = typeof map.getBounds === "function" ? map.getBounds() : null;
        if (b) {
          const sw = b.getSouthWest?.() ?? b.southwest;
          const ne = b.getNorthEast?.() ?? b.northeast;
          const west = sw?.getLng?.() ?? sw?.lng;
          const south = sw?.getLat?.() ?? sw?.lat;
          const east = ne?.getLng?.() ?? ne?.lng;
          const north = ne?.getLat?.() ?? ne?.lat;
          if ([west, south, east, north].every((n) => typeof n === "number")) {
            setMapBounds({ west, south, east, north });
          }
        }
      };
      map.on("moveend", syncView);
      map.on("complete", syncView);
      map.on("click", () => {
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

    return () => {
      if (mapInstance.current) {
        mapInstance.current.destroy();
        mapInstance.current = null;
      }
      if (satelliteLayerRef.current) {
        satelliteLayerRef.current.destroy();
        satelliteLayerRef.current = null;
      }
      markersRef.current = [];
      userMarkerRef.current = null;
      accuracyCircleRef.current = null;
      if (distanceHandleRef.current) {
        distanceHandleRef.current.setMap?.(null);
        distanceHandleRef.current = null;
      }
      if (distanceCircleRef.current) {
        distanceCircleRef.current.setMap?.(null);
        distanceCircleRef.current = null;
      }
    };
  }, []);

  // ---- Phase 2: 累计池 + 钉死原点；移动地图不重搜 ----
  useEffect(() => {
    const signal = { cancelled: false };

    function liveView() {
      const map = mapInstance.current;
      const centerObj = map?.getCenter?.();
      const liveCenter =
        centerObj && typeof centerObj.getLng === "function"
          ? { lng: centerObj.getLng(), lat: centerObj.getLat() }
          : mapCenter;
      const liveZoom =
        typeof map?.getZoom === "function" ? Math.round(map.getZoom()) : zoom;
      let liveBounds = mapBounds;
      const b = typeof map?.getBounds === "function" ? map.getBounds() : null;
      if (b) {
        const sw = b.getSouthWest?.() ?? b.southwest;
        const ne = b.getNorthEast?.() ?? b.northeast;
        const west = sw?.getLng?.() ?? sw?.lng;
        const south = sw?.getLat?.() ?? sw?.lat;
        const east = ne?.getLng?.() ?? ne?.lng;
        const north = ne?.getLat?.() ?? ne?.lat;
        if ([west, south, east, north].every((n) => typeof n === "number")) {
          liveBounds = { west, south, east, north };
        }
      }
      return { center: liveCenter, zoom: liveZoom, bounds: liveBounds };
    }

    async function load() {
      if (!mapReady || !geoSettled) {
        return;
      }
      // skipFetch 先消费:它由缓存还原/模式切换/视口替换置位,即使上一轮
      // 加载仍在飞也必须立即消费,否则会残留到下一轮合法加载被吞掉。
      if (skipFetchRef.current) {
        skipFetchRef.current = false;
        setLoadingMore(false); // 被跳过的加载没有 finally,手动释放
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
      try {
        const view = liveView();
        const origin = searchOrigin ?? userLocation ?? view.center;
        const onBatch = (batch: POI[]) => {
          if (signal.cancelled) return;
          if (viewportEpochRef.current !== epoch) return; // 视口已刷新,丢弃过期批次
          if (!batchMatchesCurrentMode(viewStateRef.current.mode, mode)) return; // 模式已切换,丢弃过期批次
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
          });
          if (batch.length > 0) setLoading(false);
        };
        // 工作模式:按当前视野 + 档位上限按需加载(增量合并,不清空已有 marker);
        // Domain 模式:保持刷新才更新(高德 API 负载/余额),视野变化不重搜。
        let noMore = false;
        let data: POI[];
        if (isRecruitmentMode(mode)) {
          const result = await loadWorkViewport({
            bounds: view.bounds ?? undefined,
            maxTier: maxTierForZoom(view.zoom),
            filters,
            q: query || undefined,
            sort: sort || undefined,
            page: pageOffset + 1,
            maxPages: WORK_INITIAL_MAX_PAGES,
            existing: catalogRef.current,
            signal,
            onBatch,
          });
          data = result.pois;
          // work 数据到底由 loadWorkViewport 上报(短页/空页 break),
          // 与 domain 的 cap 语义分离——「没有更多」= 数据源到底,不是 3000 封顶。
          noMore = result.noMore;
        } else {
          data = await fetchPOIsForMode({
            mode,
            query: query || undefined,
            center: origin,
            zoom: view.zoom,
            bounds: view.bounds ?? undefined,
            existing: mode === "domain" ? catalogRef.current : undefined,
            addCap: mode === "domain" ? DOMAIN_BATCH_SIZE : MORE_PAGE_SIZE,
            pageOffset,
            signal,
            onBatch,
          });
          // 数据耗尽判定(仅 domain):本轮零新增且此前有数据 → 哨兵停止,
          // 显示「没有更多结果」。覆盖:稀疏视野(<1000)、高德回退窗口耗尽、
          // 关键词无更多页。否则哨兵会无限空转(每轮发请求但 0 新增)。
          noMore =
            canonicalMode(mode) === "domain" && beforeLen > 0 && data.length <= beforeLen;
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
    // 刻意不依赖 mapCenter / zoom / mapBounds / filters：平移、缩放、筛选都不重搜。
    // work 模式的首屏/刷新按当前视野(bounds+maxTier)取数;视野变化后的按需加载
    // 由下方 moveend/zoomend 防抖 effect 负责。
    // 使用原始值而非对象引用，避免 React 误判依赖变化
  }, [mode, query, mapReady, geoSettled, refreshToken, pageOffset, searchOrigin?.lng, searchOrigin?.lat, userLocation?.lng, userLocation?.lat]);

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
        const mode = canonicalMode(v.mode);
        if (mode === "work") {
          // 视口替换:新视野 = 新一批(镜像 domain 分支,tech/22「替换+淡入」)。
          // 不再用 existing 增量合并——工作目录公司少,首屏+加载更多几乎全捕获,
          // merge 后去重无变化,列表冻结(用户 Bug 7)。
          // 新视野重新分页:清除上一视野的「没有更多结果」状态(w3 noMore 对接)
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
            const result = await loadWorkViewport({
              bounds,
              maxTier: maxTierForZoom(zoom),
              filters: v.filters,
              q: v.query || undefined,
              sort: v.sort || undefined,
              page: 1,
              existing: [], // 替换:新视野清空旧卡片
              onBatch: (batch) => {
                // 模式守卫:切换模式后,旧模式在飞的批次(公司/地图 POI)不得
                // 落进新模式的 catalog,否则工作公司会混入地图列表与 marker
                if (!batchMatchesCurrentMode(viewStateRef.current.mode, mode)) return;
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
                });
              },
            });
            // 视口页(短页 break)决定新视野是否已到底;未到底保持可继续滚动
            noMoreRef.current = result.noMore;
            setNoMoreData(result.noMore);
          } catch (err) {
            // 视口加载失败不打断主流程:保留现有累计池,下次地图事件再试
            console.warn("[map-shell] work viewport load failed:", err);
          }
          return;
        }
        // Domain:随视角变化刷新(替换+淡入)——按 live bounds 重新取第一批,
        // existing=[] 清空旧列表,offset 归零(新视野 = 新一批)。
        if (mode === "domain") {
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
            await fetchPOIsForMode({
              mode,
              query: v.query || undefined,
              center: v.searchOrigin ?? undefined,
              zoom,
              bounds,
              existing: [], // 替换:新视野清空旧卡片
              addCap: DOMAIN_BATCH_SIZE,
              pageOffset: 0,
              onBatch: (batch) => {
                // 模式守卫:同上——域名刷新批次不得落进切换后的工作模式
                if (!batchMatchesCurrentMode(viewStateRef.current.mode, mode)) return;
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
                });
              },
            });
          } catch (err) {
            console.warn("[map-shell] domain viewport load failed:", err);
          }
          return;
        }
      },
    });

    const onViewChange = () => loader.schedule();
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

  const distanceOrigin = userLocation ?? mapCenter;
  const distanceRadius = distanceFilterMeters(filters);
  const distanceOriginRef = useRef(distanceOrigin);
  const distanceRadiusRef = useRef(distanceRadius);
  distanceOriginRef.current = distanceOrigin;
  distanceRadiusRef.current = distanceRadius;

  useEffect(() => {
    const map = mapInstance.current;
    const AMap = typeof window !== "undefined" ? window.AMap : undefined;
    if (!map || !AMap?.Circle || !AMap?.Marker) return;

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
      distanceCircleRef.current = new AMap.Circle({
        center: [origin.lng, origin.lat],
        radius: distanceRadius,
        strokeColor: "#007AFF",
        strokeOpacity: 0.85,
        strokeWeight: 2,
        fillColor: "#007AFF",
        fillOpacity: 0.08,
        bubble: true,
        zIndex: 20,
      });
      map.add(distanceCircleRef.current);
    } else if (!draggingDistanceRef.current) {
      distanceCircleRef.current.setCenter([origin.lng, origin.lat]);
      distanceCircleRef.current.setRadius(distanceRadius);
      if (!distanceCircleRef.current.getMap()) map.add(distanceCircleRef.current);
    }

    if (!distanceHandleRef.current) {
      distanceHandleRef.current = new AMap.Marker({
        position: [handlePos.lng, handlePos.lat],
        offset: new AMap.Pixel(-9, -9),
        zIndex: 130,
        cursor: "ew-resize",
        bubble: false,
        content:
          '<div style="width:18px;height:18px;border-radius:50%;background:#007AFF;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,122,255,0.35)"></div>',
      });
      map.add(distanceHandleRef.current);
    } else if (!draggingDistanceRef.current) {
      distanceHandleRef.current.setPosition([handlePos.lng, handlePos.lat]);
      if (!distanceHandleRef.current.getMap()) map.add(distanceHandleRef.current);
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
      map.setStatus({ dragEnable: false });
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
      map.setStatus({ dragEnable: true });
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
    map.on("mousemove", onMapMove);
    map.on("mouseup", onMapUp);
    const onDocUp = () => endDrag(null);
    document.addEventListener("mouseup", onDocUp);

    return () => {
      handle.off("mousedown", onHandleDown);
      map.off("mousemove", onMapMove);
      map.off("mouseup", onMapUp);
      document.removeEventListener("mouseup", onDocUp);
      if (draggingDistanceRef.current) {
        draggingDistanceRef.current = false;
        map.setStatus({ dragEnable: true });
      }
    };
  }, [distanceOrigin, distanceRadius, mapReady]);

  const pois = useMemo(
    () =>
      runPOIPipeline(catalog, {
        query: query || undefined,
        filters: Object.keys(filters).length ? filters : undefined,
        sort: sort || undefined,
        center: distanceOrigin,
      }),
    [catalog, query, filters, sort, distanceOrigin]
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

  const overlayPois = useMemo(
    () => savedPlacesToOverlay(savedPlaces, compareCatalog, mode),
    [savedPlaces, compareCatalog, mode],
  );
  const mapPois = useMemo(
    () => mergeMapPois(pois, overlayPois, savedOverlay && Boolean(user)),
    [pois, overlayPois, savedOverlay, user],
  );

  const handleRefreshHere = useCallback(() => {
    const map = mapInstance.current;
    const centerObj = map?.getCenter?.();
    const next =
      centerObj && typeof centerObj.getLng === "function"
        ? { lng: centerObj.getLng(), lat: centerObj.getLat() }
        : mapCenter;
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
    // 无限滚动:Domain 模式到 DOMAIN_POI_HARD_CAP(1000)封顶;
    // work 模式保持 POI_HARD_CAP(3000,由 fetch 侧控制)。两种模式共用
    // noMore 短路:数据已耗尽(work 短页到底 / domain 稀疏视野无更多页),
    // 哨兵停止触发,不再递增 pageOffset。
    if (noMoreRef.current) return; // 数据已耗尽,哨兵停止触发
    if (canonicalMode(mode) === "domain") {
      if (catalogRef.current.length >= DOMAIN_POI_HARD_CAP) return;
    }
    if (loadingRef.current) return; // 防重入:上一批加载中不重复触发
    setLoadingMore(true);
    setPageOffset((n) => n + 1);
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
    pois: mapPois,
    selectedId,
    highlightedId,
    accentColor: modeConfig.color,
    onMarkerClick: (id) => {
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
    // 地图初始化期间不处理选中，避免触发重新加载
    if (!mapReady || !geoSettled) {
      return;
    }
    setSelectedId(poi.id);
  }, [mapReady, geoSettled]);

  // 卡片 hover → 高亮 marker
  const handleHover = useCallback((id: string | null) => {
    setHighlightedId(id);
  }, []);

  const handleToggleSavedOverlay = useCallback(() => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    const next = !savedOverlay;
    writeSavedOverlayPref(next);
    setSavedOverlay(next);
    if (!next) return;
    const bounds = overlayBounds(overlayPois);
    const map = mapInstance.current;
    if (!bounds || !map || overlayPois.length === 0) return;
    try {
      const AMap = (window as unknown as { AMap?: { Bounds: new (sw: number[], ne: number[]) => unknown } }).AMap;
      if (AMap?.Bounds) {
        map.setBounds(new AMap.Bounds([bounds.sw.lng, bounds.sw.lat], [bounds.ne.lng, bounds.ne.lat]));
        return;
      }
    } catch {
      // fall through
    }
    map.setCenter?.([overlayPois[0].location.lng, overlayPois[0].location.lat]);
  }, [user, savedOverlay, overlayPois]);

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
  // work：/api/suggest 服务端目录（公司 + 岗位 + 标签），0 命中/报错回退本地池；
  // domain：本地优先（/api/suggest → hz_pois 前缀匹配），0 命中/报错回退高德
  //   AutoComplete 一次，回退失败返回空列表不卡死。
  // 依赖只留 [query, mode]：之前 [query, mode, zoom, catalog] 里 catalog 每批替换、
  // zoom 每次平移都取消 200ms 定时器——hz-poi Stage 4 后 catalog 高频变化，
  // 候选列表永远不落地。zoom/catalog 改经 ref 读取。
  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      const origin = distanceOriginRef.current;

      if (isRecruitmentMode(mode)) {
        const fallback = () => {
          const pool = catalogRef.current.length ? catalogRef.current : INTERNSHIP_SEED;
          const tags = suggestSearchTags(query, 3).map((tag) => ({
            id: tag.id,
            name: tag.title,
            subtitle: tag.key,
            kind: "place" as const,
          }));
          const tips = suggestRecruitment(pool, query, 8).map((tip) => ({
            id: tip.id,
            name: tip.name,
            subtitle: tip.subtitle,
            location: tip.location,
            poiId: tip.poiId,
            positionId: tip.positionId,
            kind: tip.kind,
          }));
          return [...tags, ...tips].slice(0, 8);
        };
        try {
          const res = await fetchSearchSuggest(query.trim(), mode, origin);
          if (cancelled) return;
          if (!res.suggestions.length) {
            setSuggestions(fallback());
            return;
          }
          setSuggestions(res.suggestions.map((tip) => mapApiSuggestion(tip, mode, origin)));
        } catch {
          if (!cancelled) setSuggestions(fallback());
        }
        return;
      }

      // domain：本地优先
      try {
        const res = await fetchSearchSuggest(query.trim(), mode, origin);
        if (cancelled) return;
        if (res.suggestions.length) {
          setSuggestions(res.suggestions.map((tip) => mapApiSuggestion(tip, mode, origin)));
          return;
        }
      } catch {
        if (cancelled) return;
      }
      // 本地 0 命中 / 请求失败 → 回退高德 AutoComplete 一次
      try {
        const tips = await fetchSuggestions(query.trim(), zoomRef.current <= 8 ? "全国" : "");
        if (cancelled) return;
        setSuggestions(
          tips.map((tip) => ({
            id: tip.id,
            name: tip.name,
            subtitle: [tip.district, tip.address].filter(Boolean).join(" · ") || tip.type,
            location: tip.location,
            kind: "place",
            icon: "📍",
          }))
        );
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, mode]);

  useEffect(() => {
    setMobileSuggestIndex(-1);
  }, [query, suggestions.length]);

  // 选择建议 → 定位；招聘建议打开对应公司（服务端目录未加载的公司经
  // /api/pois/[id] 拉详情）；domain 建议本地已加载打开富卡，否则用 location
  // upsert 会话卡（不再依赖客户端 catalog 里有没有——之前 /api/suggest 匹配
  // 全量服务端目录，指向未加载公司时点击无任何反应）；#标签写入筛选插件。
  const handleSelectSuggestion = useCallback((s: SearchSuggestion) => {
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
    void recordSearch(s.name, mode);
  }, [catalog, pois, mode, recordSearch, query, filters]);

  const handleZoomIn = () => {
    if (mapInstance.current) {
      mapInstance.current.zoomIn();
    }
  };

  const handleZoomOut = () => {
    if (mapInstance.current) {
      mapInstance.current.zoomOut();
    }
  };

  const handleResetCompass = () => {
    if (!mapInstance.current) return;
    // 使用动画平滑过渡到正北，同时重置俯仰角
    mapInstance.current.setRotation(0, true, 300);  // 300ms 动画
    mapInstance.current.setPitch(0, true, 300);
  };

  const handleLocate = () => {
    if (!mapInstance.current) return;

    // 用 AMap.Geolocation 定位（addControl 绑定到 map，蓝点 + 精度圈渲染在地图上）
    getCurrentPosition(mapInstance.current)
      .then((loc) => {
        if (!loc) {
          console.warn("Geolocation failed, returning to default center");
          mapInstance.current.setCenter([120.15, 30.27]);
          mapInstance.current.setZoom(13);
          return;
        }
        const { lng, lat } = loc.position;
        mapInstance.current.setCenter([lng, lat]);
        mapInstance.current.setZoom(15);
        setMapCenter({ lng, lat });
      })
      .catch((err) => {
        console.warn("Geolocation error:", err);
        mapInstance.current.setCenter([120.15, 30.27]);
        mapInstance.current.setZoom(13);
      });
  };

  const handleMapStyleChange = (style: BasemapStyle) => {
    writeMapStylePref(style);
    setMapStyle(style);
    if (!mapInstance.current) return;

    if (style === "satellite") {
      if (!satelliteLayerRef.current) {
        satelliteLayerRef.current = new window.AMap.TileLayer.Satellite({
          map: mapInstance.current,
        });
      } else {
        satelliteLayerRef.current.show();
      }
      mapInstance.current.setMapStyle(amapStyleUrl("normal"));
      return;
    }

    mapInstance.current.setMapStyle(amapStyleUrl(style));
    if (satelliteLayerRef.current) satelliteLayerRef.current.hide();
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

  const handlePickRecent = useCallback((entry: SearchHistoryEntry) => {
    const replay = replayRecentSearch(mode, entry);
    if (replay.modeChanged) handleModeChange(replay.mode);
    openExploreSearch(replay.query);
  }, [mode, handleModeChange, openExploreSearch]);

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
          // 地图初始化期间不处理详情打开，避免触发重新加载
          if (!mapReady || !geoSettled) return;
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
          onSignOut={handleAuthAction}
          applications={applications}
          notifications={inbox}
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
                      onSignOut={handleAuthAction}
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
                onWidenSearch={handleWidenSearch}
                onNeedMore={handleNeedMore}
                loadingMore={loadingMore}
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
