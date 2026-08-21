// ============================================================
// switchMapEngine — 引擎切换编排(ws-f;ws-3 安全切换重构)
//
// 「自动为主 + 手动可切」的切换内核。纯函数 + 引擎注入(DI):
// 不 import 注册表、不 import 厂商实现,node 测试可全 mock,不真发网络。
//
// 编排顺序(契约,ws-3 改为「先就绪、后销毁」的安全顺序):
//   1. 状态捕获:opts.state 由调用方传入(旧 view 的 getState() 或初始值)
//   2. to.load() —— 幂等脚本注入(可重复调用)。最耗时步骤,旧 view 全程
//      存活、画面不中断;此间 signal.aborted → 直接放弃,旧 view 零触碰
//   3. from.getState() 再捕获(加载期间用户可能已移图)→ from?.destroy()
//   4. to.createView({ container, center, zoom, pitch, rotation, style })
//      —— 失败时**回滚**:重建旧引擎 view(from.engine 脚本已加载,重建快速)。
//        回滚成功 → { view: 回滚视图, created: false, rolledBack: true, error };
//        回滚也失败 → 抛错(容器清空,调用方须清 ref 暴露重试)。
//        回滚视图以目标 style 重建(旧 view 样式契约不可读;回滚是罕见失败
//        路径,「接近原状」即可,引擎对不支持的样式自行降级)
//   5. 重建 controller 回放:在**新 view** 上创建 POI marker 控制器并回放
//      POI 集 / 可见集 / 选中 / 高亮(仅当调用方传入回放数据;调用方若同时
//      使用 usePOIMap,勿传回放数据——usePOIMap 随 view 变化自动重建控制器)
//   6. 返回 { view, created }
//
// 取消(signal 切换 token):load 后 / createView 后各检查一次;置位后不落地
// 新视图(load 阶段 → 旧 view 保留;createView 阶段 → 已建视图销毁,容器由
// 更新意图接管)。「最新意图优先」的 generation 由调用方(use-map-engine)
// 维护,本函数只提供 token 检查点。
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

/** 取消信号:调用方传入,switchMapEngine 在检查点读取(不回调、不监听) */
export interface EngineSwitchSignal {
  /** 置位后:load 阶段 → 放弃(旧 view 保留);createView 阶段 → 已建视图销毁 */
  aborted: boolean;
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
  /** 取消 token(可选;缺省 = 不可取消) */
  signal?: EngineSwitchSignal;
}

export interface SwitchMapEngineResult {
  /** 落地视图(aborted 时 null,旧 view 或已保留或已由更新意图接管) */
  view: MapView | null;
  /** 是否实际创建了新视图(false = 同引擎守卫 / 回滚重建 / aborted) */
  created: boolean;
  /** 取消:signal 在编排中途置位,无新视图落地(见 EngineSwitchSignal) */
  aborted?: boolean;
  /** 目标 createView 失败后回滚重建的旧引擎视图(created:false;view 即回滚视图) */
  rolledBack?: boolean;
  /** rolledBack 时附带的原始失败原因(调用方记录/上报用) */
  error?: unknown;
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
 * @returns { view, created } —— created:false 出现在同引擎守卫
 * (to.id === from.engine.id,view 即原视图,零销毁)与失败回滚
 * (rolledBack:true,view 为旧引擎重建视图)。aborted 时 view 为 null。
 */
export async function switchMapEngine(opts: SwitchMapEngineOptions): Promise<SwitchMapEngineResult> {
  const { from, to, container, state, style, signal, ...replay } = opts;

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

  // 步骤 1:脚本加载(最耗时)。旧 view 全程存活,画面不中断;加载期间被取消
  // → 直接放弃,旧 view 零触碰(「最新意图优先」的早期让路)。
  await to.load();
  if (signal?.aborted) return { view: null, created: false, aborted: true };

  // 步骤 2:最终相机状态(加载期间用户可能已移图)再捕获,然后销毁旧 view。
  // 销毁失败不阻断切换(容器将由新 view 接管)。
  let finalState = state;
  if (from) {
    try {
      finalState = from.getState() ?? state;
    } catch {
      // 旧 view 已半销毁(读 getCenter 抛错):退回调用方快照
    }
  }
  try {
    from?.destroy();
  } catch (err) {
    console.warn('[map-engine] 旧视图销毁失败(继续切换):', err);
  }

  // 步骤 3:正式容器创建新视图。失败 → 回滚重建旧引擎视图(引擎脚本已加载,
  // 重建快速),绝不留下「旧 view 已销毁 + 容器无图」的不可用状态。
  let view: MapView;
  try {
    view = await to.createView({
      container,
      center: finalState.center,
      zoom: finalState.zoom,
      pitch: finalState.pitch ?? 0,
      rotation: finalState.rotation ?? 0,
      style,
    });
  } catch (err) {
    // 已让路给更新意图:不回滚(避免旧引擎视图与更新意图的新视图同容器
    // 共存),按取消返回,原始错误丢弃(更新意图已取代本意图)
    if (signal?.aborted) return { view: null, created: false, aborted: true };
    if (from) {
      try {
        const rollbackView = await from.engine.createView({
          container,
          center: finalState.center,
          zoom: finalState.zoom,
          pitch: finalState.pitch ?? 0,
          rotation: finalState.rotation ?? 0,
          style,
        });
        if (hasReplayData(replay)) replayController(rollbackView, replay);
        return { view: rollbackView, created: false, rolledBack: true, error: err };
      } catch {
        // 回滚也失败:容器清空,走下方抛错路径(调用方须清 ref 暴露重试)
      }
    }
    throw new Error(
      `[map-engine] 引擎切换失败:目标 ${to.id} createView 失败` +
        (from ? `,回滚 ${from.engine.id} 视图也失败` : `(无旧视图可回滚)`) +
        `: ${(err as Error)?.message ?? String(err)}`,
    );
  }

  // 步骤 4:createView 成功但期间被取消 → 已建视图销毁(容器由更新意图接管)。
  if (signal?.aborted) {
    try {
      view.destroy();
    } catch {
      // 销毁失败不阻断取消语义(容器内容以更新意图为准)
    }
    return { view: null, created: false, aborted: true };
  }

  if (hasReplayData(replay)) replayController(view, replay);

  return { view, created: true };
}
