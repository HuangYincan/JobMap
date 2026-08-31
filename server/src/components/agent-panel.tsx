"use client";

// AI Agent 聊天面板:360px × 70vh 霜面卡片浮层,**以悬浮球为锚实时跟随**
// (transform 驱动,computePanelPlacement 纯函数;拖动球时同步移动,松手平滑归位)。
// 移动端(≤767px):内嵌抽屉 agent sheet(铺平、无第二张玻璃卡);默认半屏露出地图,
// 再点工具栏 ✦ 回探索。极窄桌面视口仍走全宽底部 sheet。
//
// 2026-08-31 UI:顶栏仅 ✦ 助手 + 清屏/撤销/关闭;无会话/记忆弹层。输入为圆角
// composer + 圆形发送。清屏 abort 当前流并丢掉未完成助手输出(不归档)。
// 流式中输入可打字;有字再发送 = 打断(abort + discardTrailingAssistants + 新一轮);
// 输入为空点发送位 = 停止(保留已输出)。迟到 SSE 用 controller 身份校验丢弃。
// 移动内嵌顶栏去掉 ✦(工具栏已是入口)与关闭钮;composer 与探索搜索条同款。

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import styles from "./agent-panel.module.css";
import { t, type Language } from "@/lib/i18n";
import type { AccountUser } from "@/lib/account";
import type { AgentAction, AgentEvent } from "@/lib/agent/types";
import type { MapBridge } from "@/lib/agent-map-bridge";
import type { RouteOverlayMeta } from "@/lib/navigation/route-client";
import { discardTrailingAssistants, stripActionJsonBlocks, type AgentMessage, type ToolActivity } from "@/lib/agent-panel-state";
import { agentChatMapFields, streamAgentChat, toAgentChatMessages, type AgentChatRequest } from "./agent-chat-client";
import {
  createAgentMapExecutor,
  type AgentMapExecutor,
  type AgentMapExecutorCallbacks,
  type AgentToolInfo,
} from "./agent-map-executor";
import { computePanelPlacement, type BallRect, type BallSnapEdge, type ViewportSize } from "@/lib/agent-panel-placement";
import {
  abortAllStreams,
  finishStreamIfCurrent,
  getStreamMessages,
  isCurrentController,
  isStreaming,
  markDone,
  markStreamError,
  removeStream,
  routeAction,
  routeDelta,
  routeImages,
  routeTool,
  startStream,
  stopStream,
  EMPTY_STREAM_MAP,
  type SessionStreamMap,
} from "@/lib/agent-stream-store";
import {
  appendMessage,
  createSession,
  createSessionId,
  emptyState,
  loadSessionState,
  saveMessages,
  saveSessionState,
  type AgentSessionState,
} from "@/lib/agent-session-store";
import { MarkdownText } from "./markdown-text";

export type { AgentMessage, ToolActivity } from "@/lib/agent-panel-state";

interface Props {
  bridge: MapBridge | null;
  lang: Language;
  /** 登录态;记忆走后端工具,面板不再渲染管理入口。MapShell/AgentBall 仍透传。 */
  user: AccountUser | null;
  /** 悬浮球当前矩形(viewport 坐标);面板以此为锚实时跟随。嵌入式(drawer sheet)实例不传。 */
  ballRect?: BallRect | null;
  /** 球正在拖拽:面板关闭吸附过渡,transform 跟手。 */
  dragging?: boolean;
  /** 球当前吸附边缘(拖拽中/未吸附为 null → 面板按球心半区分侧,旧行为)。 */
  snapEdge?: BallSnapEdge | null;
  onClose: () => void;
  /** 关闭动画结束(仅桌面浮层);由 AgentBall 卸掉面板。 */
  onExitEnd?: () => void;
  /** 正在播放关闭动画。 */
  closing?: boolean;
  /** 用户定位(GCJ-02);每条请求带上,岗位/附近检索起点优先于视野中心。 */
  userLocation?: { lng: number; lat: number } | null;
  /** 内嵌模式(ws-ae):drawer 内 agent sheet 渲染(mobileSheet "agent"),
   *  不做锚点跟随定位(placement/panelStyle 跳过),随抽屉流填满 sheet body;
   *  无独立「返回」(再点工具栏 ✦ 回探索)。 */
  embedded?: boolean;
  onRouteMeta?: (meta: RouteOverlayMeta) => void;
  onRouteError?: (code: string) => void;
  onRouteLoading?: () => void;
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
      return t("agentShowRoute", lang);
  }
}

