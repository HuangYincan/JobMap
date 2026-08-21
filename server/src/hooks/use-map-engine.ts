"use client";

// ============================================================
// useMapEngine — 地图引擎生命周期 Hook(ws-c 初版;f 扩展引擎切换)
//
// 挂载:resolveEngine(readEnginePreference()) → engine.load() → engine.createView();
// 卸载:view.destroy()。container 来自调用方(ref);center/zoom/style 只取
// 首渲染快照(初始值),后续相机/样式变更由调用方经 view 方法下发。
//
// ws-f 扩展:
// - switchEngine(id):switch.ts 编排(旧 view 销毁 → 新引擎 load/createView
//   → 回放)→ 成功后写 localStorage 偏好(writeEnginePreference,key
//   `domain-map:engine`)→ isSwitching 状态(切换期间禁用 UI);
// - 三引擎统一接线:AMap(自注册)+ Tencent/Baidu 经 registerEngine 装配进
//   注册表骨架(与 registerAmapEngine 同模式;引擎实现模块在此求值,
//   骨架保持厂商无关,见 engine-registry 注释);
// - 引擎总线:MapShell 外子树(图层面板)经 useMapEnginePanel 订阅活跃
//   引擎/切换能力——与 poi-service.setActiveSearchProvider 同款模块级
//   总线模式,面板无需 MapShell 传 props。
//
// - 引擎未配置(零 key)→ 返回 engine=null,调用方回退 CSS fallback 地图;
// - 活跃引擎的 search 能力注入 poi-service(视口兜底搜索路由,支持引擎切换)。
// ============================================================

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { LngLat, MapEngine, MapEngineId, MapStyleId, MapView } from "@/lib/map-engine/types";
import { registerEngine, resolveEngine, getEngine } from "@/lib/map-engine/engine-registry";
import {
  readEnginePreference,
  writeEnginePreference,
} from "@/lib/map-engine/engine-preference";
import { setActiveSearchProvider } from "@/lib/poi-service";
import { switchMapEngine, type EngineSwitchReplay } from "@/lib/map-engine/switch";
// 三引擎完整实现:模块求值即注册(AMap 自注册;Tencent/Baidu 经 registerEngine 装配)
import { AMAP_ENGINE_IMPL } from "@/lib/map-engine/amap/amap-engine";
import { TENCENT_ENGINE } from "@/lib/map-engine/tencent/tencent-engine";
import { BAIDU_MAP_ENGINE } from "@/lib/map-engine/baidu/baidu-engine";

// 统一接线(幂等;与 ws-c 的 registerAmapEngine 副作用 import 同语义,
// 只是把三家的装配收敛到一处,resolveEngine/getConfiguredEngines/getEngine
// 自此返回携带完整 createView/load/search 的引擎)
registerEngine(AMAP_ENGINE_IMPL);
registerEngine(TENCENT_ENGINE);
registerEngine(BAIDU_MAP_ENGINE);

export interface UseMapEngineOptions {
  /** 地图挂载容器(ref;调用方持有) */
  containerRef: MutableRefObject<HTMLElement | null>;
  /** 初始中心(gcj02;只取首渲染快照) */
  center: LngLat;
  /** 初始 zoom(只取首渲染快照) */
  zoom: number;
  /** 初始底图样式(只取首渲染快照;引擎切换沿用该快照) */
  style: MapStyleId;
}

export interface UseMapEngineResult {
  engine: MapEngine | null;
  view: MapView | null;
  /** 引擎切换中(切换动画/重建期间为 true;UI 据此禁用切换入口) */
  isSwitching: boolean;
  /**
   * 切换到指定引擎(编排见 switch.ts)。replay 为可选控制器回放数据——
   * 由直接调用方(非 usePOIMap 场景)传入;MapShell 主链路不传,usePOIMap
   * 随 view 变化自动重建控制器。
   */
  switchEngine: (id: MapEngineId, replay?: EngineSwitchReplay) => Promise<void>;
}

