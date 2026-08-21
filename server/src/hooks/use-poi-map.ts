'use client';

// ============================================================
// usePOIMap — 卡片↔地图联动 Hook
//
// 将 POIMarkerController 绑定到 React 生命周期：
// - view 可用时创建控制器，卸载时销毁
// - pois 变化 → setPOIs 差分更新标记
// - selectedId / highlightedId 变化 → select / highlight
// - accentColor 变化 → 重建控制器并应用新配色
// ============================================================

import { useEffect, useRef } from 'react';
import type { POI } from '../lib/types.ts';
import type { MapView } from '../lib/map-engine/types.ts';
import {
  createPOIMarkerController,
  type POIMarkerController,
  type POIMarkerControllerOptions,
} from '../lib/map-markers.ts';

/** usePOIMap 的配置项。 */
export interface UsePOIMapOptions {
  /** 需要展示到地图上的 POI 列表。 */
  pois: POI[];
  /**
   * 可选：只显示这些 id 的标记(b2)——marker 实例保留在控制器内,仅切换
   * show/hide(zoom tier/聚合边界/筛选变化不再销毁重建)。缺省/null = 全部显示。
   */
  visiblePOIs?: string[] | null;
  /** 当前选中的 POI id；变化时地图标记放大 + 强调环。 */
  selectedId?: string | null;
  /** 当前高亮的 POI id；变化时标记轻微放大 + 透明度变化。 */
  highlightedId?: string | null;
  /** 模式强调色（十六进制），用于标记图标。 */
  accentColor?: string;
  /** 地图标记点击回调。 */
  onMarkerClick?: (id: string) => void;
}

/**
 * 将当前 POI 列表 + 可见集 + 选中/高亮状态同步到控制器。
 * 供 usePOIMap 的创建 effect 与数据 effect 共用,保证两处行为一致。
 */
function applySync(
  controller: POIMarkerController,
  pois: POI[],
  selectedId?: string | null,
  highlightedId?: string | null,
  visiblePOIs?: string[] | null
): void {
  controller.setPOIs(pois);
  controller.setVisiblePOIs(visiblePOIs ?? null);
  if (selectedId) controller.select(selectedId);
  else controller.deselect();
  if (highlightedId) controller.highlight(highlightedId);
  else controller.unhighlight();
}

// ---------------------------------------------------------------------------
// usePOIMap — React Hook
// ---------------------------------------------------------------------------

/**
 * 将 MapView 实例与 POI 数据绑定：管理地图标记并处理卡片↔地图双向联动。
 *
 * 内部持有持久控制器，随 view / accentColor 变化重建，随组件卸载销毁。
 *
 * @param view MapView 实例（可为 null，此时不创建任何标记）。
 * @param opts POI 列表、选中/高亮状态、强调色与点击回调。
 */
export function usePOIMap(view: MapView | null, opts: UsePOIMapOptions): void {
  const { pois, visiblePOIs, selectedId, highlightedId, accentColor, onMarkerClick } = opts;

  // 缓存最新的回调与状态，避免 effect 依赖函数/对象导致频繁重建
  const latest = useRef({ accentColor, onMarkerClick, selectedId, highlightedId, visiblePOIs });
  latest.current = { accentColor, onMarkerClick, selectedId, highlightedId, visiblePOIs };

  const controllerRef = useRef<POIMarkerController | null>(null);

  // 创建 / 销毁控制器：view 实例或强调色变化时重建
  useEffect(() => {
    if (!view) {
      controllerRef.current?.destroy();
      controllerRef.current = null;
      return;
    }

    const controller = createPOIMarkerController(view, {
      color: latest.current.accentColor,
      onMarkerClick: (id) => latest.current.onMarkerClick?.(id),
    });
    controllerRef.current = controller;
    applySync(
      controller,
      pois,
      latest.current.selectedId,
      latest.current.highlightedId,
      latest.current.visiblePOIs
    );

    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, accentColor]);

  // POI 列表变化 → 差分更新标记（只增不删），并重放当前可见集/选中/高亮
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    applySync(
      controller,
      pois,
      latest.current.selectedId,
      latest.current.highlightedId,
      latest.current.visiblePOIs
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pois]);

  // 可见集变化 → show/hide 切换（实例保留，b2）
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.setVisiblePOIs(visiblePOIs ?? null);
  }, [visiblePOIs]);

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
