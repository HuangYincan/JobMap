export type MapAdapter = "fallback" | "amap";

/** Keeps map-engine selection isolated until the read API exists. */
export function getMapAdapter(): MapAdapter {
  return process.env.NEXT_PUBLIC_AMAP_KEY ? "amap" : "fallback";
}
