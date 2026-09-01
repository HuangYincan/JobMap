"use client";

// ============================================================
// useMapEngine — 地图引擎生命周期 Hook(ws-c 初版;f 扩展引擎切换)
//
// 挂载:resolveEngine(readEnginePreference()) → engine.load() → engine.createView();
// 卸载:view.destroy()。container 来自调用方(ref);center/zoom/style 只取
// 首渲染快照(初始值),后续相机/样式变更由调用方经 view 方法下发。
//
// ws-f 扩展:
// - switchEngine(id):switch.ts 编排(ws-3「先就绪、后销毁」:目标 load → 旧
//   view destroy → createView,失败回滚重建旧引擎视图;最新意图优先,快速
//   连点第二击不被丢弃)→ 成功后写偏好(writeEnginePreference,key
//   `domain-map:engine`)→ isSwitching 状态(仅视觉指示,UI aria-disabled
//   提示,不再拦截切换请求);
// - 三引擎统一接线:AMap(自注册)+ Tencent/Baidu 经 registerEngine 装配进
//   注册表骨架(与 registerAmapEngine 同模式;引擎实现模块在此求值,
//   骨架保持厂商无关,见 engine-registry 注释);
// - 引擎总线:MapShell 外子树(图层面板)经 useMapEnginePanel 订阅活跃
//   引擎/切换能力——与 poi-service.setActiveSearchProvider 同款模块级
//   总线模式,面板无需 MapShell 传 props。
//
// - 引擎未配置(零 key)→ 返回 engine=null,调用方回退 CSS fallback 地图;
// - 活跃引擎的 search 能力注入 poi-service(视口兜底搜索路由,支持引擎切换)。
//
// ws-2(2026-08-22)扩展——挂载失败错误态 + 重试状态机:
// - 挂载链(含引擎回退、watchdog)全部失败 → 返回 mountError 非 null
//   (engine/code/message),调用方可渲染错误出口(不再只有 console.warn);
// - retryMount:重新执行完整挂载链(resolveEngine → mountEngineView);挂载
//   进行中/已有活 view 时 no-op(幂等),成功后走与首挂载相同的 .then 落地;
// - watchdog:mountEngineView 整体 withTimeout(25s)上界——单引擎各有界
//   (ws-1 loadAMap 超时 reject),此上界防未来新增无界引擎/钻缝;超时以
//   code 'MOUNT_TIMEOUT' 进入错误态并作废在飞挂载链(后台链恢复后经
//   isCancelled 销毁已建视图,不泄漏)。
// ============================================================

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { LngLat, MapEngine, MapEngineId, MapStyleId, MapView } from "@/lib/map-engine/types";
import {
  registerEngine,
  resolveEngine,
  getEngine,
  getConfiguredEngines,
} from "@/lib/map-engine/engine-registry";
import {
  readEnginePreference,
  writeEnginePreference,
} from "@/lib/map-engine/engine-preference";
// 挂载 + 失败回退(ws-8):偏好引擎 load/createView 失败 → 按 ENGINE_PRIORITY
// 序回退其余已配置引擎。纯函数在 lib(无 @ 别名,node 测试可直接 import),
// 本 hook 接线并 re-export(与 switch.ts 同款可测性模式)。
import { mountEngineView } from "@/lib/map-engine/mount";
export { mountEngineView } from "@/lib/map-engine/mount";
import { setActiveSearchProvider } from "@/lib/poi-service";
import {
  switchMapEngine,
  type EngineSwitchReplay,
  type EngineSwitchSignal,
} from "@/lib/map-engine/switch";
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

/** 挂载失败错误态(ws-2):挂载链(含引擎回退、watchdog)全部失败后非 null;
 * 重新开始挂载时立即清 null。ws-3 据此渲染错误出口(重试入口)。 */
