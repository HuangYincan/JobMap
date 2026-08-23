"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import type { POI, Position } from "@/lib/types";

export type DrawerState = "mini" | "half" | "full";

const DRAWER_MINI_H = 96;
const DRAWER_HALF_RATIO = 0.42;
/** 快滑判定阈值(px/s):超过则直接吸附到 full(上)/mini(下) */
const DRAWER_FLING_V = 900;
const DRAWER_TOOL_BUTTON_H = 40;
const DRAWER_TOP_MIN = 12;

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

function compassCenterY(safeTop: number): number {
  return Math.max(DRAWER_TOP_MIN, safeTop) + DRAWER_TOOL_BUTTON_H / 2;
}

function drawerFullHeight(vh: number, safeTop: number): number {
  return vh - compassCenterY(safeTop);
}

function nearestDrawerState(h: number, half: number, full: number): DrawerState {
  const d = (a: number) => Math.abs(h - a);
  return d(DRAWER_MINI_H) <= d(half) && d(DRAWER_MINI_H) <= d(full)
    ? "mini"
    : d(half) <= d(full)
      ? "half"
      : "full";
}

interface DrawerGestureActions {
  drawer: DrawerState;
  detailPoi: POI | null;
  mobileJd: Position | null;
  mobileSheet: "explore" | "saved" | "layers" | "account" | "recent" | "agent";
  setDrawer: Dispatch<SetStateAction<DrawerState>>;
  setDetailPoi: Dispatch<SetStateAction<POI | null>>;
  setMobileJd: Dispatch<SetStateAction<Position | null>>;
  setMobileSheet: Dispatch<SetStateAction<"explore" | "saved" | "layers" | "account" | "recent" | "agent">>;
}

/** Mobile drawer pointer state machine, extracted unchanged from MapShell. */
export function useMobileDrawerGesture(actions: DrawerGestureActions) {
  const [drawerDragging, setDrawerDragging] = useState(false);
  const drawerRef = useRef<HTMLElement | null>(null);
  const drawerDraggingRef = useRef(false);
  const drawerSuppressClickRef = useRef(false);
  const drawerStateRef = useRef<DrawerState>(actions.drawer);
  const drawerGestureRef = useRef<{
    startY: number;
    baseH: number;
    lastY: number;
    lastTime: number;
    vel: number;
    safeTop: number;
  } | null>(null);

  useEffect(() => {
    drawerStateRef.current = actions.drawer;
  }, [actions.drawer]);

  const handleDrawerPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
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

  const handleDrawerPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const g = drawerGestureRef.current;
    if (!g || !drawerDraggingRef.current) return;
    const now = performance.now();
    const dt = now - g.lastTime;
    const instant = dt > 0 ? ((event.clientY - g.lastY) / dt) * 1000 : 0;
    g.vel = Number.isFinite(instant) ? g.vel * 0.4 + instant * 0.6 : g.vel;
    g.lastY = event.clientY;
    g.lastTime = now;

    const h = g.baseH - (event.clientY - g.startY);
    const el = drawerRef.current;
    if (el) el.style.height = `${h}px`;

    const vh = window.innerHeight;
    const fullH = drawerFullHeight(vh, g.safeTop);
    const halfH = vh * DRAWER_HALF_RATIO;
    const eff: DrawerState = h >= fullH ? "full" : h >= halfH ? "half" : "mini";
    if (eff !== drawerStateRef.current) actions.setDrawer(eff);
  };

  const finishDrawerGesture = (clientY: number) => {
    const g = drawerGestureRef.current;
    drawerGestureRef.current = null;
    if (!g || !drawerDraggingRef.current) return;
    drawerDraggingRef.current = false;
    setDrawerDragging(false);

    requestAnimationFrame(() => {
      if (drawerDraggingRef.current) return; // 新手势已开始,不打断
      const el = drawerRef.current;
      if (el) el.style.height = "";
    });

    if (Math.abs(clientY - g.startY) > 8) drawerSuppressClickRef.current = true;

    const currentH = drawerRef.current?.getBoundingClientRect().height ?? g.baseH;
    const vh = window.innerHeight;
    const fullH = drawerFullHeight(vh, g.safeTop);
    const halfH = vh * DRAWER_HALF_RATIO;
    const vel = g.vel;

    // 内容栈优先:详情/JD 被下拉到过半(或快滑)→ 收到各自上一层;否则回弹 full
    if (actions.detailPoi || actions.mobileJd) {
      const popContent =
        vel > DRAWER_FLING_V || currentH < (fullH + halfH) / 2;
      if (popContent) {
        if (actions.mobileJd) {
          actions.setMobileJd(null);
          actions.setDrawer("full");
        } else {
          actions.setDetailPoi(null);
          actions.setMobileJd(null);
          actions.setDrawer("half");
        }
      } else {
        actions.setDrawer("full");
      }
      return;
    }
    if (actions.mobileSheet !== "explore") {
      if (vel > DRAWER_FLING_V) actions.setMobileSheet("explore");
      else actions.setDrawer(nearestDrawerState(currentH, halfH, fullH));
      return;
    }
    // 三态判定:向上快滑→full,向下快滑→mini,慢拖→就近档位
    if (vel < -DRAWER_FLING_V) actions.setDrawer("full");
    else if (vel > DRAWER_FLING_V) actions.setDrawer("mini");
    else actions.setDrawer(nearestDrawerState(currentH, halfH, fullH));
  };

  return {
    drawerDragging,
    drawerRef,
    drawerSuppressClickRef,
    handleDrawerPointerDown,
    handleDrawerPointerMove,
    finishDrawerGesture,
  };
}
