"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./map-shell.module.css";
import { getBrowserLanguage, t, type Language } from "@/lib/i18n";
import type { FilterState, MapMode, POI } from "@/lib/types";
import { canonicalMode, getMode, replayRecentSearch } from "@/lib/modes";
import { fetchPOIsForMode } from "@/lib/poi-service";
import { getCurrentPosition, fetchSuggestions, loadAMap } from "@/lib/amap-api";
import { INTERNSHIP_SEED } from "@/lib/seed-data";
import { applyTagSuggestion, activeFilterChips, distanceFilterMeters, metersToDistanceKm, pointAtDistanceEast, removeFilterChip, runPOIPipeline, suggestRecruitment, suggestSearchTags, widenSearchScope } from "@/lib/search";
import { suggestKeyAction } from "@/lib/suggest-nav";
import { fetchSearchSuggest } from "@/lib/api";
import { trendingForMode } from "@/lib/trending-search";
import { haversineDistance, isRecruitmentMode, isRecruitmentPOI, type Position } from "@/lib/types";
import { MORE_PAGE_SIZE, type ViewportBounds } from "@/lib/viewport-search";
import { clearModeCache, readModeCache, writeModeCache } from "@/lib/mode-cache";
import type { AccountUser, ApplicationRecord, NotificationRecord, SavedPlace, SearchHistoryEntry, UserPreferences } from "@/lib/account";
import { initialsFromName } from "@/lib/account";
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
import { SecondarySidebar, type SearchSuggestion } from "./secondary-sidebar";
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
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pendingSearchFocus = useRef(false);
  const catalogRef = useRef<POI[]>([]);
  const poisRef = useRef<POI[]>([]);
  const [geoSettled, setGeoSettled] = useState(false);
  const ignoreNextMapClick = useRef(false);

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lng: number; lat: number }>({ lng: 120.15, lat: 30.27 });
  const [mapBounds, setMapBounds] = useState<ViewportBounds | null>(null);
  const [userLocation, setUserLocation] = useState<{ lng: number; lat: number } | null>(null);
  const [searchOrigin, setSearchOrigin] = useState<{ lng: number; lat: number } | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [pageOffset, setPageOffset] = useState(0);
  const skipFetchRef = useRef(false);
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
  const drawerSwipeRef = useRef<{ y: number } | null>(null);

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

  const refreshHistory = useCallback(async () => {
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
    refreshAccount().then((next) => {
      if (next?.preferences.defaultMode) setMode(next.preferences.defaultMode);
    });
    refreshHistory();
    refreshSaved();
    refreshApplications();
    refreshInbox();
  }, [refreshAccount, refreshHistory, refreshSaved, refreshApplications, refreshInbox]);

  useEffect(() => {
    if (!user) return;
    if (!user.preferences.notifications.emailJobs && !user.preferences.notifications.smsJobs) return;
    void scanJobAlerts();
  }, [user, scanJobAlerts]);

  const recordSearch = useCallback(async (raw: string, searchMode: MapMode) => {
    const q = raw.trim();
    if (!q || !user) return;
    try {
      await fetch("/api/me/search-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, mode: searchMode }),
      });
      refreshHistory();
    } catch {
      // 未登录或网络失败时忽略
    }
  }, [refreshHistory, user]);

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
      window.AMap.plugin(['AMap.Scale'], () => {
        const isMobile = window.innerWidth <= 767;
        const scale = new window.AMap.Scale({
          position: isMobile ? 'LT' : 'LB', // 移动端左上角，桌面端左下角
          offset: isMobile ? [12, 22] : [90, 25], // 移动端避开顶部工具栏，桌面端避开侧边栏
        });
        map.addControl(scale);
      });

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
      if (!mapReady || !geoSettled) return;
      if (skipFetchRef.current) {
        skipFetchRef.current = false;
        return;
      }
      const cached = catalogRef.current.length > 0 ? readModeCache(mode) : null;
      if (cached && cached.catalog.length > 0 && pageOffset === cached.pageOffset && refreshToken === 0) {
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const view = liveView();
        const origin = searchOrigin ?? userLocation ?? view.center;
        const data = await fetchPOIsForMode({
          mode,
          query: query || undefined,
          center: origin,
          zoom: view.zoom,
          bounds: view.bounds ?? undefined,
          existing: mode === "domain" ? catalogRef.current : undefined,
          addCap: MORE_PAGE_SIZE,
          pageOffset,
          signal,
          onBatch: (batch) => {
            if (signal.cancelled) return;
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
          },
        });
        if (signal.cancelled) return;
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
      } catch (err) {
        if (!signal.cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load POIs");
        }
      } finally {
        if (!signal.cancelled) setLoading(false);
      }
    }

    const timer = setTimeout(load, query ? 300 : 80);
    return () => {
      signal.cancelled = true;
      clearTimeout(timer);
    };
    // 刻意不依赖 mapCenter / zoom / mapBounds / filters：平移、缩放、筛选都不重搜
  }, [mode, query, mapReady, geoSettled, refreshToken, pageOffset, searchOrigin, userLocation]);

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
  const filterChips = useMemo(
    () => activeFilterChips(filters, modeConfig.filters),
    [filters, modeConfig.filters],
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
    () => savedPlacesToOverlay(savedPlaces, compareCatalog),
    [savedPlaces, compareCatalog],
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
    setRefreshToken((n) => n + 1);
  }, [mapCenter, mode]);

  const handleNeedMore = useCallback(() => {
    setPageOffset((n) => n + 1);
  }, []);

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
    setSelectedId(poi.id);
  }, []);

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
  // Domain：高德地点 AutoComplete；实习/招聘：公司 + 岗位，不走 POI
  useEffect(() => {
    if (!query.trim()) {
      setSuggestions(
        trendingForMode(mode).map((item) => ({
          id: `trend:${item.query}`,
          name: item.query,
          subtitle: item.label && item.label !== item.query ? item.label : undefined,
          kind: "place" as const,
        })),
      );
      return;
    }

    if (isRecruitmentMode(mode)) {
      let cancelled = false;
      const timer = setTimeout(async () => {
        const fallback = () => {
          const pool = catalog.length ? catalog : INTERNSHIP_SEED;
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
          const res = await fetchSearchSuggest(query.trim(), mode);
          if (cancelled) return;
          if (!res.suggestions.length) {
            setSuggestions(fallback());
            return;
          }
          setSuggestions(
            res.suggestions.map((tip) => ({
              id: tip.id,
              name: tip.title,
              subtitle: tip.subtitle,
              poiId: tip.poiId ?? (tip.type === "position" || tip.type === "tag" ? undefined : tip.id),
              positionId: tip.type === "position" ? tip.id : undefined,
              kind: tip.type === "position" ? "job" : tip.type === "tag" ? "place" : "company",
            })),
          );
        } catch {
          if (!cancelled) setSuggestions(fallback());
        }
      }, 200);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const tips = await fetchSuggestions(query.trim(), zoom <= 8 ? "全国" : "");
        if (!cancelled) {
          setSuggestions(
            tips.map((tip) => ({
              id: tip.id,
              name: tip.name,
              subtitle: [tip.district, tip.address].filter(Boolean).join(" · ") || tip.type,
              location: tip.location,
              kind: "place",
            }))
          );
        }
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, mode, zoom, catalog]);

  useEffect(() => {
    setMobileSuggestIndex(-1);
  }, [query, suggestions.length]);

  // 选择建议 → 定位；招聘建议打开对应公司；#标签写入筛选插件
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
    if (s.poiId) {
      const company =
        catalog.find((p) => p.id === s.poiId) ??
        pois.find((p) => p.id === s.poiId) ??
        INTERNSHIP_SEED.find((p) => p.id === s.poiId);
      if (company) {
        setSelectedId(company.id);
        setDetailPoi(company);
        setDrawer("full");
        if (s.positionId && isRecruitmentPOI(company)) {
          const pos = company.positions.find((item) => item.id === s.positionId);
          setOpenPositionId(s.positionId);
          setMobileJd(pos ?? null);
        } else {
          setOpenPositionId(null);
          setMobileJd(null);
        }
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
        setSearchHistory([]);
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

  const handleDrawerSwipeStart = (event: { clientY: number }) => {
    drawerSwipeRef.current = { y: event.clientY };
  };

  const handleDrawerSwipeEnd = (event: { clientY: number }) => {
    const start = drawerSwipeRef.current;
    drawerSwipeRef.current = null;
    if (!start) return;
    const dy = event.clientY - start.y;
    if (Math.abs(dy) < 36) return;
    if (dy < 0) {
      if (detailPoi || mobileJd) return;
      setDrawer((current) => (current === "mini" ? "half" : "full"));
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
    setDrawer((current) => (current === "full" ? "half" : "mini"));
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
          <input
            ref={searchInputRef}
            type="search"
            placeholder={t('searchPlaceholder', lang)}
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
        <div className={styles.modeSwitcherWrapper}>
          <ModeSwitcher activeMode={mode} onModeChange={handleModeChange} />
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
        onWidenSearch={handleWidenSearch}
        saved={Boolean(detailPoi && savedPlaces.some((item) => item.poiId === detailPoi.id))}
        onToggleSave={handleToggleSave}
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
          onClear={user ? () => {
            void fetch("/api/me/search-history", { method: "DELETE" }).then(refreshHistory);
          } : undefined}
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
          });
          void refreshHistory();
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

      <div className={styles.topTools}>
        <button className={`${styles.toolButton} ${styles.compassButton}`} onClick={handleResetCompass} aria-label="Reset compass">
          <svg className={styles.compassNeedle} viewBox="0 0 20 20" width="28" height="28" style={{ transform: `rotate(${rotation}deg)` }}>
            <path d="M10 1 L12 10 L10 8.5 L8 10 Z" fill="#ff3b30" />
            <path d="M10 19 L8 10 L10 11.5 L12 10 Z" fill="#e5e5ea" />
          </svg>
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

      <section className={`${styles.mobileDrawer} ${detailPoi || drawer === "full" ? styles.drawerFull : drawer === "half" ? styles.drawerHalf : styles.drawerMini}`} aria-label={t("explore", lang)}>
        <button
          className={styles.drawerHandle}
          onClick={() => {
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
          onPointerDown={(event) => handleDrawerSwipeStart(event)}
          onPointerUp={(event) => handleDrawerSwipeEnd(event)}
          onPointerCancel={() => {
            drawerSwipeRef.current = null;
          }}
          aria-label={mobileJd ? t("closeJd", lang) : detailPoi ? t("backToList", lang) : `Expand drawer from ${drawer} state`}
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
              onToggleSave={() => {
                void handleToggleSave(detailPoi);
              }}
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
                      <strong>{s.name}</strong>
                      {s.subtitle && <small>{s.subtitle}</small>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            </div>
            )}
            <div className={styles.drawerContent}>
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
                  onClear={user ? () => {
                    void fetch("/api/me/search-history", { method: "DELETE" }).then(refreshHistory);
                  } : undefined}
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
              {filterChips.length > 0 && (
                <div className={styles.mobileChips} aria-label={t("activeFilters", lang)}>
                  {filterChips.map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      className={styles.mobileChip}
                      onClick={() => setFilters(removeFilterChip(filters, chip))}
                      aria-label={`${t("removeFilter", lang)} ${chip.title}`}
                    >
                      {chip.title}
                      <span aria-hidden="true">×</span>
                    </button>
                  ))}
                </div>
              )}
              <div className={styles.mobileMeta}>
                <span>{loading ? t("loading", lang) : `${pois.length} ${t("resultsCount", lang)}`}</span>
                <div className={styles.mobileMetaActions}>
                  <button
                    type="button"
                    className={styles.mobileIconBtn}
                    onClick={handleRefreshHere}
                    disabled={loading}
                    aria-label={t("refreshHere", lang)}
                  >
                    {t("refreshHere", lang)}
                  </button>
                  <button
                    type="button"
                    className={styles.mobileIconBtn}
                    onClick={handleNeedMore}
                    disabled={loading}
                    aria-label={t("needMore", lang)}
                  >
                    {t("needMore", lang)}
                  </button>
                </div>
              </div>
              <POIList
                pois={pois}
                selectedId={selectedId}
                highlightedId={highlightedId}
                onSelect={(poi) => {
                  handleSelect(poi);
                  setDetailPoi(poi);
                  setMobileJd(null);
                  setDrawer("full");
                  if (poi.location) flyToLocation(mapInstance.current, poi.location.lng, poi.location.lat);
                }}
                onHover={handleHover}
                loading={loading}
                lang={lang}
                accentColor={modeConfig.color}
                onWidenSearch={handleWidenSearch}
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