export interface MapMountError {
  /** 失败引擎 id(ws-eng-meta 语义修正,2026-08-22):回退链全部失败 =
   * 实际**最后失败引擎**(mount.ts 在最终错误上携带 engineId;修前缺口:
   * ① 最后一个失败不是 Error 实例时 mount.ts 兜底错误无 engineId →
   * engine 回退偏好引擎;② 分类诊断日志 engine 硬编码 偏好引擎,REPRO R4
   * 观测到的「engine=amap 而 message 是 baidu」即源于此)。语义对齐后
   * engine/message 恒指同一(最后失败)引擎;watchdog 超时无 engineId →
   * 偏好引擎 resolved.id(整链超时无法定位单引擎,诚实近似) */
  engine: string;
  /** 引擎错误分类码(透传 err.code;watchdog 超时为 'MOUNT_TIMEOUT') */
  code?: string;
  /** 可读错误文本(err.message 原文;与 engine 字段同一引擎的失败详情) */
  message: string;
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
  /** 挂载链(含引擎回退、watchdog)全部失败 → 非 null;重新开始挂载时立即清 null */
  mountError: MapMountError | null;
  /** 重新执行完整挂载链(resolveEngine → mountEngineView);挂载进行中/
   * 已有活 view 时 no-op(幂等)。成功后走与首挂载相同的落地路径。 */
  retryMount: () => void;
}

// ---------------------------------------------------------------------------
// 引擎切换总线(图层面板等 MapShell 外子树接线)
// ---------------------------------------------------------------------------

/** 引擎总线载荷:活跃引擎实例 + 切换能力 + 挂载错误态(hook 实例发布;
 * ws-2 起含 mountError/retryMount,与 UseMapEngineResult 对齐,面板侧不用即可) */
export interface EngineBusValue {
  engine: MapEngine | null;
  view: MapView | null;
  isSwitching: boolean;
  switchEngine: (id: MapEngineId, replay?: EngineSwitchReplay) => Promise<void>;
  mountError: MapMountError | null;
  retryMount: () => void;
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
  return value ?? { engine: null, view: null, isSwitching: false, switchEngine: noop, mountError: null, retryMount: noop };
}

// ---------------------------------------------------------------------------
// useMapEngine
// ---------------------------------------------------------------------------

/**
 * 挂载 watchdog 上界(ws-2):整条挂载链(load+createView+回退)的兜底超时。
 * 单引擎各有界(ws-1 loadAMap 超时 reject),此上界防未来新增无界引擎/钻缝;
 * 超时以错误 settle(携带 code 'MOUNT_TIMEOUT'),调用方进入错误态并作废在飞
 * 挂载链(见 runMount catch)。
 */
const MOUNT_TIMEOUT_MS = 25_000;

