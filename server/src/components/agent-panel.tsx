"use client";

// AI Agent 聊天面板:360px × 70vh liquid glass 卡片浮层,**以悬浮球为锚实时跟随**
// (transform 驱动,computePanelPlacement 纯函数;拖动球时同步移动,松手平滑归位)。
// 移动端(≤767px)与极窄视口 → 全宽底部 sheet(参照 mobileDrawer 动效)。
// - 消息列表(用户纯文本 / 助手 MarkdownText 渲染,助手侧可含建议卡片)+ 输入框 +
//   输入行 [输入框][发送|停止](ws-inputbar:流式中发送位原位变「停止」,红系警示,
//   点击 = 中止)+ 控件行 [清屏][撤销](清屏最左,独立停止控件已并入发送位);
// - 按轮交替:reduceAgentEvent 纯状态机把每轮(delta→tool)拆成独立 assistant 消息,
//   视觉上「文本1、工具1、文本2、工具2…」;reasoning 事件前端不消费(no-op,
//   2026-08-22 ws-bubble:思考提示与空白气泡已删除);
// - 工具活动列表:每条 tool 事件(⟳ 开始 / ✓ 完成 / ✗ 失败 + 类别文案;失败附
//   「调用失败」弱提示),渲染在文本气泡下方;运行中工具另有顶部状态条;
// - 未配置提示:503 LLM_UNCONFIGURED → agentNotConfigured;RATE_LIMITED → agentRateLimited;
// - 建议卡片:执行器捕获 action 时渲染动作摘要按钮,点击 = 重放该 action(execute);
// - 会话:localStorage 'dm.agent-sessions.v1' 多会话管理(cap 10 会话 × 30 条,
//   agent-session-store 纯函数;旧 sessionStorage 'dm.agent-history.v1' 仅迁移读,
//   不再直写);「💬 会话」入口登录/guest 均可用(本地功能,与账号无关);
//   **每会话独立流(2026-08-22 ws-pstream)**:流状态在 Map<sessionId, SessionStream>
//   (lib/agent-stream-store 纯函数,内存为事实源)——切会话只改 activeId,**不 stop、
//   不打断**,切走后台继续跑;同一时刻可多会话流式(并行),done/error 只落所属会话;
//   显示 = streams.get(activeId)?.messages ?? 从 store 载入;完成/停止状态行、
//   顶部工具条 per-session(切走再切回状态仍正确);停止/清屏只作用于当前会话;
//   会话删除终止并移除该会话流;组件卸载 abort 全部流(不泄漏);
// - 「停止」→ abort(链到 fetch);「撤销」→ executor.undo()。

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import styles from "./agent-panel.module.css";
import { t, type Language } from "@/lib/i18n";
import type { AccountUser } from "@/lib/account";
import type { AgentAction, AgentEvent } from "@/lib/agent/types";
import type { MapBridge } from "@/lib/agent-map-bridge";
import { stripActionJsonBlocks, type AgentMessage, type ToolActivity } from "@/lib/agent-panel-state";
import { streamAgentChat, type AgentChatRequest } from "./agent-chat-client";
import {
  createAgentMapExecutor,
  type AgentMapExecutor,
  type AgentMapExecutorCallbacks,
  type AgentToolInfo,
} from "./agent-map-executor";
import { computePanelPlacement, type BallRect, type BallSnapEdge, type ViewportSize } from "@/lib/agent-panel-placement";
import {
  abortAllStreams,
  finishStream,
  getStreamMessages,
  isStreaming,
  markDone,
  markStreamError,
  removeStream,
  routeAction,
  routeDelta,
  routeTool,
  startStream,
  stopStream,
  EMPTY_STREAM_MAP,
  type SessionStreamMap,
} from "@/lib/agent-stream-store";
import {
  appendMessage,
  archiveAndNew,
  createSession,
  createSessionId,
  deleteSession as storeDeleteSession,
  emptyState,
  listSessions,
  loadSessionState,
  relativeTime,
  saveMessages,
  saveSessionState,
  switchSession as storeSwitchSession,
  type AgentSessionState,
  type SessionRelativeTime,
} from "@/lib/agent-session-store";
import { MarkdownText } from "./markdown-text";

export type { AgentMessage, ToolActivity } from "@/lib/agent-panel-state";

/** 会话相对时间 → i18n 文案(纯函数,便于契约测试)。 */
function sessionTimeLabel(time: SessionRelativeTime, lang: Language): string {
  switch (time.kind) {
    case "justNow":
      return t("agentSessionJustNow", lang);
    case "minutes":
      return t("agentSessionMinutesAgo", lang).replace("{n}", String(time.n));
    case "hours":
      return t("agentSessionHoursAgo", lang).replace("{n}", String(time.n));
    case "date":
      return `${time.month}/${time.day}`;
  }
}

