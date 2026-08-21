"use client";

// AI Agent 悬浮球:44px 圆形玻璃按钮,可拖拽吸附,点击(非拖动)切换聊天面板。
// - 初始位 right:12px / bottom:179px(地图控件上方,mapControls 实测高 ~147 + 底距 20 + 间距 12);
// - 拖拽:pointer 事件,3px 阈值区分点击/拖动;松手按球心到四边最近距离四向吸附
//   (左/右/上/下,平局 左→右→上→下;computeBallSnap 纯函数),正交方向保留松手坐标,
//   clamp 12px 边距,吸附动画 cubic-bezier(0.32, 0.72, 0, 1) 0.35s;
// - 位置持久化 localStorage 'dm.agent-ball-pos'({edge, top, left?};兼容旧 {edge:'left'|'right', top});
// - 面板以球为锚实时跟随(ballRect 由 pos 状态派生,面板经 computePanelPlacement 定位,
//   吸附 edge 传入 → 垂直锚定;拖拽中不传 → 面板跟手)。

import { useMemo, useRef, useState } from "react";
import styles from "./agent-ball.module.css";
import { t, type Language } from "@/lib/i18n";
import type { MapBridge } from "@/lib/agent-map-bridge";
import { computeBallSnap, type BallRect, type BallSnapEdge } from "@/lib/agent-panel-placement";
import { AgentPanel } from "./agent-panel";

const BALL_SIZE = 44;
const EDGE_MARGIN = 12;
const DEFAULT_BOTTOM = 179; // mapControls 实测高 ~147 + 底距 20 + 间距 12
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
}

/** 初始位(含 localStorage 恢复):{edge, top, left?} 持久化格式;默认 right:12 / bottom:179。 */
function readInitialState(): InitialState {
  // SSR 安全:window 不存在时直接返回默认位(top 占位,客户端 hydration 时重算)
  if (typeof window === "undefined") return { pos: { left: null, right: EDGE_MARGIN, top: 0 }, edge: "right" };
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
          if (edge === "left") return { pos: { left: EDGE_MARGIN, right: null, top }, edge };
          if (edge === "right") return { pos: { left: null, right: EDGE_MARGIN, top }, edge };
          // top/bottom 吸附:left 存水平位置;缺失/非法 → 默认贴左
          const savedLeft = typeof left === "number" && Number.isFinite(left) ? left : EDGE_MARGIN;
          if (edge === "top") return { pos: { left: savedLeft, right: null, top: EDGE_MARGIN }, edge };
          return { pos: { left: savedLeft, right: null, top: window.innerHeight - BALL_SIZE - EDGE_MARGIN }, edge };
        }
      }
    }
  } catch {
    // 坏数据 → 默认位
  }
  const top = Math.max(EDGE_MARGIN, window.innerHeight - DEFAULT_BOTTOM - BALL_SIZE);
  return { pos: { left: null, right: EDGE_MARGIN, top }, edge: "right" };
}

export default function AgentBall({ bridge, lang }: Props) {
  const [open, setOpen] = useState(false);
  const [initial] = useState(readInitialState);
  const [pos, setPos] = useState<BallPos>(initial.pos);
  // 当前吸附边缘:松手吸附时更新,拖拽中保持旧值(面板拖拽中不消费)
  const [snapEdge, setSnapEdge] = useState<BallSnapEdge>(initial.edge);
  const [dragging, setDragging] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    moved: boolean;
    baseLeft: number;
    baseTop: number;
  } | null>(null);

  /** 球当前矩形(viewport 坐标):pos 状态派生;面板锚定用。 */
  const ballRect: BallRect = useMemo(() => {
    const viewportW = typeof window !== "undefined" ? window.innerWidth : 0;
    const left = pos.left ?? (pos.right !== null ? viewportW - pos.right - BALL_SIZE : 0);
    return { left, top: pos.top, width: BALL_SIZE, height: BALL_SIZE };
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
    if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return; // 3px 阈值区分点击/拖动
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
      setOpen((v) => !v); // 点击(非拖动)→ toggle 面板
      return;
    }
    setDragging(false);
    // 松手四向吸附:球心到四边最近距离(平局 左→右→上→下),正交方向保留松手坐标
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
    if (edge === "right") {
      setPos({ left: null, right: EDGE_MARGIN, top });
    } else {
      setPos({ left, right: null, top });
    }
    try {
      // 持久化:{edge, top}(left/right)或 {edge, top, left}(top/bottom 存水平位置)
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
        className={`${styles.ball} ${dragging ? styles.dragging : ""}`}
        style={{ left: pos.left ?? undefined, right: pos.right ?? undefined, top: pos.top }}
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
      {open && (
        <AgentPanel
          bridge={bridge}
          lang={lang}
          ballRect={ballRect}
          dragging={dragging}
          snapEdge={dragging ? null : snapEdge}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