function routeCardHint(action: AgentAction, lang: Language): string {
  if (action.type !== "showRoute") return t("agentRouteHint", lang);
  const extra = action.payload as { routeId: string; quality?: string; durationMinutes?: number };
  const bits: string[] = [];
  if (typeof extra.quality === "string" && extra.quality.length > 0) bits.push(extra.quality);
  if (typeof extra.durationMinutes === "number" && Number.isFinite(extra.durationMinutes)) {
    bits.push(`${extra.durationMinutes} ${t("commuteMinutes", lang)}`);
  }
  bits.push(t("agentRouteHint", lang));
  return bits.join(" · ");
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

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function IconUndo() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 14H4V9" />
      <path d="M4 9c2.2-3.8 6.8-6 11.2-4.8A8 8 0 1 1 5.2 16" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function IconSend() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  );
}

function IconStop() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
    </svg>
  );
}

export function AgentPanel({
  bridge,
  lang,
  ballRect,
  dragging,
  snapEdge,
  onClose,
  onExitEnd,
  closing = false,
  userLocation = null,
  embedded = false,
  onRouteMeta,
  onRouteError,
  onRouteLoading,
}: Props) {
  const [sessionState, setSessionState] = useState<AgentSessionState>(initSessionState);
  const [streams, setStreams] = useState<SessionStreamMap>(EMPTY_STREAM_MAP);
  const [input, setInput] = useState("");
  const [, setUndoVersion] = useState(0);

  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const langRef = useRef(lang);
  langRef.current = lang;
  const userLocationRef = useRef(userLocation);
  userLocationRef.current = userLocation;
  const onRouteMetaRef = useRef(onRouteMeta);
  onRouteMetaRef.current = onRouteMeta;
  const onRouteErrorRef = useRef(onRouteError);
  onRouteErrorRef.current = onRouteError;
  const onRouteLoadingRef = useRef(onRouteLoading);
  onRouteLoadingRef.current = onRouteLoading;
  const onExitEndRef = useRef(onExitEnd);
  onExitEndRef.current = onExitEnd;
  const sessionStateRef = useRef(sessionState);
  sessionStateRef.current = sessionState;
  const streamsRef = useRef<SessionStreamMap>(streams);
  streamsRef.current = streams;
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
      if (next === cur) return;
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

  const [viewport, setViewport] = useState<ViewportSize>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [panelSize, setPanelSize] = useState({
    width: 360,
    height: Math.round((typeof window !== "undefined" ? window.innerHeight : 0) * 0.7),
  });
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    setPanelSize({ width: el.offsetWidth, height: el.offsetHeight });
  }, [viewport]);

  const placement = useMemo(
    () => (embedded || !ballRect ? null : computePanelPlacement(ballRect, panelSize, viewport, snapEdge ?? undefined)),
    [embedded, ballRect, panelSize, viewport, snapEdge],
  );
  const isSheet = placement ? placement.mode === "sheet" : false;
  const panelStyle: CSSProperties | undefined =
    placement && placement.mode === "side"
      ? ({ "--px": `${placement.left}px`, "--py": `${placement.top}px` } as CSSProperties)
      : undefined;

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
      if (
        code === "EXPIRED" ||
        code === "FORBIDDEN" ||
        code === "NOT_FOUND" ||
        code === "UNAUTHORIZED" ||
        code === "OFFLINE" ||
        code === "INVALID" ||
        code === "INTERNAL"
      ) {
        onRouteErrorRef.current?.(code);
        return;
      }
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
      const sid = streamSessionRef.current;
      if (sid) setStreamsBoth((prev) => routeAction(prev, sid, action));
      setUndoVersion((v) => v + 1);
    },
    [setStreamsBoth],
  );

  const handleImages = useCallback(
    (images: Array<{ url: string; alt?: string }>) => {
      const sid = streamSessionRef.current;
      if (sid) setStreamsBoth((prev) => routeImages(prev, sid, images));
    },
    [setStreamsBoth],
  );

  const bridgeRef = useRef<MapBridge | null>(null);
  const executorRef = useRef<AgentMapExecutor | null>(null);
  if (bridgeRef.current !== bridge) {
    bridgeRef.current = bridge;
    executorRef.current = bridge
      ? createAgentMapExecutor(bridge, {
          onDelta: handleDelta,
          onTool: handleTool,
          onDone: handleDone,
          onError: handleError,
          onAction: handleAction,
          onRouteMeta: (meta) => onRouteMetaRef.current?.(meta),
          onRouteLoading: () => onRouteLoadingRef.current?.(),
        } satisfies AgentMapExecutorCallbacks)
      : null;
  }

  /** 统一事件入口:按流所属 sessionId 分流;迟到事件若 controller 已换代则丢弃。 */
  const dispatchEvent = useCallback(
    (sessionId: string, ev: AgentEvent, controller: AbortController) => {
      if (!isCurrentController(streamsRef.current, sessionId, controller)) return;
      streamSessionRef.current = sessionId;
      if (ev.type === "images") {
        handleImages(ev.images);
        return;
      }
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
          break;
        case "reasoning":
          break;
      }
    },
    [handleDelta, handleTool, handleDone, handleError, handleImages],
  );

  const runStream = useCallback(
    async (sessionId: string, req: AgentChatRequest, controller: AbortController) => {
      try {
        for await (const ev of streamAgentChat(req, controller.signal)) {
          dispatchEvent(sessionId, ev, controller);
        }
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          if (!isCurrentController(streamsRef.current, sessionId, controller)) return;
          setStreamsBoth((prev) =>
            markStreamError(prev, sessionId, { notConfigured: false, fatalText: t("agentError", langRef.current) }),
          );
        }
      } finally {
        setStreamsBoth((prev) => {
          const next = finishStreamIfCurrent(prev, sessionId, controller, controller.signal.aborted);
          const entry = next.get(sessionId);
          if (entry && entry.controller === controller) persistSessionMessages(sessionId, entry.messages);
          return next;
        });
      }
    },
    [dispatchEvent, setStreamsBoth, persistSessionMessages],
  );

  const send = useCallback(
    (text?: string) => {
      const content = (text ?? input).trim();
      if (!content) return;
      const state = sessionStateRef.current;
      const activeId = state.activeId;
      const interrupted = Boolean(activeId && isStreaming(streamsRef.current, activeId));
      let curMessages = sessionMessages(activeId);
      if (interrupted && activeId) {
        const live = getStreamMessages(streamsRef.current, activeId) ?? curMessages;
        curMessages = discardTrailingAssistants(live);
        setStreamsBoth((prev) => removeStream(prev, activeId));
      }
      const userMsg: AgentMessage = { role: "user", content };
      const nextMessages = [...curMessages, userMsg];
      setInput("");
      if (composerRef.current) composerRef.current.style.height = "";
      let nextState = state;
      let sessionId = activeId;
      if (!sessionId) {
        sessionId = createSessionId();
        nextState = createSession(nextState, { id: sessionId });
      } else if (interrupted) {
        nextState = saveMessages(nextState, sessionId, curMessages);
      }
      nextState = appendMessage(nextState, sessionId, userMsg);
      sessionStateRef.current = nextState;
      setSessionState(nextState);
      persist(nextState);
      const controller = new AbortController();
      setStreamsBoth((prev) => startStream(prev, sessionId, controller, nextMessages));
      const snapshot = bridgeRef.current?.getSnapshot() ?? null;
      const req: AgentChatRequest = {
        messages: toAgentChatMessages(nextMessages),
        ...agentChatMapFields(snapshot, userLocationRef.current),
        lang: langRef.current,
      };
      void runStream(sessionId, req, controller);
    },
    [input, sessionMessages, setStreamsBoth, runStream, persist],
  );

  const stop = useCallback(() => {
    stopStream(streamsRef.current, sessionStateRef.current.activeId ?? "");
  }, []);

  const undo = useCallback(() => {
    if (executorRef.current?.undo()) setUndoVersion((v) => v + 1);
  }, []);

  // 清屏:清覆盖物 + abort 当前流(removeStream 使迟到事件 no-op)+ 当前会话消息
  // 置空(不归档,半成品不落库)。停止 ≠ 清屏:停止保留已输出。
  const clearScreen = useCallback(() => {
    executorRef.current?.clearOverlays();
    setUndoVersion((v) => v + 1);
    const cur = sessionStateRef.current;
    const activeId = cur.activeId;
    if (activeId) setStreamsBoth((prev) => removeStream(prev, activeId));
    if (!activeId) return;
    const next = saveMessages(cur, activeId, []);
    sessionStateRef.current = next;
    setSessionState(next);
    persist(next);
  }, [persist, setStreamsBoth]);

  const replayAction = useCallback((action: AgentAction) => {
    executorRef.current?.execute(action);
  }, []);

  useEffect(() => {
    return () => abortAllStreams(streamsRef.current);
  }, []);

  useEffect(() => {
    if (!closing || embedded) return;
    const id = window.setTimeout(() => onExitEndRef.current?.(), 400);
    return () => window.clearTimeout(id);
  }, [closing, embedded]);

  const activeId = sessionState.activeId;
  const activeEntry = activeId ? streams.get(activeId) : undefined;
  const activeSession = activeId ? sessionState.sessions.find((s) => s.id === activeId) : undefined;
  const messages = useMemo(
    () => (activeEntry ? activeEntry.messages : activeSession ? activeSession.messages : []),
    [activeEntry, activeSession],
  );
  const streaming = activeEntry?.streaming ?? false;
  const tool = activeEntry?.tool ?? null;
  const truncated = activeEntry?.truncated ?? false;
  const notConfigured = activeEntry?.notConfigured ?? false;
  const fatalError = activeEntry?.fatalError ?? null;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, tool, streaming]);

  const canUndo = Boolean(executorRef.current?.canUndo());
  const lastIsAssistant = messages[messages.length - 1]?.role === "assistant";
  const showStop = streaming && !input.trim();
  const canSend = Boolean(input.trim());

  const resizeComposer = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

  return (
    <section
      ref={panelRef}
      className={`${styles.panel} ${embedded ? styles.embedded : ""} ${isSheet ? styles.panelSheet : ""} ${dragging ? styles.panelDragging : ""} ${closing ? styles.panelClosing : ""}`}
      style={panelStyle}
      aria-label={t("agentTitle", lang)}
      onAnimationEnd={(e) => {
        if (e.target !== panelRef.current) return;
        if (closing) onExitEndRef.current?.();
      }}
    >
      <header className={styles.header}>
        {!embedded && (
          <span className={styles.titleIcon} aria-hidden="true">
            ✦
          </span>
        )}
        <strong className={styles.title}>{t("agentTitle", lang)}</strong>
        <div className={styles.headerActions}>
          <button type="button" className={styles.iconBtn} onClick={clearScreen} aria-label={t("agentClear", lang)}>
            <IconTrash />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={undo}
            disabled={!canUndo}
            aria-label={t("agentUndo", lang)}
          >
            <IconUndo />
          </button>
          {!embedded && (
            <button type="button" className={styles.close} onClick={onClose} aria-label={t("agentClose", lang)}>
              <IconClose />
            </button>
          )}
        </div>
      </header>

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
            {m.role === "user" || m.content.trim() ? (
              <div className={m.role === "user" ? styles.bubbleUser : styles.bubbleAssistant}>
                {m.role === "assistant" ? (
                  <MarkdownText text={stripActionJsonBlocks(m.content)} lang={lang} />
                ) : (
                  m.content
                )}
              </div>
            ) : null}
            {m.role === "assistant" && m.images && m.images.length > 0 && (
              <ul className={styles.imageStrip} aria-label={t("agentSearchImages", lang)}>
                {m.images.map((img, j) => (
                  <li key={`${img.url}-${j}`}>
                    <a className={styles.imageLink} href={img.url} target="_blank" rel="noopener noreferrer">
                      <img
                        className={styles.imageThumb}
                        src={img.url}
                        alt={img.alt || t("agentSearchImages", lang)}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            )}
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
                  <div key={j} className={styles.actionBlock}>
                    <button type="button" className={styles.actionBtn} onClick={() => replayAction(a)}>
                      {actionLabel(a, lang)}
                    </button>
                    {a.type === "showRoute" && <span className={styles.routeHint}>{routeCardHint(a, lang)}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {streaming && !lastIsAssistant && (
          <div className={`${styles.msg} ${styles.msgAssistant}`}>
            <div className={`${styles.bubbleAssistant} ${styles.typing}`} role="status" aria-label={t("agentTyping", lang)}>
              <span className={styles.typingDot} aria-hidden="true" />
              <span className={styles.typingDot} aria-hidden="true" />
              <span className={styles.typingDot} aria-hidden="true" />
            </div>
          </div>
        )}
        {notConfigured && <p className={styles.notice}>{t("agentNotConfigured", lang)}</p>}
        {fatalError && <p className={styles.notice}>{fatalError}</p>}
        {truncated && !streaming && <p className={styles.notice}>{t("agentTruncated", lang)}</p>}
      </div>

      <footer className={styles.footer}>
        <div className={styles.composer}>
          <textarea
            ref={composerRef}
            className={styles.composerInput}
            value={input}
            rows={1}
            onChange={(e) => {
              setInput(e.target.value);
              resizeComposer(e.target);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={t("agentInput", lang)}
            aria-label={t("agentInput", lang)}
          />
          <div className={styles.composerTools}>
            {showStop ? (
              <button
                type="button"
                className={`${styles.sendFab} ${styles.sendFabStop}`}
                onClick={stop}
                aria-label={t("agentStop", lang)}
              >
                <IconStop />
              </button>
            ) : (
              <button
                type="button"
                className={`${styles.sendFab} ${canSend ? styles.sendFabReady : ""}`}
                onClick={() => send()}
                disabled={!canSend}
                aria-label={t("agentSend", lang)}
              >
                <IconSend />
              </button>
            )}
          </div>
        </div>
      </footer>
    </section>
  );
}
