"use client";

// ============================================================
// useMapEngine — 地图引擎生命周期 Hook(ws-c 初版;f 扩展引擎切换)
//
// 挂载:resolveEngine(readEnginePreference()) → engine.load() → engine.createView();
// 卸载:view.destroy()。container 来自调用方(ref);center/zoom/style 只取
// 首渲染快照(初始值),后续相机/样式变更由调用方经 view 方法下发。
//
// - 引擎未配置(零 key)→ 返回 engine=null,调用方回退 CSS fallback 地图;
// - 活跃引擎的 search 能力注入 poi-service(视口兜底搜索路由,支持引擎切换);
// - AMap 完整实现经副作用 import 自注册(engine-registry 保持厂商无关)。
// ============================================================

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { LngLat, MapEngine, MapStyleId, MapView } from "@/lib/map-engine/types";
import { resolveEngine } from "@/lib/map-engine/engine-registry";
import { readEnginePreference } from "@/lib/map-engine/engine-preference";
import { setActiveSearchProvider } from "@/lib/poi-service";
// AMap 完整实现自注册(模块副作用;engine-registry 保持厂商无关,见 engine-registry 注释)
import "@/lib/map-engine/amap/amap-engine";

export interface UseMapEngineOptions {
  /** 地图挂载容器(ref;调用方持有) */
  containerRef: MutableRefObject<HTMLElement | null>;
  /** 初始中心(gcj02;只取首渲染快照) */
  center: LngLat;
  /** 初始 zoom(只取首渲染快照) */
  zoom: number;
  /** 初始底图样式(只取首渲染快照) */
  style: MapStyleId;
}

export interface UseMapEngineResult {
  engine: MapEngine | null;
  view: MapView | null;
  /** 引擎切换中(f 扩展:切换动画/重建期间为 true;初版恒 false) */
  isSwitching: boolean;
}

export function useMapEngine(options: UseMapEngineOptions): UseMapEngineResult {
  const { containerRef, center, zoom, style } = options;
  const [engine, setEngine] = useState<MapEngine | null>(null);
  const [view, setView] = useState<MapView | null>(null);
  const viewRef = useRef<MapView | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;

    const resolved = resolveEngine(readEnginePreference());
    if (!resolved) {
      // 零配置(无任何引擎 key):不加载脚本,调用方回退 CSS fallback 地图
      return;
    }
    setEngine(resolved);
    // 视口兜底搜索/建议回退随活跃引擎路由(引擎切换后不再硬绑 amap-api)
    setActiveSearchProvider(resolved.search);

    resolved
      .load()
      .then(() => {
        if (cancelled) return null;
        return resolved.createView({ container, center, zoom, style });
      })
      .then((created) => {
        if (cancelled || !created) return;
        viewRef.current = created;
        setView(created);
      })
      .catch((err) => {
        console.warn("[use-map-engine] map engine load/createView failed:", err);
      });

    return () => {
      cancelled = true;
      viewRef.current?.destroy();
      viewRef.current = null;
      setView(null);
      setActiveSearchProvider(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- center/zoom/style 只取初始快照
  }, [containerRef]);

  return { engine, view, isSwitching: false };
}
