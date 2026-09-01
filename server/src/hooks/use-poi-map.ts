'use client';

// ============================================================
// usePOIMap — 卡片↔地图联动 Hook
//
// 将 POIMarkerController 绑定到 React 生命周期：
// - view 可用时创建控制器，卸载时销毁
// - pois 变化 → setPOIs 差分更新标记（replace 语义可选）
// - resetKey 变化 → 显式 clear() 后重放新池（模式切换换目录,池语义切换）
// - selectedId / highlightedId 变化 → select / highlight
// - accentColor 变化 → 重建控制器并应用新配色
// - 每次 applySync 末尾调用 controller.sync()：厂商侧被外部删除的
//   marker 自动补回（完整性扫描，幂等 O(n)）
// - moveend 时也触发 sync：外部删除不经过 React 状态。不挂 zoomchange
//   （缩放动画中连续触发，海量点 O(n) 扫描会卡）
//
// 控制器 keepalive(2026-09-01 poi-lifecycle):与 use-map-engine 活图交棒
// 同款——effect cleanup 不立即 destroy()。StrictMode / next/dynamic 详情
// 面板触发的 MapShell fiber disconnect→reconnect 会重放本 effect;若当帧
// 拆掉全部 marker,屏上 POI 闪没,且 applySync 若碰上空可见集就回不来。
// 同 view + 同 accentColor 重连复用控制器(针零丢失);换 view/换色/真卸载
// 才延迟销毁。
// ============================================================

import { useEffect, useRef } from 'react';
import type { POI } from '../lib/types.ts';
import type { MapView } from '../lib/map-engine/types.ts';
import {
  createPOIMarkerController,
  type POIMarkerController,
} from '../lib/map-markers.ts';

/** usePOIMap 的配置项。 */
export interface UsePOIMapOptions {
  /** 需要展示到地图上的 POI 列表。 */
  pois: POI[];
  /**
   * 可选：只显示这些 id 的标记(b2)——marker 实例保留在控制器内,仅切换
   * show/hide(聚合边界/筛选/可见集变化不再销毁重建)。缺省/null = 全部显示。
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
  /**
   * 同步是否以 replace 语义全量替换(domain 视口替换:池外 id 销毁,旧视口
   * marker 不再累积)。缺省 false = 只增不删(work 全量池语义,行为不变)。
   */
  replacePOIsOnSync?: boolean;
  /**
   * replace 时恒保留的 id 集合(收藏 overlay 层,实例不销毁,隐藏与否由
   * visiblePOIs 决定)。缺省 null = 不额外保留。仅在 replacePOIsOnSync 时生效。
   */
  retainPOIIds?: Iterable<string> | null;
  /**
   * 池语义切换键(2026-08-25 f-lod-pool):变化时显式 `controller.clear()`
   * 再重放新池——模式切换换目录时旧语义实例不跨模式泄漏(setPOIs 空列表
   * 已不再是清空路径,transient 空目录不再兜底清场)。缺省 = 不重置。
   */
  resetKey?: string | number | null;
}

/**
 * 将当前 POI 列表 + 可见集 + 选中/高亮状态同步到控制器。
 * 供 usePOIMap 的创建 effect 与数据 effect 共用,保证两处行为一致。
 */
function applySync(
  controller: POIMarkerController,
  pois: POI[],
  opts: Pick<UsePOIMapOptions, 'replacePOIsOnSync' | 'retainPOIIds'>,
  selectedId?: string | null,
  highlightedId?: string | null,
  visiblePOIs?: string[] | null
): void {
  controller.setPOIs(pois, {
    replace: opts.replacePOIsOnSync ?? false,
    retainIds: opts.retainPOIIds ?? [],
  });
  controller.setVisiblePOIs(visiblePOIs ?? null);
  if (selectedId) controller.select(selectedId);
  else controller.deselect();
  if (highlightedId) controller.highlight(highlightedId);
  else controller.unhighlight();
  // 完整性补回:厂商侧被外部删除的 marker 由 sync 扫描重建(幂等 O(n))
  controller.sync();
}

type ControllerKeepalive = {
  controller: POIMarkerController;
  view: MapView;
  color: string | undefined;
};

// ---------------------------------------------------------------------------
// usePOIMap — React Hook
// ---------------------------------------------------------------------------

