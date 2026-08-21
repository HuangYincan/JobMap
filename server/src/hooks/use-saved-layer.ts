"use client";

// ============================================================
// useSavedLayer — 收藏图层 Hook(2026-08-22 修订)
//
// 抽取自 map-shell:收藏图层开关(savedOverlay)状态 + overlay POI
// 派生(savedPlaces → overlayPois)+ toggle(登录门控 / 写 pref /
// 程序化相机移动的「收藏相机同步」抑制)+ 登出隐藏(hide)。
// - 不拥有数据:user/savedPlaces/compareCatalog/mode 由调用方传入;
// - 程序化相机移动的同步状态 ref 由调用方(map-shell)持有并传入——与
//   useWorkViewport 事件侧消费、map-shell syncView 圆心冻结共享,ref 必须
//   是同一实例;同步状态以「相机是否到达目标中心」判定事件归属(结构性
//   抑制,替代 500ms 时间窗补丁,ws1 saved-overlay-wipe),无时间常数;
// - overlayPois 派生(savedPlacesToOverlay)与 toggle 相机移动逻辑
//   与原 map-shell 实现逐行对应,行为完全不变(纯重构);
// - 互斥语义(2026-08-22 用户决策)在消费方落地:map-shell 用
//   savedOverlay && user 做地图可见性互斥(mutexVisibleIds)+ Explore
//   列表切收藏列表,本 hook 只负责状态/派生/toggle 本身。
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
import type { SavedCameraSync } from "@/hooks/use-work-viewport";

export interface UseSavedLayerDeps {
  user: AccountUser | null;
  savedPlaces: SavedPlace[];
  compareCatalog: POI[];
  mode: MapMode;
  mapInstance: MutableRefObject<any>;
  /** 程序化相机移动(toggle setBounds)的收藏相机同步状态 ref(与 useWorkViewport 共享同一实例) */
  savedCameraSyncRef: MutableRefObject<SavedCameraSync | null>;
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
    savedCameraSyncRef,
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
    const bounds = overlayBounds(overlayPois);
    const map = mapInstance.current;
    if (!bounds || !map || overlayPois.length === 0) return;
    // ws1 saved-overlay-wipe 结构性抑制(替代 500ms 时间窗补丁):setBounds 前
    // 写入「收藏相机同步」状态——视口刷新(useWorkViewport 事件侧)与 distance
    // 圆心冻结(map-shell syncView)在该次程序化相机移动的 settle 事件内跳过,
    // 以事件到达时相机是否位于目标中心判定归属(慢动画/迟到事件不逃逸,无
    // 时间常数);相机离开目标或消费满事件对后自动结束,不影响后续用户操作
    // 触发的视口刷新。目标中心 = 收藏点外接框中点(fit 保持 bounds 居中)。
    savedCameraSyncRef.current = {
      destCenter: {
        lng: (bounds.sw.lng + bounds.ne.lng) / 2,
        lat: (bounds.sw.lat + bounds.ne.lat) / 2,
      },
      consumed: 0,
    };
    // 视图归一化 setBounds(引擎内部构造厂商 Bounds,ws-c 迁移)
    map.setBounds({
      west: bounds.sw.lng,
      south: bounds.sw.lat,
      east: bounds.ne.lng,
      north: bounds.ne.lat,
    });
  }, [user, savedOverlay, overlayPois, mapInstance, savedCameraSyncRef]);

  const hide = useCallback(() => {
    setSavedOverlay(false);
    writeSavedOverlayPref(false);
  }, []);

  return { savedOverlay, overlayPois, toggle, hide };
}
