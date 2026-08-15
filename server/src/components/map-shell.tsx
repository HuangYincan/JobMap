"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./map-shell.module.css";

type DrawerState = "mini" | "half" | "full";

declare global {
  interface Window {
    AMap?: any;
    _AMapSecurityConfig?: { securityJsCode: string };
  }
}

const places = [
  { name: "Futureworks Campus", type: "Research district", tone: "blue", lng: 120.15, lat: 30.28 },
  { name: "Westlake Studio Row", type: "Creative offices", tone: "orange", lng: 120.13, lat: 30.25 },
  { name: "Civic Data Commons", type: "Public interest", tone: "purple", lng: 120.16, lat: 30.26 },
];

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

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [drawer, setDrawer] = useState<DrawerState>("mini");
  const [selectedPlace, setSelectedPlace] = useState(places[0].name);
  const [showBasemap, setShowBasemap] = useState(false);
  const [zoom, setZoom] = useState(13);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!mapContainer.current) return;

    const apiKey = process.env.NEXT_PUBLIC_AMAP_KEY;
    const securityCode = process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE;

    if (!apiKey || !securityCode) {
      console.warn("NEXT_PUBLIC_AMAP_KEY and NEXT_PUBLIC_AMAP_SECURITY_CODE are required");
      return;
    }

    // Set security config before loading AMap script
    window._AMapSecurityConfig = {
      securityJsCode: securityCode,
    };

    // Load AMap script
    if (!window.AMap) {
      const script = document.createElement("script");
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${apiKey}`;
      script.async = true;
      script.onload = () => initMap();
      document.head.appendChild(script);
    } else {
      initMap();
    }

    function initMap() {
      if (!mapContainer.current || mapInstance.current) return;

      const map = new window.AMap.Map(mapContainer.current, {
        zoom: 13,
        center: [120.15, 30.27],
        viewMode: "3D",
        pitch: 0,
        showLabel: true,
        mapStyle: "amap://styles/normal",
      });

      mapInstance.current = map;
      setMapReady(true);

      // Add place markers
      places.forEach((place) => {
        const marker = new window.AMap.Marker({
          position: [place.lng, place.lat],
          title: place.name,
          map: map,
        });
        marker.on("click", () => setSelectedPlace(place.name));
        markersRef.current.push(marker);
      });

      // Sync zoom state
      map.on("zoomchange", () => {
        setZoom(Math.round(map.getZoom()));
      });
    }

    return () => {
      if (mapInstance.current) {
        mapInstance.current.destroy();
        mapInstance.current = null;
      }
      markersRef.current = [];
    };
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

  const handleLocate = () => {
    if (!mapInstance.current) return;

    // Try to get user's real location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { longitude, latitude } = position.coords;

          // Remove old user marker if exists
          if (userMarkerRef.current) {
            userMarkerRef.current.setMap(null);
            userMarkerRef.current = null;
          }

          // Center map on user location
          mapInstance.current.setCenter([longitude, latitude]);
          mapInstance.current.setZoom(15);

          // Create a new user location marker with a distinct icon
          const userMarker = new window.AMap.Marker({
            position: [longitude, latitude],
            icon: new window.AMap.Icon({
              size: new window.AMap.Size(20, 20),
              image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'%3E%3Ccircle cx='10' cy='10' r='8' fill='%234A90E2' opacity='0.3'/%3E%3Ccircle cx='10' cy='10' r='4' fill='%234A90E2'/%3E%3Ccircle cx='10' cy='10' r='2' fill='white'/%3E%3C/svg%3E",
            }),
            title: "Your location",
            map: mapInstance.current,
          });

          userMarkerRef.current = userMarker;
        },
        (error) => {
          console.warn("Geolocation failed, returning to default center:", error.message);
          // Fallback to default center
          mapInstance.current.setCenter([120.15, 30.27]);
          mapInstance.current.setZoom(13);
        }
      );
    } else {
      // Browser doesn't support geolocation, fallback
      mapInstance.current.setCenter([120.15, 30.27]);
      mapInstance.current.setZoom(13);
    }
  };

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

      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`} aria-label="Map navigation">
        <button className={styles.menuButton} onClick={() => setSidebarOpen(!sidebarOpen)} aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}>
          <Icon name="menu" />
        </button>
        {sidebarOpen && <div className={styles.brand}><span className={styles.brandMark}>◉</span>Domain</div>}
        <div className={styles.searchBox}>
          <Icon name="search" />
          <input type="search" placeholder="Search places" />
        </div>
        <nav className={styles.navList}>
          <button className={styles.navItem}><Icon name="layers" /><span>Layers</span></button>
          <button className={styles.navItem}><Icon name="bookmark" /><span>Saved</span></button>
          <button className={styles.navItem}><Icon name="grid" /><span>Explore</span></button>
          <button className={styles.navItem}><Icon name="history" /><span>Recent</span></button>
          <button className={styles.navItem}><Icon name="settings" /><span>Settings</span></button>
        </nav>
        <button className={styles.profile} aria-label="AK Alex Kim Personal map">
          <div className={styles.avatar}>AK</div>
          {sidebarOpen && <div className={styles.profileCopy}><strong>Alex Kim</strong><small>Personal map</small></div>}
        </button>
      </aside>

      <div className={styles.topTools}>
        {showBasemap && (
          <div className={styles.basemapCard}>
            <span className={styles.eyebrow}>Map style</span><strong>Choose your view</strong>
            <button className={styles.activeMap}><div className={`${styles.mapThumb} ${styles.thumb1}`} />Standard<span className={styles.check}>✓</span></button>
            <button><div className={`${styles.mapThumb} ${styles.thumb2}`} />Satellite</button>
            <button><div className={`${styles.mapThumb} ${styles.thumb1}`} />Transit</button>
          </div>
        )}
        <button className={styles.toolButton} onClick={() => setShowBasemap(!showBasemap)} aria-label="Choose map style" aria-pressed={showBasemap}>
          <div className={styles.basemapLogo}>◌</div>
        </button>
        <button className={styles.toolButton} aria-label="Reset compass"><Icon name="compass" /></button>
      </div>

      <div className={styles.mapControls}>
        <div className={styles.zoomControls}>
          <button onClick={handleZoomIn} aria-label="Zoom in">+</button>
          <span>{zoom}</span>
          <button onClick={handleZoomOut} aria-label="Zoom out">−</button>
        </div>
        <button className={`${styles.toolButton} ${styles.locateButton}`} onClick={handleLocate} aria-label="Find my location">
          <Icon name="locate" />
        </button>
        <div className={styles.scale}><i />2 km</div>
      </div>

      <section className={`${styles.mobileDrawer} ${drawer === "mini" ? styles.drawerMini : drawer === "half" ? styles.drawerHalf : styles.drawerFull}`} aria-label="Places drawer">
        <button className={styles.drawerHandle} onClick={cycleDrawer} aria-label={`Expand drawer from ${drawer} state`}><span /></button>
        <div className={styles.mobileSearch}><Icon name="search" /><input type="search" placeholder="Search places or addresses" /></div>
        <div className={styles.drawerContent}>
          <span className={styles.eyebrow}>Around you</span><h1>Make the map yours.</h1><p>Explore the people, places, and ideas shaping your city.</p>
          <div className={styles.quickGrid}>{["People hiring", "Open studios", "Good coffee", "Quiet corners"].map((item) => <button key={item}>{item}<span>↗</span></button>)}</div>
          <div className={styles.selectedPlace}><span className={styles.selectedIcon}>✦</span><div><small>Selected place</small><strong>{selectedPlace}</strong></div><button aria-label="Open selected place">→</button></div>
        </div>
        <div className={styles.snapControls} aria-label="Drawer states">{(["mini", "half", "full"] as DrawerState[]).map((state) => <button key={state} className={drawer === state ? styles.snapActive : ""} onClick={() => setDrawer(state)}>{state}</button>)}</div>
      </section>
    </main>
  );
}
