"use client";

// AI Agent 悬浮球:44px 圆形玻璃按钮,可拖拽吸附,点击(非拖动)切换聊天面板。
// - 初始位 right 缘 / bottom:179px(地图控件上方);
// - 拖拽:pointer 事件,3px 阈值区分点击/拖动;松手按球心到四边最近距离四向吸附
//   (computeBallSnap 纯函数)。运行时位置一律 left+top,避免 left↔right 切换
//   导致过渡对不上;吸附 0.45s cubic-bezier(0.32, 0.72, 0, 1);
// - 位置持久化 localStorage 'dm.agent-ball-pos'({edge, top, left?});
// - 面板以球为锚实时跟随;开关带动画(缩放到球再卸载)。
// - 受控化:open/onOpenChange 由 MapShell 提升;移动端(≤767px)球隐藏。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./agent-ball.module.css";
import { t, type Language } from "@/lib/i18n";
import type { AccountUser } from "@/lib/account";
import type { MapBridge } from "@/lib/agent-map-bridge";
import type { RouteOverlayMeta } from "@/lib/navigation/route-client";
import {
  computeBallSnap,
  pinBallToSnapEdge,
  toLeftTopBallPos,
  type BallRect,
  type BallSnapEdge,
} from "@/lib/agent-panel-placement";
import { AgentPanel } from "./agent-panel";

const BALL_SIZE = 44;
const EDGE_MARGIN = 12;
const DEFAULT_BOTTOM = 179;
const DRAG_THRESHOLD_PX = 3;
const POS_KEY = "dm.agent-ball-pos";

interface BallPos {
  left: number | null;
  right: number | null;
  top: number;
}

interface InitialState {
  pos: BallPos;
  edge: BallSnapEdge;
}

interface Props {
  bridge: MapBridge | null;
  lang: Language;
  user: AccountUser | null;
  userLocation?: { lng: number; lat: number } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRouteMeta?: (meta: RouteOverlayMeta) => void;
  onRouteError?: (code: string) => void;
  onRouteLoading?: () => void;
}

function readInitialState(): InitialState {
  if (typeof window === "undefined") return { pos: { left: EDGE_MARGIN, right: null, top: 0 }, edge: "right" };
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  try {
    const raw = window.localStorage.getItem(POS_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const { edge, top, left } = parsed as { edge?: unknown; top?: unknown; left?: unknown };
        if (
          (edge === "left" || edge === "right" || edge === "top" || edge === "bottom") &&
          typeof top === "number" &&
          Number.isFinite(top)
        ) {
          const savedLeft = typeof left === "number" && Number.isFinite(left) ? left : EDGE_MARGIN;
          const rawPos: BallPos =
            edge === "right"
              ? { left: null, right: EDGE_MARGIN, top }
              : edge === "left"
                ? { left: EDGE_MARGIN, right: null, top }
                : edge === "top"
                  ? { left: savedLeft, right: null, top: EDGE_MARGIN }
                  : { left: savedLeft, right: null, top: viewport.height - BALL_SIZE - EDGE_MARGIN };
          return {
            pos: pinBallToSnapEdge(edge, rawPos, viewport, BALL_SIZE, EDGE_MARGIN),
            edge,
          };
        }
      }
    }
  } catch {
    // 坏数据 → 默认位
  }
  const top = Math.max(EDGE_MARGIN, window.innerHeight - DEFAULT_BOTTOM - BALL_SIZE);
  return {
    pos: pinBallToSnapEdge("right", { left: null, right: EDGE_MARGIN, top }, viewport, BALL_SIZE, EDGE_MARGIN),
    edge: "right",
  };
}

export default function AgentBall({
  bridge,
  lang,
  user,
  userLocation = null,
  open,
  onOpenChange,
  onRouteMeta,
  onRouteError,
  onRouteLoading,
}: Props) {
  const [initial] = useState(readInitialState);
  const [pos, setPos] = useState<BallPos>(initial.pos);
  const [snapEdge, setSnapEdge] = useState<BallSnapEdge>(initial.edge);
  const [dragging, setDragging] = useState(false);
  const [panelMounted, setPanelMounted] = useState(open);
  const [panelClosing, setPanelClosing] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const dragRef = useRef<{
    startX: number;
    startY: number;
    moved: boolean;
    baseLeft: number;
    baseTop: number;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setPanelMounted(true);
      setPanelClosing(false);
      return;
    }
    if (panelMounted) setPanelClosing(true);
  }, [open, panelMounted]);

  const handlePanelExitEnd = useCallback(() => {
    if (!openRef.current) {
      setPanelMounted(false);
      setPanelClosing(false);
    }
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      setPos((current) => {
        const next = pinBallToSnapEdge(snapEdge, current, viewport, BALL_SIZE, EDGE_MARGIN);
        return next.left === current.left && next.right === current.right && next.top === current.top
          ? current
          : next;
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [snapEdge]);

  const ballRect: BallRect = useMemo(() => {
    const viewportW = typeof window !== "undefined" ? window.innerWidth : 0;
    const resolved = toLeftTopBallPos(pos, viewportW, BALL_SIZE);
    return { left: resolved.left ?? 0, top: pos.top, width: BALL_SIZE, height: BALL_SIZE };
  }, [pos]);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      baseLeft: rect.left,
      baseTop: rect.top,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 指针捕获失败:退化为按下元素上的位移判定
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const g = dragRef.current;
    if (!g) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    if (!g.moved) {
      g.moved = true;
      setDragging(true);
    }
    setPos({ left: g.baseLeft + dx, right: null, top: g.baseTop + dy });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const g = dragRef.current;
    dragRef.current = null;
    if (!g) return;
    if (!g.moved) {
      onOpenChange(!open);
      return;
    }
    setDragging(false);
    const finalLeft = g.baseLeft + (e.clientX - g.startX);
    const finalTop = g.baseTop + (e.clientY - g.startY);
    const snap = computeBallSnap(
      { left: finalLeft, top: finalTop },
      { width: window.innerWidth, height: window.innerHeight },
      BALL_SIZE,
      EDGE_MARGIN,
    );
    const { edge, left, top } = snap;
    setSnapEdge(edge);
    setPos({ left, right: null, top });
    try {
      const payload = edge === "left" || edge === "right" ? { edge, top } : { edge, top, left };
      window.localStorage.setItem(POS_KEY, JSON.stringify(payload));
    } catch {
      // 隐私模式/配额:忽略,不持久化
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.ball} ${dragging ? styles.dragging : ""} ${open || panelMounted ? styles.ballOpen : ""}`}
        style={{ left: pos.left ?? 0, top: pos.top }}
        aria-label={t("agentBall", lang)}
        aria-expanded={open}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragging(false);
        }}
      >
        <span className={styles.sparkle} aria-hidden="true">
          ✦
        </span>
      </button>
      {panelMounted && (
        <AgentPanel
          bridge={bridge}
          lang={lang}
          user={user}
          userLocation={userLocation}
          ballRect={ballRect}
          dragging={dragging}
          snapEdge={dragging ? null : snapEdge}
          closing={panelClosing}
          onExitEnd={handlePanelExitEnd}
          onClose={() => onOpenChange(false)}
          onRouteMeta={onRouteMeta}
          onRouteError={onRouteError}
          onRouteLoading={onRouteLoading}
        />
      )}
    </>
  );
}
