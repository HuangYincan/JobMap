// 动作执行器(纯逻辑,可单测)。
//
// 事件分流:delta/reasoning/tool/done/error → 渲染回调(供面板);action → 客户端再校验
// (与后端 lib/agent/action-schema.ts 同款规则,非法丢弃)→ 500ms 同类型限流 →
// bridge.isReady() 检查(失败 → 错误回调)→ 执行 → 压 undo 栈 → 通知 onAction(建议卡片)。
// execute(action):纯执行语义(重放按钮用)——校验→限流→执行→压 undo 栈,不回调
// onAction(重放不应再追加建议卡片/地图重复定位);与 handleEvent 的 action 分支共用实现。
//
// undo 逆操作:
// - flyTo → 执行前 getSnapshot() 捕获旧 camera,undo 飞回;
// - addMarkers/drawCircle → 保存清理函数,undo 时调用;
// - select/openDetail → 保存各自动作历史,undo 回放上一条(旧值回调);
// - search → bridge 无 search 能力(接口不含),流式路径只通知 onAction 渲染建议卡片,
//   execute 路径为空操作;无可撤销的地图副作用,不入 undo 栈。
//
// 校验规则本地复刻(lib/agent/** 只 import types,不 import 其函数)。

import type { AgentAction, AgentEvent } from "../lib/agent/types.ts";
import type { MapBridge } from "../lib/agent-map-bridge.ts";

export interface AgentToolInfo {
  name: string;
  status: "start" | "done" | "error";
  summary?: string;
}

export interface AgentMapExecutorCallbacks {
  onDelta?: (text: string) => void;
  /** 推理模型思考内容(reasoning 事件;面板渲染可折叠「思考过程」)。 */
  onReasoning?: (text: string) => void;
  onTool?: (info: AgentToolInfo) => void;
  onDone?: (truncated?: boolean) => void;
  onError?: (code: string, message: string) => void;
  /** action 已通过校验并执行;面板据此在消息底部渲染「重放」建议卡片。 */
  onAction?: (action: AgentAction) => void;
  /** 测试注入时钟(默认 Date.now)。 */
  now?: () => number;
}

export interface AgentMapExecutor {
  handleEvent(ev: AgentEvent): void;
  /** 纯执行语义:校验→限流→执行→压 undo 栈,不回调 onAction(重放按钮用)。 */
  execute(action: AgentAction): void;
  undo(): boolean;
  canUndo(): boolean;
  reset(): void;
}

/** 同类型动作限流窗口(ms)。 */
export const ACTION_THROTTLE_MS = 500;

// ---- 客户端动作校验(action-schema.ts 同款规则,逐字段,非法 → null)----
const MAX_LAT = 90;
const MAX_LNG = 180;
const MAX_RADIUS_M = 50_000;
const MIN_RADIUS_M = 10;
const MAX_POINTS = 50;
const MAX_ID_CHARS = 128;
const MAX_QUERY_CHARS = 100;
const MAX_MODE_CHARS = 32;
const MAX_LABEL_CHARS = 50;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isLng(v: unknown): boolean {
  return isFiniteNumber(v) && v >= -MAX_LNG && v <= MAX_LNG;
}

function isLat(v: unknown): boolean {
  return isFiniteNumber(v) && v >= -MAX_LAT && v <= MAX_LAT;
}

function isOptionalString(v: unknown, max: number): boolean {
  return v === undefined || (typeof v === "string" && v.length <= max);
}

function isOptionalNumber(v: unknown): boolean {
  return v === undefined || isFiniteNumber(v);
}

function isValidCenter(v: unknown): boolean {
  return isRecord(v) && isLng(v.lng) && isLat(v.lat);
}

/** 校验未知来源的动作对象:通过 → 规范化 AgentAction;任何越界/未知 type → null。 */
export function validateAction(raw: unknown): AgentAction | null {
  if (!isRecord(raw)) return null;
  const type = raw.type;
  if (typeof type !== "string") return null;
  const payload = raw.payload;
  if (!isRecord(payload)) return null;
  if (!isOptionalString(payload.mode, MAX_MODE_CHARS)) return null;
  const mode = payload.mode as string | undefined;

  switch (type) {
    case "flyTo": {
      if (!isValidCenter(payload.center)) return null;
      if (!isOptionalNumber(payload.zoom)) return null;
      return {
        type: "flyTo",
        payload: {
          center: { lng: (payload.center as { lng: number }).lng, lat: (payload.center as { lat: number }).lat },
          ...(isFiniteNumber(payload.zoom) ? { zoom: payload.zoom } : {}),
        },
      };
    }
    case "select": {
      if (typeof payload.id !== "string" || payload.id.length === 0 || payload.id.length > MAX_ID_CHARS) return null;
      return { type: "select", payload: { id: payload.id, ...(mode !== undefined ? { mode } : {}) } };
    }
    case "addMarkers": {
      const points = payload.points;
      if (!Array.isArray(points) || points.length === 0 || points.length > MAX_POINTS) return null;
      const out: Array<{ lng: number; lat: number; label?: string }> = [];
      for (const p of points) {
        if (!isRecord(p) || !isLng(p.lng) || !isLat(p.lat)) return null;
        if (!isOptionalString(p.label, MAX_LABEL_CHARS)) return null;
        out.push({ lng: p.lng as number, lat: p.lat as number, ...(typeof p.label === "string" ? { label: p.label } : {}) });
      }
      return { type: "addMarkers", payload: { points: out } };
    }
    case "drawCircle": {
      if (!isValidCenter(payload.center)) return null;
      if (!isFiniteNumber(payload.radiusMeters)) return null;
      if (payload.radiusMeters < MIN_RADIUS_M || payload.radiusMeters > MAX_RADIUS_M) return null;
      if (!isOptionalString(payload.label, MAX_LABEL_CHARS)) return null;
      return {
        type: "drawCircle",
        payload: {
          center: { lng: (payload.center as { lng: number }).lng, lat: (payload.center as { lat: number }).lat },
          radiusMeters: payload.radiusMeters,
          ...(typeof payload.label === "string" ? { label: payload.label } : {}),
        },
      };
    }
    case "openDetail": {
      if (typeof payload.id !== "string" || payload.id.length === 0 || payload.id.length > MAX_ID_CHARS) return null;
      return { type: "openDetail", payload: { id: payload.id, ...(mode !== undefined ? { mode } : {}) } };
    }
    case "search": {
      if (typeof payload.query !== "string" || payload.query.length === 0 || payload.query.length > MAX_QUERY_CHARS) return null;
      return { type: "search", payload: { query: payload.query, ...(mode !== undefined ? { mode } : {}) } };
    }
    default:
      return null;
  }
}