// ---------------------------------------------------------------------------
// 引擎切换总线(图层面板等 MapShell 外子树接线)
// ---------------------------------------------------------------------------

/** 引擎总线载荷:活跃引擎实例 + 切换能力(hook 实例发布) */
export interface EngineBusValue {
  engine: MapEngine | null;
  view: MapView | null;
  isSwitching: boolean;
  switchEngine: (id: MapEngineId, replay?: EngineSwitchReplay) => Promise<void>;
}

let busValue: EngineBusValue | null = null;
const busSubscribers = new Set<(value: EngineBusValue | null) => void>();

function publishEngineBus(value: EngineBusValue | null): void {
  busValue = value;
  for (const subscriber of busSubscribers) subscriber(value);
}

/** 订阅引擎总线;已发布过(挂载后订阅)立即补发一次。返回解绑函数。 */
export function subscribeEngineBus(cb: (value: EngineBusValue | null) => void): () => void {
  busSubscribers.add(cb);
  if (busValue) cb(busValue);
  return () => {
    busSubscribers.delete(cb);
  };
}

/**
 * 图层面板等 MapShell 外子树的引擎接线 hook:订阅活跃 useMapEngine 实例
 * 的引擎/切换能力,无需 MapShell 传 props。无活跃实例时返回空引擎 +
 * no-op 切换(面板照常渲染,chip 全部按 configured 状态显示)。
 */
export function useMapEnginePanel(): UseMapEngineResult {
  const [value, setValue] = useState<EngineBusValue | null>(busValue);
  useEffect(() => subscribeEngineBus(setValue), []);
  const noop = useCallback(async () => {}, []);
  return value ?? { engine: null, view: null, isSwitching: false, switchEngine: noop };
}

// ---------------------------------------------------------------------------
// useMapEngine
// ---------------------------------------------------------------------------

