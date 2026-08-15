"use client";

import { useState } from "react";
import styles from "./map-shell.module.css";

type DrawerState = "mini" | "half" | "full";

const places = [
  { name: "Futureworks Campus", type: "Research district", tone: "blue", x: "48%", y: "37%" },
  { name: "Westlake Studio Row", type: "Creative offices", tone: "orange", x: "68%", y: "48%" },
  { name: "Civic Data Commons", type: "Public interest", tone: "purple", x: "35%", y: "62%" },
];

function Icon({ name }: { name: "search" | "layers" | "bookmark" | "grid" | "history" | "settings" | "menu" | "compass" | "locate" }) {
  const paths: Record<string, string> = {
    search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm6-2 4 4",
    layers: "m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5",
    bookmark: "M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4-6 4V4Z",
    grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
    history: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2",
    settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0-13v2m0 15v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M1 12h2m16 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
    menu: "M4 6h16M4 12h16M4 18h16",
    compass: "m15 9-2.5 5.5L7 17l2.5-5.5L15 9Z",
    locate: "M12 2v3m0 14v3M2 12h3m14 0h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function MapShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [basemapOpen, setBasemapOpen] = useState(false);
  const [drawer, setDrawer] = useState<DrawerState>("mini");
  const [zoom, setZoom] = useState(13);
  const [selectedPlace, setSelectedPlace] = useState(places[0].name);

  const cycleDrawer = () => setDrawer((current) => current === "mini" ? "half" : current === "half" ? "full" : "mini");

  return (
    <main className={styles.shell}>
      <section className={styles.mapCanvas} aria-label="Interactive map preview">
        <div className={styles.mapGlow} />
        <div className={styles.mapTexture} />
        <div className={styles.water} />
        <div className={`${styles.road} roadOne`} />
        <div className={`${styles.road} roadTwo`} />
        <div className={`${styles.road} roadThree`} />
        <div className={`${styles.mapLabel} labelNorth`}>NORTH LOOP</div>
        <div className={`${styles.mapLabel} labelSouth`}>CIVIC GREEN</div>
        <div className={`${styles.mapLabel} labelWest`}>WESTLAKE</div>
        {places.map((place) => (
          <button key={place.name} className={`${styles.poi} ${styles[place.tone]}`} style={{ left: place.x, top: place.y }} onClick={() => setSelectedPlace(place.name)} aria-label={`Select ${place.name}`}>
            <span className={styles.poiDot} />
            <span className={styles.poiCard}><strong>{place.name}</strong><small>{place.type}</small></span>
          </button>
        ))}
        <div className={styles.mapAttribution}>Preview map · adapter ready for AMap</div>
      </section>

      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`} aria-label="Map navigation">
        <button className={styles.menuButton} onClick={() => setSidebarOpen((open) => !open)} aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}><Icon name="menu" /></button>
        {sidebarOpen && <div className={styles.brand}><span className={styles.brandMark}>◎</span><span>domain map</span></div>}
        <div className={styles.searchBox}><Icon name="search" /><input aria-label="Search map" placeholder="Search places" /></div>
        <nav className={styles.navList}>
          {[ ["layers", "Nearby domains"], ["bookmark", "Saved places"], ["grid", "Explore categories"], ["history", "Recent activity"], ["settings", "Preferences"] ].map(([icon, label]) => <button key={label} className={styles.navItem} onClick={() => setSidebarOpen(true)}><Icon name={icon as Parameters<typeof Icon>[0]["name"]} /><span>{label}</span></button>)}
        </nav>
        <button className={styles.profile}><span className={styles.avatar}>AK</span><span className={styles.profileCopy}><strong>Alex Kim</strong><small>Personal map</small></span></button>
      </aside>

      <div className={styles.topTools}>
        {basemapOpen && <div className={styles.basemapCard}><span className={styles.eyebrow}>Map style</span><strong>Choose your view</strong>{["Standard", "Satellite", "Transit"].map((name, index) => <button key={name} className={index === 0 ? styles.activeMap : ""} onClick={() => setBasemapOpen(false)}><span className={`${styles.mapThumb} ${styles[`thumb${index}`]}`} />{name}<span className={styles.check}>{index === 0 ? "✓" : ""}</span></button>)}</div>}
        <button className={styles.toolButton} onClick={() => setBasemapOpen((open) => !open)} aria-label="Choose map style"><span className={styles.basemapLogo}>◌</span></button>
        <button className={`${styles.toolButton} ${styles.compass}`} onClick={() => setZoom(13)} aria-label="Reset compass"><Icon name="compass" /></button>
      </div>

      <div className={styles.mapControls}>
        <div className={styles.zoomControls}><button onClick={() => setZoom((value) => Math.min(20, value + 1))} aria-label="Zoom in">+</button><span>{zoom}</span><button onClick={() => setZoom((value) => Math.max(5, value - 1))} aria-label="Zoom out">−</button></div>
        <button className={styles.locateButton} onClick={() => setSelectedPlace("Your location")} aria-label="Find my location"><Icon name="locate" /></button>
        <span className={styles.scale}>2 km <i /></span>
      </div>

      <section className={`${styles.mobileDrawer} ${styles[`drawer${drawer[0].toUpperCase()}${drawer.slice(1)}`]}`} aria-label="Places drawer">
        <button className={styles.drawerHandle} onClick={cycleDrawer} aria-label={`Expand drawer from ${drawer} state`}><span /></button>
        <div className={styles.mobileSearch}><Icon name="search" /><input aria-label="Search places" placeholder="Search places or addresses" /></div>
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
