"use client";

// AI Agent 聊天面板:360px × 70vh liquid glass 卡片浮层,**以悬浮球为锚实时跟随**
// (transform 驱动,computePanelPlacement 纯函数;拖动球时同步移动,松手平滑归位)。
// 移动端(≤767px)与极窄视口 → 全宽底部 sheet(参照 mobileDrawer 动效)。
// - 消息列表(用户纯文本 / 助手 MarkdownText 渲染,助手侧可含建议卡片)+ 输入框 +
//   发送/停止/撤销;
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
//   切换/新建会话若 streaming 先 stop;完成/停止状态行按当前会话;
// - 「停止」→ abort(链到 fetch);「撤销」→ executor.undo()。

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import styles from "./agent-panel.module.css";
import { t, type Language } from "@/lib/i18n";
import type { AccountUser } from "@/lib/account";
import type { AgentAction, AgentEvent } from "@/lib/agent/types";
import type { MapBridge } from "@/lib/agent-map-bridge";
import { reduceAgentEvent, stripActionJsonBlocks, type AgentMessage, type ToolActivity } from "@/lib/agent-panel-state";
import { streamAgentChat, type AgentChatRequest } from "./agent-chat-client";
import {
  createAgentMapExecutor,
  resolveCompletion,
  type AgentCompletionState,
  type AgentMapExecutor,
  type AgentMapExecutorCallbacks,
  type AgentToolInfo,
} from "./agent-map-executor";
import { computePanelPlacement, type BallRect, type BallSnapEdge, type ViewportSize } from "@/lib/agent-panel-placement";
import {
  appendMessage,
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
  /** 悬浮球当前矩形(viewport 坐标);面板以此为锚实时跟随。 */
  ballRect: BallRect;
  /** 球正在拖拽:面板关闭吸附过渡,transform 跟手。 */
  dragging: boolean;
  /** 球当前吸附边缘(拖拽中/未吸附为 null → 面板按球心半区分侧,旧行为)。 */
  snapEdge: BallSnapEdge | null;
  onClose: () => void;
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

export function AgentPanel({ bridge, lang, user, ballRect, dragging, snapEdge, onClose }: Props) {
  // 会话存储(多会话,localStorage):单源真相;messages = 当前会话消息工作副本,
  // 流式期间只改副本,在 发送/完成/停止/切换 等边界经 saveMessages 落库。
  const [sessionState, setSessionState] = useState<AgentSessionState>(initSessionState);
  const [messages, setMessages] = useState<AgentMessage[]>(() => {
    const active = sessionState.sessions.find((s) => s.id === sessionState.activeId);
    return active ? active.messages : [];
  });
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [tool, setTool] = useState<AgentToolInfo | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  // 会话弹层:登录/guest 均可用(会话是本地功能,与账号无关)。
  const [sessionsOpen, setSessionsOpen] = useState(false);
  // 记忆弹层:打开(登录)时拉取列表;失败弱提示;不随「清屏」清除(记忆跨会话)。
  // memoriesRefresh:打开弹层/重试时 +1 触发重新拉取;已加载后的静默刷新不闪加载态。
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const [memoriesRefresh, setMemoriesRefresh] = useState(0);
  const [memories, setMemories] = useState<AgentMemoryItem[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  const [memoriesError, setMemoriesError] = useState(false);
  // 完成/停止显式状态:done 事件 → 'done';用户停止 → 'stopped';新消息/清屏清零。
  // truncated 标记 done 事件携带的截断说明(「已达回答上限」弱提示)。
  const [completion, setCompletion] = useState<AgentCompletionState>(null);
  const [truncated, setTruncated] = useState(false);
  // done 事件是否已到达(finally 判定用:setState 异步,ref 同步可靠)
  const doneRef = useRef(false);
  // undo 可用性重渲染信号(执行器实例在 ref 中,栈变化不触发渲染)
  const [, setUndoVersion] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const langRef = useRef(lang);
  langRef.current = lang;
  // 会话/消息镜像:回调内读最新值(避免闭包陈旧;与 langRef 同模式)。
  const sessionStateRef = useRef(sessionState);
  sessionStateRef.current = sessionState;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // 当前流所属会话 id:send 时固定;finally/完成时落库目标(切换后仍写回旧会话)。
  const streamSessionIdRef = useRef<string | null>(sessionState.activeId);

  /** 消息状态入口:setMessages + 同步镜像(ref 写入幂等,供事件回调读最新副本)。 */
  const setMessagesBoth = useCallback((updater: AgentMessage[] | ((prev: AgentMessage[]) => AgentMessage[])) => {
    setMessages((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      messagesRef.current = next;
      return next;
    });
  }, []);

  /** 落库:把某会话消息快照写入 localStorage(store 纯函数 + 持久化)。 */
  const persist = useCallback((state: AgentSessionState) => {
    if (typeof window === "undefined") return;
    saveSessionState(window.localStorage, state);
  }, []);

  /** 把工作副本快照存进指定会话(流完成/停止/切换前)。 */
  const persistSessionMessages = useCallback(
    (sessionId: string | null, msgs: AgentMessage[]) => {
      if (!sessionId) return;
      setSessionState((prev) => {
        const next = saveMessages(prev, sessionId, msgs);
        sessionStateRef.current = next;
        persist(next);
        return next;
      });
    },
    [persist],
  );

  /**
   * 流完成/停止时落库:经 setMessages 函数式更新读「flush 时」的最终消息
   * (同 tick 内 delta+done 连发时,ref 可能还没被 React flush,函数式 prev 才可靠)。
   */
  const flushMessagesToSession = useCallback(
    (sessionId: string | null) => {
      if (!sessionId) return;
      setMessages((prev) => {
        persistSessionMessages(sessionId, prev);
        return prev;
      });
    },
    [persistSessionMessages],
  );

  /** 会话切换/新建/删除后的 UI 态复位(完成/停止/工具/错误均按当前会话)。 */
  const resetStreamUi = useCallback(() => {
    doneRef.current = false;
    setCompletion(null);
    setTruncated(false);
    setNotConfigured(false);
    setFatalError(null);
    setTool(null);
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

  const placement = useMemo(
    () => computePanelPlacement(ballRect, panelSize, viewport, snapEdge ?? undefined),
    [ballRect, panelSize, viewport, snapEdge],
  );
  const isSheet = placement.mode === "sheet";
  // side 模式:transform 锚定(--px/--py 供 CSS translate3d 与入场动画共用)
  const panelStyle: CSSProperties | undefined = isSheet
    ? undefined
    : ({ "--px": `${placement.left}px`, "--py": `${placement.top}px` } as CSSProperties);

  // ---- 渲染回调(供执行器分流;bridge 缺失时面板直接渲染无地图事件)----
  // 消息变更统一走 reduceAgentEvent 纯状态机(按轮拆分/归并,见 lib/agent-panel-state.ts)
  const handleDelta = useCallback((text: string) => {
    setMessagesBoth((prev) => reduceAgentEvent(prev, { type: "delta", text }));
  }, [setMessagesBoth]);

  const handleTool = useCallback((info: AgentToolInfo) => {
    // 顶部状态条:只反映运行中的工具
    setTool(info.status === "start" ? info : null);
    setMessagesBoth((prev) =>
      reduceAgentEvent(prev, { type: "tool", name: info.name, status: info.status, summary: info.summary }),
    );
  }, [setMessagesBoth]);

  const handleDone = useCallback((truncated?: boolean) => {
    setTool(null);
    doneRef.current = true;
    setTruncated(Boolean(truncated));
    setCompletion("done");
    // 完成即把整份工作副本落库(当前流所属会话);切换/删除场景由对应 handler
    // 存好旧会话,此处若再存会把新会话消息写进旧会话,故仅当前会话时落库
    if (streamSessionIdRef.current === sessionStateRef.current.activeId) {
      flushMessagesToSession(streamSessionIdRef.current);
    }
  }, [flushMessagesToSession]);

  const handleError = useCallback((code: string) => {
    setTool(null);
    if (code === "LLM_UNCONFIGURED") setNotConfigured(true);
    else if (code === "RATE_LIMITED") setFatalError(t("agentRateLimited", langRef.current));
    else setFatalError(t("agentError", langRef.current));
  }, []);

  const handleAction = useCallback((action: AgentAction) => {
    // 动作已执行:在消息底部渲染「重放」建议卡片
    setMessagesBoth((prev) => reduceAgentEvent(prev, { type: "action", action }));
    setUndoVersion((v) => v + 1);
  }, [setMessagesBoth]);

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

  /** 统一事件入口:有执行器走执行器(动作落地地图),否则只渲染无地图事件 */
  const dispatchEvent = useCallback(
    (ev: AgentEvent) => {
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
    async (req: AgentChatRequest) => {
      const controller = new AbortController();
      abortRef.current = controller;
      doneRef.current = false;
      setStreaming(true);
      try {
        for await (const ev of streamAgentChat(req, controller.signal)) {
          dispatchEvent(ev);
        }
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          setFatalError(t("agentError", langRef.current));
        }
      } finally {
        abortRef.current = null;
        setStreaming(false);
        setTool(null);
        // 完成状态以 finally 为准(done 事件 → 'done';用户停止 → 'stopped';异常 → null);
        // 仅当流所属会话仍是当前会话时写状态行(切换/删除后不污染新会话视图)
        if (streamSessionIdRef.current === sessionStateRef.current.activeId) {
          setCompletion(resolveCompletion(doneRef.current, controller.signal.aborted));
          // 工作副本落库(切换/删除场景已由 handler 存好旧会话,此处再存会把
          // 新会话消息写进旧会话,故仅当前会话时落库;会话已删 → store no-op)
          flushMessagesToSession(streamSessionIdRef.current);
        }
      }
    },
    [dispatchEvent, flushMessagesToSession],
  );

  const send = useCallback(
    (text?: string) => {
      const content = (text ?? input).trim();
      if (!content || streaming) return;
      const isFirst = messagesRef.current.length === 0;
      const userMsg: AgentMessage = { role: "user", content };
      const nextMessages = [...messagesRef.current, userMsg];
      setMessagesBoth(nextMessages);
      setInput("");
      setNotConfigured(false);
      setFatalError(null);
      setTool(null);
      // 新消息开始:清零完成状态(done/stopped 不再显示)
      doneRef.current = false;
      setCompletion(null);
      setTruncated(false);
      // 会话存储:无当前会话 → 先建空会话;appendMessage 落库(刷新/中断保留本条用户消息)
      let state = sessionStateRef.current;
      let sessionId = state.activeId;
      if (!sessionId) {
        sessionId = createSessionId();
        state = createSession(state, { id: sessionId });
      }
      state = appendMessage(state, sessionId, userMsg);
      sessionStateRef.current = state;
      setSessionState(state);
      persist(state);
      streamSessionIdRef.current = sessionId;
      // 新会话首条自动带视口快照(bridge.getSnapshot() → viewport 参数)
      const snapshot = bridgeRef.current?.getSnapshot() ?? null;
      const req: AgentChatRequest = {
        messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        ...(isFirst && snapshot ? { viewport: { center: snapshot.center, zoom: snapshot.zoom } } : {}),
        lang: langRef.current,
      };
      void runStream(req);
    },
    [input, streaming, setMessagesBoth, runStream, persist],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const undo = useCallback(() => {
    if (executorRef.current?.undo()) setUndoVersion((v) => v + 1);
  }, []);

  // 清屏:清覆盖物(仅 overlay 类 undo 条目)+ 清当前会话消息(会话条目保留,
  // 标题重置「新会话」,记忆不动)+ 清状态;相机/select 逆操作保留(可继续撤销)。
  // 流式期间禁用(不打断回答)。
  const clearScreen = useCallback(() => {
    executorRef.current?.clearOverlays();
    setUndoVersion((v) => v + 1); // clearOverlays 可能改变 canUndo
    const cur = sessionStateRef.current;
    if (cur.activeId) {
      const next = saveMessages(cur, cur.activeId, []);
      sessionStateRef.current = next;
      setSessionState(next);
      persist(next);
    }
    setMessagesBoth([]);
    resetStreamUi();
  }, [persist, setMessagesBoth, resetStreamUi]);

  /** 切换会话:streaming 先 stop;工作副本落库旧会话 → 载入目标会话消息;状态按新会话。 */
  const switchToSession = useCallback(
    (id: string) => {
      if (streaming) stop();
      const cur = sessionStateRef.current;
      if (cur.activeId === id) {
        setSessionsOpen(false); // 已是当前会话:只关弹层
        return;
      }
      let next = cur;
      if (cur.activeId) {
        next = saveMessages(next, cur.activeId, messagesRef.current);
      }
      next = storeSwitchSession(next, id);
      const target = next.sessions.find((s) => s.id === id);
      sessionStateRef.current = next;
      setSessionState(next);
      persist(next);
      if (target) {
        setMessagesBoth(target.messages);
        resetStreamUi();
        setSessionsOpen(false);
      }
      // 未知 id:仅提交落库(保存生效),消息/UI 不动
    },
    [streaming, stop, persist, setMessagesBoth, resetStreamUi],
  );

  /** 新建会话:streaming 先 stop;工作副本落库旧会话 → 空消息。 */
  const newSession = useCallback(() => {
    if (streaming) stop();
    const cur = sessionStateRef.current;
    let next = cur;
    if (cur.activeId) {
      next = saveMessages(next, cur.activeId, messagesRef.current);
    }
    next = createSession(next);
    sessionStateRef.current = next;
    setSessionState(next);
    persist(next);
    setMessagesBoth([]);
    resetStreamUi();
    setSessionsOpen(false);
  }, [streaming, stop, persist, setMessagesBoth, resetStreamUi]);

  /** 删除会话:删当前且 streaming → 先 stop;store 处理「切最近 / 全删建新」。 */
  const deleteSession = useCallback(
    (id: string) => {
      const cur = sessionStateRef.current;
      if (cur.activeId === id && streaming) stop();
      const next = storeDeleteSession(cur, id);
      if (next === cur) return; // 未知 id:不动
      sessionStateRef.current = next;
      setSessionState(next);
      persist(next);
      if (cur.activeId === id) {
        const active = next.sessions.find((s) => s.id === next.activeId);
        setMessagesBoth(active ? active.messages : []);
        resetStreamUi();
      }
    },
    [streaming, stop, persist, setMessagesBoth, resetStreamUi],
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
      className={`${styles.panel} ${isSheet ? styles.panelSheet : ""} ${dragging ? styles.panelDragging : ""}`}
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
          列表(标题 + 相对时间 + 删除 ×,当前会话蓝底高亮 + ●)+ 新建会话 + 空态。 */}
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
          <button
            type="button"
            className={styles.send}
            onClick={() => send()}
            disabled={!input.trim() || streaming}
            aria-label={t("agentSend", lang)}
          >
            {t("agentSend", lang)}
          </button>
        </div>
        <div className={styles.controls}>
          <button type="button" className={styles.controlBtn} onClick={stop} disabled={!streaming} aria-label={t("agentStop", lang)}>
            {t("agentStop", lang)}
          </button>
          <button type="button" className={styles.controlBtn} onClick={undo} disabled={!canUndo} aria-label={t("agentUndo", lang)}>
            {t("agentUndo", lang)}
          </button>
          <button type="button" className={styles.controlBtn} onClick={clearScreen} disabled={streaming} aria-label={t("agentClear", lang)}>
            {t("agentClear", lang)}
          </button>
        </div>
      </footer>
    </section>
  );
}
