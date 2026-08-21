"use client";

// AI Agent 悬浮球:44px 圆形玻璃按钮,可拖拽吸附,点击(非拖动)切换聊天面板。
// - 初始位 right:12px / bottom:179px(地图控件上方,mapControls 实测高 ~147 + 底距 20 + 间距 12);
// - 拖拽:pointer 事件,3px 阈值区分点击/拖动;松手吸附最近边缘(left/right),
//   clamp 12px 边距与顶部,吸附动画 cubic-bezier(0.32, 0.72, 0, 1) 0.35s;
// - 位置持久化 localStorage 'dm.agent-ball-pos';
// - 面板以球为锚实时跟随(ballRect 由 pos 状态派生,面板经 computePanelPlacement 定位)。

import { useMemo, useRef, useState } from "react";
import styles from "./agent-ball.module.css";
import { t, type Language } from "@/lib/i18n";
import type { MapBridge } from "@/lib/agent-map-bridge";
import type { BallRect } from "@/lib/agent-panel-placement";
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

interface Props {
  bridge: MapBridge | null;
  lang: Language;
}

/** 初始位(含 localStorage 恢复):{edge, top} 持久化格式;默认 right:12 / bottom:179。 */
function readInitialPos(): BallPos {
  if (typeof window === "undefined") return { left: null, right: EDGE_MARGIN, top: 0 };
  try {
    const raw = window.localStorage.getItem(POS_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const { edge, top } = parsed as { edge?: unknown; top?: unknown };
        if ((edge === "left" || edge === "right") && typeof top === "number" && Number.isFinite(top)) {
          return edge === "left"
            ? { left: EDGE_MARGIN, right: null, top }
            : { left: null, right: EDGE_MARGIN, top };
        }
      }
    }
  } catch {
    // 坏数据 → 默认位
  }
  const top = Math.max(EDGE_MARGIN, window.innerHeight - DEFAULT_BOTTOM - BALL_SIZE);
  return { left: null, right: EDGE_MARGIN, top };
}

export default function AgentBall({ bridge, lang }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<BallPos>(readInitialPos);
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
    // 松手吸附最近边缘 + clamp 12px 边距与顶部
    const finalLeft = g.baseLeft + (e.clientX - g.startX);
    const finalTop = g.baseTop + (e.clientY - g.startY);
    const edge: "left" | "right" = finalLeft < window.innerWidth / 2 ? "left" : "right";
    const top = Math.min(Math.max(EDGE_MARGIN, finalTop), window.innerHeight - BALL_SIZE - EDGE_MARGIN);
    setPos(edge === "left" ? { left: EDGE_MARGIN, right: null, top } : { left: null, right: EDGE_MARGIN, top });
    try {
      window.localStorage.setItem(POS_KEY, JSON.stringify({ edge, top }));
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
        <AgentPanel bridge={bridge} lang={lang} ballRect={ballRect} dragging={dragging} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
