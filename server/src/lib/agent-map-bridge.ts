// 地图操作适配层(AI Agent → 活跃地图引擎视图)。
//
// 本文件是 agent 前端与地图引擎之间的唯一接触点:MapBridge 接口供动作执行器
// (components/agent-map-executor.ts)与面板调用;实现只认 map-engine 的
// MapView 门面(view.flyTo / view.createMarker / view.createCircle /
// view.getState),不直连任何厂商全局命名空间——后续引擎可平滑切换。
// 坐标/半径校验复用动作边界(lib/agent/action-schema.ts 同款规则),非法 → 忽略。
// 覆盖物(addMarkers/drawCircle)创建后由返回的清理函数自维护,undo 时调用。

import type { MapView } from "./map-engine/types.ts";

/** 相机快照(undo 逆操作 flyTo 用) */
export interface MapSnapshot {
  center: { lng: number; lat: number };
  zoom: number;
}

export interface MapPoint {
  lng: number;
  lat: number;
  label?: string;
}

/** 地图操作适配接口(动作执行器只依赖本契约) */
export interface MapBridge {
  isReady(): boolean;
  getSnapshot(): MapSnapshot | null;
  flyTo(lng: number, lat: number, zoom?: number): void; // zoom 缺省保持当前
  select(id: string, mode?: string): void;
  addMarkers(points: MapPoint[]): () => void; // 返回清理函数(移除本批 marker)
  drawCircle(center: { lng: number; lat: number }, radiusMeters: number): () => void;
  openDetail(id: string, mode?: string): void;
}

/** 桥接回调(由 map-shell seam 注入:选中/打开详情落到现有状态) */
export interface AgentBridgeCallbacks {
  onSelect?: (id: string, mode?: string) => void;
  onOpenDetail?: (id: string, mode?: string) => void;
}

// ---- 动作边界(lib/agent/action-schema.ts 同款;bridge 只认 MapView,规则本地复刻)----
const MAX_LAT = 90;
const MAX_LNG = 180;
const MIN_RADIUS_M = 10;
const MAX_RADIUS_M = 50_000;
const MAX_LABEL_CHARS = 50;

function isLng(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= -MAX_LNG && v <= MAX_LNG;
}

function isLat(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= -MAX_LAT && v <= MAX_LAT;
}

function isLabel(v: unknown): v is string {
  return typeof v === "string" && v.length <= MAX_LABEL_CHARS;
}

function noopCleanup(): () => void {
  return () => {}; // 非法入参 → 无覆盖物可清理
}

/** 转义覆盖物 label(LLM 输出不可信,防 HTML 注入) */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function createAgentBridge(
  view: MapView | null,
  callbacks: AgentBridgeCallbacks = {},
): MapBridge {
  return {
    isReady() {
      return Boolean(view && !view.isDestroyed());
    },

    getSnapshot() {
      if (!view || view.isDestroyed()) return null;
      const state = view.getState();
      return { center: { lng: state.center.lng, lat: state.center.lat }, zoom: state.zoom };
    },

    flyTo(lng, lat, zoom) {
      if (!view || view.isDestroyed()) return;
      if (!isLng(lng) || !isLat(lat)) return; // 非法坐标 → 忽略(动作边界)
      view.flyTo({ center: { lng, lat }, zoom: zoom ?? view.getState().zoom });
    },

    select(id, mode) {
      callbacks.onSelect?.(id, mode);
    },

    addMarkers(points) {
      const created: Array<{ remove(): void }> = [];
      for (const p of points ?? []) {
        if (!isLng(p?.lng) || !isLat(p?.lat)) continue; // 单项非法 → 忽略该点
        const label = isLabel(p.label) ? p.label : undefined;
        created.push(
          view?.createMarker({
            position: { lng: p.lng, lat: p.lat },
            ...(label
              ? {
                  content:
                    `<div style="background:#fff;border:1px solid rgba(26,45,62,0.16);` +
                    `border-radius:99px;padding:2px 8px;font-size:11px;color:#0b2545;` +
                    `box-shadow:0 2px 8px rgba(24,45,57,0.18);transform:translateY(-28px);` +
                    `white-space:nowrap">${escapeHtml(label)}</div>`,
                }
              : {}),
          }) ?? { remove() {} },
        );
      }
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        for (const m of created) {
          try {
            m.remove();
          } catch {
            // 地图已销毁等场景:忽略
          }
        }
      };
    },

    drawCircle(center, radiusMeters) {
      if (!center || !isLng(center.lng) || !isLat(center.lat)) return noopCleanup();
      if (!Number.isFinite(radiusMeters) || radiusMeters < MIN_RADIUS_M || radiusMeters > MAX_RADIUS_M) {
        return noopCleanup();
      }
      const circle = view?.createCircle({ center: { lng: center.lng, lat: center.lat }, radius: radiusMeters, color: "#007AFF" }) ?? null;
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        try {
          circle?.remove();
        } catch {
          // 地图已销毁等场景:忽略
        }
      };
    },

    openDetail(id, mode) {
      callbacks.onOpenDetail?.(id, mode);
    },
  };
}
