"use client";

import dynamic from "next/dynamic";

const MapShell = dynamic(() => import("@/components/map-shell").then((mod) => mod.MapShell), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: "100svh",
        display: "grid",
        placeItems: "center",
        color: "var(--muted)",
        fontSize: 14,
      }}
    >
      Loading map…
    </div>
  ),
});

export function HomeMap() {
  return <MapShell />;
}