export function createAgentMapExecutor(
  bridge: MapBridge,
  callbacks: AgentMapExecutorCallbacks = {},
): AgentMapExecutor {
  const now = callbacks.now ?? Date.now;
  const undoStack: Array<() => void> = [];
  /** 同类型动作最近执行时间戳(500ms 限流) */
  const lastExecAt: Record<string, number> = {};
  /** select 历史(undo 回放上一条旧值) */
  const selectStack: AgentAction[] = [];
  /** openDetail 历史(同上) */
  const detailStack: AgentAction[] = [];

  function throttled(type: string): boolean {
    const t = now();
    if (lastExecAt[type] !== undefined && t - lastExecAt[type] < ACTION_THROTTLE_MS) return true;
    lastExecAt[type] = t;
    return false;
  }

  /** 执行单个动作(execute 与 handleEvent action 分支共用);notify 控制是否回调 onAction。 */
  function executeAction(action: AgentAction, notify: boolean): void {
    const validated = validateAction(action);
    if (!validated) return; // 非法 → 丢弃(与后端同款规则)
    if (throttled(validated.type)) return; // 500ms 同类型限流 → 丢弃
    if (!bridge.isReady()) {
      callbacks.onError?.("MAP_NOT_READY", "map is not ready");
      return;
    }

    switch (validated.type) {
      case "flyTo": {
        const before = bridge.getSnapshot(); // 执行前捕获旧 camera(undo 用)
        bridge.flyTo(validated.payload.center.lng, validated.payload.center.lat, validated.payload.zoom);
        if (before) {
          undoStack.push(() => {
            bridge.flyTo(before.center.lng, before.center.lat, before.zoom);
          });
        }
        break;
      }
      case "select": {
        selectStack.push(validated);
        bridge.select(validated.payload.id, validated.payload.mode);
        undoStack.push(() => {
          selectStack.pop();
          const prev = selectStack[selectStack.length - 1];
          if (prev && prev.type === "select") bridge.select(prev.payload.id, prev.payload.mode);
        });
        break;
      }
      case "addMarkers": {
        const cleanup = bridge.addMarkers(validated.payload.points);
        undoStack.push(() => cleanup());
        break;
      }
      case "drawCircle": {
        const cleanup = bridge.drawCircle(validated.payload.center, validated.payload.radiusMeters);
        undoStack.push(() => cleanup());
        break;
      }
      case "openDetail": {
        detailStack.push(validated);
        bridge.openDetail(validated.payload.id, validated.payload.mode);
        undoStack.push(() => {
          detailStack.pop();
          const prev = detailStack[detailStack.length - 1];
          if (prev && prev.type === "openDetail") bridge.openDetail(prev.payload.id, prev.payload.mode);
        });
        break;
      }
      case "search": {
        // bridge 接口不含 search:无可执行的地图副作用,不入 undo 栈
        break;
      }
    }
    if (notify) callbacks.onAction?.(validated);
  }

  return {
    handleEvent(ev) {
      switch (ev.type) {
        case "delta":
          callbacks.onDelta?.(ev.text);
          break;
        case "reasoning":
          callbacks.onReasoning?.(ev.text);
          break;
        case "tool":
          callbacks.onTool?.({ name: ev.name, status: ev.status, summary: ev.summary });
          break;
        case "done":
          callbacks.onDone?.(ev.truncated);
          break;
        case "error":
          callbacks.onError?.(ev.code, ev.message);
          break;
        case "action":
          executeAction(ev.action, true);
          break;
      }
    },
    execute(action) {
      executeAction(action, false);
    },
    undo() {
      const entry = undoStack.pop();
      if (!entry) return false;
      entry();
      return true;
    },
    canUndo() {
      return undoStack.length > 0;
    },
    reset() {
      undoStack.length = 0;
      selectStack.length = 0;
      detailStack.length = 0;
      for (const k of Object.keys(lastExecAt)) delete lastExecAt[k];
    },
  };
}