interface Props {
  bridge: MapBridge | null;
  lang: Language;
  /** 登录态;非空才渲染记忆管理入口(guest 不渲染,记忆是账号级数据;会话是本地功能,guest 可用)。 */
  user: AccountUser | null;
  /** 悬浮球当前矩形(viewport 坐标);面板以此为锚实时跟随。嵌入式(drawer sheet)实例不传。 */
  ballRect?: BallRect | null;
  /** 球正在拖拽:面板关闭吸附过渡,transform 跟手。 */
  dragging?: boolean;
  /** 球当前吸附边缘(拖拽中/未吸附为 null → 面板按球心半区分侧,旧行为)。 */
  snapEdge?: BallSnapEdge | null;
  onClose: () => void;
  /** 内嵌模式(ws-ae):drawer 内 agent sheet 渲染(mobileSheet "agent"),
   *  不做锚点跟随定位(placement/panelStyle 跳过),随抽屉流填满 sheet body。 */
  embedded?: boolean;
}

/** SSR 安全初始状态:读 localStorage 会话 + 迁移旧 sessionStorage 历史。 */
function initSessionState(): AgentSessionState {
  if (typeof window === "undefined") return emptyState();
  return loadSessionState(window.localStorage, window.sessionStorage);
}

function actionLabel(action: AgentAction, lang: Language): string {
  switch (action.type) {
    case "flyTo":
      return t("agentLocate", lang);
    case "drawCircle":
      return t("agentActionCircle", lang);
    case "addMarkers":
      return t("agentActionMarkers", lang).replace("{count}", String(action.payload.points.length));
    case "select":
      return t("agentActionSelect", lang);
    case "openDetail":
      return t("agentActionDetail", lang);
    case "search":
      return t("agentActionSearch", lang).replace("{query}", action.payload.query);
    case "showRoute":
      return lang === "en" ? "Show route" : "查看路线";
  }
}

/** 工具类别(公开 SSE tool 事件 name 字段)→ i18n 文案;未知类别 → 「其他操作」。 */
function toolCategoryName(name: string, lang: Language): string {
  switch (name) {
    case "search":
      return t("agentToolSearch", lang);
    case "geocode":
      return t("agentToolGeocode", lang);
    case "directions":
      return t("agentToolDirections", lang);
    case "weather":
      return t("agentToolWeather", lang);
    case "project":
      return t("agentToolProject", lang);
    case "memory":
      return t("agentToolMemory", lang);
    default:
      return t("agentToolOther", lang);
  }
}

/** 记忆条目(GET /api/me/memories 列表项;id 兼容 number/string,仅作 key 与删除入参)。 */
export interface AgentMemoryItem {
  id: number | string;
  content: string;
  createdAt?: string;
}

/**
 * GET /api/me/memories 响应解析(纯函数):接受 {items:[...]}(saved 路由范式)/
 * {memories:[...]}/裸数组三种形态(与 ws-mem-a 并行开发,宽松兼容);
 * 缺 id 或 content 非字符串的条目丢弃。解析失败 → 空数组(调用方走弱提示)。
 */
export function parseMemories(json: unknown): AgentMemoryItem[] {
  if (!json || typeof json !== "object") return [];
  let raw: unknown;
  if (Array.isArray(json)) raw = json;
  else if (Array.isArray((json as { items?: unknown }).items)) raw = (json as { items: unknown }).items;
  else if (Array.isArray((json as { memories?: unknown }).memories)) raw = (json as { memories: unknown }).memories;
  else return [];
  return (raw as unknown[]).flatMap((m): AgentMemoryItem[] => {
    if (!m || typeof m !== "object") return [];
    const item = m as { id?: unknown; content?: unknown; createdAt?: unknown };
    if (item.id === undefined || item.id === null || typeof item.content !== "string") return [];
    return [
      {
        id: item.id as number | string,
        content: item.content,
        ...(typeof item.createdAt === "string" ? { createdAt: item.createdAt } : {}),
      },
    ];
  });
}

/** 记忆弹层渲染状态机(纯函数):加载中 → 失败弱提示 → 空态 → 列表。 */
export type MemoryViewState = "loading" | "error" | "empty" | "list";

export function memoryViewState(loading: boolean, error: boolean, count: number): MemoryViewState {
  if (loading) return "loading";
  if (error) return "error";
  return count > 0 ? "list" : "empty";
}