/**
 * 给 promise 加超时兜底(与 amap-api.withTimeout 同款语义):超时以 error 形态
 * settle,绝不永久 await;底层 promise 超时后才 settle 也无副作用(promise
 * 单次 settle 天然守卫)。超时错误携带 code='MOUNT_TIMEOUT' 供调用方分类。
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`${label} timed out after ${ms}ms`) as Error & { code: string };
      err.code = 'MOUNT_TIMEOUT';
      reject(err);
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer); // 正常成功:must clear timer,不吞成功路径
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function useMapEngine(options: UseMapEngineOptions): UseMapEngineResult {
  const { containerRef, center, zoom, style } = options;
  const [engine, setEngine] = useState<MapEngine | null>(null);
  const [view, setView] = useState<MapView | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [mountError, setMountError] = useState<MapMountError | null>(null);
  /**
   * 挂载代际(ws-2):每次 runMount 递增;cleanup/卸载/watchdog 超时递增即作废
   * 在飞挂载链——mount.ts 经 isCancelled 观察,已建视图在落地前销毁,不泄漏。
   * 原挂载 effect 的 closure cancelled 语义 ref 化,供首挂载与 retryMount 共用。
   */
  const mountSeqRef = useRef(0);
  /** 挂载链是否在飞(ws-2):retryMount 的「挂载进行中 → no-op」判定依据 */
  const mountRunningRef = useRef(false);
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
  /**
   * 切换代际(ws-3「最新意图优先」):每次 switchEngine 递增;在飞切换 resolve
   * 后若代际不匹配(已有更新意图)→ 丢弃结果并销毁刚创建的 view。不再用
   * switchingRef 硬丢弃第二次点击——isSwitching 仅作视觉指示,UI 可短暂连点。
   */
  const generationRef = useRef(0);
  /** 在飞切换的取消 token:新意图发起时置旧 signal.aborted,让在飞切换早期让路 */
  const activeSignalRef = useRef<EngineSwitchSignal | null>(null);

  const switchEngine = useCallback(
    async (id: MapEngineId, replay?: EngineSwitchReplay): Promise<void> => {
      const container = containerRef.current;
      if (!container) return;
      const to = getEngine(id);
      // 未配置引擎:不销毁当前视图,直接忽略(UI 已禁用,双保险)
      if (!to.isConfigured()) {
        console.warn(`[use-map-engine] 引擎 ${id} 未配置(${to.keyVar}),忽略切换`);
        return;
      }
      const from = viewRef.current;
      if (from?.engine.id === id) return; // 已在该引擎(同引擎守卫)
      if (!aliveRef.current) return;

      // 最新意图优先:递增代际,让路给旧的在飞切换(load 阶段即放弃,旧 view 零触碰)
      const gen = ++generationRef.current;
      if (activeSignalRef.current) activeSignalRef.current.aborted = true;
      const signal: EngineSwitchSignal = { aborted: false };
      activeSignalRef.current = signal;
      setIsSwitching(true);
      try {
        // 状态捕获:旧 view 未就绪(首载竞态)→ 初始快照
        const state = from?.getState() ?? { center, zoom, pitch: 0, rotation: 0 };
        const result = await switchMapEngine({
          from,
          to,
          container,
          state,
          style,
          signal,
          ...replay,
        });
        // 已让路给更新意图(aborted):不落地任何状态(旧 view 或已保留,或容器
        // 由更新意图接管;aborted 时 switch.ts 已自行销毁/从未创建新视图)
        if (result.aborted) return;
        const next = result.view;
        if (!next) return;
        if (!aliveRef.current) {
          next.destroy(); // 组件已卸载:新 view 不留地
          return;
        }
        if (gen !== generationRef.current) {
          next.destroy(); // 更新意图已发起:丢弃本结果,不留已建视图
          return;
        }
        if (result.rolledBack) {
          // 目标 createView 失败,已回滚重建旧引擎视图:状态可用(保留旧引擎),
          // 不写偏好,错误上报
          viewRef.current = next;
          setView(next);
          setMountError(null); // 活 view 落地:无挂载错误(错误态诚实化)
          console.warn(
            "[use-map-engine] switchEngine 目标创建失败,已回滚旧引擎视图",
            result.error instanceof Error ? result.error.message : result.error,
          );
          return;
        }
        // 切换期间挂载 createView 落地(挂载与切换并发):最新意图(切换)赢,
        // 销毁挂载视图,避免同容器双实例
        if (viewRef.current && viewRef.current !== next && !viewRef.current.isDestroyed?.()) {
          try {
            viewRef.current.destroy();
          } catch {
            // 销毁失败不阻断切换落地
          }
        }
        viewRef.current = next;
        setView(next);
        setMountError(null); // 活 view 落地:无挂载错误(错误态诚实化)
        setEngine(to);
        // 切换成功才写偏好(失败不持久化)
        writeEnginePreference(id);
        // 视口兜底搜索/建议随活跃引擎路由(与挂载路径同口径)
        setActiveSearchProvider(to.search);
      } catch (err) {
        // 已被更新意图取代:预期失败,静默(新意图会正常落地)
        if (gen !== generationRef.current) return;
        // 错误路径:清空视图状态(旧 view 已在 switch.ts 销毁;回滚也失败 →
        // 容器无图),暴露可重试——下次 switchEngine 从 viewRef=null 正常走
        console.warn(
          "[use-map-engine] switchEngine failed:",
          err instanceof Error ? err.message : err,
        );
        // 失败分类可见化(bug 3):switch.ts 重包装后分类属性丢失(message 仍
        // 含分类码原文),引擎层 failBaidu 已 console.warn 结构化输出——此处
        // 兜底输出仍携带分类的错误;无 toast 基建,不新增 UI 组件
        const classified = (err ?? {}) as { code?: string; guidance?: string };
        if (classified.code) {
          console.warn("[use-map-engine] 引擎切换失败分类:", {
            code: classified.code,
            guidance: classified.guidance,
          });
        }
        viewRef.current = null;
        setView(null);
      } finally {
        if (gen === generationRef.current) {
          activeSignalRef.current = null;
          setIsSwitching(false);
        }
      }
    },
    [containerRef, center, zoom, style],
  );

  /**
   * 完整挂载链(ws-2 提取,首挂载 effect 与 retryMount 共用;keepalive 接管
   * 分支之外):resolveEngine → setEngine/setActiveSearchProvider →
   * mountEngineView(withTimeout watchdog)→ .then 落地 / .catch 错误态。
   * 可重入:每次调用递增挂载代际(mountSeqRef),cleanup/卸载/watchdog 超时
   * 递增即作废在飞轮次——mount.ts 经 isCancelled 观察,已建视图落地前销毁。
   * 首挂载 effect 与 retryMount 同走本函数,不复制第二份挂载链。
   */
  const runMount = useCallback((): void => {
    const container = containerRef.current;
    if (!container) return;
    const resolved = resolveEngine(readEnginePreference());
    if (!resolved) {
      // 零配置(无任何引擎 key):不加载脚本,调用方回退 CSS fallback 地图
      // (非挂载失败,不进错误态;原首挂载 effect 同口径)
      return;
    }
    mountRunningRef.current = true;
    setMountError(null); // 重新开始挂载:立即清错误态(ws-2 契约)
    const seq = ++mountSeqRef.current;
    setEngine(resolved);
    // 视口兜底搜索/建议回退随活跃引擎路由(引擎切换后不再硬绑 amap-api)
    setActiveSearchProvider(resolved.search);

    // 挂载 + 失败回退(ws-8):偏好引擎 load/createView 失败 → 自动回退其余
    // 已配置引擎(ENGINE_PRIORITY 序)重试,修复「偏好指向故障引擎时刷新即
    // 空白、只 warn 无视图」的缺口。回退成功 → engine/search 状态随实际
    // 挂载引擎更新;全部失败 → 保持空视图 + warn + 错误态(ws-2,调用方渲染
    // 重试出口)。挂载/回退均不写偏好(偏好由手动切换专属,见 switchEngine
    // 成功路径;挂载回退不覆盖 sessionStorage——故障可能是瞬时的,静默改写
    // 用户选择会让偏好永久丢失,取舍见 23-map-engines.md)。
    // watchdog(ws-2):整条链 25s 上界,超时以 code 'MOUNT_TIMEOUT' 进入错误态。
    withTimeout(
      mountEngineView(resolved, getConfiguredEngines(), {
        container,
        center,
        zoom,
        style,
        isCancelled: () => seq !== mountSeqRef.current,
        isViewTaken: () => Boolean(viewRef.current),
      }),
      MOUNT_TIMEOUT_MS,
      'map-engine mount',
    )
      .then((created) => {
        if (!created) return; // 取消/被接管:helper 已销毁或未创建,零落地
        if (seq !== mountSeqRef.current) {
          // teardown 竞态双保险(主路径同口径):已建视图销毁,不落地
          created.destroy();
          return;
        }
        if (viewRef.current) {
          // 双保险(与主路径同口径):切换抢先落地 → 同容器视图销毁
          created.destroy();
          return;
        }
        viewRef.current = created;
        setView(created);
        // 回退成功后 engine/search 状态落到实际挂载引擎(首引擎成功时
        // 同引用,setEngine/setActiveSearchProvider 均为 no-op)
        setEngine(created.engine);
        setActiveSearchProvider(created.engine.search);
        setMountError(null); // 挂载成功:错误态清除
      })
      .catch((err) => {
        console.warn("[use-map-engine] map engine load/createView failed:", err);
        // 失败分类可见化(bug 3,2026-08-22 ws-c):引擎错误携带 code/stage/
        // guidance 时输出结构化诊断(含可操作指引,用户可直接照做)。挂载
        // 路径 mount.ts 原样上抛引擎错误,分类属性可直达;切换路径被
        // switch.ts 重包装(分类仅留在引擎层 console,见 switchEngine catch)。
        // 无共享 toast/alert 基建(已核查,map-shell 注明「后续可接 toast 提示、
        // 不新增 UI」)→ 仅 console 结构化输出,不新增 UI 组件。
        const classified = (err ?? {}) as {
          code?: string;
          stage?: string;
          guidance?: string;
          engineId?: string;
          engine?: string;
        };
        if (classified.code) {
          console.warn("[use-map-engine] 引擎加载失败分类:", {
            engine: classified.engineId ?? resolved.id,
            code: classified.code,
            stage: classified.stage,
            guidance: classified.guidance,
          });
        }
        // watchdog 超时:作废在飞挂载链——后台链(mount.ts)恢复后检查
        // isCancelled → 已建视图销毁/零落地,不留僵尸链(超时不泄漏视图)。
        // 单线程保证:超时触发时链必然 parked 在 await 上,catch 先于其恢复。
        if (classified.code === 'MOUNT_TIMEOUT') mountSeqRef.current++;
        // 错误态(ws-2):失败不再只有 warn —— warn + mountError,调用方据此
        // 渲染错误出口(重试按钮)。engine = **最后失败引擎** id(ws-eng-meta
        // 语义归一:mount.ts 在最终错误上携带 engineId → err.engineId 优先,
        // 其次 err.engine(其它错误形状),兜底偏好引擎 resolved.id——仅
        // watchdog 超时(无 engineId/engine)落此分支,此时整链超时无法定位
        // 单引擎,退回偏好引擎是诚实近似)。
        setMountError({
          engine: classified.engineId ?? classified.engine ?? resolved.id,
          code: classified.code,
          message: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        mountRunningRef.current = false;
      });
  }, [containerRef, center, zoom, style]);

  /**
   * 重试挂载(ws-2):重新执行 resolveEngine → mountEngineView 完整挂载链。
   * 幂等:已有活 view(已挂载/接管后 viewRef 战位)或挂载进行中 → no-op;
   * 成功后走与首挂载相同的 .then 落地路径(viewRef/setView/setEngine 不变)。
   */
  const retryMount = useCallback((): void => {
    if (viewRef.current || mountRunningRef.current) return;
    runMount();
  }, [runMount]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 活图交棒 keepalive 供重连接管(不立即销毁,相机/标记零丢失);真卸载
    // (无重连或未接管)由延迟销毁兜底,不泄漏。disconnect 与 reconnect 的 cleanup
    // 共用——重连复用后下一次 double-invoke 的 disconnect 必须再次交棒,链条才不断。
    const relinquishView = () => {
      mountSeqRef.current++; // 作废在飞挂载(原 closure cancelled 语义 ref 化)
      mountRunningRef.current = false;
      if (viewRef.current && !viewRef.current.isDestroyed()) {
        const doomed = viewRef.current;
        keepaliveRef.current = { view: doomed, container };
        setTimeout(() => {
          // 重连已把同一 view 写回 viewRef → 跳过销毁。
          if (viewRef.current === doomed) return;
          if (keepaliveRef.current?.view === doomed) keepaliveRef.current = null;
          doomed.destroy();
          if (!aliveRef.current) return;
          // 真卸载:这才清 React view。交棒当帧不得同步把 view 置空,
          // 否则 usePOIMap 随 view 变空拆掉全部 POI marker(poi-lifecycle #1)。
          setView((current) => (current === doomed ? null : current));
        }, 0);
      }
      viewRef.current = null;
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

    // 首挂载:完整挂载链在 runMount(与 retryMount 共用,ws-2)
    runMount();

    return relinquishView;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- center/zoom/style 只取初始快照;runMount 同口径(ws-2)
  }, [containerRef]);

  // 卸载标记(切换 await 竞态保护)
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      // 让路在飞切换:load 阶段即放弃(旧 view 零触碰),createView 阶段已建
      // 视图由 switch.ts 销毁——组件已卸载,不再需要落地任何视图
      if (activeSignalRef.current) activeSignalRef.current.aborted = true;
    };
  }, []);

  // 引擎总线发布:依赖变化才重跑(cleanup 先撤下再发布,同一次 effect flush
  // 内被 React 批处理合并,订阅者无 null 闪烁);卸载时撤下
  useEffect(() => {
    publishEngineBus({ engine, view, isSwitching, switchEngine, mountError, retryMount });
    return () => publishEngineBus(null);
  }, [engine, view, isSwitching, switchEngine, mountError, retryMount]);

  return { engine, view, isSwitching, switchEngine, mountError, retryMount };
}
