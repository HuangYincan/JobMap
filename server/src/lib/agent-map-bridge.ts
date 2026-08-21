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
        // 一律自定义 content:蓝点 + 白边 + 蓝影(与距离手柄同款,定位点显眼可辨)。
        // 外层 wrapper 固定 20×20(即圆点本体);label(有则)绝对定位出流、不占布局,
        // 叠在圆点上方 2px —— content 实测尺寸恒为 20×20,锚点可精确计算,
        // 避免旧 flex 竖排(高约 44px、含非整数 2.5px 边框)在缩放重排期间锚定错位。
        // offset [-10,-10] 以圆心锚定地理坐标(与距离手柄 18px 点 [-9,-9] 同款语义)。
        const dot =
          '<div style="width:20px;height:20px;border-radius:50%;background:#007AFF;' +
          'border:2.5px solid #fff;box-shadow:0 2px 10px rgba(0,122,255,0.45)"></div>';
        const content = label
          ? '<div style="position:relative;width:20px;height:20px">' +
            '<div style="position:absolute;bottom:calc(100% + 2px);left:50%;transform:translateX(-50%);' +
            'background:#007AFF;color:#fff;border-radius:99px;padding:2px 10px;' +
            'font-size:12px;box-shadow:0 2px 8px rgba(0,122,255,0.35);white-space:nowrap">' +
            `${escapeHtml(label)}</div>${dot}</div>`
          : dot;
        created.push(
          view?.createMarker({
            position: { lng: p.lng, lat: p.lat },
            content,
            offset: [-10, -10],
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
