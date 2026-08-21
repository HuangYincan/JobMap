// ============================================================
// switchMapEngine — 引擎切换编排(ws-f)
//
// 「自动为主 + 手动可切」的切换内核。纯函数 + 引擎注入(DI):
// 不 import 注册表、不 import 厂商实现,node 测试可全 mock,不真发网络。
//
// 编排顺序(契约,不可交换):
//   1. 状态捕获:opts.state 由调用方传入(旧 view 的 getState() 或初始值)
//   2. from?.destroy() —— 先于新 view 创建(同一容器同时只能有一个地图实例)
//   3. to.load() —— 幂等脚本注入(可重复调用)
//   4. to.createView({ container, center, zoom, pitch, rotation, style })
//   5. 重建 controller 回放:在**新 view** 上创建 POI marker 控制器并回放
//      POI 集 / 可见集 / 选中 / 高亮(仅当调用方传入回放数据;调用方若同时
//      使用 usePOIMap,勿传回放数据——usePOIMap 随 view 变化自动重建控制器)
//   6. 返回 { view, created }
//
// 守卫:
// - 目标引擎未配置(isConfigured() false)→ 直接抛错,**不销毁旧 view**;
// - 同引擎切换(to.id === from.engine.id)→ 不销毁不重建,created:false。
//
// style 降级:由引擎视图自身语义兜底(baidu/tencent 对不支持的样式回退
// normal + console.warn,见各引擎实现),本函数不做二次猜测,只负责透传。
// ============================================================

import type { DomainPOI } from '../types.ts';
import { createPOIMarkerController } from '../map-markers.ts';
import type { MapEngine, MapStyleId, MapView, MapViewState } from './types.ts';

/** 切换时回放到新 view 控制器的 POI 状态(全可选;缺省 = 不创建控制器) */
export interface EngineSwitchReplay {
  /** 全量 POI 池 → 控制器 setPOIs */
  pois?: DomainPOI[];
  /** 可见 id 集 → setVisiblePOIs(优先于 visiblePOIs 派生) */
  visibleIds?: Set<string>;
  /** 可见 POI 数组 → 未传 visibleIds 时派生可见集;pois 缺省时兼作全量池 */
  visiblePOIs?: DomainPOI[];
  /** 选中 id → controller.select(显式 null = deselect) */
  selectedId?: string | null;
  /** 高亮 id → controller.highlight(显式 null = unhighlight) */
  highlightedId?: string | null;
}

export interface SwitchMapEngineOptions extends EngineSwitchReplay {
  /** 旧 view(可为 null:首次切换 / 初始状态) */
  from: MapView | null;
  /** 目标引擎(DI 注入;测试传 mock,不真发网络) */
  to: MapEngine;
  /** 地图挂载容器(原容器,引擎间复用) */
  container: HTMLElement;
  /** 捕获自旧 view 的相机状态(或初始值) */
  state: MapViewState;
  /** 目标底图样式(引擎不支持时自行降级 normal + warn) */
  style: MapStyleId;
}

export interface SwitchMapEngineResult {
  view: MapView;
  /** 是否实际创建了新视图(false = 同引擎守卫,直接返回旧 view) */
  created: boolean;
}

/** 是否携带任何控制器回放数据(全空 = 不创建控制器,交给 usePOIMap 等调用方) */
function hasReplayData(replay: EngineSwitchReplay): boolean {
  return (
    (replay.pois?.length ?? 0) > 0 ||
    (replay.visiblePOIs?.length ?? 0) > 0 ||
    (replay.visibleIds?.size ?? 0) > 0 ||
    replay.selectedId !== undefined ||
    replay.highlightedId !== undefined
  );
}

/**
 * 在新 view 上重建 POI marker 控制器并回放状态。
 * 顺序(与 usePOIMap.applySync 同口径):POI 集 → 可见集 → 选中 → 高亮。
 */
function replayController(view: MapView, replay: EngineSwitchReplay): void {
  const controller = createPOIMarkerController(view);
  const { pois, visibleIds, visiblePOIs, selectedId, highlightedId } = replay;

  if (pois && pois.length > 0) controller.setPOIs(pois);
  else if (visiblePOIs && visiblePOIs.length > 0) controller.setPOIs(visiblePOIs);

  const visible = visibleIds
    ? Array.from(visibleIds)
    : visiblePOIs
      ? visiblePOIs.map((p) => p.id)
      : null;
  controller.setVisiblePOIs(visible);

  if (selectedId !== undefined) {
    if (selectedId) controller.select(selectedId);
    else controller.deselect();
  }
  if (highlightedId !== undefined) {
    if (highlightedId) controller.highlight(highlightedId);
    else controller.unhighlight();
  }
}

/**
 * 引擎切换编排(见文件头注释)。
 *
 * @returns { view, created } —— created:false 仅出现在同引擎守卫
 * (to.id === from.engine.id),此时 view 即原视图,未发生任何销毁/重建。
 */
export async function switchMapEngine(opts: SwitchMapEngineOptions): Promise<SwitchMapEngineResult> {
  const { from, to, container, state, style, ...replay } = opts;

  // 未配置引擎:不销毁旧 view(可用视图保留),直接抛错由调用方处理
  if (!to.isConfigured()) {
    throw new Error(
      `[map-engine] 目标引擎 ${to.id} 未配置(${to.keyVar}),切换中止(旧 view 保留)`,
    );
  }
  // 同引擎守卫:点击当前引擎 chip 等场景,不销毁不重建
  if (from && from.engine.id === to.id) {
    return { view: from, created: false };
  }

  from?.destroy();
  await to.load();
  const view = await to.createView({
    container,
    center: state.center,
    zoom: state.zoom,
    pitch: state.pitch ?? 0,
    rotation: state.rotation ?? 0,
    style,
  });

  if (hasReplayData(replay)) replayController(view, replay);

  return { view, created: true };
}