export function AgentPanel({ bridge, lang, user, ballRect, dragging, snapEdge, onClose, embedded = false }: Props) {
  // 会话存储(多会话,localStorage);**每会话独立流状态**(Map<sessionId, SessionStream>,
  // 内存为事实源)与 store 双轨:
  // - 流式会话:entry.messages 是工作副本,事件只改内存;显示 = entry.messages;
  // - 非流式会话:内存 entry 保留(streaming=false)或不存在 → 显示从 store 载入;
  // - 边界(发送/完成/停止/切换/删除/清屏)经 saveMessages 落库 localStorage。
  const [sessionState, setSessionState] = useState<AgentSessionState>(initSessionState);
  const [streams, setStreams] = useState<SessionStreamMap>(EMPTY_STREAM_MAP);
  const [input, setInput] = useState("");
  // 会话弹层:登录/guest 均可用(会话是本地功能,与账号无关)。
  const [sessionsOpen, setSessionsOpen] = useState(false);
  // 记忆弹层:打开(登录)时拉取列表;失败弱提示;不随「清屏」清除(记忆跨会话)。
  // memoriesRefresh:打开弹层/重试时 +1 触发重新拉取;已加载后的静默刷新不闪加载态。
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const [memoriesRefresh, setMemoriesRefresh] = useState(0);
  const [memories, setMemories] = useState<AgentMemoryItem[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  const [memoriesError, setMemoriesError] = useState(false);
  // undo 可用性重渲染信号(执行器实例在 ref 中,栈变化不触发渲染)
  const [, setUndoVersion] = useState(0);

  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const langRef = useRef(lang);
  langRef.current = lang;
  // 会话/流镜像:回调内读最新值(避免闭包陈旧;与 langRef 同模式)。
  const sessionStateRef = useRef(sessionState);
  sessionStateRef.current = sessionState;
  const streamsRef = useRef<SessionStreamMap>(streams);
  streamsRef.current = streams;
  // 当前事件所属流 sessionId:dispatchEvent 在事件分流前写入(执行器回调同步读);
  // 并行流在同一 tick 内串行 dispatch,回调读取时恒为本流会话。
  const streamSessionRef = useRef<string | null>(null);

  /** 流状态入口:setStreams + 同步镜像(ref 写入幂等,供回调读最新副本)。 */
  const setStreamsBoth = useCallback((updater: (prev: SessionStreamMap) => SessionStreamMap) => {
    setStreams((prev) => {
      const next = updater(prev);
      streamsRef.current = next;
      return next;
    });
  }, []);

  /** 落库:把某会话消息快照写入 localStorage(store 纯函数 + 持久化)。 */
  const persist = useCallback((state: AgentSessionState) => {
    if (typeof window === "undefined") return;
    saveSessionState(window.localStorage, state);
  }, []);

  /** 把工作副本快照存进指定会话(流完成/停止/切换/删除前);未知会话 → no-op。 */
  const persistSessionMessages = useCallback(
    (sessionId: string, msgs: AgentMessage[]) => {
      const cur = sessionStateRef.current;
      const next = saveMessages(cur, sessionId, msgs);
      if (next === cur) return; // 会话已删 → store no-op
      sessionStateRef.current = next;
      setSessionState(next);
      persist(next);
    },
    [persist],
  );

  /**
   * 某会话当前消息(工作副本读取):流式会话 → 内存 entry.messages(事实源);
   * 无流会话 → store 该会话消息;未知会话 → []。
   */
  const sessionMessages = useCallback((sessionId: string | null): AgentMessage[] => {
    if (!sessionId) return [];
    const streamed = getStreamMessages(streamsRef.current, sessionId);
    if (streamed) return streamed;
    const sess = sessionStateRef.current.sessions.find((s) => s.id === sessionId);
    return sess ? sess.messages : [];
  }, []);

  // ---- 面板跟随:视口 + 实测尺寸 → 锚定位置(transform)----
  const [viewport, setViewport] = useState<ViewportSize>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // 初始尺寸用 CSS 规格(360 × 70vh)估算,layout effect 实测后校正——避免
  // 首帧 placement 用 (360, 0) 导致的高度回弹
  const [panelSize, setPanelSize] = useState({ width: 360, height: Math.round((typeof window !== "undefined" ? window.innerHeight : 0) * 0.7) });
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    setPanelSize({ width: el.offsetWidth, height: el.offsetHeight });
  }, [viewport]); // 视口变化(70vh 高度随之变)→ 重测

  // 嵌入式(drawer sheet):不做锚点跟随定位,placement 为 null,panelStyle 不注入
  // --px/--py(基类 transform 由 .panel.embedded 覆盖为 none)。
  const placement = useMemo(
    () => (embedded || !ballRect ? null : computePanelPlacement(ballRect, panelSize, viewport, snapEdge ?? undefined)),
    [embedded, ballRect, panelSize, viewport, snapEdge],
  );
  const isSheet = placement ? placement.mode === "sheet" : false;
  // side 模式:transform 锚定(--px/--py 供 CSS translate3d 与入场动画共用)
  const panelStyle: CSSProperties | undefined =
    placement && placement.mode === "side"
      ? ({ "--px": `${placement.left}px`, "--py": `${placement.top}px` } as CSSProperties)
      : undefined;

  // ---- 渲染回调(供执行器分流;bridge 缺失时面板直接渲染无地图事件)----
  // 事件按**流所属 sessionId** 路由(并行流互不打断):回调经 streamSessionRef
  // 取得当前 dispatch 的会话,只更新该会话 entry;其余会话不受影响。
  const handleDelta = useCallback(
    (text: string) => {
      const sid = streamSessionRef.current;
      if (!sid) return;
      setStreamsBoth((prev) => routeDelta(prev, sid, text));
    },
    [setStreamsBoth],
  );

  const handleTool = useCallback(
    (info: AgentToolInfo) => {
      const sid = streamSessionRef.current;
      if (!sid) return;
      setStreamsBoth((prev) => routeTool(prev, sid, info));
    },
    [setStreamsBoth],
  );

  const handleDone = useCallback(
    (truncated?: boolean) => {
      const sid = streamSessionRef.current;
      if (!sid) return;
      setStreamsBoth((prev) => markDone(prev, sid, Boolean(truncated)));
    },
    [setStreamsBoth],
  );

  const handleError = useCallback(
    (code: string) => {
      const sid = streamSessionRef.current;
      if (!sid) return;
      if (code === "LLM_UNCONFIGURED") {
        setStreamsBoth((prev) => markStreamError(prev, sid, { notConfigured: true, fatalText: null }));
      } else if (code === "RATE_LIMITED") {
        setStreamsBoth((prev) => markStreamError(prev, sid, { notConfigured: false, fatalText: t("agentRateLimited", langRef.current) }));
      } else {
        setStreamsBoth((prev) => markStreamError(prev, sid, { notConfigured: false, fatalText: t("agentError", langRef.current) }));
      }
    },
    [setStreamsBoth],
  );

  const handleAction = useCallback(
    (action: AgentAction) => {
      // 动作已执行:在消息底部渲染「重放」建议卡片(落在该流所属会话)
      const sid = streamSessionRef.current;
      if (sid) setStreamsBoth((prev) => routeAction(prev, sid, action));
      setUndoVersion((v) => v + 1);
    },
    [setStreamsBoth],
  );

  // ---- 执行器实例:bridge 可用时惰性创建,bridge 实例变更时重建 ----
  const bridgeRef = useRef<MapBridge | null>(null);
  const executorRef = useRef<AgentMapExecutor | null>(null);
  if (bridgeRef.current !== bridge) {
    bridgeRef.current = bridge;
    executorRef.current = bridge
      ? createAgentMapExecutor(
          bridge,
          {
            onDelta: handleDelta,
            onTool: handleTool,
            onDone: handleDone,
            onError: handleError,
            onAction: handleAction,
          } satisfies AgentMapExecutorCallbacks,
        )
      : null;
  }

  /** 统一事件入口:按流所属 sessionId 分流;有执行器走执行器(动作落地地图),否则只渲染无地图事件 */
  const dispatchEvent = useCallback(
    (sessionId: string, ev: AgentEvent) => {
      streamSessionRef.current = sessionId;
      const ex = executorRef.current;
      if (ex) {
        ex.handleEvent(ev);
        return;
      }
      switch (ev.type) {
        case "delta":
          handleDelta(ev.text);
          break;
        case "tool":
          handleTool(ev);
          break;
        case "done":
          handleDone(ev.truncated);
          break;
        case "error":
          handleError(ev.code);
          break;
        case "action":
          break; // 无地图桥接:不执行动作
        case "reasoning":
          break; // 2026-08-22 ws-bubble:思考内容前端不消费(no-op)
      }
    },
    [handleDelta, handleTool, handleDone, handleError],
  );

  const runStream = useCallback(
    async (sessionId: string, req: AgentChatRequest, controller: AbortController) => {
      try {
        for await (const ev of streamAgentChat(req, controller.signal)) {
          dispatchEvent(sessionId, ev);
        }
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          setStreamsBoth((prev) =>
            markStreamError(prev, sessionId, { notConfigured: false, fatalText: t("agentError", langRef.current) }),
          );
        }
      } finally {
        // 完成状态以 finally 为准(done 事件 → 'done';用户停止 → 'stopped';异常 → null);
        // 流结束只触碰本流所属会话(并行流互不影响);会话已删/已清屏 → entry 缺失 no-op
        setStreamsBoth((prev) => {
          const next = finishStream(prev, sessionId, controller.signal.aborted);
          const entry = next.get(sessionId);
          if (entry) persistSessionMessages(sessionId, entry.messages);
          return next;
        });
      }
    },
    [dispatchEvent, setStreamsBoth, persistSessionMessages],
  );

  const send = useCallback(
    (text?: string) => {
      const content = (text ?? input).trim();
      const state = sessionStateRef.current;
      const activeId = state.activeId;
      if (!content || isStreaming(streamsRef.current, activeId)) return;
      const curMessages = sessionMessages(activeId);
      const isFirst = curMessages.length === 0;
      const userMsg: AgentMessage = { role: "user", content };
      const nextMessages = [...curMessages, userMsg];
      setInput("");
      // 会话存储:无当前会话 → 先建空会话;appendMessage 落库(刷新/中断保留本条用户消息)
      let nextState = state;
      let sessionId = activeId;
      if (!sessionId) {
        sessionId = createSessionId();
        nextState = createSession(nextState, { id: sessionId });
      }
      nextState = appendMessage(nextState, sessionId, userMsg);
      sessionStateRef.current = nextState;
      setSessionState(nextState);
      persist(nextState);
      // 每会话独立流:新 AbortController + 内存消息为事实源(切走不打断);
      // 覆盖式建流(上一轮完成/停止状态随新一轮清零)
      const controller = new AbortController();
      setStreamsBoth((prev) => startStream(prev, sessionId, controller, nextMessages));
      // 新会话首条自动带视口快照(bridge.getSnapshot() → viewport 参数)
      const snapshot = bridgeRef.current?.getSnapshot() ?? null;
      const req: AgentChatRequest = {
        messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        ...(isFirst && snapshot ? { viewport: { center: snapshot.center, zoom: snapshot.zoom } } : {}),
        lang: langRef.current,
      };
      void runStream(sessionId, req, controller);
    },
    [input, sessionMessages, setStreamsBoth, runStream, persist],
  );

  const stop = useCallback(() => {
    // 停止**当前会话**的流(其余会话不受影响)
    stopStream(streamsRef.current, sessionStateRef.current.activeId ?? "");
  }, []);

  const undo = useCallback(() => {
    if (executorRef.current?.undo()) setUndoVersion((v) => v + 1);
  }, []);

  // 清屏:清覆盖物(仅 overlay 类 undo 条目)+ 归档当前会话(有消息才归档,
  // 标题保留原样)+ 新建空会话并激活;**流式时先停当前会话并移除其流**
  // (其余会话的流不受影响);记忆不动;相机/select 逆操作保留(可继续撤销)。
  const clearScreen = useCallback(() => {
    executorRef.current?.clearOverlays();
    setUndoVersion((v) => v + 1); // clearOverlays 可能改变 canUndo
    const cur = sessionStateRef.current;
    const activeId = cur.activeId;
    const curSession = activeId ? cur.sessions.find((s) => s.id === activeId) : null;
    const next = archiveAndNew(cur, {
      activeId,
      messages: sessionMessages(activeId),
      title: curSession?.title,
    });
    if (activeId) setStreamsBoth((prev) => removeStream(prev, activeId));
    sessionStateRef.current = next;
    setSessionState(next);
    persist(next);
  }, [persist, sessionMessages, setStreamsBoth]);

  /** 切换会话:只改 activeId,**不 stop、不打断**(并行流后台继续跑);
   *  工作副本落库旧会话 → 目标会话显示 = streams 内存态 ?? store 载入。 */
  const switchToSession = useCallback(
    (id: string) => {
      const cur = sessionStateRef.current;
      if (cur.activeId === id) {
        setSessionsOpen(false); // 已是当前会话:只关弹层
        return;
      }
      let next = cur;
      if (cur.activeId) {
        next = saveMessages(next, cur.activeId, sessionMessages(cur.activeId));
      }
      next = storeSwitchSession(next, id);
      const target = next.sessions.find((s) => s.id === id);
      sessionStateRef.current = next;
      setSessionState(next);
      persist(next);
      if (target) {
        setSessionsOpen(false);
      }
      // 未知 id:仅提交落库(保存生效),消息/UI 不动
    },
    [persist, sessionMessages],
  );

  /** 新建会话:不 stop、不打断;工作副本落库旧会话 → 空消息。 */
  const newSession = useCallback(() => {
    const cur = sessionStateRef.current;
    let next = cur;
    if (cur.activeId) {
      next = saveMessages(next, cur.activeId, sessionMessages(cur.activeId));
    }
    next = createSession(next);
    sessionStateRef.current = next;
    setSessionState(next);
    persist(next);
    setSessionsOpen(false);
  }, [persist, sessionMessages]);

  /** 删除会话:终止并移除该会话的流(无论是否当前;迟到事件 entry 缺失 no-op);
   *  store 处理「切最近 / 全删建新」。 */
  const deleteSession = useCallback(
    (id: string) => {
      const cur = sessionStateRef.current;
      const next = storeDeleteSession(cur, id);
      if (next === cur) return; // 未知 id:不动
      setStreamsBoth((prev) => removeStream(prev, id));
      sessionStateRef.current = next;
      setSessionState(next);
      persist(next);
    },
    [persist, setStreamsBoth],
  );

  const replayAction = useCallback((action: AgentAction) => {
    // 纯执行语义:只在地图上重放动作,不再回调 onAction(否则按钮翻倍 + 地图反复定位)
    executorRef.current?.execute(action);
  }, []);

  // ---- 记忆列表:登录即拉取(header 徽章计数);打开弹层/重试 → memoriesRefresh +1 再拉。
  // 首次加载显示加载态;已加载后的刷新为静默(不闪加载态、徽章不抖动);失败 → 弱提示(不打断对话)。
  // 账号切换(登出/换号)→ 清掉上一账号的记忆残留再拉。
  const memoriesLoadedRef = useRef(false);
  const memoriesUserKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const userKey = String(user.id);
    const userChanged = memoriesUserKeyRef.current !== userKey;
    if (userChanged) {
      memoriesUserKeyRef.current = userKey;
      setMemories([]);
      memoriesLoadedRef.current = false;
    }
    const isFirst = (memoriesRefresh === 0 || memories.length === 0) && !memoriesLoadedRef.current;
    if (isFirst) {
      setMemoriesLoading(true);
      setMemoriesError(false);
    }
    fetch("/api/me/memories")
      .then(async (res) => {
        if (!res.ok) throw new Error(`memories list ${res.status}`);
        const json: unknown = await res.json();
        if (!cancelled) {
          setMemories(parseMemories(json));
          memoriesLoadedRef.current = true;
          setMemoriesLoading(false);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setMemories([]);
        setMemoriesLoading(false);
        setMemoriesError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user, memoriesRefresh]);

  /** 逐条删除:DELETE /api/me/memories?id=N(saved 路由范式);失败 → 复用弱提示。 */
  const deleteMemory = useCallback(async (id: number | string) => {
    try {
      const res = await fetch(`/api/me/memories?id=${encodeURIComponent(String(id))}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`memories delete ${res.status}`);
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch {
      setMemoriesError(true);
    }
  }, []);

  /** 一键清除:轻确认(原生 confirm,用 langRef 避免闭包依赖)后 DELETE 全量。 */
  const clearMemories = useCallback(() => {
    if (!window.confirm(t("agentMemoryClearConfirm", langRef.current))) return;
    void (async () => {
      try {
        const res = await fetch("/api/me/memories", { method: "DELETE" });
        if (!res.ok) throw new Error(`memories clear ${res.status}`);
        setMemories([]);
      } catch {
        setMemoriesError(true);
      }
    })();
  }, []);

  /** 会话弹层开关(互斥:开会话关记忆)。 */
  const toggleSessions = useCallback(() => {
    setSessionsOpen((v) => {
      const next = !v;
      if (next) setMemoriesOpen(false);
      return next;
    });
  }, []);

  /** 记忆弹层开关(互斥:开记忆关会话;打开时刷新列表)。 */
  const toggleMemories = useCallback(() => {
    setMemoriesOpen((v) => {
      const next = !v;
      if (next) {
        setSessionsOpen(false);
        setMemoriesRefresh((r) => r + 1);
      }
      return next;
    });
  }, []);

  // ---- 卸载清理:组件卸载/严格模式销毁时 abort 全部流(不泄漏)----
  useEffect(() => {
    return () => abortAllStreams(streamsRef.current);
  }, []);

  // ---- 当前会话显示(派生):显示 = streams.get(activeId)?.messages ?? 从 store 载入;
  // 完成/停止、工具条、错误提示均 per-session(切走再切回状态仍正确)----
  const activeId = sessionState.activeId;
  const activeEntry = activeId ? streams.get(activeId) : undefined;
  const activeSession = activeId ? sessionState.sessions.find((s) => s.id === activeId) : undefined;
  const messages = useMemo(
    () => (activeEntry ? activeEntry.messages : activeSession ? activeSession.messages : []),
    [activeEntry, activeSession],
  );
  const streaming = activeEntry?.streaming ?? false;
  const tool = activeEntry?.tool ?? null;
  const completion = activeEntry?.completion ?? null;
  const truncated = activeEntry?.truncated ?? false;
  const notConfigured = activeEntry?.notConfigured ?? false;
  const fatalError = activeEntry?.fatalError ?? null;

  // 消息/状态变化 → 滚动到底部
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, tool, streaming]);

  const canUndo = Boolean(executorRef.current?.canUndo());
  const lastIsAssistant = messages[messages.length - 1]?.role === "assistant";
  const memoryView = memoryViewState(memoriesLoading, memoriesError, memories.length);
  const sessionList = useMemo(() => listSessions(sessionState), [sessionState]);
  // 记忆计数徽章渲染条件:登录 + 非加载/失败 + 有数据(加载/失败期不显示计数)
  const showMemoryBadge = Boolean(user) && !memoriesLoading && !memoriesError && memories.length > 0;

  return (
    <section
      ref={panelRef}
      className={`${styles.panel} ${embedded ? styles.embedded : ""} ${isSheet ? styles.panelSheet : ""} ${dragging ? styles.panelDragging : ""}`}
      style={panelStyle}
      aria-label={t("agentTitle", lang)}
    >
      <header className={styles.header}>
        <span className={styles.titleIcon} aria-hidden="true">
          ✦
        </span>
        <strong className={styles.title}>{t("agentTitle", lang)}</strong>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.sessionsBtn}
            onClick={toggleSessions}
            aria-label={t("agentSessions", lang)}
            aria-expanded={sessionsOpen}
          >
            💬 {t("agentSessions", lang)}
          </button>
          {user && (
            <button
              type="button"
              className={styles.memoryBtn}
              onClick={toggleMemories}
              aria-label={t("agentMemory", lang)}
              aria-expanded={memoriesOpen}
            >
              🧠 {t("agentMemory", lang)}
              {showMemoryBadge && (
                <span className={styles.memoryBadge} aria-hidden="true">
                  {memories.length}
                </span>
              )}
            </button>
          )}
          <button type="button" className={styles.close} onClick={onClose} aria-label={t("agentClose", lang)}>
            ✕
          </button>
        </div>
      </header>

      {/* 会话弹层(glass 卡,面板内嵌,与记忆弹层同体系;登录/guest 均可用):
          列表(标题 + 相对时间 + 删除 ×,当前会话蓝底高亮 + ●;**流式中的会话
          显示「进行中」弱化蓝点标记**)+ 新建会话 + 空态。 */}
      {sessionsOpen && (
        <div className={styles.sessionsPanel} role="region" aria-label={t("agentSessions", lang)}>
          <div className={styles.sessionsHead}>
            <span className={styles.sessionsTitle}>💬 {t("agentSessions", lang)}</span>
            <button type="button" className={styles.sessionsNew} onClick={newSession}>
              ＋ {t("agentSessionNew", lang)}
            </button>
          </div>
          {sessionList.length === 0 ? (
            <p className={styles.sessionsEmpty}>{t("agentSessionEmpty", lang)}</p>
          ) : (
            <ul className={styles.sessionsList}>
              {sessionList.map((s) => {
                const isActive = s.id === sessionState.activeId;
                const isRunning = isStreaming(streams, s.id);
                return (
                  <li key={s.id} className={isActive ? styles.sessionRowActive : styles.sessionRow}>
                    <button
                      type="button"
                      className={styles.sessionMain}
                      onClick={() => switchToSession(s.id)}
                      aria-current={isActive ? "true" : undefined}
                    >
                      <span className={styles.sessionDot} aria-hidden="true">
                        {isActive ? "●" : "○"}
                      </span>
                      <span className={styles.sessionTitle}>{s.title}</span>
                      {isRunning && (
                        <span
                          className={styles.sessionStreaming}
                          role="status"
                          title={t("agentSessionStreaming", lang)}
                          aria-label={t("agentSessionStreaming", lang)}
                        />
                      )}
                      <span className={styles.sessionTime}>{sessionTimeLabel(relativeTime(s.updatedAt, Date.now()), lang)}</span>
                    </button>
                    <button
                      type="button"
                      className={styles.sessionDelete}
                      onClick={() => deleteSession(s.id)}
                      aria-label={t("agentSessionDelete", lang)}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* 记忆弹层(liquid glass 卡,面板内嵌;登录用户打开时渲染):标题「🧠 记忆 · N」
          计数徽章(蓝底白字圆角)+ 清除(橙边 hover 红);条目卡片式(soft-strong 底、
          圆角 12px、12px 内边距、行距 8px、删除 × hover 红);加载三点 / 空态 /
          失败弱提示 + 重试;与「清屏」互不相干(记忆跨会话)。 */}
      {user && memoriesOpen && (
        <div className={styles.memoryPanel} role="region" aria-label={t("agentMemory", lang)}>
          <div className={styles.memoryHead}>
            <span className={styles.memoryTitle}>
              🧠 {t("agentMemory", lang)}
              {memoryView === "list" && <span className={styles.memoryCountBadge}>{memories.length}</span>}
            </span>
            {memoryView === "list" && (
              <button type="button" className={styles.memoryClear} onClick={clearMemories}>
                🗑 {t("agentMemoryClear", lang)}
              </button>
            )}
          </div>
          {memoryView === "loading" && (
            <p className={styles.memoryDots} role="status" aria-label={t("agentMemoryLoading", lang)}>
              <span className={styles.memoryDot} aria-hidden="true" />
              <span className={styles.memoryDot} aria-hidden="true" />
              <span className={styles.memoryDot} aria-hidden="true" />
            </p>
          )}
          {memoryView === "error" && (
            <p className={styles.memoryError}>
              <span className={styles.memoryHint}>{t("agentMemoryError", lang)}</span>
              <button type="button" className={styles.memoryRetry} onClick={() => setMemoriesRefresh((r) => r + 1)}>
                {t("retry", lang)}
              </button>
            </p>
          )}
          {memoryView === "empty" && <p className={styles.memoryEmpty}>{t("agentMemoryEmpty", lang)}</p>}
          {memoryView === "list" && (
            <ul className={styles.memoryList}>
              {memories.map((m) => (
                <li key={m.id} className={styles.memoryRow}>
                  <span className={styles.memoryContent}>{m.content}</span>
                  <button
                    type="button"
                    className={styles.memoryDelete}
                    onClick={() => void deleteMemory(m.id)}
                    aria-label={t("agentMemoryDelete", lang)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tool && (
        <div className={styles.toolBar} role="status">
          <span className={styles.toolDot} aria-hidden="true" />
          {t("agentToolRunning", lang).replace("{name}", toolCategoryName(tool.name, lang))}
        </div>
      )}

      <div ref={listRef} className={styles.list}>
        {messages.length === 0 && !streaming && <p className={styles.welcome}>{t("agentWelcome", lang)}</p>}
        {messages.map((m, i) => (
          <div key={i} className={`${styles.msg} ${m.role === "user" ? styles.msgUser : styles.msgAssistant}`}>
            {/* 气泡条件渲染(2026-08-22 ws-bubble):assistant 内容为空(trim 后)→ 不渲染
                气泡 div(纯工具轮只显示工具活动;避免空白气泡);动作按钮/工具列表在
                气泡之外各自渲染,不受影响。 */}
            {m.role === "user" || m.content.trim() ? (
              <div className={m.role === "user" ? styles.bubbleUser : styles.bubbleAssistant}>
                {m.role === "assistant" ? (
                  <MarkdownText text={stripActionJsonBlocks(m.content)} lang={lang} />
                ) : (
                  m.content
                )}
              </div>
            ) : null}
            {m.role === "assistant" && m.tools && m.tools.length > 0 && (
              <ul className={styles.toolActivity} aria-label={t("agentToolsSection", lang)}>
                {m.tools.map((toolItem, j) => (
                  <li key={j} className={`${styles.toolRow} ${toolItem.status === "error" ? styles.toolRowError : ""}`}>
                    <span className={styles.toolStatus} aria-hidden="true">
                      {toolItem.status === "start" ? "⟳" : toolItem.status === "done" ? "✓" : "✗"}
                    </span>
                    <span className={styles.toolName}>{toolCategoryName(toolItem.name, lang)}</span>
                    {toolItem.status === "error" && (
                      <span className={styles.toolSummary}>{t("agentToolFailed", lang)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {m.role === "assistant" && m.actions && m.actions.length > 0 && (
              <div className={styles.actions}>
                {m.actions.map((a, j) => (
                  <button key={j} type="button" className={styles.actionBtn} onClick={() => replayAction(a)}>
                    {actionLabel(a, lang)}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {streaming && !lastIsAssistant && (
          <div className={`${styles.msg} ${styles.msgAssistant}`}>
            {/* 流式输入指示(2026-08-22 ws-bubble):三点跳动,纯视觉无文字,不再显示思考提示 */}
            <div className={`${styles.bubbleAssistant} ${styles.typing}`} role="status" aria-label={t("agentTyping", lang)}>
              <span className={styles.typingDot} aria-hidden="true" />
              <span className={styles.typingDot} aria-hidden="true" />
              <span className={styles.typingDot} aria-hidden="true" />
            </div>
          </div>
        )}
        {notConfigured && <p className={styles.notice}>{t("agentNotConfigured", lang)}</p>}
        {fatalError && <p className={styles.notice}>{fatalError}</p>}
        {/* 完成/停止显式状态:流结束后渲染在消息列表尾部(弱化小字);流式期间不显示 */}
        {completion && !streaming && (
          <p className={styles.completion} role="status">
            {completion === "done"
              ? `✓ ${t("agentDone", lang)}${truncated ? ` · ${t("agentTruncated", lang)}` : ""}`
              : `■ ${t("agentStopped", lang)}`}
          </p>
        )}
      </div>

      <footer className={styles.footer}>
        <div className={styles.inputRow}>
          <input
            className={styles.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
            }}
            placeholder={t("agentInput", lang)}
            aria-label={t("agentInput", lang)}
            disabled={streaming}
          />
          {streaming ? (
            <button
              type="button"
              className={`${styles.send} ${styles.sendStop}`}
              onClick={stop}
              aria-label={t("agentStop", lang)}
            >
              ■ {t("agentStop", lang)}
            </button>
          ) : (
            <button
              type="button"
              className={styles.send}
              onClick={() => send()}
              disabled={!input.trim() || streaming}
              aria-label={t("agentSend", lang)}
            >
              {t("agentSend", lang)}
            </button>
          )}
        </div>
        <div className={styles.controls}>
          <button type="button" className={styles.controlBtn} onClick={clearScreen} aria-label={t("agentClear", lang)}>
            {t("agentClear", lang)}
          </button>
          <button type="button" className={styles.controlBtn} onClick={undo} disabled={!canUndo} aria-label={t("agentUndo", lang)}>
            {t("agentUndo", lang)}
          </button>
        </div>
      </footer>
    </section>
  );
}