export function useMapEngine(options: UseMapEngineOptions): UseMapEngineResult {
  const { containerRef, center, zoom, style } = options;
  const [engine, setEngine] = useState<MapEngine | null>(null);
  const [view, setView] = useState<MapView | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const viewRef = useRef<MapView | null>(null);
  /**
   * StrictMode 双调用存活接管(2026-08-21 热修):React dev 的 double-invoke 对
   * 挂载了 Next dynamic 面板(最近/收藏/图层等)的 MapShell fiber 做
   * disconnect→reconnect——cleanup 若立即销毁活图,重连的「接线 effect」就会
   * 拿着被销毁的旧 view 重跑 createMap → syncView → AMap getCenter 崩溃
   * (getOptions undefined),进而 Fast Refresh 整页重载。修复:cleanup 只把活图
   * 存入 keepalive 交棒,重连时同容器直接接管(相机/标记零丢失);真卸载由
   * 延迟销毁兜底,不泄漏。
   */
  const keepaliveRef = useRef<{ view: MapView; container: HTMLElement } | null>(null);
  /** 卸载后丢弃在飞切换结果(await 完成时组件已卸载 → 销毁新 view) */
  const aliveRef = useRef(true);
  /** 切换重入守卫(UI 已禁用 chip,双保险) */
  const switchingRef = useRef(false);

  const switchEngine = useCallback(
    async (id: MapEngineId, replay?: EngineSwitchReplay): Promise<void> => {
      const container = containerRef.current;
      if (!container || switchingRef.current) return;
      const to = getEngine(id);
      // 未配置引擎:不销毁当前视图,直接忽略(UI 已禁用,双保险)
      if (!to.isConfigured()) {
        console.warn(`[use-map-engine] 引擎 ${id} 未配置(${to.keyVar}),忽略切换`);
        return;
      }
      const from = viewRef.current;
      if (from?.engine.id === id) return; // 已在该引擎(同引擎守卫)
      if (!aliveRef.current) return;

      switchingRef.current = true;
      setIsSwitching(true);
      try {
        // 状态捕获:旧 view 未就绪(首载竞态)→ 初始快照
        const state = from?.getState() ?? { center, zoom, pitch: 0, rotation: 0 };
        const { view: next } = await switchMapEngine({
          from,
          to,
          container,
          state,
          style,
          ...replay,
        });
        if (!aliveRef.current) {
          next.destroy(); // 组件已卸载:新 view 不留地
          return;
        }
        viewRef.current = next;
        setView(next);
        setEngine(to);
        // 切换成功才写偏好(失败不持久化)
        writeEnginePreference(id);
        // 视口兜底搜索/建议随活跃引擎路由(与挂载路径同口径)
        setActiveSearchProvider(to.search);
      } catch (err) {
        console.warn("[use-map-engine] switchEngine failed:", err);
      } finally {
        switchingRef.current = false;
        setIsSwitching(false);
      }
    },
    [containerRef, center, zoom, style],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;

    // 活图交棒 keepalive 供重连接管(不立即销毁,相机/标记零丢失);真卸载
    // (无重连或未接管)由延迟销毁兜底,不泄漏。disconnect 与 reconnect 的 cleanup
    // 共用——重连复用后下一次 double-invoke 的 disconnect 必须再次交棒,链条才不断。
    const relinquishView = () => {
      cancelled = true;
      if (viewRef.current && !viewRef.current.isDestroyed()) {
        const doomed = viewRef.current;
        keepaliveRef.current = { view: doomed, container };
        setTimeout(() => {
          if (viewRef.current !== doomed) {
            if (keepaliveRef.current?.view === doomed) keepaliveRef.current = null;
            doomed.destroy();
          }
        }, 0);
      }
      viewRef.current = null;
      setView(null);
      setActiveSearchProvider(null);
    };

    // 重连接管:上一 effect 实例 cleanup 留下的活图(同容器、同引擎、未销毁、容器仍
    // 挂载)直接复用,不重建不销毁——StrictMode double-invoke 的 disconnect→reconnect
    // 是同一 commit 内同步发生,此间活图应当存活。真卸载(容器替换/断开/引擎偏好
    // 变更)不满足条件 → 落回正常加载,旧图由延迟销毁兜底。
    const keep = keepaliveRef.current;
    if (
      keep &&
      !keep.view.isDestroyed() &&
      keep.container === container &&
      container.isConnected
    ) {
      const resolved = resolveEngine(readEnginePreference());
      if (resolved && resolved.id === keep.view.engine.id) {
        keepaliveRef.current = null;
        viewRef.current = keep.view;
        setEngine(resolved);
        setActiveSearchProvider(resolved.search);
        setView(keep.view);
        // 接管后仍要交棒:下一次 double-invoke(后续弹卡/搜索)的 disconnect
        // 会把活图再次留给重连接管,链条不断、地图全程零销毁。
        return relinquishView;
      }
    }

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
        if (viewRef.current) {
          // 引擎切换已抢先落地(switchEngine 先行):挂载创建的同容器视图
          // 不再需要,直接销毁,避免双地图实例
          created.destroy();
          return;
        }
        viewRef.current = created;
        setView(created);
      })
      .catch((err) => {
        console.warn("[use-map-engine] map engine load/createView failed:", err);
      });

    return relinquishView;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- center/zoom/style 只取初始快照
  }, [containerRef]);

  // 卸载标记(切换 await 竞态保护)
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // 引擎总线发布:依赖变化才重跑(cleanup 先撤下再发布,同一次 effect flush
  // 内被 React 批处理合并,订阅者无 null 闪烁);卸载时撤下
  useEffect(() => {
    publishEngineBus({ engine, view, isSwitching, switchEngine });
    return () => publishEngineBus(null);
  }, [engine, view, isSwitching, switchEngine]);

  return { engine, view, isSwitching, switchEngine };
}
