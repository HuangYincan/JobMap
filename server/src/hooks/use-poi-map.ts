'use client';

// ============================================================
// usePOIMap — 卡片↔地图联动 Hook
//
// 将 POIMarkerController 绑定到 React 生命周期：
// - map 可用时创建控制器，卸载时销毁
// - pois 变化 → setPOIs 差分更新标记
// - selectedId / highlightedId 变化 → select / highlight
// - accentColor 变化 → 重建控制器并应用新配色
// ============================================================

import { useEffect, useRef } from 'react';
import type { POI } from '../lib/types.ts';
import {
  createPOIMarkerController,
  type POIMarkerController,
  type POIMarkerControllerOptions,
} from '../lib/map-markers.ts';

/** usePOIMap 的配置项。 */
export interface UsePOIMapOptions {
  /** 需要展示到地图上的 POI 列表。 */
  pois: POI[];
  /** 当前选中的 POI id；变化时地图标记放大 + 强调环。 */
  selectedId?: string | null;
  /** 当前高亮的 POI id；变化时标记轻微放大 + 透明度变化。 */
  highlightedId?: string | null;
  /** 模式强调色（十六进制），用于标记图标。 */
  accentColor?: string;
  /** 地图标记点击回调。 */
  onMarkerClick?: (id: string) => void;
}

/** syncPOIsToMap 的配置项（pois 单独传参，故移除）。 */
export type SyncPOIsToMapOptions = Omit<UsePOIMapOptions, 'pois'>;

/**
 * 将当前 POI 列表 + 选中/高亮状态同步到控制器。
 * 供 Hook 内部与 syncPOIsToMap 共用，保证两套入口行为一致。
 */
function applySync(
  controller: POIMarkerController,
  pois: POI[],
  selectedId?: string | null,
  highlightedId?: string | null
): void {
  controller.setPOIs(pois);
  if (selectedId) controller.select(selectedId);
  else controller.deselect();
  if (highlightedId) controller.highlight(highlightedId);
  else controller.unhighlight();
}

// ---------------------------------------------------------------------------
// syncPOIsToMap — 无生命周期的一次性同步入口
// ---------------------------------------------------------------------------

/** 每个 map 实例复用同一个控制器，避免重复同步产生重复标记。 */
interface SyncEntry {
  controller: POIMarkerController;
  opts: Pick<POIMarkerControllerOptions, 'color' | 'onMarkerClick'>;
}

const syncRegistry = new WeakMap<object, SyncEntry>();

/**
 * 将 POI 列表与选中/高亮状态一次性同步到地图。
 *
 * 适用于非 React / 无需生命周期管理的场景；对同一 map 重复调用会差分更新，
 * 不会产生重复标记。若需要随状态持续联动，请使用 usePOIMap。
 *
 * @param map AMap.Map 实例（为空时 no-op）。
 * @param pois 需要展示的 POI 列表。
 * @param opts 选中 / 高亮 / 配色 / 点击回调。
 */
export function syncPOIsToMap(
  map: any,
  pois: POI[],
  opts: SyncPOIsToMapOptions
): void {
  if (!map) return;

  const key = map as object;
  const nextOpts: SyncEntry['opts'] = {
    color: opts.accentColor,
    onMarkerClick: opts.onMarkerClick,
  };

  let entry = syncRegistry.get(key);
  if (
    !entry ||
    entry.opts.color !== nextOpts.color ||
    entry.opts.onMarkerClick !== nextOpts.onMarkerClick
  ) {
    if (entry) entry.controller.destroy();
    const controller = createPOIMarkerController(map, nextOpts);
    entry = { controller, opts: nextOpts };
    syncRegistry.set(key, entry);
  }

  applySync(entry.controller, pois, opts.selectedId, opts.highlightedId);
}

// ---------------------------------------------------------------------------
// usePOIMap — React Hook
// ---------------------------------------------------------------------------

/**
 * 将 AMap 实例与 POI 数据绑定：管理地图标记并处理卡片↔地图双向联动。
 *
 * 内部持有持久控制器，随 map / accentColor 变化重建，随组件卸载销毁。
 *
 * @param map AMap.Map 实例（可为 null，此时不创建任何标记）。
 * @param opts POI 列表、选中/高亮状态、强调色与点击回调。
 */
export function usePOIMap(map: any | null, opts: UsePOIMapOptions): void {
  const { pois, selectedId, highlightedId, accentColor, onMarkerClick } = opts;

  // 缓存最新的回调与状态，避免 effect 依赖函数/对象导致频繁重建
  const latest = useRef({ accentColor, onMarkerClick, selectedId, highlightedId });
  latest.current = { accentColor, onMarkerClick, selectedId, highlightedId };

  const controllerRef = useRef<POIMarkerController | null>(null);

  // 创建 / 销毁控制器：map 实例或强调色变化时重建
  useEffect(() => {
    if (!map) {
      controllerRef.current?.destroy();
      controllerRef.current = null;
      return;
    }

    const controller = createPOIMarkerController(map, {
      color: latest.current.accentColor,
      onMarkerClick: (id) => latest.current.onMarkerClick?.(id),
    });
    controllerRef.current = controller;
    applySync(controller, pois, latest.current.selectedId, latest.current.highlightedId);

    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, accentColor]);

  // POI 列表变化 → 差分更新标记，并重放当前选中/高亮
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    applySync(controller, pois, latest.current.selectedId, latest.current.highlightedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pois]);

  // 选中状态变化 → select / deselect
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (selectedId) controller.select(selectedId);
    else controller.deselect();
  }, [selectedId]);

  // 高亮状态变化 → highlight / unhighlight
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (highlightedId) controller.highlight(highlightedId);
    else controller.unhighlight();
  }, [highlightedId]);
}
