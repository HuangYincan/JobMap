"use client";

// ============================================================
// useSavedLayer — 收藏图层 Hook(2026-08-20,QA scan #6)
//
// 抽取自 map-shell:收藏图层开关(savedOverlay)状态 + overlay POI
// 派生(savedPlaces → overlayPois)+ toggle(登录门控 / 写 pref /
// 程序化相机移动抑制视口刷新)+ 登出隐藏(hide)。
// - 不拥有数据:user/savedPlaces/compareCatalog/mode 由调用方传入;
// - 相机移动的抑制窗口 ref 由调用方(map-shell)持有并传入——与
//   useWorkViewport 事件侧检查共享,ref 必须是同一实例;
// - overlayPois 派生(savedPlacesToOverlay)与 toggle 相机移动逻辑
//   与原 map-shell 实现逐行对应,行为完全不变(纯重构)。
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { AccountUser, SavedPlace } from "@/lib/account";
import type { MapMode, POI } from "@/lib/types";
import {
  overlayBounds,
  readSavedOverlayPref,
  savedPlacesToOverlay,
  writeSavedOverlayPref,
} from "@/lib/saved-overlay";
import { VIEWPORT_SUPPRESS_MS } from "@/hooks/use-work-viewport";

export interface UseSavedLayerDeps {
  user: AccountUser | null;
  savedPlaces: SavedPlace[];
  compareCatalog: POI[];
  mode: MapMode;
  mapInstance: MutableRefObject<any>;
  /** 程序化相机移动(toggle setBounds/setCenter)前打开的视口刷新抑制窗口 ref(与 useWorkViewport 共享) */
  suppressViewportRefreshUntilRef: MutableRefObject<number>;
  /** 未登录点击开关时的处理(map-shell 打开登录弹窗) */
  onRequireAuth: () => void;
}

export interface UseSavedLayerResult {
  savedOverlay: boolean;
  overlayPois: POI[];
  toggle: () => void;
  /** 登出时隐藏收藏图层 + 持久化关闭(避免收藏图层静默消失) */
  hide: () => void;
}

export function useSavedLayer(deps: UseSavedLayerDeps): UseSavedLayerResult {
  const {
    user,
    savedPlaces,
    compareCatalog,
    mode,
    mapInstance,
    suppressViewportRefreshUntilRef,
    onRequireAuth,
  } = deps;

  const [savedOverlay, setSavedOverlay] = useState(true);

  // 挂载时读回持久化偏好(原 map-shell 挂载 effect 中的对应行)
  useEffect(() => {
    setSavedOverlay(readSavedOverlayPref(true));
  }, []);

  const overlayPois = useMemo(
    () => savedPlacesToOverlay(savedPlaces, compareCatalog, mode),
    [savedPlaces, compareCatalog, mode],
  );

  // onRequireAuth 经 ref 调用:toggle 的 useCallback 依赖保持与数据
  // 一致(user/savedOverlay/overlayPois + 稳定 refs),inline 箭头不重建 toggle
  const onRequireAuthRef = useRef(onRequireAuth);
  onRequireAuthRef.current = onRequireAuth;

  const toggle = useCallback(() => {
    if (!user) {
      onRequireAuthRef.current();
      return;
    }
    const next = !savedOverlay;
    writeSavedOverlayPref(next);
    setSavedOverlay(next);
    if (!next) return;
    // w5:setBounds 触发 moveend/zoomend → 视口 replace loader 会以空批次(单 pin 退化视野/覆盖区外)
    // 整体替换目录,清空全部 marker(收藏图层启停 bug)。相机移动前开抑制窗口吞掉本次移动事件,
    // 窗口自动过期,不影响后续用户操作触发的视口刷新。
    suppressViewportRefreshUntilRef.current = Date.now() + VIEWPORT_SUPPRESS_MS;
    const bounds = overlayBounds(overlayPois);
    const map = mapInstance.current;
    if (!bounds || !map || overlayPois.length === 0) return;
    try {
      const AMap = (window as unknown as { AMap?: { Bounds: new (sw: number[], ne: number[]) => unknown } }).AMap;
      if (AMap?.Bounds) {
        map.setBounds(new AMap.Bounds([bounds.sw.lng, bounds.sw.lat], [bounds.ne.lng, bounds.ne.lat]));
        return;
      }
    } catch {
      // fall through
    }
    map.setCenter?.([overlayPois[0].location.lng, overlayPois[0].location.lat]);
  }, [user, savedOverlay, overlayPois, mapInstance, suppressViewportRefreshUntilRef]);

  const hide = useCallback(() => {
    setSavedOverlay(false);
    writeSavedOverlayPref(false);
  }, []);

  return { savedOverlay, overlayPois, toggle, hide };
}
