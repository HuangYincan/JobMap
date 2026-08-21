"use client";

// ============================================================
// useSavedLayer — 收藏图层 Hook(2026-08-22 no-fly 修订)
//
// 抽取自 map-shell:收藏图层开关(savedOverlay)状态 + overlay POI
// 派生(savedPlaces → overlayPois)+ toggle(登录门控 / 写 pref)+ 登出隐藏(hide)。
// - 不拥有数据:user/savedPlaces/compareCatalog/mode 由调用方传入;
// - toggle 不触碰相机(2026-08-22 用户反馈):打开/关闭只翻转状态 + 写 pref,
//   地图 pin 可见性切换由消费方派生(mergeMapPois/mutexVisibleIds,互斥语义),
//   相机完全不动(不调用任何视图移动方法);
// - 互斥语义(2026-08-22 用户决策)在消费方落地:map-shell 用
//   savedOverlay && user 做地图可见性互斥(mutexVisibleIds)+ Explore
//   列表切收藏列表,本 hook 只负责状态/派生/toggle 本身。
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AccountUser, SavedPlace } from "@/lib/account";
import type { MapMode, POI } from "@/lib/types";
import {
  readSavedOverlayPref,
  savedPlacesToOverlay,
  writeSavedOverlayPref,
} from "@/lib/saved-overlay";

export interface UseSavedLayerDeps {
  user: AccountUser | null;
  savedPlaces: SavedPlace[];
  compareCatalog: POI[];
  mode: MapMode;
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
  const { user, savedPlaces, compareCatalog, mode, onRequireAuth } = deps;

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
  // 一致(user/savedOverlay + 稳定 refs),inline 箭头不重建 toggle
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
    // 不触碰相机(2026-08-22 用户反馈):打开/关闭只翻转状态 + 写 pref,
    // 地图 pin 可见性与 Explore 列表切换由消费方按互斥语义派生,相机完全
    // 不动(不调用任何视图移动方法);关闭时池保留 catalog 全量(marker
    // 实例不销毁),恢复搜索管线 pin 与列表秒恢复、不重查。
  }, [user, savedOverlay]);

  const hide = useCallback(() => {
    setSavedOverlay(false);
    writeSavedOverlayPref(false);
  }, []);

  return { savedOverlay, overlayPois, toggle, hide };
}
