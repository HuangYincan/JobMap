"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./map-shell.module.css";
import { t, type Language } from "@/lib/i18n";
import type { FilterState, MapMode, POI } from "@/lib/types";
import { getMode } from "@/lib/modes";
import { fetchPOIsForMode } from "@/lib/poi-service";
import { getCurrentPosition, fetchSuggestions, loadAMap } from "@/lib/amap-api";
import { SecondarySidebar, type SearchSuggestion } from "./secondary-sidebar";
import { usePOIMap } from "@/hooks/use-poi-map";

type DrawerState = "mini" | "half" | "full";

function Icon({ name }: { name: "search" | "layers" | "bookmark" | "grid" | "history" | "settings" | "menu" | "compass" | "locate" }) {
  const paths: Record<string, string> = {
    search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm6-2 4 4",
    layers: "m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5",
    bookmark: "M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4-6 4V4Z",
    grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
    history: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2",
    settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0 0v5m0-17v5m7 3h-5m-9 0H0m15.36 8.36-3.54-3.54M8.18 8.18 4.64 4.64m10.72 0-3.54 3.54M8.18 15.82l-3.54 3.54",
    menu: "M3 6h18M3 12h18M3 18h18",
    compass: "m12 2 3 10-10 3-3-10 10-3Z",
    locate: "M12 2v4m0 12v4M2 12h4m12 0h4m-6 6a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z",
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
  const satelliteLayerRef = useRef<any>(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [drawer, setDrawer] = useState<DrawerState>("mini");
  const [lang, setLang] = useState<Language>('zh');
  const [showBasemap, setShowBasemap] = useState(false);
  const [mapStyle, setMapStyle] = useState<'normal' | 'satellite' | 'whitesmoke'>('normal');
  const [zoom, setZoom] = useState(13);
  const [mapReady, setMapReady] = useState(false);
  const [rotation, setRotation] = useState(0);

  // ---- Phase 2 多模式状态 ----
  const [mode, setMode] = useState<MapMode>('domain');
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<FilterState>({});
  const [sort, setSort] = useState("distance");
  const [pois, setPois] = useState<POI[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lng: number; lat: number }>({ lng: 120.15, lat: 30.27 });
  const [error, setError] = useState<string | null>(null);
  // 左侧结果面板显隐（点击导航"探索"展开）
  const [exploreOpen, setExploreOpen] = useState(false);
  // 搜索建议（AutoComplete）
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);

  const modeConfig = getMode(mode);

  // 初始化语言设置 - 默认英文，未来可从用户偏好读取
  useEffect(() => {
    setLang('en');  // 先按全英开发
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

      // 用 AMap.Geolocation 获取当前位置（融合 H5/IP/SDK 定位，自带精度圈 + 蓝点）
      getCurrentPosition()
        .then((loc) => {
          if (!loc) {
            // 定位失败 → 默认中心（杭州）
            createMap([120.15, 30.27], 13);
            return;
          }
          const { lng, lat } = loc.position;
          createMap([lng, lat], 15);
          setMapCenter({ lng, lat });
          // 由 AMap.Geolocation 插件负责绘制精度圈 + 蓝点（见 createMap 内注册）
        })
        .catch(() => {
          createMap([120.15, 30.27], 13);
        });
    }

    function createMap(center: [number, number], zoom: number) {
      // Detect system dark mode preference
      const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const initialMapStyle = isDarkMode ? 'amap://styles/whitesmoke' : 'amap://styles/normal';

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

      // Set initial mapStyle state based on dark mode
      setMapStyle(isDarkMode ? 'whitesmoke' : 'normal');

      // Listen for system theme changes and update map style dynamically
      const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleThemeChange = (e: MediaQueryListEvent) => {
        const newStyleName = e.matches ? 'whitesmoke' : 'normal';
        const newMapStyle = e.matches ? 'amap://styles/whitesmoke' : 'amap://styles/normal';
        setMapStyle(newStyleName);
        map.setMapStyle(newMapStyle);
      };
      darkModeQuery.addEventListener('change', handleThemeChange);

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

      // 地图移动/缩放后更新中心点（用于 POI 距离计算）
      map.on("moveend", () => {
        const center = map.getCenter();
        if (center) {
          setMapCenter({ lng: center.getLng(), lat: center.getLat() });
        }
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
    };
  }, []);

  // ---- Phase 2: POI 数据加载 ----
  // mode/query/filters/sort/mapCenter 变化 → 重新获取
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchPOIsForMode({
          mode,
          query: query || undefined,
          filters: Object.keys(filters).length ? filters : undefined,
          sort: sort || undefined,
          center: mapCenter,
          zoom,
        });
        if (!cancelled) {
          setPois(data);
          setSelectedId(null);
          setHighlightedId(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load POIs');
          setPois([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    // 搜索输入防抖 300ms（tech/10-search-filter.md）
    const timer = setTimeout(load, query ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // mapReady：地图初始化完成（= AMap 就绪）后重新拉取真实 POI，
    // 避免首次加载时 AMap 未就绪而回退到 seed 数据。
    // zoom：缩放级别变化 → 视口搜索半径自适应（制图学策略）。
  }, [mode, query, filters, sort, mapCenter, zoom, mapReady]);

  // ---- 地图联动 ----
  usePOIMap(mapInstance.current, {
    pois,
    selectedId,
    highlightedId,
    accentColor: modeConfig.color,
    onMarkerClick: (id) => {
      setSelectedId(id);
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

  // 模式切换：清空查询与筛选，重置排序为默认
  const handleModeChange = useCallback((nextMode: MapMode) => {
    setMode(nextMode);
    setQuery("");
    setFilters({});
    setSort(getMode(nextMode).defaultSort);
    setSelectedId(null);
    setHighlightedId(null);
    setSuggestions([]);
  }, []);

  // ---- 搜索建议（AutoComplete）----
  // 输入变化时拉取建议（防抖 200ms）
  useEffect(() => {
    if (!query.trim() || query.trim().length < 1) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const tips = await fetchSuggestions(query.trim(), '杭州');
        if (!cancelled) {
          setSuggestions(
            tips.map((tip) => ({
              id: tip.id,
              name: tip.name,
              subtitle: [tip.district, tip.address].filter(Boolean).join(' · ') || tip.type,
              location: tip.location,
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
  }, [query]);

  // 选择建议 → 定位到该地点 + 设为搜索词
  const handleSelectSuggestion = useCallback((s: SearchSuggestion) => {
    if (s.location && mapInstance.current) {
      mapInstance.current.setCenter([s.location.lng, s.location.lat]);
      mapInstance.current.setZoom(16);
      setMapCenter({ lng: s.location.lng, lat: s.location.lat });
    }
    setQuery(s.name);
    setSuggestions([]);
  }, []);

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

    // 用 AMap.Geolocation 定位（自带精度圈 + 蓝点，无需手写 marker）
    getCurrentPosition()
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

  const handleMapStyleChange = (style: 'normal' | 'satellite' | 'whitesmoke') => {
    if (!mapInstance.current) return;

    if (style === 'satellite') {
      // 卫星图需要使用图层而不是 mapStyle
      if (!satelliteLayerRef.current) {
        // 创建卫星图层
        satelliteLayerRef.current = new window.AMap.TileLayer.Satellite({
          map: mapInstance.current,
        });
      } else {
        satelliteLayerRef.current.show();
      }
      // 隐藏标准图层（设置透明）
      mapInstance.current.setMapStyle('amap://styles/normal');
    } else {
      // Standard 和 Dark 使用 mapStyle
      const styleMap = {
        normal: 'amap://styles/normal',
        whitesmoke: 'amap://styles/whitesmoke',
      };
      mapInstance.current.setMapStyle(styleMap[style]);

      // 隐藏卫星图层
      if (satelliteLayerRef.current) {
        satelliteLayerRef.current.hide();
      }
    }

    setMapStyle(style);
    setShowBasemap(false);
  };

  // Close basemap picker when clicking outside
  useEffect(() => {
    if (!showBasemap) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Check if click is outside basemap card and button
      if (!target.closest(`.${styles.basemapCard}`) && !target.closest('[aria-label="Choose map style"]')) {
        setShowBasemap(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showBasemap]);

  const cycleDrawer = () => setDrawer((current) => current === "mini" ? "half" : current === "half" ? "full" : "mini");

  return (
    <main className={styles.shell}>
      <section className={styles.mapCanvas} aria-label="Interactive map preview">
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
        <button className={styles.menuButton} onClick={() => setSidebarOpen(!sidebarOpen)} aria-label={sidebarOpen ? t('collapsSidebar', lang) : t('expandSidebar', lang)}>
          <Icon name="menu" />
        </button>
        {sidebarOpen && <div className={styles.brand}><span className={styles.brandMark}>◉</span>Domain</div>}
        <div className={styles.searchBox} data-tooltip={t('search', lang)}>
          <Icon name="search" />
          <input type="search" placeholder={t('searchPlaceholder', lang)} />
        </div>
        <nav className={styles.navList}>
          <button className={styles.navItem} data-tooltip={t('layers', lang)}><Icon name="layers" /><span>{t('layers', lang)}</span></button>
          <button className={styles.navItem} data-tooltip={t('saved', lang)}><Icon name="bookmark" /><span>{t('saved', lang)}</span></button>
          <button
            className={styles.navItem}
            data-tooltip={t('explore', lang)}
            aria-expanded={exploreOpen}
            aria-pressed={exploreOpen}
            onClick={() => setExploreOpen((v) => !v)}
          >
            <Icon name="grid" />
            <span>{t('explore', lang)}</span>
          </button>
          <button className={styles.navItem} data-tooltip={t('recent', lang)}><Icon name="history" /><span>{t('recent', lang)}</span></button>
          <button className={styles.navItem} data-tooltip={t('settings', lang)}><Icon name="settings" /><span>{t('settings', lang)}</span></button>
        </nav>
        <button className={styles.profile} aria-label="AK Alex Kim Personal map" data-tooltip={t('profile', lang)}>
          <div className={styles.avatar}>AK</div>
          {sidebarOpen && <div className={styles.profileCopy}><strong>Alex Kim</strong><small>Personal map</small></div>}
        </button>
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
        totalCount={pois.length}
        lang={lang}
        onClose={() => setExploreOpen(false)}
        suggestions={suggestions}
        onSelectSuggestion={handleSelectSuggestion}
        shifted={sidebarOpen}
      />
      )}

      <div className={styles.topTools}>
        {showBasemap && (
          <div className={styles.basemapCard}>
            <span className={styles.eyebrow}>{t('mapStyle', lang)}</span><strong>{t('chooseView', lang)}</strong>
            <button
              className={mapStyle === 'normal' ? styles.activeMap : ''}
              onClick={() => handleMapStyleChange('normal')}
            >
              <div className={`${styles.mapThumb} ${styles.thumb1}`} />
              {t('standard', lang)}
              {mapStyle === 'normal' && <span className={styles.check}>✓</span>}
            </button>
            <button
              className={mapStyle === 'satellite' ? styles.activeMap : ''}
              onClick={() => handleMapStyleChange('satellite')}
            >
              <div className={`${styles.mapThumb} ${styles.thumb2}`} />
              {t('satellite', lang)}
              {mapStyle === 'satellite' && <span className={styles.check}>✓</span>}
            </button>
            <button
              className={mapStyle === 'whitesmoke' ? styles.activeMap : ''}
              onClick={() => handleMapStyleChange('whitesmoke')}
            >
              <div className={`${styles.mapThumb} ${styles.thumb3}`} />
              {t('dark', lang)}
              {mapStyle === 'whitesmoke' && <span className={styles.check}>✓</span>}
            </button>
          </div>
        )}
        <button className={styles.toolButton} onClick={() => setShowBasemap(!showBasemap)} aria-label="Choose map style" aria-pressed={showBasemap}>
          <div className={styles.basemapLogo}>◌</div>
        </button>
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

      <section className={`${styles.mobileDrawer} ${drawer === "mini" ? styles.drawerMini : drawer === "half" ? styles.drawerHalf : styles.drawerFull}`} aria-label="Places drawer">
        <button className={styles.drawerHandle} onClick={cycleDrawer} aria-label={`Expand drawer from ${drawer} state`}><span /></button>
        <div className={styles.mobileSearch}><Icon name="search" /><input type="search" placeholder={t('searchPlaceholder', lang)} /></div>
        <div className={styles.drawerContent}>
          <span className={styles.eyebrow}>Around you</span><h1>Make the map yours.</h1><p>Explore the people, places, and ideas shaping your city.</p>
          <div className={styles.quickGrid}>{["People hiring", "Open studios", "Good coffee", "Quiet corners"].map((item) => <button key={item}>{item}<span>↗</span></button>)}</div>
          <div className={styles.selectedPlace}><span className={styles.selectedIcon}>✦</span><div><small>Selected place</small><strong>{selectedId ? pois.find(p => p.id === selectedId)?.name ?? "" : "—"}</strong></div><button aria-label="Open selected place">→</button></div>
        </div>
        <div className={styles.snapControls} aria-label="Drawer states">{(["mini", "half", "full"] as DrawerState[]).map((state) => <button key={state} className={drawer === state ? styles.snapActive : ""} onClick={() => setDrawer(state)}>{state}</button>)}</div>
      </section>
    </main>
  );
}