/**
 * 将 MapView 实例与 POI 数据绑定：管理地图标记并处理卡片↔地图双向联动。
 *
 * 内部持有持久控制器。同 view / 同强调色在 fiber reconnect 时复用(keepalive);
 * 换 view、换强调色或真卸载才销毁。
 *
 * @param view MapView 实例（可为 null，此时不创建任何标记）。
 * @param opts POI 列表、选中/高亮状态、强调色与点击回调。
 */
export function usePOIMap(view: MapView | null, opts: UsePOIMapOptions): void {
  const {
    pois,
    visiblePOIs,
    selectedId,
    highlightedId,
    accentColor,
    onMarkerClick,
    replacePOIsOnSync,
    retainPOIIds,
    resetKey,
  } = opts;

  // 缓存最新的回调与状态，避免 effect 依赖函数/对象导致频繁重建
  const latest = useRef({
    pois,
    accentColor,
    onMarkerClick,
    selectedId,
    highlightedId,
    visiblePOIs,
    replacePOIsOnSync,
    retainPOIIds,
    resetKey,
  });
  latest.current = {
    pois,
    accentColor,
    onMarkerClick,
    selectedId,
    highlightedId,
    visiblePOIs,
    replacePOIsOnSync,
    retainPOIIds,
    resetKey,
  };

  const controllerRef = useRef<POIMarkerController | null>(null);
  const keepaliveRef = useRef<ControllerKeepalive | null>(null);

  // 创建 / 销毁控制器：view 实例或强调色变化时重建;同 view 重连复用
  useEffect(() => {
    if (!view) {
      return;
    }

    const keep = keepaliveRef.current;
    const viewAlive = typeof view.isDestroyed !== 'function' || !view.isDestroyed();
    const reusable =
      Boolean(keep) &&
      keep!.view === view &&
      keep!.color === latest.current.accentColor &&
      viewAlive;

    let controller: POIMarkerController;
    if (reusable && keep) {
      keepaliveRef.current = null;
      controller = keep.controller;
    } else {
      if (keep) {
        keep.controller.destroy();
        keepaliveRef.current = null;
      }
      controllerRef.current?.destroy();
      controller = createPOIMarkerController(view, {
        color: latest.current.accentColor,
        onMarkerClick: (id) => latest.current.onMarkerClick?.(id),
      });
    }
    controllerRef.current = controller;
    applySync(
      controller,
      latest.current.pois,
      latest.current,
      latest.current.selectedId,
      latest.current.highlightedId,
      latest.current.visiblePOIs
    );

    // 无状态变化时的完整性补回:marker 可能被厂商侧外部删除而 React 状态
    // 不感知(引用不变不触发任何 effect)——挂 moveend 触发 sync,幂等。
    // 不挂 zoomchange:该事件在缩放动画中连续触发,对海量点做 O(n)
    // isAttached 扫描会卡顿;缩放结束通常伴随 moveend。
    const offMove = view.on('moveend', () => {
      controller.sync();
    });

    return () => {
      offMove();
      if (controllerRef.current === controller) controllerRef.current = null;
      keepaliveRef.current = {
        controller,
        view,
        color: latest.current.accentColor,
      };
      const doomed = controller;
      setTimeout(() => {
        if (keepaliveRef.current?.controller !== doomed) return;
        doomed.destroy();
        keepaliveRef.current = null;
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, accentColor]);

  // POI 池变化 → 差分更新标记（replace 可选），并重放当前可见集/选中/高亮。
  // resetKey 变化(模式切换换目录,2026-08-25 f-lod-pool):先显式 clear() 摘除
  // 旧语义实例再重放新池——setPOIs 空列表已不再清场(空过滤 ≠ 清空池),
  // 若不做显式清空,domain→work(无 replace)会把旧模式遗留实例留在池内隐藏。
  // 首次运行(prev 未初始化)不清:挂载时本 effect 与 create effect 同 commit
  // 执行,create 已回放最新池;首变清场会无谓销毁刚回放的实例。
  const prevResetKeyRef = useRef<string | number | null | undefined>(undefined);
  useEffect(() => {
    const prev = prevResetKeyRef.current;
    prevResetKeyRef.current = resetKey;
    const reset = prev !== undefined && resetKey !== prev;
    const controller = controllerRef.current;
    if (!controller) return;
    if (reset) controller.clear();
    applySync(
      controller,
      latest.current.pois,
      latest.current,
      latest.current.selectedId,
      latest.current.highlightedId,
      latest.current.visiblePOIs
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pois, resetKey]);

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
